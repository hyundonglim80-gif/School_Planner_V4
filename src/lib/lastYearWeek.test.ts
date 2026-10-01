import { describe, it, expect } from 'vitest';
import {
  schoolStartDate,
  mondayOf,
  schoolWeekOf,
  weeksInSchoolYear,
  lastYearDateOf,
  lastYearWeekOf,
} from './lastYearWeek';
import { getWeekDays, parseDateStr, addDays } from './dateUtils';

describe('작년 이맘때 - 학년도 같은 주 (ROADMAP 7)', () => {
  it('개학일은 3월 2일, 주말이면 다음 월요일', () => {
    expect(schoolStartDate(2024)).toBe('2024-03-04'); // 토
    expect(schoolStartDate(2025)).toBe('2025-03-03'); // 일
    expect(schoolStartDate(2026)).toBe('2026-03-02'); // 월
    expect(schoolStartDate(2027)).toBe('2027-03-02'); // 화
  });

  it('주는 월요일에 시작한다 (일요일은 앞 주)', () => {
    expect(mondayOf('2026-03-04')).toBe('2026-03-02');
    expect(mondayOf('2026-03-08')).toBe('2026-03-02');
    expect(mondayOf('2026-03-09')).toBe('2026-03-09');
  });

  it('개학 주가 1주, 개학 주 앞(2월 말)은 지난 학년도의 끝 주', () => {
    expect(schoolWeekOf('2026-03-02')).toEqual({ schoolYear: 2026, week: 1 });
    expect(schoolWeekOf('2026-03-08')).toEqual({ schoolYear: 2026, week: 1 });
    expect(schoolWeekOf('2026-03-09')).toEqual({ schoolYear: 2026, week: 2 });
    // 2026-03-01(일)은 2.23 주 - 2025학년도 52주
    expect(schoolWeekOf('2026-03-01')).toEqual({ schoolYear: 2025, week: 52 });
    // 해를 넘겨도 같은 학년도
    expect(schoolWeekOf('2027-01-05').schoolYear).toBe(2026);
    // 개학이 금요일이면 그 주 월요일(2월)부터 1주
    expect(schoolWeekOf('2029-02-26')).toEqual({ schoolYear: 2029, week: 1 });
  });

  it('작년 같은 주 같은 요일', () => {
    expect(lastYearDateOf('2026-03-02')).toBe('2025-03-03');
    expect(lastYearDateOf('2026-03-06')).toBe('2025-03-07');
    expect(lastYearDateOf('2026-10-01')).toBe('2025-10-02'); // 목 → 목
    expect(lastYearDateOf('2027-01-05')).toBe('2026-01-06'); // 해 넘김
    expect(lastYearDateOf('2027-03-02')).toBe('2026-03-03'); // 화 개학 → 작년 개학 주 화
  });

  it('364일 빼기로는 어긋나는 해도 개학 주끼리 맞춘다', () => {
    // 2030 개학(3.4 월) → 364일 전은 2029-03-05(2주)지만 2029 개학 주는 2.26 주
    expect(lastYearDateOf('2030-03-04')).toBe('2029-02-26');
    expect(addDays('2030-03-04', -364)).toBe('2029-03-05');
  });

  it('작년이 한 주 짧으면 작년 마지막 주로', () => {
    expect(weeksInSchoolYear(2029)).toBe(53);
    expect(weeksInSchoolYear(2028)).toBe(52);
    expect(schoolWeekOf('2030-02-25')).toEqual({ schoolYear: 2029, week: 53 });
    expect(lastYearDateOf('2030-02-25')).toBe('2029-02-19');
  });

  it('요일은 늘 같다 (몇 해를 훑어도)', () => {
    let d = '2024-01-01';
    while (d < '2032-01-01') {
      const last = lastYearDateOf(d);
      expect(parseDateStr(last).getDay()).toBe(parseDateStr(d).getDay());
      const gap = (parseDateStr(d).getTime() - parseDateStr(last).getTime()) / 86400000;
      expect(gap).toBeGreaterThanOrEqual(357);
      expect(gap).toBeLessThanOrEqual(378);
      d = addDays(d, 1);
    }
  });

  it('주간 화면의 한 주를 넣으면 작년 날짜와 제목', () => {
    const days = getWeekDays(parseDateStr('2026-03-04')).map((d) => d.dateStr);
    const w = lastYearWeekOf(days)!;
    expect(w.schoolYear).toBe(2025);
    expect(w.week).toBe(1);
    expect(w.dateMap['2026-03-02']).toBe('2025-03-03');
    expect(w.dateMap['2026-03-08']).toBe('2025-03-09');
    expect(w.lastDates).toHaveLength(7);
    expect(w.label).toBe('2025학년도 1주 · 2025.3.3 (월) ~ 3.9 (일)');
  });

  it('작년 주가 해를 넘기면 끝 날짜에도 연도를 붙인다', () => {
    const days = getWeekDays(parseDateStr('2027-12-29')).map((d) => d.dateStr);
    const w = lastYearWeekOf(days)!;
    expect(w.label).toMatch(/^2026학년도 \d+주 · 2026\.12\.\d+ \(월\) ~ 2027\.1\.\d+ \(일\)$/);
  });

  it('날짜가 없으면 null', () => {
    expect(lastYearWeekOf([])).toBeNull();
  });
});
