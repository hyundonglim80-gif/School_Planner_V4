import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 컴포넌트 테스트용 설정.
// 앱 빌드(vite.config.ts)와 분리해 두어 tailwind 플러그인 등을 끌어들이지 않는다.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
