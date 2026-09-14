import { useEffect, useState } from 'react';

// Tailwind의 sm 경계(640px)와 같은 기준. 이보다 좁으면 휴대폰 세로 화면으로 본다.
// (갤럭시 S25 Ultra / S26의 CSS 폭은 약 412px)
const MOBILE_MAX_WIDTH = 639;

const readIsMobile = () =>
  typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX_WIDTH;

/**
 * 격자 대신 목록을 보여주는 식으로 "구조"가 달라져야 할 때만 쓴다.
 * 여백·글자 크기처럼 CSS로 되는 것은 Tailwind의 sm: 접두사로 처리한다.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(readIsMobile);

  useEffect(() => {
    const update = () => setIsMobile(readIsMobile());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return isMobile;
}
