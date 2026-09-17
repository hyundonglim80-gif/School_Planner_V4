import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { auth, db } from './lib/firebase'
import { autoSignIn } from './lib/emulator'
import { flushPendingToast } from './utils/toast'
import { watchForBrokenPersistence, watchForLeaseFailure } from './lib/firestoreRecovery'

// 점검용 에뮬레이터에서만 동작한다(운영 빌드에서는 통째로 빠진다).
// Firestore의 로컬 저장소가 깨지면(사이트 데이터를 앱이 떠 있는 채로 지울 때
// 생긴다) 읽기는 캐시에서 오고 쓰기는 서버로 못 나간다. 스스로 회복하게 한다.
watchForBrokenPersistence(db)
// Firestore가 콘솔로만 알려 주는 '주 탭 임대권 실패'도 붙잡는다.
// 이 오류는 catch로 오지 않아서, 여태 어떤 장치로도 못 잡았다.
watchForLeaseFailure()

autoSignIn(auth)

// 새로고침을 건너오며 맡겨 둔 알림이 있으면 띄운다 (백업 복원 등)
flushPendingToast()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
