import { initializeApp } from 'firebase/app';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
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

// 구글 파일 선택창(Picker)이 요구하는 두 값. 같은 구글 클라우드 프로젝트의
// 것이라 firebaseConfig에 이미 들어 있는 것을 그대로 쓴다. 브라우저에 나가는
// 값이라 숨길 대상이 아니다(도메인 제한으로 지킨다).
export const GOOGLE_API_KEY = firebaseConfig.apiKey;
export const GOOGLE_APP_ID = firebaseConfig.messagingSenderId;

/**
 * 예전 표시. 오프라인 저장소를 포기하고 다시 뜨라는 뜻이었다.
 *
 * 이제는 처음부터 저장소를 안 쓰므로 포기할 것이 없다. 되살리기 쪽
 * (firestoreRecovery.ts)이 이 이름을 아직 참조하므로 이름만 남겨 둔다.
 */
export const MEMORY_CACHE_MARK = 'sp4-memory-cache';

/** 오프라인 저장소(IndexedDB)를 쓰는가. 지금은 늘 아니다. */
export const USING_MEMORY_CACHE = true;

// ── 오프라인 저장소(IndexedDB)를 쓰지 않는다 ──────────────────────────
//
// 이 앱은 오프라인 캐시 때문에 같은 사고를 반년 가까이 되풀이했다.
// 탭을 열어 둔 채 브라우저의 '인터넷 사용 기록 삭제'를 하면, 그 탭이 붙잡고
// 있는 IndexedDB만 지워지지 않고 반쯤 남는다. 다음에 들어오면 Firestore가 그
// 반쪽 저장소를 열다가 조용히 멈춘다. 콘솔에만 이렇게 남는다.
//
//   Failed to obtain primary lease for action 'Apply remote event'.
//
// 'Apply remote event'는 서버에서 온 데이터를 화면에 반영하는 바로 그 동작이다.
// 로그인도 연결도 멀쩡한데 서버 데이터만 영영 도착하지 않는다. 일정도 수업도
// D-Day도 시간표도 한꺼번에 빈다. 오류 한 줄 없이.
//
// 고쳐 보려 한 기록 (전부 증상 옆을 스쳤다)
//   1a3db41  저장소가 깨지면 비우고 다시 시작 → 잠긴 저장소는 비우기도 실패한다
//   894fd02  잠긴 저장소를 여는 대신 저장소 없이 시작
//   0529553  persistentSingleTabManager({ forceOwnership: true }) → 09-18 확인, 09-21 재발
//   6fb418e  감시견 오발동을 고침 → 되레 빈 화면을 '멀쩡함'으로 덮었다
//   bc88e79  캐시 답조차 없으면 곧바로 되살리기 → 여전했다
//   28a23af  위 둘을 통째로 되돌림
//
// 남은 것은 10초짜리 감시견(startPersistenceWatchdog)뿐이었다. 서버 답이 10초
// 동안 없으면 저장소를 포기하고 새로고침한다. 그래서 선생님 눈에는 '오늘 일정이
// 사라졌다가 잠시 뒤 돌아오는' 앱이었다. 안전장치가 일하는 모습이 곧 증상이었다.
//
// 그래서 문을 고치는 대신 문을 없앤다. 잠길 저장소가 없으면 잠길 일도 없다.
//
// 무엇을 잃는가: 인터넷이 없으면 내용이 보이지 않는다. 예전에는 마지막으로 본
// 것이 캐시에서 나왔다. 대신 화면에 보이는 것은 언제나 서버에 실제로 있는 것이고,
// '있는데 안 보이는' 사고가 사라진다. 학교에서 쓰는 도구라 인터넷은 대개 있고,
// 반대로 저 사고는 반년째 되풀이됐다.
//
// 되돌리려면 localCache를 아래로 바꾸면 된다. 위 사고가 함께 돌아온다.
//   persistentLocalCache({ tabManager: persistentSingleTabManager({ forceOwnership: true }) })
// ignoreUndefinedProperties: 값이 undefined인 밭은 빼고 보낸다.
//
// 이것이 없으면 저장이 통째로 막힌다. 특히 배열 안에 undefined가 하나라도 들어가면
// Firestore가 거부하면서 어느 밭인지도 알려 주지 않는다.
//   Unsupported field value: undefined (found in document users/…/tasks/…)
// 실제로 크기가 안 적힌 옛 첨부가 붙은 메모는 저장할 때마다 이걸로 실패했다.
// undefined는 어차피 '지운다'는 뜻이 아니므로(지우려면 deleteField를 쓴다),
// 빼고 보내는 것이 값이 통째로 안 써지는 것보다 언제나 낫다.
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
  ignoreUndefinedProperties: true,
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

