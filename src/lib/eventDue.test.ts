import { describe, expect, it } from 'vitest';
import { dueBadge, dueOf, isDueDate, newChainId } from './eventDue';

describe('dueOf', () => {
  it('일정 칸이 먼저, 없으면 사슬 기한', () => {
    const map = { chain_a: '2026-10-15' };
    expect(dueOf({ due: '2026-10-09', forwardChainId: 'chain_a' }, map)).toBe('2026-10-09');
    expect(dueOf({ forwardChainId: 'chain_a' }, map)).toBe('2026-10-15');
    expect(dueOf({ forwardChainId: 'chain_b' }, map)).toBe('');
    expect(dueOf(null, map)).toBe('');
  });
  it("''로 비운 일정은 사슬 기한으로 되살리지 않는다, 이상한 값은 버린다", () => {
    expect(dueOf({ due: '', forwardChainId: 'chain_a' }, { chain_a: '2026-10-15' })).toBe('');
    expect(dueOf({ due: '10/15' } as any, {})).toBe('');
    expect(dueOf({ forwardChainId: 'c' }, { c: 'x' })).toBe('');
  });
});

describe('dueBadge', () => {
  const today = '2026-10-02';
  it('D-n · D-day · 지남, 3일 안은 soon', () => {
    expect(dueBadge('2026-10-09', today)).toEqual({ text: 'D-7', tone: 'later', days: 7 });
    expect(dueBadge('2026-10-05', today)).toEqual({ text: 'D-3', tone: 'soon', days: 3 });
    expect(dueBadge('2026-10-02', today)).toEqual({ text: 'D-day', tone: 'today', days: 0 });
    expect(dueBadge('2026-09-30', today)).toEqual({ text: '기한 2일 지남', tone: 'over', days: -2 });
  });
  it('끝낸 일정·기한 없음은 없다, 달·해 넘김도', () => {
    expect(dueBadge('2026-10-09', today, true)).toBeNull();
    expect(dueBadge('', today)).toBeNull();
    expect(dueBadge('2027-01-01', '2026-12-31')?.text).toBe('D-1');
  });
});

describe('newChainId · isDueDate', () => {
  it('V3와 같은 사슬 id 모양, 날짜 모양만 기한', () => {
    expect(newChainId()).toMatch(/^chain_[a-z0-9]+_[a-z0-9]+$/);
    expect(isDueDate('2026-10-02')).toBe(true);
    expect(isDueDate('2026-1-2')).toBe(false);
    expect(isDueDate(undefined)).toBe(false);
  });
});
