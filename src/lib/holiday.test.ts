import { describe, it, expect } from 'vitest';
import { dayToneOf, DAY_CELL_BG, DAY_NUMBER_COLOR, isHolidayEvent, splitHolidayEvents } from './holiday';

describe('dayToneOf - 주말/공휴일 색 규칙', () => {
  it('토요일은 파랑', () => {
    expect(dayToneOf({ isSaturday: true })).toBe('saturday');
  });

  it('일요일은 빨강', () => {
    expect(dayToneOf({ isSunday: true })).toBe('holiday');
  });

  it('공휴일은 요일과 무관하게 빨강', () => {
    expect(dayToneOf({ holidayName: '어린이날' })).toBe('holiday');
    // 토요일이 공휴일이면 공휴일(빨강)이 이긴다
    expect(dayToneOf({ isSaturday: true, holidayName: '광복절' })).toBe('holiday');
  });

  it('평일은 보통', () => {
    expect(dayToneOf({})).toBe('normal');
    expect(dayToneOf({ holidayName: null })).toBe('normal');
  });

  it('날짜 글자색과 칸 배경색이 짝을 이룬다', () => {
    expect(DAY_NUMBER_COLOR.saturday).toContain('blue');
    expect(DAY_CELL_BG.saturday).toContain('blue');
    expect(DAY_NUMBER_COLOR.holiday).toContain('red');
    expect(DAY_CELL_BG.holiday).toContain('red');
    expect(DAY_CELL_BG.normal).toBe('bg-white');
  });
});

describe('공휴일 일정 가려내기', () => {
  it("'공휴일'과 '휴일' 라벨을 모두 알아본다", () => {
    expect(isHolidayEvent({ label: '공휴일' })).toBe(true);
    expect(isHolidayEvent({ label: '휴일' })).toBe(true);
    expect(isHolidayEvent({ labelIds: ['공휴일'] })).toBe(true);
    expect(isHolidayEvent({ label: '회의' })).toBe(false);
    expect(isHolidayEvent(null)).toBe(false);
  });

  it('공휴일 일정은 목록에서 빼고 이름만 돌려준다', () => {
    const { events, holidayName } = splitHolidayEvents([
      { id: '1', label: '공휴일', content: '어린이날' },
      { id: '2', label: '회의', content: '학년 협의회' },
    ]);
    expect(holidayName).toBe('어린이날');
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('2');
  });
});
