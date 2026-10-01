import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MonthGrid from './MonthGrid';
import type { CalendarDay } from '../../lib/dateUtils';

// 월간 교시 칩. PC는 시간표 교시 수대로 그린다. 휴대폰은 과목 칩을 그리지 않는다(ROADMAP 15 - 세로 글자로
// 읽기 어려웠다. 그날 수업은 날짜를 누르면 올라오는 그날 목록에 적는다).
const day = (dateStr: string, dayNum: number): CalendarDay => ({
  dateStr,
  day: dayNum,
  month: 9,
  year: 2026,
  isCurrentMonth: true,
  isToday: false,
  isSunday: false,
  isSaturday: false,
});

const days = [day('2026-09-21', 21), day('2026-09-22', 22)];

/** 21일은 1·2·5교시, 22일은 1·2·3교시 (5교시를 3교시로 옮긴 날) */
const dataMap: any = {
  '2026-09-21': {
    eventList: [],
    schedules: { 1: { subject: '국어' }, 2: { subject: '수학' }, 5: { subject: '체육' } },
  },
  '2026-09-22': {
    eventList: [],
    schedules: { 1: { subject: '국어' }, 2: { subject: '수학' }, 3: { subject: '미술' } },
  },
};

function renderGrid(compact: boolean) {
  return render(
    <MonthGrid
      days={days}
      dataMap={dataMap}
      onSelectDate={vi.fn()}
      onQuickAdd={vi.fn()}
      onToggleEvent={vi.fn()}
      onDeleteEvent={vi.fn()}
      compact={compact}
    />
  );
}

describe('MonthGrid - 교시 칩', () => {
  it('휴대폰(compact)에서는 과목 칩을 그리지 않는다', () => {
    renderGrid(true);

    expect(screen.queryByTitle('체육 (5교시)')).toBeNull();
    expect(screen.queryAllByTitle('4교시')).toHaveLength(0);
  });

  it('PC는 시간표 교시 수대로 늘 다 그린다', () => {
    renderGrid(false);

    // 6교시까지 두 날 모두 빈 칸이 선다 (예전부터 이랬고 멀쩡했다)
    expect(screen.getAllByTitle('6교시')).toHaveLength(2);
    expect(screen.getAllByTitle('4교시')).toHaveLength(2);
    expect(screen.getByTitle('체육 (5교시)')).toBeInTheDocument();
  });

  it('휴대폰에서 그날 목록을 띄운 날짜는 칸에 표시', () => {
    const { container } = render(
      <MonthGrid days={days} dataMap={dataMap} onSelectDate={vi.fn()} onQuickAdd={vi.fn()} onToggleEvent={vi.fn()} onDeleteEvent={vi.fn()} compact selectedDate="2026-09-22" />
    );
    expect(container.querySelector('[data-selected="true"]')?.getAttribute('data-date')).toBe('2026-09-22');
  });
});
