// src/lib/peerAccount.ts
//
// V3와 V4는 같은 주소(같은 출처)의 하위 경로에 올라가 있지만, 파이어베이스 앱
// 이름이 다르다.
//   V3: initializeApp(config)              -> [DEFAULT]
//   V4: initializeApp(config, 'SchoolPlannerV4')
// 앱 이름이 다르면 로그인 세션도 따로 논다. 즉 한 브라우저에서 V3는 A 계정,
// V4는 B 계정으로 로그인되어 있을 수 있고, 두 앱 모두 그 사실을 말해 주지 않는다.
//
// 게다가 두 앱 다 로그인할 때 prompt: 'select_account'를 쓴다. 쿠키를 지우고 나면
// 계정 선택창이 다시 뜨므로, 계정이 여럿인 사람은 앱마다 다른 계정을 고를 수 있다.
// 그러면 V4는 남의 빈 서랍을 여는 셈이 된다. 일정도, 라벨도, 시간표 설정도
// 전부 users/{uid} 아래에 있으니 한꺼번에 '사라진 것처럼' 보인다.
//
// 다행히 로그인 기록은 출처마다 하나인 IndexedDB(firebaseLocalStorageDb)에
// 앱 이름을 붙인 열쇠로 나란히 들어 있다. 그래서 V4에서 V3가 어느 계정으로
// 들어가 있는지 읽어 볼 수 있다. 읽기만 한다.
const DB_NAME = 'firebaseLocalStorageDb';
const STORE = 'firebaseLocalStorage';

export interface PeerAccount {
  uid: string;
  email: string | null;
}

/** V3(기본 앱 이름)가 로그인해 둔 계정. 없으면 null */
export function readV3Account(apiKey: string): Promise<PeerAccount | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (v: PeerAccount | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    // 브라우저가 답을 안 주는 경우(사생활 보호 모드 등)에 매달리지 않는다
    const timer = setTimeout(() => done(null), 3000);

    try {
      const req = indexedDB.open(DB_NAME);
      req.onerror = () => { clearTimeout(timer); done(null); };
      req.onsuccess = () => {
        clearTimeout(timer);
        const db = req.result;
        try {
          if (!db.objectStoreNames.contains(STORE)) { done(null); return; }
          const tx = db.transaction(STORE, 'readonly');
          const get = tx.objectStore(STORE).get(`firebase:authUser:${apiKey}:[DEFAULT]`);
          get.onsuccess = () => {
            const val = (get.result as any)?.value;
            done(val?.uid ? { uid: val.uid, email: val.email ?? null } : null);
          };
          get.onerror = () => done(null);
        } catch {
          done(null);
        }
      };
      // 이 데이터베이스는 파이어베이스가 만든다. 우리가 만들 일은 없다.
      req.onupgradeneeded = () => { try { req.transaction?.abort(); } catch { /* 무시 */ } done(null); };
    } catch {
      clearTimeout(timer);
      done(null);
    }
  });
}

/** 두 앱이 서로 다른 계정으로 들어가 있는가 */
export function accountsDiffer(v4Uid: string | undefined, v3: PeerAccount | null): boolean {
  if (!v4Uid || !v3) return false;
  return v3.uid !== v4Uid;
}
