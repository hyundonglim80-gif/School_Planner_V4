import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { auth } from './lib/firebase'
import { autoSignIn } from './lib/emulator'
import { flushPendingToast } from './utils/toast'

// 점검용 에뮬레이터에서만 동작한다(운영 빌드에서는 통째로 빠진다).
autoSignIn(auth)

// 새로고침을 건너오며 맡겨 둔 알림이 있으면 띄운다 (백업 복원 등)
flushPendingToast()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
