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
//  2. 자리가 다르다. 첨부는 School_Planner 바로 아래에 모이고, 사진은 그
//     아래 Students_Poto/2026-3-1 로 학급마다 나뉜다.
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import { getValidGoogleToken } from './googleApi';
import { pickDriveFolder } from './googlePicker';
import { getOrCreateFolder } from './driveApi';
import {
  classFolderName,
  isPhotoFile,
  photoFileName,
  type ClassKey,
  type PhotoCandidate,
} from './studentPhotoNames';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

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

/**
 * 기억해 둔 폴더들.
 *
 * ⚠️ 왜 학급마다 따로 기억하는가.
 *    drive.file 권한에서 선택창으로 고른 폴더는 그 폴더와 '바로 아래 자식'까지만
 *    앱에 열린다. 손자는 열리지 않는다. 그래서 School_Planner_Students_Poto를
 *    고르면 그 안의 2026-3-1 폴더는 보이지만, 정작 그 안의 사진 파일은 보이지
 *    않는다. 목록이 빈 채로 오고 오류도 나지 않아서, 사진을 안 올린 것과
 *    구별되지 않는다. 실제로 그렇게 막혔다.
 *
 *    풀려면 학급 폴더를 직접 고르게 해야 한다. 그러면 사진이 '바로 아래 자식'이
 *    되어 보인다. 대신 학급마다 한 번씩 골라야 하므로, 고른 것을 학급 이름을
 *    열쇠로 기억해 둔다. 한 번 고른 학급은 다시 묻지 않는다.
 */
export interface PhotoFolders {
  /** 위쪽 폴더. 학급 폴더가 그 아래에 보이면 이것만으로도 된다. */
  root: PhotoFolderConfig | null;
  /** '2026-3-1' -> 그 학급을 위해 따로 고른 폴더 */
  byClass: Record<string, PhotoFolderConfig>;
}

export const EMPTY_FOLDERS: PhotoFolders = { root: null, byClass: {} };

export async function loadPhotoFolders(): Promise<PhotoFolders> {
  const user = auth.currentUser;
  if (!user) return EMPTY_FOLDERS;
  try {
    const snap = await getDoc(configRef(user.uid));
    if (!snap.exists()) return EMPTY_FOLDERS;
    const data = snap.data();
    const id = (data.studentPhotoFolderId as string) || '';
    return {
      root: id ? { id, name: (data.studentPhotoFolderName as string) || '' } : null,
      byClass: (data.studentPhotoFoldersByClass as Record<string, PhotoFolderConfig>) || {},
    };
  } catch (e) {
    console.warn('사진 폴더 설정을 읽지 못했습니다.', e);
    return EMPTY_FOLDERS;
  }
}

async function writeConfig(patch: Record<string, unknown>): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  await setDoc(configRef(user.uid), { ...patch, updatedAt: Date.now() }, { merge: true });
}

/** 연결을 끊는다 (학급별로 골라 둔 것까지 모두) */
export async function clearPhotoFolder(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  await writeConfig({
    studentPhotoFolderId: '',
    studentPhotoFolderName: '',
    studentPhotoFoldersByClass: {},
  });
  managedRootId = null;
}

/** 선택창을 띄워 위쪽 폴더를 고른다. 취소하면 null. */
export async function connectPhotoFolder(): Promise<PhotoFolderConfig | null> {
  const token = await getValidGoogleToken();
  if (!token) throw new Error('구글 계정 연결이 필요합니다.');
  const picked = await pickDriveFolder(token);
  if (!picked) return null;
  await writeConfig({ studentPhotoFolderId: picked.id, studentPhotoFolderName: picked.name });
  managedRootId = null;
  return picked;
}

