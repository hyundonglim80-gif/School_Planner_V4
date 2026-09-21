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
import {
  terminate,
  clearIndexedDbPersistence,
  doc,
  getDocFromServer,
  type Firestore,
} from 'firebase/firestore';
import { MEMORY_CACHE_MARK, auth } from './firebase';

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


// ── 아무 말도 없이 멈추는 경우 ──────────────────────────────────────
//
// 위의 감시는 '오류가 올라올 때'만 동작한다. 그런데 더 고약한 경우가 있다.
// 오류를 내지 않고 그냥 아무 답도 주지 않는 것이다.
//
// 브라우저의 '인터넷 사용 기록 삭제'는 그 순간 열려 있는 탭이 붙잡고 있는
// IndexedDB를 지우지 못하고 넘어갈 수 있다. 그러면 Firestore의 로컬 캐시가
// 반쯤 지워진 채 남는다. 그 상태로 다시 켜면 SDK가 그 캐시를 열다가 조용히
// 멈춘다. 구독을 걸어도 콜백이 한 번도 불리지 않는다.
//
// 화면에는 일정도, 수업도, D-Day도 전부 빈 채로 나온다. 오류 한 줄 없이.
// 사용기록을 한 번 더 지우면(이번엔 탭이 안 붙잡고 있으니 완전히 지워진다)
// 멀쩡해지는 것이 그래서다.
//
// 그래서 '살아 있다는 신호'를 기다린다. 로그인까지 끝났는데 그 신호가 한 번도
// 오지 않으면 캐시가 깨진 것으로 보고 비우고 다시 시작한다.
let aliveSeen = false;
/**
 * 구독이 '한 번이라도' 답을 줬는가 (캐시에서 온 것도 친다).
 *
 * ⚠️ 이 둘을 갈라 두지 않으면 서로 다른 두 사고를 구별할 수 없다.
 *    · 사용기록을 지워 저장소가 잠긴 경우 — 콜백이 한 번도 안 불린다. 화면이 빈다.
 *    · 그냥 새로고침한 경우 — 캐시 콜백은 오고 서버 콜백만 안 온다. 화면은 멀쩡하다.
 *    앞의 것은 반드시 고쳐야 하고, 뒤의 것은 건드리면 안 된다.
 */
let anyAnswerSeen = false;
let watchdog: ReturnType<typeof setTimeout> | null = null;

/**
 * 구독이 답을 줬을 때 부른다.
 *
 * ⚠️ 예전에는 캐시에서 온 답도 '살아 있다'로 쳤다. 그런데 임대권을 못 얻은
 *    상태에서는 캐시 답은 오고 서버 답만 영영 안 온다. 그래서 감시가 캐시 답에
 *    만족해 버리고, 정작 화면은 빈 채로 남았다. 서버에서 온 답만 인정한다.
 */
export function markFirestoreAlive(fromServer: boolean = true) {
  // 캐시에서 온 답도 '구독이 살아서 불리고는 있다'는 뜻은 된다. 그것만 따로 센다.
  anyAnswerSeen = true;
  if (!fromServer) return;
  aliveSeen = true;
  if (watchdog) {
    clearTimeout(watchdog);
    watchdog = null;
  }
  // 제대로 한 바퀴 돌았으니 다음에 또 깨지면 다시 고칠 수 있게 표시를 지운다.
  markFirestoreHealthy();
}

/**
 * 서버에 정말로 닿지 않는지 직접 물어본다.
 *
 * ⚠️ 왜 한 번 더 묻는가.
 *    감시견은 '서버에서 온 스냅샷'이 오지 않으면 답이 없다고 본다. 그런데
 *    onSnapshot은 기본값에서 메타데이터만 바뀌면 콜백을 부르지 않는다
 *    (includeMetadataChanges를 켜지 않았다). 그래서 새로고침처럼 캐시에 이미
 *    같은 내용이 들어 있는 경우에는, 서버가 '바뀐 것 없다'고 확인해 주어도
 *    콜백이 한 번도 더 불리지 않는다. fromCache는 영영 true인 채로 남는다.
 *
 *    실제로 그래서, 새로고침만 하면 화면에는 일정이 1.3초 만에 멀쩡히 떴는데도
 *    10초 뒤 감시견이 '답이 없다'며 오프라인 저장소를 버리고 앱을 다시 띄웠다.
 *    45초로 늘려 봐도 마찬가지였다. 기다려서 될 일이 아니었다.
 *
 *    저장소를 버리는 것은 되돌릴 수 없는 일이므로, 그 전에 전제를 직접 확인한다.
 *    서버에 한 번 물어 답이 오면 Firestore는 멀쩡한 것이다.
 */
