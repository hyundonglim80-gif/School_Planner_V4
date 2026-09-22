import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PeriodModal from './PeriodModal';

// 공휴일은 Firestore에서 읽어온다. 여기서는 표만 갈아 끼운다.
const gov = vi.hoisted(() => ({ days: {} as Record<string, string> }));
vi.mock('../hooks/useGovHolidays', () => ({
  loadHolidayYears: async () => gov.days,
}));

// 2026-09-21은 월요일이다.
const MONDAY = '2026-09-21';

const renderModal = () =>
  render(<PeriodModal isOpen onClose={vi.fn()} startDate={MONDAY} defaultContent="여름방학" />);

beforeEach(() => {
  gov.days = {};
});

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

describe('PeriodModal - 공휴일', () => {
  // 주말을 뺄 때 공휴일도 같이 뺀다. 학교가 쉬는 날에 일정을 깔아 두면
  // 그날 할 수 없는 일이 목록에 남고, 미완료로 계속 이월된다.
  it('주말 제외를 켜면 공휴일도 빠진다', async () => {
    gov.days = { '2026-09-23': '테스트 공휴일' }; // 수요일

    renderModal();
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-27' } });

    // 평일 5일에서 공휴일 하루가 빠져 4일
    expect(await screen.findByRole('button', { name: '등록 (4일)' })).toBeInTheDocument();
  });

  it('빠지는 공휴일 이름을 알려 준다', async () => {
    gov.days = { '2026-09-23': '테스트 공휴일' };

    renderModal();
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-27' } });

    expect(await screen.findByText(/빠지는 공휴일: 테스트 공휴일/)).toBeInTheDocument();
  });

  it('주말 제외를 끄면 공휴일에도 등록한다', async () => {
    gov.days = { '2026-09-23': '테스트 공휴일' };
    const user = userEvent.setup();

    renderModal();
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-27' } });
    await screen.findByRole('button', { name: '등록 (4일)' });
    await user.click(screen.getByLabelText(/주말/));

    expect(screen.getByRole('button', { name: '등록 (7일)' })).toBeInTheDocument();
  });
});
