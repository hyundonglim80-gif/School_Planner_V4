// src/lib/driveApi.ts
//
// 첨부 파일과 캡처 이미지를 구글 드라이브에 올린다.
//
// V3는 파일 첨부만 드라이브에 올리고 이미지는 Firebase Storage에 두었다.
// V4는 둘 다 Storage였다. 그래서 같은 사람의 첨부가 세 군데로 흩어져 있었고,
// V3에서 올린 것을 V4에서 지우면 드라이브 원본이 남는 문제도 있었다.
// 이제 두 앱 모두 드라이브 한 곳으로 모은다.
//
// ⚠️ 이미지를 화면에 펼쳐 보여주는 것에 관하여.
//    드라이브의 uc?export=download 주소는 다른 사이트에서 <img>로 직접 불러오는
//    용도로는 잘 동작하지 않는다(구글이 막아 둔 경로라 이미지 대신 안내 페이지가
//    오기도 한다). 화면에 펼쳐 보여줄 때는 thumbnail 주소를 쓴다. 이쪽은 공식
//    문서에 있는 경로는 아니라서, 구글이 바꾸면 깨질 수 있다. 그때는 이미지만
//    다시 Storage로 되돌리면 된다(드라이브에 원본이 남아 있으므로 되돌릴 수 있다).
import { getValidGoogleToken } from './googleApi';

export const DRIVE_FOLDER_NAME = 'School_Planner';

export interface DriveFile {
  id: string;
  name: string;
  /** 드라이브에서 열어 보는 주소 */
  webViewLink?: string;
  /** 내려받기 주소 (V3가 attachments.url 에 넣던 값과 같은 모양) */
  downloadLink: string;
}

/** 드라이브에 올린 이미지를 화면에 펼쳐 보여줄 때 쓰는 주소 */
export function driveImageSrc(fileId: string, width = 1000): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${width}`;
}

/** 주소에서 드라이브 파일 id를 뽑는다 (없으면 null) */
export function driveFileIdOf(url: string | undefined | null): string | null {
  if (!url) return null;
  const m =
    url.match(/[?&]id=([A-Za-z0-9_-]+)/) ||
    url.match(/\/file\/d\/([A-Za-z0-9_-]+)/) ||
    url.match(/\/d\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/** 이 주소가 Firebase Storage 것인가 */
export function isStorageUrl(url: string | undefined | null): boolean {
  return !!url && /firebasestorage\.googleapis\.com|\.firebasestorage\.app/.test(url);
}

async function driveFetch(url: string, token: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  });
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(
        '구글 드라이브 접근 권한이 없습니다. 로그아웃 후 다시 로그인하실 때 ' +
          '드라이브 권한을 허용해 주세요.'
      );
    }
    const body = await res.text().catch(() => '');
    throw new Error(`구글 드라이브 오류 ${res.status} ${body.slice(0, 200)}`);
  }
  return res;
}

/** School_Planner 폴더를 찾고, 없으면 만든다. 한 번 찾으면 기억해 둔다. */
let cachedFolderId: string | null = null;
export async function getOrCreateFolder(token: string): Promise<string> {
  if (cachedFolderId) return cachedFolderId;
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`
  );
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`,
    token
  );
  const data = await res.json();
  if (data.files?.length > 0) {
    cachedFolderId = data.files[0].id;
    return cachedFolderId!;
  }
  const created = await driveFetch('https://www.googleapis.com/drive/v3/files', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const createdData = await created.json();
  cachedFolderId = createdData.id;
  return cachedFolderId!;
}

/**
 * 파일 하나를 드라이브에 올린다.
 *
 * 올린 뒤 '링크가 있는 사람은 볼 수 있음'으로 열어 둔다. 그래야 기록·메모에
 * 넣어 둔 주소로 이미지가 보이고, 공유 그룹의 다른 선생님도 열 수 있다.
 */
export async function uploadToDrive(file: File | Blob, name: string): Promise<DriveFile> {
  const token = await getValidGoogleToken();
  if (!token) throw new Error('구글 계정 연결이 필요합니다.');
  const folderId = await getOrCreateFolder(token);

  const metadata = {
    name,
    mimeType: (file as File).type || 'application/octet-stream',
    parents: [folderId],
  };

  const initRes = await driveFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink',
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    }
  );
  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) throw new Error('업로드 주소를 받지 못했습니다.');

  const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: file });
  if (!uploadRes.ok) throw new Error(`구글 드라이브 업로드 실패 ${uploadRes.status}`);
  const fileData = await uploadRes.json();

  // 권한 열기는 실패해도 업로드 자체는 성공이다. 다만 화면에 이미지가 안 보일 수 있다.
  await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileData.id}/permissions`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  }).catch((e) => console.warn('드라이브 공개 설정 실패(무시 가능):', e));

  return {
    id: fileData.id,
    name: fileData.name,
    webViewLink: fileData.webViewLink,
    downloadLink: `https://drive.google.com/uc?export=download&id=${fileData.id}`,
  };
}

/**
 * 드라이브에 그 파일이 정말 있는지 확인한다.
 * 원본(Firebase Storage)을 지우기 전에 반드시 이걸로 확인한다.
 * 확인 없이 지우면, 업로드가 반쯤 실패했을 때 되돌릴 방법이 없다.
 */
export async function existsInDrive(fileId: string): Promise<boolean> {
  try {
    const token = await getValidGoogleToken();
    if (!token) return false;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,size,trashed`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.id && data.trashed !== true;
  } catch {
    return false;
  }
}

/** 드라이브에서 파일을 지운다 (첨부를 지울 때) */
export async function deleteFromDrive(fileId: string): Promise<void> {
  const token = await getValidGoogleToken();
  if (!token) return;
  await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, token, {
    method: 'DELETE',
  }).catch((e) => console.warn('드라이브 파일 삭제 실패:', e));
}

/**
 * 첨부를 화면에 이미지로 펼쳐 보여줄 때 쓸 주소.
 *
 * 드라이브에 올린 것이면 thumbnail 주소로 바꾼다. 저장해 둔 downloadLink를
 * 그대로 <img>에 넣으면 이미지 대신 안내 페이지가 와서 깨진 그림으로 보인다.
 * driveId가 없는 옛 항목도 주소에서 id를 뽑아 본다(옮기기 전에 저장된 것들).
 * 드라이브 것이 아니면(아직 Storage에 있는 것) 주소를 그대로 쓴다.
 */
export function attachmentImageSrc(att: { url?: string; driveId?: string } | null | undefined): string {
  if (!att?.url && !att?.driveId) return '';
  const id = att?.driveId || (att?.url?.includes('drive.google.com') ? driveFileIdOf(att.url) : null);
  return id ? driveImageSrc(id) : att?.url || '';
}


/**
 * 첨부 목록에 저장할 주소를 고른다.
 *
 * 이미지면 thumbnail 주소를, 그 밖에는 내려받기 주소를 넣는다.
 * ⚠️ V3는 저장된 주소를 그대로 <img src>에 넣는다(주소를 바꿔 주는 코드가 없다).
 *    그래서 이미지의 저장 주소 자체가 화면에 보이는 주소여야 두 앱 모두에서
 *    그림이 보인다. 내려받기 주소를 넣으면 V3에서 깨진 그림이 된다.
 */
export function driveUrlToStore(mimeType: string | undefined, file: DriveFile): string {
  return mimeType?.startsWith('image/') ? driveImageSrc(file.id) : file.downloadLink;
}
