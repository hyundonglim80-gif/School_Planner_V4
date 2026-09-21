import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { calculateDDay, pickPrimaryDDay } from './useDDay';

// D-Day 기준은 오늘이다. 'D-100'은 오늘부터 100일이라는 뜻으로 통용되므로,
// 화면 위쪽 ⏳ 배지는 어느 화면에서 보든 같은 숫자여야 한다.
//
// 다만 하루 화면에서 다른 날을 펼쳐 놓았을 때는 그 날 기준도 궁금하다.
// 그때만 기준 날짜를 넘겨 센다. 두 값이 섞이지 않도록 여기에 고정한다.
describe('D-Day 세기', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T09:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('기준을 넘기지 않으면 오늘을 센다', () => {
    expect(calculateDDay('2026-10-21').text).toBe('D-30');
  });

  it('오늘이면 D-Day라고 적는다', () => {
    expect(calculateDDay('2026-09-21')).toEqual({ text: 'D-Day', daysDiff: 0 });
  });

  it('지난 날은 D+로 센다', () => {
    expect(calculateDDay('2026-09-11').text).toBe('D+10');
  });

  it('기준 날짜를 넘기면 그 날부터 센다', () => {
    // 하루 화면에서 10월 15일을 펼쳐 놓은 경우
    expect(calculateDDay('2026-10-21', '2026-10-15').text).toBe('D-6');
  });

  it('기준 날짜를 넘겨도 오늘 기준 값은 달라지지 않는다', () => {
    // 같은 목표를 두 기준으로 세어도 서로 영향을 주지 않아야 한다
    expect(calculateDDay('2026-10-21', '2026-10-15').text).toBe('D-6');
    expect(calculateDDay('2026-10-21').text).toBe('D-30');
  });

  it('기준 날짜가 목표보다 뒤면 D+로 센다', () => {
    expect(calculateDDay('2026-10-21', '2026-11-01').text).toBe('D+11');
  });

  it('시각과 무관하게 날짜만 센다', () => {
    // 늦은 밤에 봐도 같은 숫자여야 한다
    vi.setSystemTime(new Date('2026-09-21T23:59:00'));
    expect(calculateDDay('2026-10-21').text).toBe('D-30');
  });
});

describe('상단에 세울 D-Day 고르기', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T09:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const list = [
    { id: 'a', title: '수능', date: '2026-11-19' },
    { id: 'b', title: '체육대회', date: '2026-09-26' },
  ];

  it('고른 것을 세운다', () => {
    expect(pickPrimaryDDay(list, 'a')).toMatchObject({ title: '수능', text: 'D-59' });
  });

  it('해제하면 아무것도 세우지 않는다', () => {
    // 여기서 가장 가까운 '체육대회'를 대신 세우면, 팝업에서 별을 없애도
    // 상단이 그대로라 해제가 안 되는 것처럼 보인다
    expect(pickPrimaryDDay(list, null)).toBeNull();
  });

  it('고른 것을 지웠으면 아무것도 세우지 않는다', () => {
    expect(pickPrimaryDDay(list, '이미-지운-것')).toBeNull();
  });

  it('등록된 것이 없으면 아무것도 세우지 않는다', () => {
    expect(pickPrimaryDDay([], 'a')).toBeNull();
  });
});
