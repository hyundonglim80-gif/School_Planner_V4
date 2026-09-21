import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuickAddModal from './QuickAddModal';

// 주간·월간·년간에서 일정을 더할 때 여는 팝업이다. 하루 화면의 '+ 새 일정'과
// 같게 굴어야 한다. 같은 일정을 더하는데 어느 화면에서 눌렀느냐에 따라 라벨이
// 붙기도 하고 안 붙기도 하면, 나중에 라벨로 걸러 볼 때 왜 빠졌는지 알 수 없다.
describe('QuickAddModal - 라벨 미리 고르기', () => {
  const renderModal = () =>
    render(<QuickAddModal isOpen onClose={vi.fn()} dateStr="2026-09-21" />);

  it('맨 위 라벨이 미리 골라져 있다', async () => {
    renderModal();

    // 라벨 목록의 맨 위 (DEFAULT_EVENT_LABELS 기준)
    expect(await screen.findByRole('button', { name: '달력' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('눌러서 뗄 수 있다', async () => {
    const user = userEvent.setup();
    renderModal();

    const first = await screen.findByRole('button', { name: '달력' });
    await user.click(first);

    expect(first).toHaveAttribute('aria-pressed', 'false');
  });

  it('미리 골라 둔 것 말고는 꺼져 있다', async () => {
    renderModal();

    expect(await screen.findByRole('button', { name: '이월' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });
});
