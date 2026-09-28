import { createContext, useContext } from 'react';

/**
 * 화면 본문(main)의 실제 폭.
 *
 * 오른쪽 메모·기록 칸이 열리면 본문이 그만큼 좁아진다. 그런데 창 폭(뷰포트)은
 * 그대로라, 창 폭으로 칸 수를 정하는 화면은 좁아진 본문에 넓은 배치를 밀어 넣는다.
 * 칸 수를 정할 때는 창 폭 대신 이 값을 본다. (CSS 쪽은 @container 로 같은 일을 한다)
 */
export const MainWidthContext = createContext<number>(typeof window !== 'undefined' ? window.innerWidth : 1280);

export function useMainWidth(): number {
  return useContext(MainWidthContext);
}
