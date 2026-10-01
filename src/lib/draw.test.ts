import { describe, expect, it } from 'vitest';
import { afterPick, drawStatus, pickNext, rollSequence, sanitizeDraw, type DrawState } from './draw';

const ACTIVE = [1, 2, 3, 4, 5];
const first = () => 0;
const last = () => 0.9999;

describe('sanitizeDraw', () => {
  it('없거나 이상하면 빈 첫 판', () => {
    expect(sanitizeDraw(undefined)).toEqual({ picked: [], round: 1 });
    expect(sanitizeDraw({ picked: 'x', round: -2 })).toEqual({ picked: [], round: 1 });
  });

  it('번호만, 겹치지 않게, 차례는 그대로', () => {
    expect(sanitizeDraw({ picked: [3, '1', 3, 0, 'a', 2.5, 7], round: 4 })).toEqual({ picked: [3, 1, 7], round: 4 });
  });
});

describe('drawStatus', () => {
  it('결석은 빼고, 전출(재학 아님)은 처음부터 없다', () => {
    const s = drawStatus(ACTIVE, [2], { picked: [1, 9], round: 1 });
    expect(s.pool).toEqual([1, 3, 4, 5]);
    expect(s.remaining).toEqual([3, 4, 5]);
    expect(s.absent).toEqual([2]);
    // 9번은 재학생이 아니라 세지 않는다
    expect(s.done).toBe(1);
    expect(s.total).toBe(5);
  });
});

describe('pickNext', () => {
  it('이번 판에 안 뽑힌 학생 중에서', () => {
    const state: DrawState = { picked: [1, 2], round: 1 };
    expect(pickNext(ACTIVE, [], state, first)).toEqual({ num: 3, newRound: false });
    expect(pickNext(ACTIVE, [], state, last)).toEqual({ num: 5, newRound: false });
  });

  it('오늘 결석한 학생은 뽑지 않는다', () => {
    const state: DrawState = { picked: [1, 2, 3], round: 1 };
    expect(pickNext(ACTIVE, [4], state, first)).toEqual({ num: 5, newRound: false });
  });

  it('나올 수 있는 학생을 다 뽑았으면 새 판 (남은 결석생이 있어도)', () => {
    const state: DrawState = { picked: [1, 2, 3, 5], round: 2 };
    const pick = pickNext(ACTIVE, [4], state, first);
    expect(pick).toEqual({ num: 1, newRound: true });
    expect(afterPick(state, pick!)).toEqual({ picked: [1], round: 3 });
  });

  it('나올 수 있는 학생이 없으면 null', () => {
    expect(pickNext([], [], { picked: [], round: 1 })).toBeNull();
    expect(pickNext([1, 2], [1, 2], { picked: [], round: 1 })).toBeNull();
  });

  it('한 판을 끝까지 뽑으면 모두 한 번씩', () => {
    let state: DrawState = { picked: [], round: 1 };
    const seen: number[] = [];
    for (let i = 0; i < ACTIVE.length; i++) {
      const pick = pickNext(ACTIVE, [], state)!;
      expect(pick.newRound).toBe(false);
      seen.push(pick.num);
      state = afterPick(state, pick);
    }
    expect([...seen].sort()).toEqual(ACTIVE);
    expect(state.picked).toEqual(seen);
    expect(pickNext(ACTIVE, [], state)!.newRound).toBe(true);
  });
});

describe('rollSequence', () => {
  it('마지막은 뽑힌 학생, 잇달아 같은 번호 없음', () => {
    const seq = rollSequence([1, 2, 3, 4], 3, 12);
    expect(seq).toHaveLength(12);
    expect(seq[seq.length - 1]).toBe(3);
    for (let i = 1; i < seq.length - 1; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    expect(seq.slice(0, -1)).not.toContain(3);
  });

  it('후보가 하나면 그것만', () => {
    expect(rollSequence([7], 7, 10)).toEqual([7]);
  });
});
