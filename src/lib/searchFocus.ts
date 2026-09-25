// src/lib/searchFocus.ts
//
// 검색 결과에서 '이동'을 누르면 그 항목이 있는 화면으로 간 뒤,
// 항목이 화면에 나타나도록 스크롤하고 잠깐 강조한다.
//
// 화면 쪽 항목에는 data-focus-key를 붙여 둔다. 화면을 바꾸면 데이터가 늦게
// 도착하므로, 그 표식이 나타날 때까지 잠시 기다렸다가 찾는다.
import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { showToast } from '../utils/toast';

/** 이동한 화면에서 펼쳐 둬야 할 칸. 접혀 있으면 항목이 그려지지 않는다. */
export type FocusSection = 'memo' | 'event' | 'journal' | 'schedule';

export interface FocusTarget {
  /** 화면 항목의 data-focus-key와 같은 값 */
  key: string;
  section?: FocusSection;
}

// 하루 화면의 항목 id(ev_0, jr_0 …)는 날짜마다 되풀이되므로 날짜를 함께 넣는다.
export const focusKey = {
  memo: (id: string) => `memo:${id}`,
  event: (dateStr: string, id: string) => `event:${dateStr}:${id}`,
  journal: (dateStr: string, id: string) => `journal:${dateStr}:${id}`,
  period: (dateStr: string, period: number | string) => `period:${dateStr}:${period}`,
};

/** 강조가 머무는 시간 */
const HIGHLIGHT_MS = 2600;
/** 항목이 나타나기를 기다리는 최대 시간 (데이터가 늦게 올 수 있다) */
const WAIT_MS = 6000;
const POLL_MS = 150;

/** 표식이 붙은 항목을 찾아 가운데로 스크롤하고 강조한다. 찾으면 true. */
export function scrollToFocusKey(key: string): boolean {
  // 따옴표 안의 속성 값이라 따옴표와 역슬래시만 막으면 된다
  const quoted = key.replace(/["\\]/g, (c) => '\\' + c);
  const el = document.querySelector<HTMLElement>(`[data-focus-key="${quoted}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('search-focus');
  // 같은 항목을 연달아 고르면 애니메이션이 다시 돌도록 한 번 그리게 한다
  void el.offsetWidth;
  el.classList.add('search-focus');
  window.setTimeout(() => el.classList.remove('search-focus'), HIGHLIGHT_MS);
  return true;
}

/**
 * 이동 요청을 지켜보다가 항목이 나타나면 스크롤하고 강조한다.
 * 앱 전체에서 한 번만 쓴다 (Layout).
 */
export function useSearchFocusRunner() {
  const focusTarget = useAppStore((s) => s.focusTarget);
  const clearFocusTarget = useAppStore((s) => s.clearFocusTarget);

  useEffect(() => {
    if (!focusTarget) return;
    const started = Date.now();
    let timer = 0;
    const tryFind = () => {
      if (scrollToFocusKey(focusTarget.key)) {
        clearFocusTarget();
        return;
      }
      if (Date.now() - started >= WAIT_MS) {
        showToast('항목을 화면에서 찾지 못했습니다. 지워졌거나 옮겨졌을 수 있습니다.');
        clearFocusTarget();
        return;
      }
      timer = window.setTimeout(tryFind, POLL_MS);
    };
    // 화면이 바뀐 뒤 한 번 그려질 틈을 준다
    timer = window.setTimeout(tryFind, 50);
    return () => window.clearTimeout(timer);
  }, [focusTarget, clearFocusTarget]);
}
