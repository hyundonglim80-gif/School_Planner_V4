import { useEffect, useState } from 'react';

/**
 * 화면 폭이 minPx 이상인가. Tailwind 경계(xl = 1280px 등)와 같은 CSS 픽셀로 잰다.
 * 브라우저 확대/축소(90% 등)를 하면 CSS 폭이 바뀌므로 그것도 따라간다.
 *
 * 구조가 달라져야 할 때만 쓴다(그릴지 말지). 모양만 바뀌는 것은 CSS로 한다.
 */
export function useMinWidth(minPx: number): boolean {
  const query = `(min-width: ${minPx}px)`;
  const read = () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;
  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return matches;
}
