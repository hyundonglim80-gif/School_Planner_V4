import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ModalShell from './ModalShell';

// 팝업 안에서 글자를 끌어 선택하다가 팝업 밖에서 손을 떼면 팝업이 닫혀버렸다.
// click은 누른 곳과 뗀 곳의 공통 조상(= 배경)에서 일어나기 때문이다.
// 안쪽에 stopPropagation을 걸어도 막히지 않는다.
const setup = () => {
  const onClose = vi.fn();
  render(
    <ModalShell isOpen onClose={onClose} title="시험용">
      <p>끌어서 선택할 내용</p>
    </ModalShell>
  );
  const panelText = screen.getByText('끌어서 선택할 내용');
  // 배경은 팝업 상자의 부모
  const backdrop = panelText.closest('.fixed') as HTMLElement;
  return { onClose, panelText, backdrop };
};

describe('ModalShell - 배경 눌러 닫기', () => {
  it('배경에서 누르고 배경에서 떼면 닫는다', () => {
    const { onClose, backdrop } = setup();

    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  it('팝업 안에서 끌기 시작해 배경에서 떼면 닫지 않는다', () => {
    const { onClose, panelText, backdrop } = setup();

    // 글자 위에서 누르고(선택 시작) 배경까지 끌고 나가 손을 뗀다
    fireEvent.pointerDown(panelText);
    fireEvent.pointerUp(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('배경에서 누르고 팝업 안에서 떼도 닫지 않는다', () => {
    const { onClose, panelText, backdrop } = setup();

    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(panelText);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('끌다가 취소된 뒤 배경을 다시 눌러야 닫힌다 (상태가 남지 않는다)', () => {
    const { onClose, panelText, backdrop } = setup();

    fireEvent.pointerDown(panelText);
    fireEvent.pointerUp(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);
    expect(onClose).toHaveBeenCalled();
  });
});
