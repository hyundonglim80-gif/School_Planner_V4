import { initializeApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager, memoryLocalCache } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { connectEmulators } from './emulator';

const firebaseConfig = {
  apiKey: 'AIzaSyBd1z4RZnSbZWdwAIFvPOue5AaZ8wQ9ka0',
  authDomain: 'schoolplannerv3.firebaseapp.com',
  projectId: 'schoolplannerv3',
  storageBucket: 'schoolplannerv3.firebasestorage.app',
  messagingSenderId: '906471951519',
  appId: '1:906471951519:web:1d3e6952d9579b2a9b26aa'
};

// V3와의 IndexedDB(로컬 오프라인 캐시) 충돌을 방지하기 위해 App 이름을 'SchoolPlannerV4'로 명시적으로 지정
export const app = initializeApp(firebaseConfig, 'SchoolPlannerV4');

/**
 * 오프라인 저장소를 못 쓰는 상태로 들어왔는가.
 *
 * 탭을 열어 둔 채로 브라우저의 사이트 데이터를 지우면, 그 탭이 붙잡고 있던
 * IndexedDB가 잠긴 채 남는다. 그 뒤로 Firestore는 그 저장소를 잡지 못하고
 * failed-precondition을 낸다. 그 상태에서는 구독이 아무 답도 주지 않아서
 * 일정도 수업도 D-Day도 전부 빈 화면이 된다.
 *
 * 예전에는 이럴 때 저장소를 지우고 다시 시작하게 했는데, 잠겨 있으니 그
 * 지우기도 똑같이 실패했다. 새로고침해도 같은 자리로 돌아올 뿐이었다.
 *
 * 잠긴 문을 억지로 열 것이 아니라 그 문을 안 쓰면 된다. 오프라인 저장소 없이
 * (메모리 캐시로) 시작하면 앱은 온라인에서 정상으로 돌아간다. 오프라인 보기만
 * 잠시 못 쓸 뿐이다. 이 표시는 sessionStorage에 두어 이 탭에서만 유효하다.
 * 새 탭에서는 다시 정상 방식으로 시작해 본다.
 */
export const MEMORY_CACHE_MARK = 'sp4-memory-cache';

function shouldUseMemoryCache(): boolean {
  try {
    return sessionStorage.getItem(MEMORY_CACHE_MARK) === '1';
  } catch {
    return false;
  }
}

const usingMemoryCache = shouldUseMemoryCache();
if (usingMemoryCache) {
  console.warn('[SP4] 오프라인 저장소를 쓸 수 없어 온라인 전용(메모리 캐시)으로 시작합니다.');
}

// ⚠️ 예전에는 persistentMultipleTabManager()(여러 탭 공유 모드)를 썼다.
//    그 모드에서는 탭 하나가 '주 탭 임대권'을 쥐고 서버 연결을 담당한다.
//    그런데 탭을 열어 둔 채 브라우저의 사이트 데이터를 지우면 그 임대 기록이
//    죽은 탭 앞으로 잠긴 채 남는다. 새로 뜬 탭은 임대권을 얻지 못하고,
//    콘솔에 이렇게 찍힌다.
//      Failed to obtain primary lease for action 'Apply remote event'.
//    'Apply remote event'는 서버에서 온 데이터를 반영하는 바로 그 동작이다.
//    그래서 연결도 로그인도 멀쩡한데 서버 데이터만 영영 도착하지 않는다.
//    일정도 수업도 D-Day도 시간표 설정도 전부 빈 화면이 된다. 오류 하나 없이.
//
//    forceOwnership: true 는 '기다리지 말고 내가 임대권을 가져간다'는 뜻이다.
//    죽은 탭이 쥐고 있던 임대 기록이 새 탭을 막지 못한다.
//    이 앱은 한 사람이 쓰는 도구라 여러 탭이 동시에 쓰기를 다툴 일이 드물고,
//    설령 탭을 여럿 열어도 데이터가 깨지지는 않는다(뒤 탭이 오프라인 캐시를
//    양보할 뿐이다). 화면이 통째로 비는 쪽이 훨씬 나쁘다.
export const db = initializeFirestore(app, {
  localCache: usingMemoryCache
    ? memoryLocalCache()
    : persistentLocalCache({
        tabManager: persistentSingleTabManager({ forceOwnership: true }),
      }),
});

export const auth = getAuth(app);
export const storage = getStorage(app);

// 점검용 에뮬레이터. VITE_USE_EMULATOR=1 일 때만 붙는다(운영 빌드에서는 빠진다).
connectEmulators(auth, db, storage);
export const googleProvider = new GoogleAuthProvider();
// V3와 같은 범위를 요청한다. 캘린더가 빠져 있어서 캘린더 API는 부를 수 없었고,
// 시트(명렬표/백업)도 같은 이유로 401이 났다.
googleProvider.addScope('https://www.googleapis.com/auth/calendar');
googleProvider.addScope('https://www.googleapis.com/auth/tasks');
googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets');
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');

