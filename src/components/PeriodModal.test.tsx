import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PeriodModal from './PeriodModal';

// 2026-09-21은 월요일이다.
const MONDAY = '2026-09-21';

const renderModal = () =>
  render(<PeriodModal isOpen onClose={vi.fn()} startDate={MONDAY} defaultContent="여름방학" />);

describe('PeriodModal - 기간 설정', () => {
  it('일정 내용과 시작·끝 날짜 칸이 보인다', () => {
    renderModal();

    expect(screen.getByDisplayValue('여름방학')).toBeInTheDocument();
    expect(screen.getByLabelText('시작일')).toHaveValue(MONDAY);
    expect(screen.getByLabelText('종료일')).toHaveValue(MONDAY);
  });

  it('주말을 뺀 날짜 수가 등록 버튼에 나온다', () => {
    renderModal();

    // 월~일 7일 중 토·일을 빼면 평일 5일
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-27' } });

    expect(screen.getByRole('button', { name: '등록 (5일)' })).toBeInTheDocument();
  });

  it('주말 제외를 끄면 주말까지 센다', async () => {
    const user = userEvent.setup();
    renderModal();

    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-27' } });
    await user.click(screen.getByLabelText(/주말/));

    expect(screen.getByRole('button', { name: '등록 (7일)' })).toBeInTheDocument();
  });

  it('종료일이 시작일보다 빠르면 등록할 수 없다', () => {
    renderModal();

    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-01' } });

    expect(screen.getByRole('button', { name: '등록 (0일)' })).toBeDisabled();
  });
});
