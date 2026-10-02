import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './useAppStore';
import { addMonthsClamped, formatDateStr } from '../lib/dateUtils';

// ◀ ▶ 날짜 이동. 월간에서 31일에 ▶를 누르면 2월을 건너뛰어 3월로 갔다(Date.setMonth: 1/31 + 1달 = 3/3).
const st = () => useAppStore.getState();
const shown = () => formatDateStr(new Date(st().currentDate));
const at = (scope: 'day' | 'week' | 'month' | 'year', dateStr: string) =>
  useAppStore.setState({ scope, currentDate: new Date(`${dateStr}T09:00:00`).toISOString(), showWeekend: true });

beforeEach(() => at('day', '2026-10-02'));

describe('addMonthsClamped', () => {
  it('옮긴 달에 그 날이 없으면 그 달의 마지막 날', () => {
    const d = (s: string) => new Date(`${s}T09:00:00`);
    expect(formatDateStr(addMonthsClamped(d('2027-01-31'), 1))).toBe('2027-02-28');
    expect(formatDateStr(addMonthsClamped(d('2028-01-31'), 1))).toBe('2028-02-29');
    expect(formatDateStr(addMonthsClamped(d('2026-03-31'), -1))).toBe('2026-02-28');
    expect(formatDateStr(addMonthsClamped(d('2026-10-31'), 1))).toBe('2026-11-30');
    expect(formatDateStr(addMonthsClamped(d('2026-12-15'), 1))).toBe('2027-01-15');
    expect(formatDateStr(addMonthsClamped(d('2028-02-29'), 12))).toBe('2029-02-28');
  });
});

describe('◀ ▶ 날짜 이동', () => {
  it('월간: 31일에 ▶ 를 눌러도 다음 달로 (달을 건너뛰지 않는다)', () => {
    at('month', '2027-01-31');
    st().navigateNextDate();
    expect(shown()).toBe('2027-02-28');
    st().navigateNextDate();
    expect(shown().slice(0, 7)).toBe('2027-03');

    at('month', '2026-10-31');
    st().navigateNextDate();
    expect(shown().slice(0, 7)).toBe('2026-11');
    st().navigatePrevDate();
    expect(shown().slice(0, 7)).toBe('2026-10');

    at('month', '2026-03-31');
    st().navigatePrevDate();
    expect(shown().slice(0, 7)).toBe('2026-02');
  });

  it('년간: 2월 29일에서 한 해 옮겨도 한 학년도씩', () => {
    at('year', '2028-02-29'); // 2027학년도
    st().navigateNextDate();
    expect(shown()).toBe('2029-02-28'); // 2028학년도 (3월 1일이 되면 2029학년도로 건너뛴다)
    st().navigatePrevDate();
    expect(shown()).toBe('2028-02-28');
  });

  it('하루: 주말을 감추면 토·일을 건너뛴다', () => {
    at('day', '2026-10-02'); // 금
    useAppStore.setState({ showWeekend: false });
    st().navigateNextDate();
    expect(shown()).toBe('2026-10-05'); // 월
    st().navigatePrevDate();
    expect(shown()).toBe('2026-10-02');
  });

  it('주간은 한 주씩', () => {
    at('week', '2026-10-02');
    st().navigateNextDate();
    expect(shown()).toBe('2026-10-09');
  });
});
