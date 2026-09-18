// src/lib/studentPhotos.ts
//
// 학생 사진을 드라이브에서 가져오고, 올리고, 기기에 재어 둔다.
//
// 첨부 파일을 다루는 driveApi.ts와 따로 두는 까닭이 두 가지 있다.
//
//  1. 공개 설정을 하지 않는다. driveApi는 올린 파일을 '링크가 있는 사람은
//     볼 수 있음'으로 열어 둔다(기록·메모의 그림이 V3에서도 보여야 하므로).
//     학생 얼굴 사진에 그렇게 하면 주소만 알면 누구나 볼 수 있게 된다.
//     여기서는 권한을 건드리지 않고, 선생님 토큰으로 내려받아 화면에만 띄운다.
//
//  2. 폴더가 다르다. 첨부는 앱이 만든 School_Planner 폴더에 모이고, 사진은
//     선생님이 손수 만든 폴더를 골라 쓴다.
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import { getValidGoogleToken } from './googleApi';
import { pickDriveFolder } from './googlePicker';
import {
  classFolderName,
  isPhotoFile,
  photoFileName,
  type ClassKey,
  type PhotoCandidate,
} from './studentPhotoNames';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

/**
 * 폴더 id를 두는 자리.
 *
 * 시트 id가 이미 여기 있으므로(users/{uid}/settings/backup_config) 같은
 * 문서에 나란히 둔다. V3는 이 칸을 읽지 않으므로 V3에 영향이 없다.
 */
function configRef(uid: string) {
  return doc(db, 'users', uid, 'settings', 'backup_config');
}

export interface PhotoFolderConfig {
  id: string;
  name: string;
}

export async function loadPhotoFolder(): Promise<PhotoFolderConfig | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const snap = await getDoc(configRef(user.uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    const id = (data.studentPhotoFolderId as string) || '';
    if (!id) return null;
    return { id, name: (data.studentPhotoFolderName as string) || '' };
  } catch (e) {
    console.warn('사진 폴더 설정을 읽지 못했습니다.', e);
    return null;
  }
}

export async function savePhotoFolder(folder: PhotoFolderConfig): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  await setDoc(
    configRef(user.uid),
    {
      studentPhotoFolderId: folder.id,
      studentPhotoFolderName: folder.name,
      updatedAt: Date.now(),
    },
    { merge: true }
  );
}

/** 연결을 끊는다 (다른 폴더로 바꾸고 싶을 때) */
export async function clearPhotoFolder(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  await setDoc(
    configRef(user.uid),
    { studentPhotoFolderId: '', studentPhotoFolderName: '', updatedAt: Date.now() },
    { merge: true }
  );
  folderIdCache.clear();
}

/** 선택창을 띄워 폴더를 고르고 저장한다. 취소하면 null. */
export async function connectPhotoFolder(): Promise<PhotoFolderConfig | null> {
  const token = await getValidGoogleToken();
  if (!token) throw new Error('구글 계정 연결이 필요합니다.');
  const picked = await pickDriveFolder(token);
  if (!picked) return null;
  await savePhotoFolder(picked);
  folderIdCache.clear();
  return picked;
}

async function driveFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  });
  if (res.ok) return res;

  if (res.status === 403 || res.status === 404) {
    throw new PhotoAccessError(
      '고른 폴더를 읽을 수 없습니다. 폴더를 다시 골라 주시거나, 폴더가 지워지지 않았는지 확인해 주세요.'
    );
  }
  const body = await res.text().catch(() => '');
  throw new Error(`구글 드라이브 오류 ${res.status} ${body.slice(0, 200)}`);
}

/** 폴더에 손이 닿지 않는 경우. 화면에서 '다시 연결' 안내를 띄우는 데 쓴다. */
export class PhotoAccessError extends Error {
  readonly needsReconnect = true;
}

/** 학급 폴더 id를 기억해 둔다 ('2026-3-2' -> id). 팝업을 열 때마다 찾지 않게. */
const folderIdCache = new Map<string, string | null>();

/**
 * 학급 폴더('2026-3-2')를 뿌리 폴더 아래에서 찾는다.
 * 없으면 null (아직 사진을 한 장도 안 올린 학급).
 */
