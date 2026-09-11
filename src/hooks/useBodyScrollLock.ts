import { useEffect } from 'react';

let lockCount = 0;

const SCROLLABLE_ATTR = 'data-scroll-lock';

function findScrollable(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${SCROLLABLE_ATTR}]`) as HTMLElement | null;
}

function isAtScrollBoundary(el: HTMLElement, deltaY: number): boolean {
  const { scrollTop, scrollHeight, clientHeight } = el;
  if (scrollHeight <= clientHeight) return true;
  if (deltaY < 0) return scrollTop <= 0;
  if (deltaY > 0) return scrollTop + clientHeight >= scrollHeight - 1;
  return false;
}

function handleWheel(e: WheelEvent) {
  const scrollable = findScrollable(e.target);
  if (!scrollable || isAtScrollBoundary(scrollable, e.deltaY)) {
    e.preventDefault();
  }
}

let touchStartY = 0;

function handleTouchStart(e: TouchEvent) {
  touchStartY = e.touches[0]?.clientY ?? 0;
}

function handleTouchMove(e: TouchEvent) {
  const scrollable = findScrollable(e.target);
  if (!scrollable) {
    e.preventDefault();
    return;
  }
  const currentY = e.touches[0]?.clientY ?? touchStartY;
  const deltaY = touchStartY - currentY; // 손가락을 위로 밀면(스크롤 다운) 양수
  if (isAtScrollBoundary(scrollable, deltaY)) {
    e.preventDefault();
  }
}

// 팝업이 열려있는 동안, [data-scroll-lock] 영역 밖(또는 그 영역의 스크롤 경계)에서는
// 휠/터치 스크롤이 배경 페이지로 전달되지 않도록 막는다.
export function useBodyScrollLock(isOpen: boolean) {
  useEffect(() => {
    if (!isOpen) return;

    if (lockCount === 0) {
      document.addEventListener('wheel', handleWheel, { passive: false });
      document.addEventListener('touchstart', handleTouchStart, { passive: true });
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
    }
    lockCount++;

    return () => {
      lockCount--;
      if (lockCount === 0) {
        document.removeEventListener('wheel', handleWheel);
        document.removeEventListener('touchstart', handleTouchStart);
        document.removeEventListener('touchmove', handleTouchMove);
      }
    };
  }, [isOpen]);
}
