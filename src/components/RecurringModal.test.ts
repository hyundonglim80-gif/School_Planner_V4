import { describe, it, expect } from 'vitest';
import { computeRecurringDates } from './RecurringModal';

const base = { selectedMonthDays: [] as number[] };

describe('computeRecurringDates', () => {
  it('매주: 고른 요일마다', () => {
    // 2026-10-05(월) ~ 10-18(일), 화요일
    expect(computeRecurringDates({ ...base, startDate: '2026-10-05', endDate: '2026-10-18', recurType: 'weekly', selectedDays: [2] }))
      .toEqual(['2026-10-06', '2026-10-13']);
  });

  it('격주는 달력의 주로 센다 (V3와 같다) - 수요일에 시작해 월·금', () => {
    // 2026-10-07은 수요일. 그 주(10/4~10/10)의 금요일, 두 주 뒤(10/18~10/24)의 월·금.
    // 예전엔 시작일부터 7일씩 끊어서 10/9, 10/12, 10/23, 10/26이 나왔다.
    expect(computeRecurringDates({ ...base, startDate: '2026-10-07', endDate: '2026-10-31', recurType: 'biweekly', selectedDays: [1, 5] }))
      .toEqual(['2026-10-09', '2026-10-19', '2026-10-23']);
  });

  it('매월(특정 일)', () => {
    expect(computeRecurringDates({ startDate: '2026-10-01', endDate: '2026-12-31', recurType: 'monthday', selectedDays: [], selectedMonthDays: [15] }))
      .toEqual(['2026-10-15', '2026-11-15', '2026-12-15']);
  });

  it('매월(첫째 주 요일)', () => {
    expect(computeRecurringDates({ ...base, startDate: '2026-10-01', endDate: '2026-11-30', recurType: 'monthly', selectedDays: [1] }))
      .toEqual(['2026-10-05', '2026-11-02']);
  });

  it('종료일이 시작일보다 빠르면 없다', () => {
    expect(computeRecurringDates({ ...base, startDate: '2026-10-10', endDate: '2026-10-01', recurType: 'weekly', selectedDays: [1] })).toEqual([]);
  });
});