export async function findClassFolderId(
  rootId: string,
  cls: ClassKey,
  token: string
): Promise<string | null> {
  const name = classFolderName(cls);
  const cacheKey = `${rootId}/${name}`;
  if (folderIdCache.has(cacheKey)) return folderIdCache.get(cacheKey)!;

  const q = encodeURIComponent(
    `'${rootId}' in parents and name='${name}' and ` +
      `mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const res = await driveFetch(`${DRIVE_FILES}?q=${q}&fields=files(id)&pageSize=1`, token);
  const data = await res.json();
  const id = data.files?.[0]?.id || null;
  folderIdCache.set(cacheKey, id);
  return id;
}

/** 학급 폴더를 찾고, 없으면 만든다 (사진을 올릴 때만 쓴다) */
export async function ensureClassFolderId(
  rootId: string,
  cls: ClassKey,
  token: string
): Promise<string> {
  const found = await findClassFolderId(rootId, cls, token);
  if (found) return found;

  const res = await driveFetch(DRIVE_FILES, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: classFolderName(cls),
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootId],
    }),
  });
  const created = await res.json();
  folderIdCache.set(`${rootId}/${classFolderName(cls)}`, created.id);
  return created.id;
}

export interface DrivePhotoFile extends PhotoCandidate {
  /** 마지막으로 고쳐진 때. 재어 둔 사진을 언제 버릴지 가르는 값이다. */
  modifiedTime?: string;
}

/**
 * 학급 폴더 안의 사진 파일을 모두 받아온다 (한 번에 200개씩).
 *
 * 한 반이 200명을 넘을 일은 없지만, 폴더에 학년 전체를 몰아 둔 경우가
 * 있을 수 있어 다음 쪽까지 따라간다.
 */
export async function listClassPhotos(
  folderId: string,
  token: string
): Promise<DrivePhotoFile[]> {
  const out: DrivePhotoFile[] = [];
  let pageToken = '';

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id,name,modifiedTime)',
      pageSize: '200',
      orderBy: 'name',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await driveFetch(`${DRIVE_FILES}?${params}`, token);
    const data = await res.json();
    for (const f of data.files || []) {
      if (isPhotoFile(f.name)) out.push({ id: f.id, name: f.name, modifiedTime: f.modifiedTime });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return out;
}

// ────────────────────────────────────────────────────────────────
// 기기에 재어 두기
//
// 스물다섯 장을 플래시카드로 몇 바퀴 돌면 드라이브를 수백 번 부르게 된다.
// 느리고, 구글이 잠시 막기도 한다. 한 번 받은 사진은 브라우저에 재어 두고,
// 파일이 바뀌었을 때(modifiedTime)만 다시 받는다.
// ────────────────────────────────────────────────────────────────

const CACHE_DB = 'sp4-student-photos';
const CACHE_STORE = 'photos';

function openCache(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(CACHE_DB, 1);
      req.onupgradeneeded = () => {
        const idb = req.result;
        if (!idb.objectStoreNames.contains(CACHE_STORE)) idb.createObjectStore(CACHE_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      // 시크릿 모드·저장소 차단 등. 재어 두지 못할 뿐이므로 그냥 넘어간다.
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

interface CachedPhoto {
  blob: Blob;
  modifiedTime: string;
}

function cacheGet(idb: IDBDatabase, key: string): Promise<CachedPhoto | null> {
  return new Promise((resolve) => {
    try {
      const req = idb.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(key);
      req.onsuccess = () => resolve((req.result as CachedPhoto) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function cachePut(idb: IDBDatabase, key: string, value: CachedPhoto): void {
  try {
    idb.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE).put(value, key);
  } catch {
    /* 재어 두지 못해도 화면에는 보인다 */
  }
}

function cacheDelete(key: string): void {
  openCache().then((idb) => {
    if (!idb) return;
    try {
      idb.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE).delete(key);
    } catch {
      /* 무시 */
    }
  });
}

/**
 * 한 파일에 대해 화면에 띄울 주소 하나만 만들어 쓴다.
 *
 * createObjectURL은 부를 때마다 새 주소를 만들고, 그 주소는 URL.revokeObjectURL
 * 을 부르기 전까지 메모리를 붙잡는다. 같은 얼굴을 목록·타일·플래시카드에서
 * 거듭 그리므로, 파일당 하나로 모아 두지 않으면 사진 수백 장어치가 쌓인다.
 */
const objectUrls = new Map<string, string>();

/**
 * 붙잡아 둘 주소의 수.
 *
 * 한 반이 서른 명 남짓이니 열 학급을 오가도 삼백 장이다. 그 언저리에서
 * 끊어 준다. 넘으면 가장 오래 전에 넣은 것부터 놓아준다(Map은 넣은 차례를
 * 지키므로 첫 열쇠가 곧 가장 오래된 것이다). 놓아준 사진은 IndexedDB에
 * 그대로 있으므로, 다시 보게 되면 드라이브가 아니라 거기서 꺼낸다.
 */
const MAX_OBJECT_URLS = 400;

function rememberUrl(fileId: string, url: string): void {
  objectUrls.set(fileId, url);
  while (objectUrls.size > MAX_OBJECT_URLS) {
    const oldest = objectUrls.keys().next();
    if (oldest.done) break;
    const stale = objectUrls.get(oldest.value);
    objectUrls.delete(oldest.value);
    if (stale) URL.revokeObjectURL(stale);
  }
}

/**
 * 사진 하나를 화면에 띄울 수 있는 주소로 받아온다.
 *
 * 드라이브의 thumbnail 주소를 <img>에 바로 꽂는 길도 있지만, 그 길은 파일이
 * '링크가 있는 사람은 볼 수 있음'으로 열려 있어야 한다. 학생 사진을 그렇게
 * 열어 둘 수는 없으므로, 토큰을 실어 내려받은 뒤 blob 주소로 바꾼다.
 */
export async function getPhotoUrl(file: DrivePhotoFile, token: string): Promise<string> {
  const cached = objectUrls.get(file.id);
  if (cached) return cached;

  const modifiedTime = file.modifiedTime || '';
  const idb = await openCache();

  if (idb) {
    const hit = await cacheGet(idb, file.id);
    if (hit && hit.modifiedTime === modifiedTime) {
      const url = URL.createObjectURL(hit.blob);
      rememberUrl(file.id, url);
      return url;
    }
  }

  const res = await driveFetch(`${DRIVE_FILES}/${file.id}?alt=media`, token);
  const blob = await res.blob();
  if (idb) cachePut(idb, file.id, { blob, modifiedTime });

  const url = URL.createObjectURL(blob);
  rememberUrl(file.id, url);
  return url;
}

/**
 * 사진 한 장을 올린다. 이미 같은 이름이 있으면 그 파일의 내용을 갈아끼운다
 * (새로 만들면 같은 학생의 사진이 두 장이 되어 어느 것이 나올지 알 수 없다).
 */
export async function uploadStudentPhoto(
  rootId: string,
  cls: ClassKey,
  student: { num: number; name: string },
  file: File
): Promise<DrivePhotoFile> {
  const token = await getValidGoogleToken();
  if (!token) throw new Error('구글 계정 연결이 필요합니다.');

  const folderId = await ensureClassFolderId(rootId, cls, token);
  const name = photoFileName(cls, student.num, student.name, file.name);

  const existing = await findByExactName(folderId, name, token);
  const uploaded = existing
    ? await replaceContent(existing, file, token)
    : await createFile(folderId, name, file, token);

  // 갈아끼운 파일은 재어 둔 것이 낡았다. 지워야 다음에 새 사진을 받는다.
  const stale = objectUrls.get(uploaded.id);
  objectUrls.delete(uploaded.id);
  if (stale) URL.revokeObjectURL(stale);
  cacheDelete(uploaded.id);
  return uploaded;
}

async function findByExactName(
  folderId: string,
  name: string,
  token: string
): Promise<string | null> {
  const q = encodeURIComponent(
    `'${folderId}' in parents and name='${name.replace(/'/g, "\\'")}' and trashed=false`
  );
  const res = await driveFetch(`${DRIVE_FILES}?q=${q}&fields=files(id)&pageSize=1`, token);
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

async function createFile(
  folderId: string,
  name: string,
  file: File,
  token: string
): Promise<DrivePhotoFile> {
  const metadata = {
    name,
    mimeType: file.type || 'image/png',
    parents: [folderId],
  };
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  body.append('file', file);

  const res = await driveFetch(
    `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,modifiedTime`,
    token,
    { method: 'POST', body }
  );
  return res.json();
}

async function replaceContent(
  fileId: string,
  file: File,
  token: string
): Promise<DrivePhotoFile> {
  const res = await driveFetch(
    `${DRIVE_UPLOAD}/${fileId}?uploadType=media&fields=id,name,modifiedTime`,
    token,
    {
      method: 'PATCH',
      headers: { 'Content-Type': file.type || 'image/png' },
      body: file,
    }
  );
  return res.json();
}

/** 학급 폴더를 다시 읽게 한다 (사진을 올린 뒤) */
export function forgetFolderCache(): void {
  folderIdCache.clear();
}