async function serverReachable(): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid || !dbRef) return false;
  try {
    const probe = getDocFromServer(doc(dbRef, 'users', uid, 'settings', 'preferences'));
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('probe-timeout')), 8000)
    );
    // 문서가 없어도 된다. 서버가 답을 줬다는 것만으로 충분하다.
    await Promise.race([probe, timeout]);
    return true;
  } catch {
    return false;
  }
}

/** 로그인이 끝난 뒤 건다. 정해진 시간 안에 아무 답도 없으면 캐시를 버린다. */
export function startPersistenceWatchdog(db: Firestore, ms = 10000) {
  if (typeof window === 'undefined') return;
  if (aliveSeen || watchdog) return;
  dbRef = db;
  watchdog = setTimeout(() => {
    watchdog = null;
    if (aliveSeen) return;

    // ⚠️ 구독이 한 번도 안 불렸으면 서버에 물어볼 것도 없다.
    //    사용기록을 지우면 잠긴 저장소 때문에 콜백이 아예 오지 않는데, 서버
    //    직접 조회(getDocFromServer)는 그와 상관없이 답할 수 있다. 그 답만 보고
    //    '멀쩡하다'로 넘기면 화면이 빈 채로 영영 남는다. 실제로 그렇게 됐다.
    //    캐시 답조차 없다 = 저장소가 잠긴 것이다. 곧바로 되살린다.
    if (!anyAnswerSeen) {
      console.warn(
        '[SP4] 로그인은 됐는데 구독이 한 번도 답하지 않았습니다. ' +
        '오프라인 저장소를 못 잡은 것으로 보고 저장소 없이 다시 시작합니다.'
      );
      recoverByGivingUpPersistence('no-response', '구독이 한 번도 불리지 않음');
      return;
    }

    // 여기까지 왔으면 캐시 답은 오고 있다 = 화면에는 내용이 떠 있다.
    // 서버 답만 안 온 것이 정말 고장인지 한 번 더 확인한다.
    void serverReachable().then((reachable) => {
      if (aliveSeen) return;
      if (reachable) {
        // 스냅샷이 다시 안 불렸을 뿐, Firestore는 멀쩡하다. 건드리지 않는다.
        markFirestoreAlive(true);
        return;
      }
      console.warn(
        '[SP4] 로그인은 됐는데 Firestore가 아무 답도 주지 않고, 서버에 직접 물어도 답이 없습니다. ' +
        '오프라인 저장소를 못 잡은 것으로 보고 저장소 없이 다시 시작합니다.'
      );
      // 이 증상의 원인도 결국 저장소가 잠긴 것이었다. 비우기는 잠겨 있으면 실패하므로
      // 아예 저장소를 안 쓰고 다시 뜨게 한다.
      recoverByGivingUpPersistence('no-response', '구독도 서버 직접 조회도 답하지 않음');
    });
  }, ms);
}


// ── 저장소를 잡지 못한 경우 (failed-precondition) ────────────────────
//
// 실제로 화면에 이렇게 찍혔다.
//   서버에 묻다가 막혔습니다 (failed-precondition).
//
// Firestore가 이 코드를 내는 경우는 둘이다.
//   1) 복합 색인이 필요한 조회인데 색인이 없다
//   2) 오프라인 저장소(IndexedDB)를 잡지 못했다
// 우리가 낸 조회는 색인이 필요 없는 단순한 것이므로 2번이다.
//
// 탭을 열어 둔 채로 브라우저의 사이트 데이터를 지우면, 그 탭이 붙잡고 있던
// IndexedDB는 지워지지 않고 잠긴 채 남는다. 다시 들어오면 Firestore가 그
// 저장소를 잡지 못하고, 그 상태에서는 구독이 아무 답도 주지 않는다.
// 오류도 안 나고 그냥 빈 화면이 된다. 일정도 수업도 D-Day도 전부.
// 사용 기록을 한 번 더 지우면(이번엔 붙잡는 탭이 없으니) 멀쩡해지던 것이 이것이다.
//
// 저장소를 비우고 한 번 다시 시작하면 풀린다. 사람이 두 번 지워서 풀던 것을
// 앱이 스스로 하게 한다.
function looksLikePersistenceLock(code: string, message: string): boolean {
  if (code !== 'failed-precondition') return false;
  // 색인이 없어서 나는 failed-precondition 과는 구분한다 (그건 우리가 고칠 문제다)
  if (/index/i.test(message)) return false;
  return true;
}

