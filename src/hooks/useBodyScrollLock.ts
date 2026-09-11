import { useEffect } from 'react';

let lockCount = 0;

const SCROLLABLE_ATTR = 'data-scroll-lock';
// 모든 팝업의 최상위 오버레이 래퍼가 공통으로 쓰는 클래스 (fixed inset-0 ...)
const MODAL_ROOT_SELECTOR = '.fixed.inset-0';

function findScrollable(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const direct = target.closest(`[${SCROLLABLE_ATTR}]`) as HTMLElement | null;
  if (direct) return direct;

  // 헤더/탭/푸터처럼 스크롤 영역이 아닌 곳에서 스크롤하더라도, 같은 팝업 안이라면
  // 그 팝업의 기본 스크롤 영역으로 대신 스크롤되도록 한다.
  const modalRoot = target.closest(MODAL_ROOT_SELECTOR);
  return (modalRoot?.querySelector(`[${SCROLLABLE_ATTR}]`) as HTMLElement | null) ?? null;
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
  if (!scrollable) {
    e.preventDefault();
    return;
  }
  const directHit = (e.target instanceof Element) && !!e.target.closest(`[${SCROLLABLE_ATTR}]`);
  if (isAtScrollBoundary(scrollable, e.deltaY)) {
    e.preventDefault();
  } else if (!directHit) {
    // 헤더/탭/푸터 등에서 발생한 스크롤은 브라우저 기본 동작이 없으므로 직접 반영한다.
    scrollable.scrollTop += e.deltaY;
    e.preventDefault();
  }
}

let touchStartY = 0;
let touchLastY = 0;

function handleTouchStart(e: TouchEvent) {
  touchStartY = e.touches[0]?.clientY ?? 0;
  touchLastY = touchStartY;
}

function handleTouchMove(e: TouchEvent) {
  const scrollable = findScrollable(e.target);
  if (!scrollable) {
    e.preventDefault();
    return;
  }
  const currentY = e.touches[0]?.clientY ?? touchLastY;
  const stepDeltaY = touchLastY - currentY; // 손가락을 위로 밀면(스크롤 다운) 양수
  const totalDeltaY = touchStartY - currentY;
  touchLastY = currentY;

  const directHit = (e.target instanceof Element) && !!e.target.closest(`[${SCROLLABLE_ATTR}]`);
  if (isAtScrollBoundary(scrollable, totalDeltaY)) {
    e.preventDefault();
  } else if (!directHit) {
    scrollable.scrollTop += stepDeltaY;
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
