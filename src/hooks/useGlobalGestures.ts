import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';

const SCOPES = ['day', 'week', 'month', 'year', 'memo'] as const;

export function useGlobalGestures() {
  const touchStartRef = useRef({ x: 0, y: 0, atTop: false, atBottom: false });
  const blockWheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollNavTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // 팝업(모달) 감지 함수: 모달이 열려있으면 제스처가 무시됨
    const isModalOpen = () => {
      // 1. AppStore의 명시적 모달 상태 검사 (주요 모달들)
      const state = useAppStore.getState();
      if (
        state.isLinkerModalOpen ||
        state.isLinkViewerModalOpen ||
        state.isEvaluationModalOpen ||
        state.isTrashModalOpen ||
        state.isLabelModalOpen
      ) {
        return true;
      }
      
      // 2. Headless UI나 Radix UI 등 전역 Dialog 오버레이 또는 body 스크롤 방지 감지
      if (document.body.style.overflow === 'hidden') return true;
      if (document.querySelector('[role="dialog"]')) return true;

      return false;
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (isModalOpen()) return;

      touchStartRef.current.x = e.touches[0].clientX;
      touchStartRef.current.y = e.touches[0].clientY;

      const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const currentScroll = Math.ceil(window.innerHeight + window.scrollY);

      // 모바일 오차 50px 허용
      touchStartRef.current.atTop = window.scrollY <= 50;
      touchStartRef.current.atBottom = currentScroll >= scrollHeight - 50;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (isModalOpen()) return;
      if (scrollNavTimeout.current) return;

      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;

      const deltaX = touchStartRef.current.x - touchEndX;
      const deltaY = touchStartRef.current.y - touchEndY;

      const state = useAppStore.getState();

      // 좌우 스와이프: 가로 이동거리가 세로 이동거리의 1.5배보다 크고 50px 이상 이동했을 때
      if (Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        if (Math.abs(deltaX) > 50) {
          const currentIdx = SCOPES.indexOf(state.scope);
          if (currentIdx !== -1) {
            let nextIdx = deltaX > 0 ? currentIdx + 1 : currentIdx - 1;
            if (nextIdx < 0) nextIdx = SCOPES.length - 1;
            if (nextIdx >= SCOPES.length) nextIdx = 0;
            state.setScope(SCOPES[nextIdx]);
          }
        }
      } else {
        // 세로 스와이프: 메모 화면에서는 제외
        if (state.scope === 'memo') return;

        const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        const currentScroll = Math.ceil(window.innerHeight + window.scrollY);
        const atBottom = currentScroll >= scrollHeight - 50;
        const atTop = window.scrollY <= 50;

        if (atBottom && deltaY > 50 && touchStartRef.current.atBottom) {
          state.navigateNextDate();
          lockScrollNav();
        } else if (atTop && deltaY < -50 && touchStartRef.current.atTop) {
          state.navigatePrevDate();
          lockScrollNav();
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (isModalOpen()) return;
      const state = useAppStore.getState();
      if (state.scope === 'memo') return;
      if (scrollNavTimeout.current) return;

      const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const currentScroll = Math.ceil(window.innerHeight + window.scrollY);
      const atBottom = currentScroll >= scrollHeight - 10;
      const atTop = window.scrollY <= 10;

      if (!blockWheelTimer.current) {
        touchStartRef.current.atTop = atTop;
        touchStartRef.current.atBottom = atBottom;
      }
      if (blockWheelTimer.current) clearTimeout(blockWheelTimer.current);
      blockWheelTimer.current = setTimeout(() => { blockWheelTimer.current = null; }, 150);

      if (atBottom && e.deltaY > 0 && touchStartRef.current.atBottom) {
        state.navigateNextDate();
        lockScrollNav();
      } else if (atTop && e.deltaY < 0 && touchStartRef.current.atTop) {
        state.navigatePrevDate();
        lockScrollNav();
      }
    };

    const lockScrollNav = () => {
      if (scrollNavTimeout.current) clearTimeout(scrollNavTimeout.current);
      scrollNavTimeout.current = setTimeout(() => {
        scrollNavTimeout.current = null;
      }, 800);
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('wheel', handleWheel, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('wheel', handleWheel);
      if (blockWheelTimer.current) clearTimeout(blockWheelTimer.current);
      if (scrollNavTimeout.current) clearTimeout(scrollNavTimeout.current);
    };
  }, []);
}
