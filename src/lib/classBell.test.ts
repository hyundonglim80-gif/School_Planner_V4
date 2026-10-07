import { describe, it, expect } from 'vitest';
import { bellDay, bellMessage, bellTimes, bellsDue, DEFAULT_BELL, offsetSeconds, sanitizeBell } from './classBell';

const times = { '1': { start: '09:00', end: '09:40' }, '2': { start: '09:50', end: '10:30' } };
const on = { ...DEFAULT_BELL, enabled: true };

describe('classBell', () => {
  it('꺼져 있으면 없다', () => {
    expect(bellTimes(times, DEFAULT_BELL)).toEqual([]);
  });
  it('시작·끝 종, 시각 차례', () => {
    expect(bellTimes(times, on).map((b) => `${b.period}${b.kind}@${b.at}`)).toEqual([
      `1start@${9 * 3600}`,
      `1end@${9 * 3600 + 40 * 60}`,
      `2start@${9 * 3600 + 50 * 60}`,
      `2end@${10 * 3600 + 30 * 60}`,
    ]);
  });
  it('분·초 전/후', () => {
    const cfg = { ...on, start: { on: true, amount: 1, unit: 'min' as const, when: 'before' as const }, end: { on: true, amount: 30, unit: 'sec' as const, when: 'after' as const } };
    expect(offsetSeconds(cfg.start)).toBe(-60);
    expect(offsetSeconds(cfg.end)).toBe(30);
    const list = bellTimes(times, cfg);
    expect(list[0].at).toBe(9 * 3600 - 60);
    expect(list[1].at).toBe(9 * 3600 + 40 * 60 + 30);
    expect(bellMessage(list[0], cfg)).toBe('1교시 시작 (1분 전)');
    expect(bellMessage(list[1], cfg, '1교시')).toBe('1교시 끝 (30초 후)');
  });
  it('끝 종만', () => {
    expect(bellTimes(times, { ...on, start: { ...on.start, on: false } }).every((b) => b.kind === 'end')).toBe(true);
  });
  it('지난번과 지금 사이의 종만, 1분 넘게 지난 것은 울리지 않는다', () => {
    const list = bellTimes(times, on);
    expect(bellsDue(list, 9 * 3600 - 1, 9 * 3600).map((b) => b.period)).toEqual([1]);
    expect(bellsDue(list, 9 * 3600, 9 * 3600 + 1)).toEqual([]);
    expect(bellsDue(list, 8 * 3600, 9 * 3600 + 120)).toEqual([]);
  });
  it('주말에는 울리지 않는다 (끌 수 있다)', () => {
    expect(bellDay(on, new Date(2026, 9, 10))).toBe(false); // 토
    expect(bellDay(on, new Date(2026, 9, 12))).toBe(true); // 월
    expect(bellDay({ ...on, weekdaysOnly: false }, new Date(2026, 9, 10))).toBe(true);
  });
  it('저장된 값 고쳐 읽기', () => {
    expect(sanitizeBell({ enabled: 1, start: { amount: '5', unit: 'sec', when: 'after' }, end: null })).toEqual({
      enabled: true,
      start: { on: true, amount: 5, unit: 'sec', when: 'after' },
      end: DEFAULT_BELL.end,
      weekdaysOnly: true,
    });
  });
});
