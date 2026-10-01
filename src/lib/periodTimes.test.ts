import { describe, it, expect } from 'vitest';
import { fillPeriodTimes, fromMinutes, periodRangeLabel, periodStateAt, toMinutes, validPeriods } from './periodTimes';

// 교시 시각과 '지금 몇 교시' (docs/ROADMAP.md 2-2)

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 9, 1, h, m);
};

const elementary = {
  '1': { start: '09:00', end: '09:40' },
  '2': { start: '09:50', end: '10:30' },
  '3': { start: '10:40', end: '11:20' },
  '4': { start: '11:30', end: '12:10' },
  '5': { start: '13:00', end: '13:40' },
};

describe('시각 읽기', () => {
  it('여러 모양을 분으로 바꾼다', () => {
    expect(toMinutes('09:05')).toBe(545);
    expect(toMinutes('9:05')).toBe(545);
    expect(toMinutes('0905')).toBe(545);
    expect(toMinutes('905')).toBe(545);
    expect(toMinutes('13:40')).toBe(820);
  });

  it('알아볼 수 없으면 null', () => {
    expect(toMinutes('')).toBeNull();
    expect(toMinutes('25:00')).toBeNull();
    expect(toMinutes('09:75')).toBeNull();
    expect(toMinutes('아홉시')).toBeNull();
  });

  it('분을 HH:MM으로', () => {
    expect(fromMinutes(545)).toBe('09:05');
    expect(fromMinutes(0)).toBe('00:00');
  });

  it('끝이 시작보다 이르거나 비어 있는 교시는 빼고, 시작 순으로', () => {
    const list = validPeriods({ '2': { start: '10:00', end: '10:40' }, '1': { start: '09:00', end: '09:40' }, '3': { start: '11:00', end: '10:00' }, '4': { start: '', end: '' } });
    expect(list.map((p) => p.period)).toEqual([1, 2]);
  });

  it('화면에 적는 범위', () => {
    expect(periodRangeLabel(elementary, 1)).toBe('09:00~09:40');
    expect(periodRangeLabel(elementary, 6)).toBe('');
    expect(periodRangeLabel({ '1': { start: '9:00', end: '' } }, 1)).toBe('09:00');
  });
});

describe('지금 몇 교시', () => {
  it('첫 교시 전에는 몇 분 남았는지', () => {
    expect(periodStateAt(elementary, at('08:35'))).toEqual({ kind: 'before', next: 1, minutes: 25 });
  });

  it('교시 중에는 그 교시와 남은 분', () => {
    expect(periodStateAt(elementary, at('09:00'))).toEqual({ kind: 'during', period: 1, minutesLeft: 40 });
    expect(periodStateAt(elementary, at('10:29'))).toEqual({ kind: 'during', period: 2, minutesLeft: 1 });
  });

  it('쉬는 시간·점심에는 다음 교시', () => {
    expect(periodStateAt(elementary, at('09:40'))).toEqual({ kind: 'break', next: 2, minutes: 10 });
    expect(periodStateAt(elementary, at('12:30'))).toEqual({ kind: 'break', next: 5, minutes: 30 });
  });

  it('마지막 교시가 끝나면 after', () => {
    expect(periodStateAt(elementary, at('13:40'))).toEqual({ kind: 'after' });
  });

  it('시각을 하나도 적지 않았으면 null (화면에 아무것도 안 보인다)', () => {
    expect(periodStateAt({}, at('10:00'))).toBeNull();
    expect(periodStateAt(undefined, at('10:00'))).toBeNull();
  });

  it('교시 수보다 뒤의 시각은 보지 않는다 (교시를 줄인 뒤 남은 7교시 시각 등)', () => {
    const times = { ...elementary, '6': { start: '13:50', end: '14:30' } };
    expect(periodStateAt(times, at('14:00'), 5)).toEqual({ kind: 'after' });
    expect(periodStateAt(times, at('14:00'), 6)).toEqual({ kind: 'during', period: 6, minutesLeft: 30 });
  });
});

describe('한 번에 채우기', () => {
  it('1교시 시작·수업·쉬는 시간·점심으로 모든 교시를 채운다', () => {
    const t = fillPeriodTimes({ count: 6, firstStart: '09:00', classMinutes: 40, breakMinutes: 10, lunchAfter: 4, lunchMinutes: 50 });
    expect(t).toEqual({
      '1': { start: '09:00', end: '09:40' },
      '2': { start: '09:50', end: '10:30' },
      '3': { start: '10:40', end: '11:20' },
      '4': { start: '11:30', end: '12:10' },
      '5': { start: '13:00', end: '13:40' },
      '6': { start: '13:50', end: '14:30' },
    });
  });

  it('1교시 시작을 알아볼 수 없으면 null', () => {
    expect(fillPeriodTimes({ count: 6, firstStart: '', classMinutes: 45, breakMinutes: 10, lunchAfter: 4, lunchMinutes: 50 })).toBeNull();
  });
});
