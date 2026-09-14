import { useEffect, useRef } from 'react';
import { isAnyModalOpen } from './useModalLayer';

/**
 * 화면 안에 펼쳐지는 수정 섹션을 바깥 클릭으로 닫는다. ('닫기'를 누른 것과 같게)
 *
 * 섹션에서 띄운 팝업(알림/링크/라벨/조사표)은 DOM상 섹션 밖에 그려진다.
 * 그 팝업을 누른 것까지 바깥으로 세면 수정하던 게 닫혀버리므로, 팝업이 열려 있는
 * 동안은 아무것도 하지 않는다.
 */
export function useClickOutside<T extends HTMLElement>(
  active: boolean,
  onOutside: () => void
) {
  const ref = useRef<T>(null);
  const onOutsideRef = useRef(onOutside);
  onOutsideRef.current = onOutside;

  useEffect(() => {
    if (!active) return;

    const handle = (e: MouseEvent) => {
      if (isAnyModalOpen()) return;
      const el = ref.current;
      if (!el) return;
      const target = e.target as Node | null;
      // 이미 문서에서 빠진 요소를 누른 경우(누르자마자 사라지는 버튼 등)는 판단할 수 없다
      if (!target || !target.isConnected) return;
      if (el.contains(target)) return;
      onOutsideRef.current();
    };

    // 캡처 단계에서 듣는다. 안쪽 버튼이 stopPropagation을 걸어도 바깥 클릭 판정은 해야 한다.
    document.addEventListener('mousedown', handle, true);
    return () => document.removeEventListener('mousedown', handle, true);
  }, [active]);

  return ref;
}
