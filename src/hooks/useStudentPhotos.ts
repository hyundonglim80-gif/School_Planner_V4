// src/hooks/useStudentPhotos.ts
//
// 한 학급의 학생 사진을 화면에 띄울 수 있는 모양으로 내어 준다.
//
// 드라이브를 부르는 일은 전부 lib/studentPhotos.ts가 하고, 여기서는
// '언제 부를 것인가'와 '부르는 동안 화면에 무엇을 보일 것인가'만 다룬다.
import { useState, useEffect, useCallback, useRef } from 'react';
import { getValidGoogleToken, getGoogleTokenQuietly } from '../lib/googleApi';
import {
  loadPhotoFolders,
  connectPhotoFolder,
  connectClassFolder,
  clearClassFolder,
  clearPhotoFolder,
  scanClassPhotos,
  getPhotoUrl,
  uploadStudentPhoto,
  forgetFolderCache,
  PhotoAccessError,
  EMPTY_FOLDERS,
  type PhotoFolders,
  type PhotoFolderConfig,
  type DrivePhotoFile,
  type PhotoScan,
} from '../lib/studentPhotos';
import { matchClassPhotos, classFolderName, type ClassKey } from '../lib/studentPhotoNames';
import { planBulkUpload } from '../lib/photoBulkUpload';

export type PhotoStatus =
  /** 사진 보기가 꺼져 있다. 드라이브를 아예 부르지 않는다. */
  | 'off'
  /** 폴더 설정을 읽는 중 */
  | 'checking'
  /** 사진 목록을 받아오는 중 */
  | 'loading'
  /** 다 받았다 (사진이 한 장도 없을 수도 있다) */
  | 'ready'
  /** 구글 연결이 끊겨 있다. 사용자가 눌러 주면 그때 이어 붙인다. */
  | 'needs-auth'
  /** 폴더에 손이 닿지 않는다. 다시 고르게 해야 한다. */
  | 'error';

export interface StudentPhoto {
  /** 화면에 꽂을 blob 주소 */
  url: string;
  /** 번호까지 맞아떨어진 사진인가 (아니면 이름만으로 되찾은 것) */
  exact: boolean;
  fileName: string;
}

interface Student {
  num: number;
  name: string;
}

/**
 * @param enabled 사진 보기가 켜져 있는가. 꺼져 있으면 드라이브를 부르지 않는다.
 *   명단만 고치러 들어온 사람에게까지 구글을 두드릴 까닭이 없다.
 */
