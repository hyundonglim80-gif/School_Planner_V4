// src/hooks/useStudentPhotos.ts
//
// 한 학급의 학생 사진을 화면에 띄울 수 있는 모양으로 내어 준다.
//
// 드라이브를 부르는 일은 전부 lib/studentPhotos.ts가 하고, 여기서는
// '언제 부를 것인가'와 '부르는 동안 화면에 무엇을 보일 것인가'만 다룬다.
import { useState, useEffect, useCallback, useRef } from 'react';
import { getValidGoogleToken } from '../lib/googleApi';
import {
  loadPhotoFolder,
  connectPhotoFolder,
  clearPhotoFolder,
  scanClassPhotos,
  getPhotoUrl,
  uploadStudentPhoto,
  forgetFolderCache,
  PhotoAccessError,
  type PhotoFolderConfig,
  type DrivePhotoFile,
  type PhotoScan,
} from '../lib/studentPhotos';
import { matchClassPhotos, type ClassKey } from '../lib/studentPhotoNames';

export type PhotoStatus =
  /** 아직 폴더를 고르지 않았다 */
  | 'no-folder'
  /** 폴더 설정을 읽는 중 */
  | 'checking'
  /** 사진 목록을 받아오는 중 */
  | 'loading'
  /** 다 받았다 (사진이 한 장도 없을 수도 있다) */
  | 'ready'
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

export function useStudentPhotos(cls: ClassKey | null, students: Student[]) {
  const [folder, setFolder] = useState<PhotoFolderConfig | null>(null);
  const [status, setStatus] = useState<PhotoStatus>('checking');
  const [error, setError] = useState<string>('');
  /** 학생 번호 -> 사진 */
  const [photos, setPhotos] = useState<Map<number, StudentPhoto>>(new Map());
  const [uploading, setUploading] = useState<number | null>(null);
  /** 마지막으로 폴더를 훑은 결과. 사진이 안 붙을 때 까닭을 짚는 데 쓴다. */
  const [scan, setScan] = useState<PhotoScan | null>(null);

  // 명단은 글자를 한 자 칠 때마다 새 배열이 된다. 그대로 의존성에 넣으면
  // 이름을 고치는 동안 드라이브를 수십 번 부르게 되므로, 사진 찾기에 실제로
  // 쓰이는 값만 뽑아 문자열로 견준다.
  const rosterKey = students.map((s) => `${s.num}:${s.name}`).join('|');
  const clsKey = cls ? `${cls.year}-${cls.grade}-${cls.classNum}` : '';

  // 비동기로 받아온 결과가 뒤늦게 도착해 다른 학급 화면을 덮어쓰지 않게
  // 마지막 요청만 반영한다.
  const runIdRef = useRef(0);
  const studentsRef = useRef(students);
  studentsRef.current = students;

  /** 폴더 설정을 읽는다 (팝업을 열 때 한 번) */
  useEffect(() => {
    let alive = true;
    setStatus('checking');
    loadPhotoFolder()
      .then((f) => {
        if (!alive) return;
        setFolder(f);
        if (!f) setStatus('no-folder');
      })
      .catch(() => {
        if (alive) setStatus('no-folder');
      });
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!folder || !cls || !clsKey) return;
    const runId = ++runIdRef.current;

    setStatus('loading');
    setError('');
    try {
      const token = await getValidGoogleToken();
      if (!token) throw new Error('구글 계정 연결이 필요합니다.');

      const found = await scanClassPhotos(folder.id, cls, token);
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
      // 나머지는 보여야 하므로 allSettled로 받는다.
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
      if (e instanceof PhotoAccessError) {
        setStatus('error');
        setError(e.message);
      } else {
        setStatus('error');
        setError(e?.message || '사진을 불러오지 못했습니다.');
      }
    }
  }, [folder, cls, clsKey]);

  /** 폴더가 정해졌고 학급이나 명단이 바뀌면 다시 읽는다 */
  useEffect(() => {
    if (!folder || !clsKey) return;
    void load();
    // rosterKey를 넣어 두면 전입생을 넣거나 이름을 고쳤을 때 사진이 따라온다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, clsKey, rosterKey]);

  const connect = useCallback(async () => {
    const picked = await connectPhotoFolder();
    if (picked) {
      // 지난 폴더를 훑은 결과가 남아 있으면 새 폴더에 대한 진단인 것처럼 보인다
      setScan(null);
      setPhotos(new Map());
      setFolder(picked);
      setStatus('checking');
    }
    return picked;
  }, []);

  const disconnect = useCallback(async () => {
    await clearPhotoFolder();
    setFolder(null);
    setScan(null);
    setPhotos(new Map());
    setStatus('no-folder');
  }, []);

  const upload = useCallback(
    async (student: Student, file: File) => {
      if (!folder || !cls) throw new Error('사진 폴더를 먼저 연결해 주세요.');
      setUploading(student.num);
      try {
        await uploadStudentPhoto(folder.id, cls, student, file);
        forgetFolderCache();
        await load();
      } finally {
        setUploading(null);
      }
    },
    [folder, cls, load]
  );

  const missing = students.filter((s) => !photos.has(s.num));

  return {
    folder,
    status,
    error,
    photos,
    /** 사진이 없는 학생들 */
    missing,
    uploading,
    /** 폴더를 훑은 결과 (사진이 안 붙는 까닭을 짚는 데 쓴다) */
    scan,
    connect,
    disconnect,
    reload: load,
    upload,
  };
}
