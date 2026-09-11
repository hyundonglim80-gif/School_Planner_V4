import { useEffect } from 'react';

let lockCount = 0;

// 팝업이 지정한 대표 스크롤 영역 (헤더/푸터 위에서 스크롤할 때 사용)
const SCROLLABLE_ATTR = 'data-scroll-lock';
// 모든 팝업의 최상위 오버레이 래퍼가 공통으로 쓰는 클래스 (fixed inset-0 ...)
const MODAL_ROOT_SELECTOR = '.fixed.inset-0';

// 해당 요소가 요청한 방향으로 실제로 더 스크롤될 수 있는지 확인한다.
function canScroll(el: Element, deltaY: number): boolean {
  const { overflowY } = getComputedStyle(el);
  if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') return false;

  const { scrollTop, scrollHeight, clientHeight } = el as HTMLElement;
  if (scrollHeight <= clientHeight) return false;
  if (deltaY > 0) return scrollTop + clientHeight < scrollHeight - 1;
  if (deltaY < 0) return scrollTop > 0;
  return false;
}

function getModalRoot(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(MODAL_ROOT_SELECTOR);
}

// 커서 아래에서부터 팝업 루트까지 올라가며, 실제로 스크롤 여지가 있는 가장 가까운 요소를 찾는다.
// data-scroll-lock 표시 여부와 무관하게 동작하므로 중첩된 목록(max-h-* overflow-y-auto)도 정상 스크롤된다.
function findScrollTarget(target: EventTarget | null, deltaY: number): HTMLElement | null {
  const modalRoot = getModalRoot(target);
  if (!modalRoot || !(target instanceof Element)) return null;

  let el: Element | null = target;
  while (el) {
    if (canScroll(el, deltaY)) return el as HTMLElement;
    if (el === modalRoot) break;
    el = el.parentElement;
  }
  return null;
}

// 커서 아래에 스크롤할 것이 없을 때(헤더/탭/푸터/딤 배경 등) 대신 스크롤할 팝업의 대표 영역.
// 딤 레이어를 별도 fixed inset-0로 두는 팝업도 있으므로 상위 오버레이까지 거슬러 올라가며 찾는다.
function findFallbackScrollable(target: EventTarget | null, deltaY: number): HTMLElement | null {
  let modalRoot = getModalRoot(target);

  while (modalRoot) {
    const marked = modalRoot.querySelectorAll<HTMLElement>(`[${SCROLLABLE_ATTR}]`);
    for (const el of marked) {
      if (canScroll(el, deltaY)) return el;
    }
    modalRoot = modalRoot.parentElement?.closest(MODAL_ROOT_SELECTOR) ?? null;
  }
  return null;
}

function handleWheel(e: WheelEvent) {
  // 1. 커서 아래에 스크롤 여지가 있으면 브라우저 기본 동작에 맡긴다.
  if (findScrollTarget(e.target, e.deltaY)) return;

  // 2. 없으면 같은 팝업의 대표 스크롤 영역을 직접 스크롤한다.
  const fallback = findFallbackScrollable(e.target, e.deltaY);
  if (fallback) fallback.scrollTop += e.deltaY;

  // 3. 어느 경우든 배경 페이지로는 스크롤이 넘어가지 않게 막는다.
  e.preventDefault();
}

let touchLastY = 0;

function handleTouchStart(e: TouchEvent) {
  touchLastY = e.touches[0]?.clientY ?? 0;
}

function handleTouchMove(e: TouchEvent) {
  const currentY = e.touches[0]?.clientY ?? touchLastY;
  const deltaY = touchLastY - currentY; // 손가락을 위로 밀면(스크롤 다운) 양수
  touchLastY = currentY;

  if (findScrollTarget(e.target, deltaY)) return;

  const fallback = findFallbackScrollable(e.target, deltaY);
  if (fallback) fallback.scrollTop += deltaY;

  e.preventDefault();
}

// 팝업이 열려있는 동안 팝업 내부에서는 정상적으로 스크롤되게 하고,
// 배경 페이지로 스크롤이 전달되는 것만 막는다.
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
