import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { closeAllModals } from './useModalLayer';

/**
 * 팝업 배경(어두운 부분)을 눌러 닫는 동작.
 *
 * 예전에는 배경에 onClick={closeAllModals} 하나만 걸려 있었다. 그런데 click은
 * 누른 곳과 뗀 곳의 공통 조상에서 일어난다. 그래서 팝업 안에서 글자를 끌어
 * 선택하다가 손을 팝업 밖에서 떼면, click의 대상이 배경이 되어 팝업이 닫혔다.
 * 안쪽에 stopPropagation을 걸어도 소용이 없다. click 자체가 배경에서 나기 때문이다.
 *
 * 그래서 누른 곳과 뗀 곳이 "둘 다" 배경일 때만 닫는다.
 *   배경에서 누르고 배경에서 뗌   -> 닫는다 (배경을 클릭한 것)
 *   팝업에서 누르고 배경에서 뗌   -> 그대로 둔다 (글자를 끌어 선택하던 중)
 *   배경에서 누르고 팝업에서 뗌   -> 그대로 둔다
 */
export function useBackdropClose(onClose: () => void = closeAllModals) {
  const startedOnBackdrop = useRef(false);

  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      startedOnBackdrop.current = e.target === e.currentTarget;
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const started = startedOnBackdrop.current;
      startedOnBackdrop.current = false;
      if (!started) return;
      if (e.target !== e.currentTarget) return;
      onClose();
    },
  };
}
