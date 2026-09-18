import { describe, it, expect } from 'vitest';
import {
  weightOf,
  isMastered,
  buildDeck,
  applyAnswer,
  undoAnswer,
  recordOf,
  quizKey,
  MASTERED_STREAK,
  type QuizRecords,
} from './photoQuiz';

describe('weightOf', () => {
  it('아직 안 본 학생을 맞힌 적 있는 학생보다 앞세운다', () => {
    const unseen = weightOf({ o: 0, x: 0, streak: 0 });
    const known = weightOf({ o: 1, x: 0, streak: 1 });
    expect(unseen).toBeGreaterThan(known);
  });

  it('틀릴수록 무게가 올라간다', () => {
    const once = weightOf({ o: 0, x: 1, streak: 0 });
    const thrice = weightOf({ o: 0, x: 3, streak: 0 });
    expect(thrice).toBeGreaterThan(once);
    expect(once).toBeGreaterThan(weightOf({ o: 2, x: 0, streak: 2 }));
  });

  it('잇따라 맞히면 무게가 내려간다', () => {
    expect(weightOf({ o: 2, x: 0, streak: 2 })).toBeLessThan(weightOf({ o: 1, x: 0, streak: 1 }));
  });
});

describe('isMastered', () => {
  it(`연속 ${MASTERED_STREAK}번 맞히면 외운 것으로 본다`, () => {
    expect(isMastered({ o: 1, x: 0, streak: 1 })).toBe(false);
    expect(isMastered({ o: 2, x: 0, streak: 2 })).toBe(true);
  });
});

describe('applyAnswer / undoAnswer', () => {
  it('맞히면 o와 streak이 오른다', () => {
    expect(applyAnswer({ o: 1, x: 2, streak: 1 }, true, 100)).toEqual({
      o: 2, x: 2, streak: 2, seenAt: 100,
    });
  });

  it('틀리면 x가 오르고 streak은 0으로 돌아간다', () => {
    expect(applyAnswer({ o: 3, x: 0, streak: 3 }, false, 100)).toEqual({
      o: 3, x: 1, streak: 0, seenAt: 100,
    });
  });

  it('되돌리면 방금 더한 것이 빠지고 streak이 되살아난다', () => {
    const before = { o: 3, x: 0, streak: 3 };
    const after = applyAnswer(before, false, 100);
    expect(undoAnswer(after, false, before.streak)).toMatchObject({ o: 3, x: 0, streak: 3 });
  });

  it('되돌리기를 거듭해도 음수로 내려가지 않는다', () => {
    expect(undoAnswer({ o: 0, x: 0, streak: 0 }, true, 0).o).toBe(0);
    expect(undoAnswer({ o: 0, x: 0, streak: 0 }, false, 0).x).toBe(0);
  });
});

describe('recordOf', () => {
  it('없는 기록은 빈 기록으로 읽는다', () => {
    expect(recordOf({}, '없음')).toEqual({ o: 0, x: 0, streak: 0, seenAt: undefined });
  });

  it('숫자가 아닌 값이 들어 있어도 0으로 읽는다', () => {
    const dirty = { a: { o: null, x: 'x', streak: undefined } } as unknown as QuizRecords;
    expect(recordOf(dirty, 'a')).toMatchObject({ o: 0, x: 0, streak: 0 });
  });
});

describe('buildDeck', () => {
  const people = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  // 난수를 고정하면 무게만으로 차례가 정해진다
  const fixed = () => 1;

  it('많이 틀린 학생이 앞에 온다', () => {
    const records: QuizRecords = {
      a: { o: 5, x: 0, streak: 1 },
      b: { o: 0, x: 3, streak: 0 },
      c: { o: 2, x: 1, streak: 1 },
    };
    expect(buildDeck(people, records, { random: fixed }).map((p) => p.key)).toEqual(['b', 'c', 'a']);
  });

  it('외운 학생은 이번 판에서 뺀다', () => {
    const records: QuizRecords = {
      a: { o: 2, x: 0, streak: 2 },
      b: { o: 0, x: 1, streak: 0 },
      c: { o: 0, x: 0, streak: 0 },
    };
    expect(buildDeck(people, records, { random: fixed }).map((p) => p.key)).toEqual(['b', 'c']);
  });

  it('모두 외웠으면 비우지 않고 다 같이 한 바퀴 더 돈다', () => {
    const records: QuizRecords = {
      a: { o: 2, x: 0, streak: 2 },
      b: { o: 3, x: 0, streak: 3 },
      c: { o: 2, x: 0, streak: 2 },
    };
    expect(buildDeck(people, records, { random: fixed })).toHaveLength(3);
  });

  it('가중치를 끄면 외운 학생도 남고 무게가 차례를 정하지 않는다', () => {
    const records: QuizRecords = {
      a: { o: 0, x: 9, streak: 0 },
      b: { o: 0, x: 0, streak: 0 },
      c: { o: 2, x: 0, streak: 2 },
    };
    const deck = buildDeck(people, records, {
      weighted: false,
      dropMastered: false,
      random: fixed,
    });
    expect(deck).toHaveLength(3);
    // 무게가 모두 1이므로 아홉 번 틀린 a가 반드시 앞설 이유가 없다
    expect(deck.map((p) => p.key).sort()).toEqual(['a', 'b', 'c']);
  });

  it('아무도 없으면 빈 판', () => {
    expect(buildDeck([], {}, { random: fixed })).toEqual([]);
  });
});

describe('quizKey', () => {
  it('번호가 아니라 이름으로 기록을 잇는다', () => {
    const cls = { year: 2026, grade: '3', classNum: '2' };
    expect(quizKey(cls, '배유나')).toBe('2026-3-2-배유나');
    // 번호가 밀려도 열쇠가 같으므로 성적이 이어진다
    expect(quizKey(cls, '배 유나')).toBe('2026-3-2-배유나');
  });
});
