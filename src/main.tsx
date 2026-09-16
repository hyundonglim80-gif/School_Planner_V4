import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { auth } from './lib/firebase'
import { autoSignIn } from './lib/emulator'

// 점검용 에뮬레이터에서만 동작한다(운영 빌드에서는 통째로 빠진다).
autoSignIn(auth)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
