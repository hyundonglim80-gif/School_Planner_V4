// src/lib/driveMigration.ts
//
// Firebase Storage에 있던 첨부와 캡처 이미지를 구글 드라이브로 옮긴다.
//
// 기록·메모·일정 문서에는 파일 자체가 아니라 '주소'가 들어 있다. 그래서 옮기는
// 일은 세 가지를 한 벌로 해야 한다.
//   1) 파일을 드라이브로 복사하고
//   2) 문서에 든 주소를 새 주소로 바꾸고
//   3) 원본을 Storage에서 지운다
//
// ⚠️ 3번은 되돌릴 수 없다. 그래서 1번이 정말 끝났는지(드라이브에 그 파일이
//    있는지) 확인한 뒤에만 지운다. 확인 없이 지우면 업로드가 반쯤 실패했을 때
//    파일이 그냥 사라진다.
//
// 주소를 찾고 바꾸는 부분은 따로 떼어 두었다. 문서 모양이 제각각이라(기록은
// entries, 메모는 attachments, 일정은 eventList 안의 attachments) 이 부분에서
// 하나라도 빠뜨리면 그 첨부는 영영 옛 주소를 가리킨 채 남는다.

/** 문서 안에서 찾아낸 첨부 하나 */
export interface FoundFile {
  /** 문서 안 위치. 되돌려 넣을 때 쓴다. */
  path: (string | number)[];
  url: string;
  name: string;
}

const isStorage = (u: unknown): u is string =>
  typeof u === 'string' && /firebasestorage\.googleapis\.com|\.firebasestorage\.app/.test(u);

function nameFromUrl(url: string): string {
  try {
    const decoded = decodeURIComponent(url.split('?')[0]);
    const last = decoded.split('/').pop() || 'file';
    // 업로드할 때 앞에 붙인 타임스탬프를 떼어 이름을 읽기 쉽게 되돌린다
    return last.replace(/^\d{10,}_/, '') || 'file';
  } catch {
    return 'file';
  }
}

/**
 * 문서 데이터에서 Storage 주소를 전부 찾아낸다.
 * 어떤 모양의 문서든 훑을 수 있게 객체·배열을 통째로 내려가며 본다.
 * (기록 entries, 메모 attachments, 일정 eventList 안의 attachments, 그리고
 *  옛 항목이 쓰던 imageUrl 까지 한 번에 걸린다)
 */
export function collectStorageFiles(data: unknown, base: (string | number)[] = []): FoundFile[] {
  const found: FoundFile[] = [];
  const walk = (node: unknown, path: (string | number)[]) => {
    if (isStorage(node)) {
      found.push({ path, url: node, name: nameFromUrl(node) });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, [...path, i]));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, [...path, k]);
      }
    }
  };
  walk(data, base);
  return found;
}

/**
 * 찾아낸 자리의 주소를 새 주소로 갈아 끼운 사본을 돌려준다.
 * 원본은 건드리지 않는다.
 * driveId도 같은 항목에 함께 적어 둔다. 나중에 이미지를 화면에 펼쳐 보여줄 때와
 * 첨부를 지울 때 그 id가 필요하다.
 */
export function applyNewUrls(
  data: unknown,
  changes: { path: (string | number)[]; url: string; driveId: string }[]
): unknown {
  const clone = JSON.parse(JSON.stringify(data));
  for (const c of changes) {
    let node: any = clone;
    for (let i = 0; i < c.path.length - 1; i++) node = node?.[c.path[i]];
    if (!node) continue;
    const last = c.path[c.path.length - 1];
    node[last] = c.url;
    // 주소가 담긴 자리가 객체 안의 'url' 이면 그 객체에 driveId를 달아 둔다.
    if (last === 'url' && typeof node === 'object') node.driveId = c.driveId;
  }
  return clone;
}

/** 옮길 대상이 담긴 컬렉션들 */
export const MIGRATION_COLLECTIONS = ['journals', 'tasks', 'events', 'memos'] as const;

// ── 실제로 옮기는 부분 ────────────────────────────────────────────────
import { collection, getDocs, doc as fsDoc, setDoc } from 'firebase/firestore';
import { ref as storageRef, getBlob, deleteObject } from 'firebase/storage';
import { db, auth, storage } from './firebase';
import { uploadToDrive, existsInDrive, driveUrlToStore } from './driveApi';

export interface MigrationProgress {
  scanned: number;
  total: number;
  moved: number;
  deleted: number;
  failed: number;
  current: string;
}

export interface MigrationResult extends MigrationProgress {
  errors: string[];
  /** 버킷의 CORS 설정이 없어 파일을 내려받지 못한 경우 */
  corsBlocked: boolean;
}

/**
 * 내려받기가 CORS로 막힌 것인가.
 *
 * 브라우저는 다른 주소의 파일을 함부로 읽지 못하게 막는다. 버킷에 '이 사이트에서
 * 읽어도 된다'고 적어 두지 않으면 옮기는 일 자체를 시작할 수 없다.
 * 이때 SDK가 주는 코드가 storage/unauthorized 나 storage/retry-limit-exceeded 라서
 * 권한 문제처럼 보이는데, 실제 원인은 CORS다. 그대로 보여주면 엉뚱한 데를 고치게 된다.
 */
