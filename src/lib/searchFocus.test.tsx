import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useAppStore } from '../store/useAppStore';
import { focusKey, scrollToFocusKey, useSearchFocusRunner } from './searchFocus';
import * as toast from '../utils/toast';

function Runner() {
  useSearchFocusRunner();
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom에는 scrollIntoView가 없다
  Element.prototype.scrollIntoView = vi.fn();
  useAppStore.setState({ focusTarget: null });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const addItem = (key: string) => {
  const el = document.createElement('div');
  el.dataset.focusKey = key;
  document.body.appendChild(el);
  return el;
};

describe('검색에서 이동한 항목 짚기', () => {
  it('하루 화면의 id는 날짜마다 되풀이되므로 날짜를 함께 넣는다', () => {
    expect(focusKey.event('2026-04-10', 'ev_0')).not.toBe(focusKey.event('2026-04-11', 'ev_0'));
  });

  it('항목을 찾으면 스크롤하고 잠깐 강조한다', () => {
    const el = addItem(focusKey.memo('m1'));

    expect(scrollToFocusKey(focusKey.memo('m1'))).toBe(true);
    expect(el.scrollIntoView).toHaveBeenCalled();
    expect(el.classList.contains('search-focus')).toBe(true);

    vi.advanceTimersByTime(3000);
    expect(el.classList.contains('search-focus')).toBe(false);
  });

  it('데이터가 늦게 와서 항목이 나중에 나타나도 기다렸다가 짚는다', () => {
    render(<Runner />);
    act(() => useAppStore.getState().requestFocus({ key: focusKey.event('2026-04-10', 'ev_a'), section: 'event' }));

    vi.advanceTimersByTime(500);
    const el = addItem(focusKey.event('2026-04-10', 'ev_a'));
    act(() => vi.advanceTimersByTime(300));

    expect(el.classList.contains('search-focus')).toBe(true);
    // 다 짚었으면 요청을 비운다 (같은 항목을 또 고를 수 있게)
    expect(useAppStore.getState().focusTarget).toBeNull();
  });

  it('끝내 나타나지 않으면 알려 주고 요청을 비운다', () => {
    const spy = vi.spyOn(toast, 'showToast').mockImplementation(() => {});
    render(<Runner />);
    act(() => useAppStore.getState().requestFocus({ key: focusKey.memo('없는 것'), section: 'memo' }));

    act(() => vi.advanceTimersByTime(7000));

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('찾지 못했습니다'));
    expect(useAppStore.getState().focusTarget).toBeNull();
  });
});
