// src/lib/firestoreRecovery.ts
//
// Firestore의 로컬 저장소(IndexedDB)가 깨졌을 때 스스로 일어나게 한다.
//
// 실제로 이런 것이 올라왔다.
//   FIRESTORE (12.18.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)
//   TypeError: e.Tc.get is not a function or its return value is not iterable
//
// 이건 오프라인 저장소를 다루는 층이 망가졌다는 뜻이다. 브라우저의 사이트
// 데이터를 앱이 떠 있는 채로 지우면(또는 탭이 여럿 떠 있는 채로 지우면) 이렇게 된다.
//
// 이 상태가 무서운 이유는 '조용히 반쪽만 도는 것'이다.
//   읽기는 남아 있는 캐시에서 오므로 화면은 멀쩡해 보인다.
//   쓰기는 큐에 쌓인 채 서버로 나가지 못한다.
// 그래서 '저장했다'고 보이는데 서버에는 없고, 다음에 기기를 비우면 통째로 사라진다.
// 로그인도 이 상태에서는 끝까지 못 간다.
//
// 저장소를 비우고 한 번 새로고침하면 정상으로 돌아온다. 사용자가 F5를 눌러
// 해결하던 것을 앱이 스스로 하게 한다. 되풀이하지 않도록 표시를 남긴다.
import { terminate, clearIndexedDbPersistence, type Firestore } from 'firebase/firestore';

const MARK = 'sp4-firestore-recovered';

function isBrokenPersistence(message: string): boolean {
  return (
    message.includes('INTERNAL ASSERTION FAILED') ||
    message.includes('Tc.get is not a function') ||
    message.includes('FIRESTORE') && message.includes('Unexpected state')
  );
}

async function recover(db: Firestore) {
  let already = false;
  try {
    already = sessionStorage.getItem(MARK) === '1';
    sessionStorage.setItem(MARK, '1');
  } catch {
    /* 세션 저장소를 못 쓰면 한 번만 시도한다 */
  }
  // 이미 한 번 고쳐 봤는데 또 났다면 새로고침으로 풀릴 문제가 아니다.
  // 무한 새로고침이 더 나쁘므로 여기서 멈춘다.
  if (already) return;

  console.warn('[SP4] Firestore 로컬 저장소가 깨져 비우고 다시 시작합니다.');
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (e) {
    console.warn('[SP4] 저장소를 비우지 못했습니다. 그대로 새로고침합니다.', e);
  }
  window.location.reload();
}

/** 앱이 처음 뜰 때 한 번 건다. */
export function watchForBrokenPersistence(db: Firestore) {
  if (typeof window === 'undefined') return;
  dbRef = db;

  window.addEventListener('error', (e) => {
    const msg = String(e?.message || (e as any)?.error?.message || '');
    if (isBrokenPersistence(msg)) void recover(db);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const msg = String((e as any)?.reason?.message || (e as any)?.reason || '');
    if (isBrokenPersistence(msg)) void recover(db);
  });
}

/** 제대로 한 바퀴 돌았으면 표시를 지운다 (다음에 또 나면 다시 고칠 수 있게) */
export function markFirestoreHealthy() {
  try {
    sessionStorage.removeItem(MARK);
  } catch {
    /* 무시 */
  }
}

// ── 캐시가 거짓말을 한 경우 ──────────────────────────────────────────
//
// 기기 캐시는 '그 문서 없다'고 하는데 서버에 직접 물으면 있다. 이러면 화면에는
// 그 날짜 일정이 통째로 사라진 것으로 보인다. 문서 하나만의 일이 아니다.
// 같은 캐시를 쓰는 다른 것(라벨, 시간표 설정)도 같이 비어 보인다.
//
// 읽을 때마다 서버에 확인하는 것으로는 못 고친다. 캐시 자체가 틀린 것이므로
// 버리고 새로 받는 편이 낫다. 되풀이하지 않도록 한 번만 한다.
const LIED = 'sp4-cache-lied';

/** 캐시가 '없다'고 했지만 서버에는 있었다 */
export function noteCacheLied(path: string) {
  let already = false;
  try {
    already = sessionStorage.getItem(LIED) === '1';
    sessionStorage.setItem(LIED, '1');
  } catch {
    /* 세션 저장소를 못 쓰면 한 번만 시도한다 */
  }
  if (already) return;
  console.warn(
    `[SP4] 기기 캐시가 "${path} 없음"이라고 했지만 서버에는 있었습니다. ` +
    '캐시를 버리고 다시 받습니다.'
  );
  if (dbRef) void recover(dbRef);
}

let dbRef: Firestore | null = null;