export function useStudentPhotos(cls: ClassKey | null, students: Student[], enabled = true) {
  const [folders, setFolders] = useState<PhotoFolders>(EMPTY_FOLDERS);
  const [status, setStatus] = useState<PhotoStatus>(enabled ? 'checking' : 'off');
  const [error, setError] = useState<string>('');
  /** 학생 번호 -> 사진 */
  const [photos, setPhotos] = useState<Map<number, StudentPhoto>>(new Map());
  const [uploading, setUploading] = useState<number | null>(null);
  /** 여러 장 올리는 중의 진행 (없으면 올리는 중이 아니다) */
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  /** 마지막으로 폴더를 훑은 결과. 사진이 안 붙을 때 까닭을 짚는 데 쓴다. */
  const [scan, setScan] = useState<PhotoScan | null>(null);

  // 명단은 글자를 한 자 칠 때마다 새 배열이 된다. 그대로 의존성에 넣으면
  // 이름을 고치는 동안 드라이브를 수십 번 부르게 되므로, 사진 찾기에 실제로
  // 쓰이는 값만 뽑아 문자열로 견준다.
  const rosterKey = students.map((s) => `${s.num}:${s.name}`).join('|');
  const className = cls ? classFolderName(cls) : '';

  /** 이 학급을 위해 따로 골라 둔 폴더 (없으면 위쪽 폴더에서 찾는다) */
  const classFolder: PhotoFolderConfig | null = className
    ? folders.byClass[className] || null
    : null;
  /** 지금 이 학급이 실제로 보고 있는 폴더 */
  const folder = classFolder || folders.root;

  /**
   * 다시 읽기를 걸기 위한 셈수.
   *
   * ⚠️ 폴더를 고른 뒤 다시 읽는 일을 '폴더 id가 바뀌었는가'에만 맡겼더니,
   *    같은 폴더를 한 번 더 고르면 id가 그대로라 다시 읽기가 안 걸렸다.
   *    그 사이 화면은 '불러오는 중'으로 바꿔 놓았으므로 거기서 멈춰 섰다.
   *    고르는 행위 자체를 셈해서 걸어 준다.
   */
  const [reloadNonce, setReloadNonce] = useState(0);

  // 비동기로 받아온 결과가 뒤늦게 도착해 다른 학급 화면을 덮어쓰지 않게
  // 마지막 요청만 반영한다.
  const runIdRef = useRef(0);
  const studentsRef = useRef(students);
  studentsRef.current = students;

  /** 폴더 설정을 읽는다 (사진 보기를 켤 때 한 번) */
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setStatus('checking');
    loadPhotoFolders()
      .then((f) => {
        if (alive) setFolders(f);
      })
      .catch(() => {
        // 설정을 못 읽어도 앱이 맡아 두는 자리는 그대로 쓸 수 있다
        if (alive) setFolders(EMPTY_FOLDERS);
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  const rootId = folders.root?.id || null;
  const pickedId = classFolder?.id;

  /**
   * 사진을 찾아 온다.
   *
   * interactive가 아니면 구글 권한 창을 띄우지 않는다. 팝업을 여는 것만으로
   * 로그인을 강요하지 않기 위해서다. 토큰이 없으면 'needs-auth'로 멈추고,
   * 사용자가 단추를 누르면 그때 interactive로 다시 부른다.
   */
  const load = useCallback(async (interactive = false) => {
    if (!enabled || !cls || !className) return;
    const runId = ++runIdRef.current;

    setStatus('loading');
    setError('');
    try {
      const token = interactive ? await getValidGoogleToken() : await getGoogleTokenQuietly();
      if (!token) {
        setStatus('needs-auth');
        return;
      }

      const found = await scanClassPhotos(rootId, cls, token, pickedId);
      if (runId !== runIdRef.current) return;
      setScan(found);

      // 사진을 찾을 곳이 없는 것은 잘못이 아니다. 한 장도 안 올렸을 수 있다.
      // 무엇을 보고 그렇게 판단했는지는 scan에 담겨 화면에서 풀어 쓴다.
      if (!found.folderId) {
        setPhotos(new Map());
        setStatus('ready');
        return;
      }

      const files = found.files;
      const matched = matchClassPhotos(files, cls, studentsRef.current);
      const byId = new Map(files.map((f) => [f.id, f] as const));

      // 주소 만들기는 파일마다 따로 실패할 수 있다. 한 장이 안 되어도
      // 나머지는 보여야 하므로 하나씩 감싸서 받는다.
      const entries = await Promise.all(
        [...matched.entries()].map(async ([num, hit]) => {
          const file = byId.get(hit.id) as DrivePhotoFile;
          try {
            const url = await getPhotoUrl(file, token);
            return [num, { url, exact: hit.exact, fileName: hit.name }] as const;
          } catch {
            return null;
          }
        })
      );
      if (runId !== runIdRef.current) return;

      setPhotos(new Map(entries.filter((e): e is NonNullable<typeof e> => e !== null)));
      setStatus('ready');
    } catch (e: any) {
      if (runId !== runIdRef.current) return;
      setStatus('error');
      setError(
        e instanceof PhotoAccessError ? e.message : e?.message || '사진을 불러오지 못했습니다.'
      );
    }
  }, [enabled, cls, className, rootId, pickedId]);

  /** 폴더가 정해졌고 학급이나 명단이 바뀌면 다시 읽는다 */
  useEffect(() => {
    if (!enabled) {
      // 꺼져 있으면 들고 있던 것도 내려놓는다. 다시 켤 때 새로 읽는다.
      setStatus('off');
      setScan(null);
      setPhotos(new Map());
      return;
    }
    if (!className) return;
    void load(false);
    // rosterKey를 넣어 두면 전입생을 넣거나 이름을 고쳤을 때 사진이 따라온다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, rootId, pickedId, className, rosterKey, reloadNonce]);

  /** 고른 폴더가 바뀌었으니 지난 진단을 버린다 (새 폴더 이야기인 것처럼 보인다) */
  const resetView = () => {
    setScan(null);
    setPhotos(new Map());
    setStatus('checking');
    setReloadNonce((n) => n + 1);
  };

  /** 위쪽 폴더를 고른다 */
  const connect = useCallback(async () => {
    const picked = await connectPhotoFolder();
    if (picked) {
      resetView();
      setFolders((f) => ({ ...f, root: picked }));
    }
    return picked;
  }, []);

  /**
   * 이 학급의 폴더를 직접 고른다.
   *
   * drive.file 권한은 고른 폴더의 바로 아래 자식까지만 열어 준다. 위쪽 폴더를
   * 골랐을 때 학급 폴더는 보여도 그 안의 사진은 안 보이는 까닭이다.
   * 학급 폴더를 직접 고르면 사진이 바로 아래 자식이 되어 보인다.
   */
  const connectForClass = useCallback(async () => {
    if (!className) return null;
    const picked = await connectClassFolder(className);
    if (picked) {
      resetView();
      setFolders((f) => ({ ...f, byClass: { ...f.byClass, [className]: picked } }));
    }
    return picked;
  }, [className]);

  /** 이 학급에 골라 둔 폴더를 잊고, 앱이 맡아 두는 자리로 되돌아간다 */
  const forgetClassFolder = useCallback(async () => {
    if (!className) return;
    await clearClassFolder(className);
    resetView();
    setFolders((f) => {
      const next = { ...f.byClass };
      delete next[className];
      return { ...f, byClass: next };
    });
  }, [className]);

  /** 골라 둔 폴더를 모두 잊는다. 앱이 맡아 두는 자리는 그대로 쓴다. */
  const disconnect = useCallback(async () => {
    await clearPhotoFolder();
    setFolders(EMPTY_FOLDERS);
    setScan(null);
    setPhotos(new Map());
    setStatus('checking');
  }, []);

  const upload = useCallback(
    async (student: Student, file: File) => {
      if (!cls) throw new Error('학급을 먼저 골라 주세요.');
      setUploading(student.num);
      try {
        // 올릴 곳은 lib이 정한다. 학급 폴더를 따로 골라 두었으면 거기,
        // 아니면 School_Planner/Students_Poto/2026-3-1 (없으면 만든다).
        await uploadStudentPhoto(cls, student, file, pickedId);
        forgetFolderCache();
        await load(true);
      } finally {
        setUploading(null);
      }
    },
    [cls, pickedId, load]
  );

  /**
   * 여러 장을 한꺼번에 올린다.
   *
   * 파일 이름으로 누구인지 짝짓고(lib/photoBulkUpload.ts), 하나씩 차례로
   * 올린다. 한꺼번에 스물세 개를 던지면 구글이 잠시 막는다.
   * 한 장이 실패해도 나머지는 계속 간다 — 한 장 때문에 처음부터 다시
   * 하게 만들 일이 아니다.
   */
  const uploadMany = useCallback(
    async (fileList: File[]) => {
      if (!cls) throw new Error('학급을 먼저 골라 주세요.');
      const plan = planBulkUpload(fileList, cls, studentsRef.current);
      const failed: string[] = [];

      setBulk({ done: 0, total: plan.matched.length });
      try {
        for (const [i, item] of plan.matched.entries()) {
          try {
            await uploadStudentPhoto(cls, item.student, item.file, pickedId);
          } catch (e) {
            console.warn('사진 올리기 실패:', item.file.name, e);
            failed.push(item.file.name);
          }
          setBulk({ done: i + 1, total: plan.matched.length });
        }
      } finally {
        setBulk(null);
      }

      forgetFolderCache();
      await load(true);
      return { plan, failed };
    },
    [cls, pickedId, load]
  );

  const missing = students.filter((s) => !photos.has(s.num));

  return {
    /** 지금 이 학급이 보고 있는 폴더 */
    folder,
    /** 이 학급을 위해 따로 골라 둔 폴더가 있는가 */
    classFolder,
    folders,
    status,
    error,
    photos,
    /** 사진이 없는 학생들 */
    missing,
    uploading,
    /** 여러 장 올리는 중의 진행 */
    bulk,
    /** 여러 장 한꺼번에 올리기 */
    uploadMany,
    /** 폴더를 훑은 결과 (사진이 안 붙는 까닭을 짚는 데 쓴다) */
    scan,
    connect,
    connectForClass,
    forgetClassFolder,
    disconnect,
    reload: load,
    /** 사용자가 눌러서 구글에 다시 이어 붙인다 (권한 창이 떠도 되는 자리) */
    authorize: () => load(true),
    upload,
  };
}