/** 선택창을 띄워 이 학급의 폴더를 고른다. 취소하면 null. */
export async function connectClassFolder(
  className: string
): Promise<PhotoFolderConfig | null> {
  const token = await getValidGoogleToken();
  if (!token) throw new Error('구글 계정 연결이 필요합니다.');
  // 어느 폴더를 골라야 하는지 창 제목에 못 박는다. '사진이 담긴 폴더'라고만
  // 했더니 위쪽 폴더를 고르고 왜 안 되는지 몰라 헤매는 일이 있었다.
  const picked = await pickDriveFolder(
    token,
    `${className} 폴더를 골라 주세요 (그 안에 사진이 바로 들어 있어야 합니다)`
  );
  if (!picked) return null;
  // 점(.)이 든 열쇠는 Firestore가 중첩 필드로 알아듣는다. 문서 통째로 합친다.
  await writeConfig({ studentPhotoFoldersByClass: { [className]: picked } });
  managedRootId = null;
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

export interface DrivePhotoFile extends PhotoCandidate {
  /** 마지막으로 고쳐진 때. 재어 둔 사진을 언제 버릴지 가르는 값이다. */
  modifiedTime?: string;
}

/**
 * 앱이 맡아 두는 사진 자리.
 *
 *   School_Planner / Students_Poto / 2026-3-1 / 2026-3-1-23-최지우.png
 *
 * ⚠️ 왜 하필 School_Planner 아래인가.
 *    drive.file 권한은 '앱이 만들었거나 사용자가 앱에 직접 건네준 것'만 열어
 *    준다. School_Planner는 첨부를 담느라 앱이 손수 만든 폴더다. 그 아래로
 *    Students_Poto와 학급 폴더까지 앱이 만들면, 그 안에 앱이 올린 사진은
 *    처음부터 끝까지 앱 것이라 권한이 막힐 일이 없다.
 *
 *    선생님이 따로 만든 폴더(School_Planner_Students_Poto)를 골랐을 때는
 *    학급 폴더는 보여도 그 안의 사진이 안 보였다. 고른 폴더의 '자식'까지만
 *    열리고 '손자'는 안 열리기 때문이다. 이 자리는 그 벽을 아예 만나지 않는다.
 *
 *    다만 선생님이 드라이브 화면에서 이 폴더에 사진을 손수 끌어다 넣으면,
 *    그 파일은 앱이 만든 것이 아니므로 또 안 보일 수 있다. 그때를 위해
 *    학급 폴더를 직접 고르는 길(picked)을 그대로 남겨 둔다.
 */
export const PHOTO_SUBFOLDER_NAME = 'Students_Poto';

/** Students_Poto 폴더 id를 기억해 둔다 */
let managedRootId: string | null = null;

/** 한 폴더 아래에서 이름이 같은 폴더를 찾는다 */
async function findChildFolder(
  parentId: string,
  name: string,
  token: string
): Promise<string | null> {
  const q = encodeURIComponent(
    `'${parentId}' in parents and name='${name.replace(/'/g, "\\'")}' and ` +
      `mimeType='${FOLDER_MIME}' and trashed=false`
  );
  const res = await driveFetch(`${DRIVE_FILES}?q=${q}&fields=files(id)&pageSize=1`, token);
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

async function createChildFolder(
  parentId: string,
  name: string,
  token: string
): Promise<string> {
  const res = await driveFetch(DRIVE_FILES, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  return (await res.json()).id;
}

/** School_Planner / Students_Poto. create가 아니면 없을 때 null. */
export async function getManagedPhotoRoot(
  token: string,
  create: boolean
): Promise<string | null> {
  if (managedRootId) return managedRootId;
  const appFolder = await getOrCreateFolder(token);
  const found = await findChildFolder(appFolder, PHOTO_SUBFOLDER_NAME, token);
  if (found) {
    managedRootId = found;
    return found;
  }
  if (!create) return null;
  managedRootId = await createChildFolder(appFolder, PHOTO_SUBFOLDER_NAME, token);
  return managedRootId;
}

/** School_Planner / Students_Poto / 2026-3-1. 없으면 null (읽을 때는 만들지 않는다). */
export async function findManagedClassFolder(
  cls: ClassKey,
  token: string
): Promise<string | null> {
  const root = await getManagedPhotoRoot(token, false);
  if (!root) return null;
  return findChildFolder(root, classFolderName(cls), token);
}

/** 위와 같되, 없으면 만든다 (사진을 올릴 때) */
export async function ensureManagedClassFolder(
  cls: ClassKey,
  token: string
): Promise<string> {
  const root = await getManagedPhotoRoot(token, true);
  if (!root) throw new Error('사진 폴더를 만들지 못했습니다.');
  const name = classFolderName(cls);
  const found = await findChildFolder(root, name, token);
  return found || createChildFolder(root, name, token);
}

/** 앱이 맡아 두는 폴더를 드라이브에서 열 주소 (없으면 만들어서 연다) */
export async function openManagedPhotoFolder(cls: ClassKey): Promise<string> {
  const token = await getValidGoogleToken();
  if (!token) throw new Error('구글 계정 연결이 필요합니다.');
  const id = await ensureManagedClassFolder(cls, token);
  return `https://drive.google.com/drive/folders/${id}`;
}

/** 폴더 하나의 속살. 사진 파일과 하위 폴더 이름을 함께 준다. */
interface FolderContents {
  photos: DrivePhotoFile[];
  folders: { id: string; name: string }[];
  /** 사진도 폴더도 아닌 것까지 합친 전체 개수 (비었는지 가리는 데 쓴다) */
  total: number;
}


/** 폴더 안을 한 번에 훑는다 (한 쪽에 200개씩, 다음 쪽까지 따라간다) */
async function listFolder(folderId: string, token: string): Promise<FolderContents> {
  const photos: DrivePhotoFile[] = [];
  const folders: { id: string; name: string }[] = [];
  let total = 0;
  let pageToken = '';

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id,name,mimeType,modifiedTime)',
      pageSize: '200',
      orderBy: 'name',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await driveFetch(`${DRIVE_FILES}?${params}`, token);
    const data = await res.json();
    for (const f of data.files || []) {
      total += 1;
      if (f.mimeType === FOLDER_MIME) folders.push({ id: f.id, name: f.name });
      else if (isPhotoFile(f.name)) {
        photos.push({ id: f.id, name: f.name, modifiedTime: f.modifiedTime });
      }
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return { photos, folders, total };
}

/**
 * 어디서 사진을 찾았는지, 못 찾았으면 어디까지 갔는지.
 *
 * 예전에는 학급 폴더를 못 찾으면 그냥 빈 손으로 돌아왔다. 그러면 화면에는
 * '사진 없는 학생 25명'이라고만 떠서, 사진을 안 올린 것인지 폴더를 못 읽은
 * 것인지 파일 이름이 틀린 것인지를 가릴 수가 없다. 실제로 폴더를 연결하고도
 * 사진이 안 붙는 일이 생겼고, 화면만 봐서는 까닭을 알 수 없었다.
 * 그래서 가는 길에 본 것을 그대로 담아 온다.
 */
export interface PhotoScan {
  /** 사진을 찾아낸 폴더. 못 찾았으면 null */
  folderId: string | null;
  /**
   * 어디서 찾았는가.
   *   managed   School_Planner/Students_Poto/2026-3-1 (앱이 맡아 두는 자리)
   *   picked    학급을 위해 따로 골라 둔 폴더
   *   subfolder 따로 고른 위쪽 폴더 아래의 '2026-3-1'
   *   root      따로 고른 위쪽 폴더 자체
   *   none      못 찾음
   */
  source: 'managed' | 'picked' | 'subfolder' | 'root' | 'none';
  files: DrivePhotoFile[];
  /** 뿌리 폴더 안에서 본 하위 폴더 이름들 (없으면 빈 배열) */
  subfolderNames: string[];
  /** 뿌리 폴더 안이 통째로 비어 보이는가 */
  rootEmpty: boolean;
  /**
   * 학급 폴더는 눈에 보이는데 그 안이 비어 보이는가.
   *
   * 사진을 안 올린 것일 수도 있고, 권한이 손자까지 닿지 않아 안 보이는 것일
   * 수도 있다. 여기서는 가릴 수 없으므로 표시만 남기고 화면에서 둘 다 말한다.
   */
  classFolderLooksEmpty: boolean;
}

/**
 * 학급의 사진을 찾는다.
 *
 * 두 가지 모양을 모두 받아들인다.
 *   1. 고른 폴더 / 2026-3-1 / 사진들        (원래 약속한 모양)
 *   2. 고른 폴더 / 사진들                    (학급 폴더를 바로 고른 경우)
 *
 * 2를 받아들이는 까닭이 있다. drive.file 권한에서는 사용자가 선택창에서 고른
 * 폴더까지만 앱에 열린다. 그 안의 하위 폴더가 함께 열리지 않는 경우가 있어,
 * 뿌리 폴더를 골랐는데 정작 2026-3-1 폴더는 앱 눈에 안 보일 수 있다.
 * 그럴 때는 선생님이 학급 폴더를 바로 고르면 되게 길을 열어 둔다.
 */
export async function scanClassPhotos(
  rootId: string | null,
  cls: ClassKey,
  token: string,
  /** 이 학급을 위해 따로 골라 둔 폴더가 있으면 그것부터 본다 */
  pickedFolderId?: string
): Promise<PhotoScan> {
  const wanted = classFolderName(cls);

  if (pickedFolderId) {
    const inner = await listFolder(pickedFolderId, token);
    return {
      folderId: pickedFolderId,
      source: 'picked',
      files: inner.photos,
      subfolderNames: [],
      rootEmpty: false,
      classFolderLooksEmpty: inner.photos.length === 0,
    };
  }

  // 앱이 맡아 두는 자리부터 본다. 여기 있는 것은 권한 걱정이 없다.
  const managed = await findManagedClassFolder(cls, token);
  if (managed) {
    const inner = await listFolder(managed, token);
    return {
      folderId: managed,
      source: 'managed',
      files: inner.photos,
      subfolderNames: [],
      rootEmpty: false,
      classFolderLooksEmpty: inner.photos.length === 0,
    };
  }

  if (!rootId) {
    return {
      folderId: null,
      source: 'none',
      files: [],
      subfolderNames: [],
      rootEmpty: true,
      classFolderLooksEmpty: false,
    };
  }

  const root = await listFolder(rootId, token);
  const subfolderNames = root.folders.map((f) => f.name);

  const sub = root.folders.find((f) => f.name.trim() === wanted);
  if (sub) {
    const inner = await listFolder(sub.id, token);
    return {
      folderId: sub.id,
      source: 'subfolder',
      files: inner.photos,
      subfolderNames,
      rootEmpty: false,
      // 폴더는 보이는데 안이 비었다. 권한이 손자까지 안 닿는 경우가 여기다.
      classFolderLooksEmpty: inner.photos.length === 0,
    };
  }

  // 하위 폴더가 없다면, 고른 폴더가 곧 학급 폴더일 수 있다
  if (root.photos.length > 0) {
    return {
      folderId: rootId,
      source: 'root',
      files: root.photos,
      subfolderNames,
      rootEmpty: false,
      classFolderLooksEmpty: false,
    };
  }

  return {
    folderId: null,
    source: 'none',
    files: [],
    subfolderNames,
    rootEmpty: root.total === 0,
    classFolderLooksEmpty: false,
  };
}

/**
 * 사진을 올릴 폴더.
 *
 * 이 학급을 위해 따로 골라 둔 폴더가 있으면 거기, 아니면 앱이 맡아 두는
 * School_Planner/Students_Poto/2026-3-1 에 넣는다(없으면 만든다).
 * 선생님이 따로 고른 '위쪽 폴더'에는 넣지 않는다. 그 아래에 앱이 만든 폴더는
 * 나중에 다시 읽을 때 손자가 되어 안 보일 수 있기 때문이다.
 */
export async function ensureClassFolderId(
  cls: ClassKey,
  token: string,
  pickedFolderId?: string
): Promise<string> {
  if (pickedFolderId) return pickedFolderId;
  return ensureManagedClassFolder(cls, token);
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
  cls: ClassKey,
  student: { num: number; name: string },
  file: File,
  pickedFolderId?: string
): Promise<DrivePhotoFile> {
  const token = await getValidGoogleToken();
  if (!token) throw new Error('구글 계정 연결이 필요합니다.');

  const folderId = await ensureClassFolderId(cls, token, pickedFolderId);
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

/** 폴더를 다시 찾게 한다 (사진을 올린 뒤, 또는 연결을 바꾼 뒤) */
export function forgetFolderCache(): void {
  managedRootId = null;
}
