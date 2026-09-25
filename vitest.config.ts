import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 컴포넌트 테스트용 설정.
// 앱 빌드(vite.config.ts)와 분리해 두어 tailwind 플러그인 등을 끌어들이지 않는다.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // 기본 풀은 테스트 파일마다 jsdom을 새로 만들어 시간의 2/3를 거기에 썼다
    // (208초). vmThreads는 파일마다 따로 떼어 두면서도 jsdom을 일꾼마다 한 번만
    // 만든다 (약 45초).
    pool: 'vmThreads',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