/** Firestore 작업이 실패했을 때 부른다. 저장소 문제로 보이면 스스로 되살린다. */
export function noteFirestoreError(err: unknown): boolean {
  const code = String((err as any)?.code || '');
  const message = String((err as any)?.message || err || '');
  if (!looksLikePersistenceLock(code, message) && !isBrokenPersistence(message)) return false;
  recoverByGivingUpPersistence(code, message);
  return true;
}

/**
 * 저장소가 잠겨 있을 때의 진짜 해법.
 *
 * ⚠️ 예전에는 여기서 clearIndexedDbPersistence로 저장소를 비우려 했다.
 *    그런데 저장소가 잠겨 있어서 못 읽는 상황이므로, 그 비우기도 똑같이 실패한다.
 *    실패한 채로 새로고침하니 같은 자리로 돌아올 뿐이었다. 제자리걸음이었다.
 *
 * 잠긴 문을 억지로 열 것이 아니라 그 문을 안 쓰면 된다. 다음 시작 때
 * 오프라인 저장소 없이(메모리 캐시로) 뜨도록 표시를 남기고 새로고침한다.
 * 그러면 앱은 온라인에서 정상으로 돌아간다. 비우기는 되면 좋고 안 돼도 그만이라
 * 곁다리로만 해 본다.
 */
function recoverByGivingUpPersistence(code: string, message: string) {
  let already = false;
  try {
    already = sessionStorage.getItem(MEMORY_CACHE_MARK) === '1';
    sessionStorage.setItem(MEMORY_CACHE_MARK, '1');
  } catch {
    /* 세션 저장소를 못 쓰면 더 할 수 있는 것이 없다 */
  }
  // 이미 메모리 캐시로 돌고 있는데 또 났다면 저장소 문제가 아니다. 새로고침 반복은 더 나쁘다.
  if (already) {
    console.warn('[SP4] 메모리 캐시로도 같은 오류가 납니다. 새로고침하지 않습니다.', code, message);
    return;
  }

  console.warn(
    '[SP4] 오프라인 저장소를 잡지 못했습니다(' + code + '). ' +
    '저장소 없이 온라인 전용으로 다시 시작합니다.'
  );
  // 되면 좋고 안 돼도 그만 — 어차피 다음 시작은 저장소를 안 쓴다
  const cleanup = dbRef
    ? terminate(dbRef).then(() => clearIndexedDbPersistence(dbRef!)).catch(() => {})
    : Promise.resolve();
  void cleanup.then(() => window.location.reload());
}


// ── Firestore가 콘솔로만 알려 주는 실패 ──────────────────────────────
//
// 이 오류는 우리 코드의 catch로 오지 않는다. SDK가 콘솔에만 남긴다.
//   Failed to obtain primary lease for action 'Apply remote event'.
// 그래서 여태 어떤 장치로도 잡히지 않았다. 화면은 조용히 비어 있었다.
// 콘솔을 한 겹 감싸서 이 말이 나오면 알아차린다.
const LEASE_FAIL = 'Failed to obtain primary lease';

export function watchForLeaseFailure() {
  if (typeof console === 'undefined' || typeof window === 'undefined') return;
  const original = console.error;
  console.error = function (...args: unknown[]) {
    try {
      const text = args.map((a) => String((a as any)?.message ?? a)).join(' ');
      if (text.includes(LEASE_FAIL)) {
        recoverByGivingUpPersistence('primary-lease', LEASE_FAIL);
      }
    } catch {
      /* 감시가 원래 로그를 막아서는 안 된다 */
    }
    original.apply(console, args as []);
  };
}