function looksLikeCors(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || err || '');
  return (
    /CORS/i.test(msg) ||
    code === 'storage/unauthorized' ||
    code === 'storage/retry-limit-exceeded' ||
    /ERR_FAILED|Failed to fetch|NetworkError/i.test(msg)
  );
}

export const CORS_HELP = [
  '브라우저가 Firebase Storage의 파일을 읽지 못하도록 막혀 있습니다(CORS).',
  '버킷에 이 사이트를 한 번 등록해 주면 풀립니다. 설치할 것은 없습니다.',
  '',
  '1) console.cloud.google.com 접속 → 오른쪽 위 >_ (Cloud Shell) 실행',
  '2) 저장소의 docs-storage-cors.md 에 적힌 명령을 붙여넣기',
  '3) 다시 이 단추를 누르기',
].join(String.fromCharCode(10));

/**
 * Storage의 파일을 드라이브로 옮긴다.
 *
 * 한 건의 순서: 내려받기 -> 드라이브 업로드 -> 드라이브에 있는지 확인 ->
 * 문서의 주소 교체 -> 그 다음에야 원본 삭제.
 * 중간에 하나라도 실패하면 그 건은 건너뛰고 원본을 남긴다. 파일이 사라지는 것보다
 * 옛 주소가 남아 있는 편이 낫다.
 */
export async function runDriveMigration(
  groupId: string | null,
  onProgress: (p: MigrationProgress) => void
): Promise<MigrationResult> {
  const user = auth.currentUser;
  const p: MigrationResult = {
    scanned: 0, total: 0, moved: 0, deleted: 0, failed: 0, current: '', errors: [], corsBlocked: false,
  };
  if (!user) {
    p.errors.push('로그인이 필요합니다.');
    return p;
  }
  const basePath = groupId ? `groups/${groupId}` : `users/${user.uid}`;

  // 1) 먼저 전부 훑어 몇 건인지 센다 (진행 정도를 보여주기 위해)
  const docsToDo: { colName: string; docId: string; data: any; files: FoundFile[] }[] = [];
  for (const colName of MIGRATION_COLLECTIONS) {
    let snap;
    try {
      snap = await getDocs(collection(db, `${basePath}/${colName}`));
    } catch {
      continue; // 없는 컬렉션은 건너뛴다
    }
    snap.forEach((d) => {
      const data = d.data();
      const files = collectStorageFiles(data);
      if (files.length > 0) docsToDo.push({ colName, docId: d.id, data, files });
    });
  }
  p.total = docsToDo.reduce((n, d) => n + d.files.length, 0);
  onProgress({ ...p });

  // 2) 문서 단위로 옮기고, 그 문서의 주소를 한 번에 바꾼 뒤 원본을 지운다
  for (const item of docsToDo) {
    const changes: { path: (string | number)[]; url: string; driveId: string }[] = [];
    const movedUrls: string[] = [];

    for (const f of item.files) {
      p.scanned++;
      p.current = `${item.colName}/${item.docId} · ${f.name}`;
      onProgress({ ...p });
      try {
        // 내려받기 (SDK를 쓰면 로그인 정보가 붙는다)
        const blob = await getBlob(storageRef(storage, f.url));
        const drive = await uploadToDrive(blob, f.name);
        // ⚠️ 정말 올라갔는지 확인하기 전에는 원본을 지우지 않는다
        if (!(await existsInDrive(drive.id))) {
          throw new Error('드라이브에서 올린 파일을 찾지 못했습니다');
        }
        // 이미지는 화면에 바로 보이는 주소로 저장한다. V3는 저장된 주소를
        // 그대로 <img>에 넣으므로, 내려받기 주소를 넣으면 V3에서 깨진다.
        changes.push({ path: f.path, url: driveUrlToStore(blob.type, drive), driveId: drive.id });
        movedUrls.push(f.url);
        p.moved++;
      } catch (err: any) {
        p.failed++;
        if (looksLikeCors(err)) {
          // 원인이 하나이므로 파일마다 같은 말을 쌓지 않는다. 한 번만 알리고 멈춘다.
          p.corsBlocked = true;
          p.current = '';
          return p;
        }
        p.errors.push(`${f.name}: ${String(err?.message || err)}`);
      }
      onProgress({ ...p });
    }

    if (changes.length === 0) continue;

    // 3) 문서의 주소를 새것으로 바꾼다
    try {
      const next = applyNewUrls(item.data, changes) as Record<string, unknown>;
      await setDoc(fsDoc(db, `${basePath}/${item.colName}`, item.docId), next, { merge: true });
    } catch (err: any) {
      p.errors.push(`${item.colName}/${item.docId} 주소 교체 실패: ${err?.message || err}`);
      p.failed += changes.length;
      continue; // 주소를 못 바꿨으면 원본을 지우면 안 된다
    }

    // 4) 주소까지 바뀐 뒤에야 원본을 지운다
    for (const url of movedUrls) {
      try {
        await deleteObject(storageRef(storage, url));
        p.deleted++;
      } catch (err: any) {
        // 지우기 실패는 치명적이지 않다. 드라이브에 복사됐고 주소도 바뀌었다.
        p.errors.push(`원본 삭제 실패(남아 있음): ${String(err?.message || err).slice(0, 80)}`);
      }
      onProgress({ ...p });
    }
  }

  p.current = '';
  return p;
}
