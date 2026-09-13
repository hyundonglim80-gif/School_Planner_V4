import { collection, getDocs } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { db, storage } from '../lib/firebase';

// Firebase Storage에 올린 파일만 지운다. 사용자가 붙여넣은 외부 링크를
// 실수로 건드리지 않도록 호스트를 확인한다.
function isStorageUrl(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    (url.includes('firebasestorage.googleapis.com') || url.includes('.firebasestorage.app'))
  );
}

/**
 * 문서/항목 데이터 안에 들어 있는 업로드 파일 URL을 모두 모은다.
 * imageUrl(본문 이미지)과 attachments[].url(첨부) 양쪽을 훑는다.
 */
export function collectUploadUrls(data: any): string[] {
  const urls = new Set<string>();
  const seen = new Set<any>();

  const visit = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return; // 순환 참조 방지
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (isStorageUrl(value.imageUrl)) urls.add(value.imageUrl);
    if (isStorageUrl(value.url)) urls.add(value.url);
    Object.values(value).forEach(visit);
  };

  visit(data);
  return [...urls];
}

/**
 * 더 이상 어디에서도 참조하지 않는 업로드 파일만 Storage에서 지운다.
 *
 * 💡 그냥 지우면 안 된다. 이월 로직이 첨부 목록을 그대로 복사하기 때문에
 * 과거 원본과 이월된 사본이 같은 파일을 가리킨다. 원본을 지웠다고 파일까지
 * 지우면 살아 있는 사본의 첨부가 깨진다.
 * 그래서 살아 있는 문서와 휴지통을 한 번 훑어 참조가 남아 있는 URL은 제외한다.
 * 스캔은 영구 삭제 한 번당 1회만 돌기 때문에 항목 수와 무관하다.
 */
export async function deleteUnreferencedUploads(urls: string[], uid: string): Promise<number> {
  const candidates = new Set(urls.filter(isStorageUrl));
  if (candidates.size === 0) return 0;

  const collectionsToScan = ['events', 'journals', 'tasks', 'trash'];
  for (const colName of collectionsToScan) {
    if (candidates.size === 0) break;
    try {
      const snap = await getDocs(collection(db, 'users', uid, colName));
      snap.forEach((d) => {
        collectUploadUrls(d.data()).forEach((u) => candidates.delete(u));
      });
    } catch (e) {
      // 한 컬렉션이라도 확인하지 못하면 삭제를 포기한다(지우는 것보다 남기는 편이 안전).
      console.warn(`첨부 참조 확인 실패(${colName}) - 파일 삭제를 건너뜁니다.`, e);
      return 0;
    }
  }

  let deleted = 0;
  await Promise.all(
    [...candidates].map(async (url) => {
      try {
        await deleteObject(ref(storage, url));
        deleted++;
      } catch (e: any) {
        if (e?.code !== 'storage/object-not-found') {
          console.warn('업로드 파일 삭제 실패:', url, e?.code || e);
        }
      }
    })
  );
  return deleted;
}
