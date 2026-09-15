import { describe, it, expect } from 'vitest';
import { pickYear } from './holidays';

// V3는 공휴일을 연도 구분 없이 users/{uid}/settings/holidays 의 map 하나에 모아둔다.
// V4는 한 해씩 다루므로 그 해 것만 골라내야 한다.
describe('pickYear - V3가 모아둔 map에서 그 해만 골라낸다', () => {
  const map = {
    '2025-12-25': '기독탄신일',
    '2026-01-01': '1월1일',
    '2026-03-01': '삼일절',
    '2027-01-01': '1월1일',
  };

  it('해당 연도의 날짜만 남긴다', () => {
    expect(pickYear(map, 2026)).toEqual({
      '2026-01-01': '1월1일',
      '2026-03-01': '삼일절',
    });
  });

  it('없는 해는 빈 값이다', () => {
    expect(pickYear(map, 2030)).toEqual({});
  });

  it('연도가 앞자리만 겹치는 것을 끌어오지 않는다', () => {
    expect(pickYear({ '20260-01-01': 'x' }, 2026)).toEqual({});
  });
});
