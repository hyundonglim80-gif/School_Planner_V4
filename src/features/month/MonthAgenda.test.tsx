import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MonthAgenda from './MonthAgenda';
import type { CalendarDay } from '../../lib/dateUtils';
import type { DaySummary } from '../../hooks/useCalendarData';

const days: CalendarDay[] = [
  // 앞 달 꼬리 - 목록에서는 빠져야 한다
  { dateStr: '2026-08-31', day: 31, month: 8, year: 2026, isCurrentMonth: false, isToday: false, isSunday: false, isSaturday: false },
  { dateStr: '2026-09-01', day: 1, month: 9, year: 2026, isCurrentMonth: true, isToday: false, isSunday: false, isSaturday: false },
  { dateStr: '2026-09-02', day: 2, month: 9, year: 2026, isCurrentMonth: true, isToday: false, isSunday: false, isSaturday: false },
  { dateStr: '2026-09-05', day: 5, month: 9, year: 2026, isCurrentMonth: true, isToday: false, isSunday: false, isSaturday: true },
  { dateStr: '2026-09-06', day: 6, month: 9, year: 2026, isCurrentMonth: true, isToday: false, isSunday: true, isSaturday: false },
];

const dataMap: Record<string, DaySummary> = {
  '2026-09-01': {
    eventList: [{ id: 'ev_1', content: '학년 협의회', completed: false, linkedItems: [], attachments: [] }],
    schedules: { 1: { subject: '국어', content: '', memo: '', supplies: '' } },
  },
  '2026-08-31': {
    eventList: [{ id: 'ev_x', content: '지난달 일정', completed: false, linkedItems: [], attachments: [] }],
  },
};

function renderAgenda(overrides: Partial<React.ComponentProps<typeof MonthAgenda>> = {}) {
  const props = {
    days,
    dataMap,
    onSelectDate: vi.fn(),
    onQuickAdd: vi.fn(),
    showWeekend: true,
    onToggleEvent: vi.fn(),
    onDeleteEvent: vi.fn(),
    ...overrides,
  };
  return { ...render(<MonthAgenda {...props} />), props };
}

describe('MonthAgenda - 휴대폰 월간 목록', () => {
  it('일정 제목이 잘리지 않고 그대로 보인다', () => {
    renderAgenda();
    expect(screen.getByText('학년 협의회')).toBeInTheDocument();
  });

  it('이번 달이 아닌 날은 목록에서 빠진다', () => {
    renderAgenda();
    expect(screen.queryByText('지난달 일정')).toBeNull();
  });

  it('내용이 없는 날은 한 줄로 접어 보여준다', () => {
    renderAgenda();
    // 9/2, 9/5, 9/6 은 데이터가 없다
    expect(screen.getAllByText('일정 없음')).toHaveLength(3);
  });

  it('수업 과목을 교시와 함께 보여준다', () => {
    renderAgenda();
    expect(screen.getByText('국어')).toBeInTheDocument();
  });

  it('주말 숨기기를 켜면 토·일이 빠진다', () => {
    renderAgenda({ showWeekend: false });
    // 9/5(토), 9/6(일)이 빠져 빈 날은 9/2 하나만 남는다
    expect(screen.getAllByText('일정 없음')).toHaveLength(1);
  });

  it('날짜를 누르면 그 날의 하루 화면으로 넘어간다', async () => {
    const user = userEvent.setup();
    const { props } = renderAgenda();

    await user.click(screen.getByText('학년 협의회').closest('div.rounded-xl')!.querySelector('button')!);

    expect(props.onSelectDate).toHaveBeenCalledWith('2026-09-01');
  });

  it('+ 버튼은 빠른 추가를 연다', async () => {
    const user = userEvent.setup();
    const { props } = renderAgenda();

    await user.click(screen.getAllByTitle('일정 빠른 추가')[0]);

    expect(props.onQuickAdd).toHaveBeenCalledWith('2026-09-01');
  });

  it('일정마다 수정/삭제 아이콘이 있다', () => {
    renderAgenda();
    const row = screen.getByText('학년 협의회').closest('div.group') as HTMLElement;
    expect(within(row).getByTitle('일정 수정')).toBeInTheDocument();
    expect(within(row).getByTitle('일정 삭제')).toBeInTheDocument();
  });
});
