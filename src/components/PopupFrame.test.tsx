import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import PopupFrame, { useSidePopups, getSideColumn } from './PopupFrame';
import SidePanelFrame from './SidePanelFrame';
import { useAppStore } from '../store/useAppStore';

// 환경설정 > 팝업 모양. '오른쪽 칸'이면 넓은 화면에서 화면을 나눠 오른쪽 줄에 띄운다.
// 칸 위에서 또 칸을 열면 나중에 연 것이 위, 먼저 연 것이 아래에 쌓이고,
// 줄 전체가 한 덩어리로 스크롤한다. 칸 폭은 모두 같다.

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

const frameOf = (text: string) =>
  screen.getByText(text).closest('[data-popup-frame], aside') as HTMLElement;

beforeEach(() => {
  useAppStore.setState({ popupStyle: 'side' });
  useSidePopups.setState({ order: [] });
});

afterEach(() => {
  // @ts-expect-error jsdom에는 원래 없다
  delete window.matchMedia;
});

describe('PopupFrame - 오른쪽 줄', () => {
  it('넓은 화면에서는 오른쪽 줄에 서고, 뒤 화면을 덮지 않는다', () => {
    setWidth(1280);
    render(
      <PopupFrame isOpen onClose={vi.fn()}>
        <p>설정 내용</p>
      </PopupFrame>
    );
    const frame = frameOf('설정 내용');
    expect(frame.dataset.popupFrame).toBe('side');
    expect(getSideColumn().contains(frame)).toBe(true);
    // 어두운 배경이 없다
    expect(document.querySelector('.bg-slate-900\\/40')).toBeNull();
    // 혼자면 줄을 꽉 채운다
    expect(frame.style.height).toBe('100%');
    expect(useSidePopups.getState().order).toHaveLength(1);
  });

  it('줄은 스스로 스크롤하고, 끝까지 굴려도 뒤 화면으로 넘어가지 않는다', () => {
    setWidth(1280);
    const col = getSideColumn();
    expect(col.className).toContain('overflow-y-auto');
    expect(col.className).toContain('overscroll-contain');
  });

  it('폭을 따로 주어도(넓은 팝업) 오른쪽 줄의 폭은 하나다', () => {
    setWidth(1280);
    render(
      <>
        <PopupFrame isOpen onClose={vi.fn()} width="4xl">
          <p>시간표</p>
        </PopupFrame>
      </>
    );
    // 칸은 줄의 폭을 그대로 쓴다 (칸마다 폭을 정하지 않는다)
    expect(frameOf('시간표').style.width).toBe('');
    expect(getSideColumn().style.width).toContain('--right-column-w');
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

describe('PopupFrame - 칸 위에서 연 칸', () => {
  it('나중에 연 것(하위)이 위, 먼저 연 것(상위)이 아래에 제 길이대로 쌓인다', () => {
    setWidth(1280);
    const Two = ({ child }: { child: boolean }) => (
      <>
        <PopupFrame isOpen onClose={vi.fn()}>
          <p>상위</p>
        </PopupFrame>
        <PopupFrame isOpen={child} onClose={vi.fn()}>
          <p>하위</p>
        </PopupFrame>
      </>
    );
    const { rerender } = render(<Two child={false} />);
    expect(frameOf('상위').style.height).toBe('100%');

    rerender(<Two child />);
    expect(frameOf('하위').style.order).toBe('0');
    expect(frameOf('상위').style.order).toBe('1');
    // 여럿이면 칸마다 높이를 묶지 않는다 - 줄 전체가 한 덩어리로 스크롤한다
    expect(frameOf('하위').style.height).toBe('');
    expect(frameOf('상위').style.height).toBe('');

    // 하위를 닫으면 상위가 다시 줄을 꽉 채운다
    rerender(<Two child={false} />);
    expect(frameOf('상위').style.height).toBe('100%');
  });

  it('메모·기록·일정 쓰는 칸에서 연 팝업도 같은 줄 - 쓰는 칸이 아래로 간다', () => {
    setWidth(1280);
    render(
      <>
        <SidePanelFrame docked onClose={vi.fn()} onBackdropClose={vi.fn()} ariaLabel="일정 쓰기">
          <p>일정 쓰는 칸</p>
        </SidePanelFrame>
        <PopupFrame isOpen onClose={vi.fn()}>
          <p>링크 추가</p>
        </PopupFrame>
      </>
    );
    const col = getSideColumn();
    expect(col.contains(frameOf('링크 추가'))).toBe(true);
    expect(col.contains(frameOf('일정 쓰는 칸'))).toBe(true);
    expect(frameOf('링크 추가').style.order).toBe('0');
    expect(frameOf('일정 쓰는 칸').style.order).toBe('1');
  });
});
