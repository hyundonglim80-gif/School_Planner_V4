import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import PopupFrame, { useSidePopups } from './PopupFrame';
import SidePanelFrame from './SidePanelFrame';
import { useAppStore } from '../store/useAppStore';

// 환경설정 > 팝업 모양. '오른쪽 칸'이면 넓은 화면에서 화면을 나눠 오른쪽에 띄우고,
// 칸 위에서 또 칸을 열면 오른쪽을 위아래로 나눈다 (나중에 연 것이 위).

function setWidth(px: number) {
  window.matchMedia = vi.fn((query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] || 0);
    return {
      matches: px >= min,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList;
  });
}

const frameOf = (text: string) => screen.getByText(text).closest('[data-popup-frame], aside') as HTMLElement;

beforeEach(() => {
  useAppStore.setState({ popupStyle: 'side' });
  useSidePopups.setState({ order: [], widths: {} });
});

afterEach(() => {
  // @ts-expect-error jsdom에는 원래 없다
  delete window.matchMedia;
});

describe('PopupFrame - 오른쪽 칸', () => {
  it('넓은 화면에서는 화면 옆에 붙고, 뒤 화면을 덮지 않는다', () => {
    setWidth(1280);
    render(
      <PopupFrame isOpen onClose={vi.fn()}>
        <p>설정 내용</p>
      </PopupFrame>
    );
    const frame = frameOf('설정 내용');
    expect(frame.dataset.popupFrame).toBe('side');
    expect(frame.className).toContain('right-0');
    // 어두운 배경이 없다
    expect(document.querySelector('.bg-slate-900\\/40')).toBeNull();
    // Layout이 이 폭만큼 화면을 줄인다
    expect(Object.values(useSidePopups.getState().widths)).toHaveLength(1);
  });

  it('칸은 스스로 스크롤하고, 끝까지 굴려도 뒤 화면으로 넘어가지 않는다', () => {
    setWidth(1280);
    render(
      <PopupFrame isOpen onClose={vi.fn()}>
        <p>긴 내용</p>
      </PopupFrame>
    );
    const frame = frameOf('긴 내용');
    expect(frame.className).toContain('overflow-y-auto');
    expect(frame.className).toContain('overscroll-contain');
  });

  it('휴대폰에서는 오른쪽에서 나오는 배너로 뜬다', () => {
    setWidth(390);
    render(
      <PopupFrame isOpen onClose={vi.fn()}>
        <p>배너 내용</p>
      </PopupFrame>
    );
    expect(frameOf('배너 내용').dataset.popupFrame).toBe('banner');
    expect(useSidePopups.getState().order).toHaveLength(0);
  });

  it("'가운데 팝업'을 고르면 예전처럼 가운데에 뜬다", () => {
    setWidth(1280);
    useAppStore.setState({ popupStyle: 'center' });
    render(
      <PopupFrame isOpen onClose={vi.fn()}>
        <p>가운데 내용</p>
      </PopupFrame>
    );
    expect(frameOf('가운데 내용').dataset.popupFrame).toBe('center');
  });
});

describe('PopupFrame - 칸 위에서 연 칸은 위아래로 나눈다', () => {
  it('나중에 연 것(하위)이 위(크게), 먼저 연 것(상위)이 아래', () => {
    setWidth(1280);
    const { rerender } = render(
      <>
        <PopupFrame isOpen onClose={vi.fn()}>
          <p>상위</p>
        </PopupFrame>
      </>
    );
    expect(frameOf('상위').style.height).toBe('100%');

    rerender(
      <>
        <PopupFrame isOpen onClose={vi.fn()}>
          <p>상위</p>
        </PopupFrame>
        <PopupFrame isOpen onClose={vi.fn()}>
          <p>하위</p>
        </PopupFrame>
      </>
    );
    expect(frameOf('하위').style.top).toBe('0%');
    expect(frameOf('하위').style.height).toBe('62%');
    expect(frameOf('상위').style.top).toBe('62%');
    expect(frameOf('상위').style.height).toBe('38%');

    // 하위를 닫으면 상위가 다시 오른쪽을 다 쓴다
    rerender(
      <>
        <PopupFrame isOpen onClose={vi.fn()}>
          <p>상위</p>
        </PopupFrame>
        <PopupFrame isOpen={false} onClose={vi.fn()}>
          <p>하위</p>
        </PopupFrame>
      </>
    );
    expect(frameOf('상위').style.top).toBe('0%');
    expect(frameOf('상위').style.height).toBe('100%');
  });

  it('메모·기록·일정 쓰는 칸에서 연 팝업도 나눈다 - 쓰는 칸이 아래로 간다', () => {
    setWidth(1280);
    render(
      <>
        <SidePanelFrame docked onClose={vi.fn()} onBackdropClose={vi.fn()} ariaLabel="일정 쓰기">
          <p>일정 쓰는 칸</p>
        </SidePanelFrame>
      </>
    );
    act(() => {});
    render(
      <PopupFrame isOpen onClose={vi.fn()}>
        <p>링크 추가</p>
      </PopupFrame>
    );
    expect(frameOf('링크 추가').style.top).toBe('0%');
    expect(frameOf('일정 쓰는 칸').style.top).toBe('62%');
  });
});
