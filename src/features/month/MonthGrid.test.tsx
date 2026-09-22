import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MonthGrid from './MonthGrid';
import type { CalendarDay } from '../../lib/dateUtils';

// 휴대폰 월간은 뒤쪽 빈 교시를 그리지 않는다. 그 잘라내기를 '그날 마지막 수업'으로
// 재던 것이 문제였다. 5교시 수업을 3교시로 옮긴 날 하나만 칸이 셋으로 줄고,
// 비어 있던 4·5교시가 통째로 사라졌다. 옆 날짜는 다섯 칸인데 그 날만 셋이었다.
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

describe('MonthGrid - 휴대폰 교시 칸', () => {
  it('수업을 앞 교시로 옮겨도 그날 칸만 줄지 않는다', () => {
    renderGrid(true);

    // 두 날 모두 4교시 자리가 빈 칸으로 남아 있어야 한다
    expect(screen.getAllByTitle('4교시')).toHaveLength(2);
  });

  it('달에 5교시가 있으면 5교시까지 그린다', () => {
    renderGrid(true);

    // 21일은 체육이 차 있고, 22일은 빈 칸으로 남는다
    expect(screen.getByTitle('체육 (5교시)')).toBeInTheDocument();
    expect(screen.getAllByTitle('5교시')).toHaveLength(1);
  });

  it('달 전체에 없는 뒤쪽 교시는 그리지 않는다', () => {
    // 기본 시간표는 6교시까지지만 이 달에는 6교시 수업이 없다
    renderGrid(true);

    expect(screen.queryAllByTitle('6교시')).toHaveLength(0);
  });

  it('PC는 시간표 교시 수대로 늘 다 그린다', () => {
    renderGrid(false);

    // 6교시까지 두 날 모두 빈 칸이 선다 (예전부터 이랬고 멀쩡했다)
    expect(screen.getAllByTitle('6교시')).toHaveLength(2);
    expect(screen.getAllByTitle('4교시')).toHaveLength(2);
  });
});
