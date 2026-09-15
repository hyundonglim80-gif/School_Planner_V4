import { initializeApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

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

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
// V3와 같은 범위를 요청한다. 캘린더가 빠져 있어서 캘린더 API는 부를 수 없었고,
// 시트(명렬표/백업)도 같은 이유로 401이 났다.
googleProvider.addScope('https://www.googleapis.com/auth/calendar');
googleProvider.addScope('https://www.googleapis.com/auth/tasks');
googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets');
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');

