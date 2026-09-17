import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 지금 브라우저가 어느 빌드를 돌리고 있는지 화면에서 확인할 수 있게 한다.
// 이걸 안 해 두었더니, 고친 것이 실제로 그 기기에서 돌고 있는지조차 알 수 없어
// '고쳤는데 그대로'라는 말을 여러 판 주고받았다.
const BUILD_ID = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
})
