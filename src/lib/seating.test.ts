import { describe, it, expect } from 'vitest';
import {
  aisleAfter,
  clearSeat,
  currentPairs,
  deskPairSeats,
  displayOrder,
  initialChart,
  isNear,
  layoutCost,
  nearApartSeats,
  numberOrderSeats,
  pairKey,
  placeStudent,
  pushHistory,
  resizeChart,
  sanitizeChart,
  shuffleSeats,
  shuffleSummary,
  swapSeats,
  unseatedNums,
  usableSeats,
  type SeatingChart,
  type SeatStudent,
} from './seating';

/** 늘 같은 차례를 내는 난수 (시험이 매번 같게) */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const kids = (n: number, gender?: (i: number) => string): SeatStudent[] =>
  Array.from({ length: n }, (_, i) => ({ num: i + 1, name: `학생${i + 1}`, gender: gender?.(i) }));

const chartOf = (over: Partial<SeatingChart> = {}): SeatingChart => ({
  id: 'st1',
  ...initialChart('2026_3_2', kids(12), '1학기'),
  ...over,
});

const opts = { apart: [], avoidPast: false, mixGender: false };

describe('자리표 - 자리와 짝 (ROADMAP 8)', () => {
  it('새 자리표는 여섯 열·두 칸씩 짝, 번호 차례로 앞줄부터', () => {
    const c = initialChart('2026_3_2', kids(14), '1학기');
    expect(c).toMatchObject({ rows: 3, cols: 6, groupCols: 2, front: 'top' });
    expect(c.seats['0-0']).toBe(1);
    expect(c.seats['0-5']).toBe(6);
    expect(c.seats['2-1']).toBe(14);
    expect(Object.keys(c.seats)).toHaveLength(14);
    expect(initialChart('k', [], '빈 반').rows).toBe(5);
  });

  it('짝은 같은 줄·바로 옆·같은 분단, 책상 없는 칸은 빠진다', () => {
    const shape = { rows: 1, cols: 6, groupCols: 2, off: [] as string[] };
    expect(deskPairSeats(shape)).toEqual([['0-0', '0-1'], ['0-2', '0-3'], ['0-4', '0-5']]);
    expect(deskPairSeats({ ...shape, groupCols: 0 })).toHaveLength(5);
    expect(deskPairSeats({ ...shape, groupCols: 1 })).toEqual([]);
    expect(deskPairSeats({ ...shape, groupCols: 3 })).toEqual([['0-0', '0-1'], ['0-1', '0-2'], ['0-3', '0-4'], ['0-4', '0-5']]);
    expect(deskPairSeats({ ...shape, off: ['0-3'] })).toEqual([['0-0', '0-1'], ['0-4', '0-5']]);
  });

  it('통로는 분단 사이에만', () => {
    expect([0, 1, 2, 3, 4, 5].filter((c) => aisleAfter(c, 6, 2))).toEqual([1, 3]);
    expect([0, 1, 2, 3, 4, 5].filter((c) => aisleAfter(c, 6, 0))).toEqual([]);
    expect([0, 1, 2, 3, 4, 5].filter((c) => aisleAfter(c, 6, 3))).toEqual([2]);
  });

  it('지금 짝인 학생 쌍은 작은 번호가 앞', () => {
    const c = chartOf({ seats: { '0-0': 7, '0-1': 3, '0-2': 5 } });
    expect(currentPairs(c)).toEqual(['3-7']);
    expect(pairKey(9, 2)).toBe('2-9');
  });

  it('붙은 자리는 앞뒤옆·대각선 (같은 칸은 아니다)', () => {
    expect(isNear('1-1', '0-0')).toBe(true);
    expect(isNear('1-1', '1-2')).toBe(true);
    expect(isNear('1-1', '1-3')).toBe(false);
    expect(isNear('1-1', '1-1')).toBe(false);
  });

  it('떨어뜨릴 학생이 붙어 앉은 칸', () => {
    const seats = { '0-0': 1, '1-1': 2, '0-3': 3, '0-5': 4 };
    expect([...nearApartSeats(seats, ['1-2', '3-4', '1-9', 'bad'])].sort()).toEqual(['0-0', '1-1']);
  });

  it('앉을 수 있는 칸은 앞줄 왼쪽부터, 책상 없는 칸은 뺀다', () => {
    expect(usableSeats({ rows: 2, cols: 2, off: ['0-1'] })).toEqual(['0-0', '1-0', '1-1']);
  });

  it('교탁을 아래로 두면 180도 돌려 그린다', () => {
    expect(displayOrder({ rows: 2, cols: 3, front: 'top' })).toEqual({ rows: [0, 1], cols: [0, 1, 2] });
    expect(displayOrder({ rows: 2, cols: 3, front: 'bottom' })).toEqual({ rows: [1, 0], cols: [2, 1, 0] });
  });
});

describe('자리표 - 손으로 고치기', () => {
  it('맞바꾸기: 한쪽이 비었으면 옮긴다', () => {
    expect(swapSeats({ a: 1, b: 2 }, 'a', 'b')).toEqual({ a: 2, b: 1 });
    expect(swapSeats({ a: 1 }, 'a', 'b')).toEqual({ b: 1 });
    expect(swapSeats({ a: 1 }, 'a', 'a')).toEqual({ a: 1 });
  });

  it('학생 놓기: 앉아 있던 학생은 맞바꾸고, 자리 없던 학생이 오면 있던 학생은 자리 없음', () => {
    expect(placeStudent({ a: 1, b: 2 }, 'b', 1)).toEqual({ a: 2, b: 1 });
    expect(placeStudent({ a: 1, b: 2 }, 'b', 9)).toEqual({ a: 1, b: 9 });
    expect(clearSeat({ a: 1, b: 2 }, 'a')).toEqual({ b: 2 });
  });

  it('자리 없는 학생: 표 밖·책상 없는 칸에 남은 번호도 자리가 없다', () => {
    const c = chartOf({ rows: 1, cols: 3, seats: { '0-0': 1, '0-1': 2, '0-2': 3, '1-0': 4 }, off: ['0-2'] });
    expect(unseatedNums(c, kids(5))).toEqual([3, 4, 5]);
  });

  it('줄·열을 줄이면 밖으로 나간 칸이 지워진다 (1~10으로 묶는다)', () => {
    const c = chartOf({ locked: ['0-5', '1-0'], off: ['2-0'] });
    const r = resizeChart(c, 1, 4);
    expect(r).toMatchObject({ rows: 1, cols: 4, off: [], locked: [] });
    expect(Object.values(r.seats).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(resizeChart(c, 0, 99)).toMatchObject({ rows: 1, cols: 10 });
  });
});

describe('자리표 - 섞기', () => {
  it('모든 재학생을 한 번씩, 앞줄부터 앉힌다', () => {
    const c = chartOf({ rows: 4 }); // 24칸에 12명
    const r = shuffleSeats(c, kids(12), opts, seeded(1));
    const nums = Object.values(r.seats).sort((a, b) => a - b);
    expect(nums).toEqual(kids(12).map((k) => k.num));
    expect(Object.keys(r.seats).every((k) => k.startsWith('0-') || k.startsWith('1-'))).toBe(true);
    expect(r.unseated).toEqual([]);
  });

  it('고정 칸은 그대로, 고정한 빈 칸은 빈 채로, 명단에 없는 학생의 고정 칸은 섞는다', () => {
    const c = chartOf({ rows: 3, seats: { ...chartOf().seats, '0-0': 1, '0-1': 99 }, locked: ['0-0', '0-1', '1-5'] });
    delete c.seats['1-5'];
    const r = shuffleSeats(c, kids(12), opts, seeded(2));
    expect(r.seats['0-0']).toBe(1);
    expect(r.seats['1-5']).toBeUndefined();
    expect(Object.values(r.seats)).not.toContain(99);
    expect(Object.values(r.seats).sort((a, b) => a - b)).toEqual(kids(12).map((k) => k.num));
  });

  it('떨어뜨릴 학생은 붙여 앉히지 않는다', () => {
    const c = chartOf();
    const apart = [pairKey(1, 2), pairKey(3, 4), pairKey(1, 5)];
    for (let seed = 1; seed <= 20; seed++) {
      const r = shuffleSeats(c, kids(12), { ...opts, apart }, seeded(seed));
      expect(r.cost.apart).toBe(0);
    }
  });

  it('지난 짝 피하기: 지난 기록의 짝과 다시 짝이 되지 않는다', () => {
    const c = chartOf();
    const history = [{ at: 1, pairs: currentPairs(c) }];
    for (let seed = 1; seed <= 10; seed++) {
      const r = shuffleSeats({ ...c, history }, kids(12), { ...opts, avoidPast: true }, seeded(seed));
      const pairs = currentPairs({ ...c, seats: r.seats });
      expect(pairs.some((p) => history[0].pairs.includes(p))).toBe(false);
      expect(r.cost.repeat).toBe(0);
    }
  });

  it('남녀 짝: 남녀 수가 같으면 모든 짝이 남녀', () => {
    const students = kids(12, (i) => (i % 2 ? 'F' : 'M'));
    const r = shuffleSeats(chartOf(), students, { ...opts, mixGender: true }, seeded(3));
    expect(r.cost.sameGender).toBe(0);
    expect(layoutCost({ ...chartOf(), seats: r.seats }, students, { ...opts, mixGender: true }).sameGender).toBe(0);
  });

  it('남녀 수가 다르면 덜 어긴 것을 돌려주고 남은 수를 센다', () => {
    const students = kids(12, (i) => (i < 9 ? 'M' : 'F')); // 남 9, 여 3 → 6쌍 중 최소 3쌍은 같은 성별
    const r = shuffleSeats(chartOf(), students, { ...opts, mixGender: true }, seeded(4));
    expect(r.cost.sameGender).toBe(3);
    expect(shuffleSummary(r.cost, 0, { ...opts, mixGender: true })).toContain('같은 성별 짝 3쌍');
  });

  it('번호 차례로: 고정 칸은 그대로, 나머지는 번호 차례로 앞줄부터', () => {
    const c = chartOf({ seats: { '0-0': 7, '1-0': 3 }, locked: ['0-0'], off: ['0-1'] });
    const r = numberOrderSeats(c, kids(8));
    expect(r.seats).toEqual({ '0-0': 7, '0-2': 1, '0-3': 2, '0-4': 3, '0-5': 4, '1-0': 5, '1-1': 6, '1-2': 8 });
    expect(r.unseated).toEqual([]);
  });

  it('자리가 모자라면 남는 학생은 자리 없음', () => {
    const c = chartOf({ rows: 1 }); // 6칸에 12명
    const r = shuffleSeats(c, kids(12), opts, seeded(5));
    expect(Object.keys(r.seats)).toHaveLength(6);
    expect(r.unseated).toHaveLength(6);
    expect(new Set([...Object.values(r.seats), ...r.unseated]).size).toBe(12);
  });

  it('섞기 전 짝을 지난 짝 기록 맨 앞에 넣고 셋까지만 둔다', () => {
    const c = chartOf({ history: [1, 2, 3].map((at) => ({ at, pairs: ['1-2'] })) });
    const h = pushHistory(c, 9);
    expect(h).toHaveLength(3);
    expect(h[0]).toEqual({ at: 9, pairs: currentPairs(c) });
    const empty = chartOf({ seats: {} });
    expect(pushHistory(empty, 9)).toBe(empty.history); // 짝이 없으면 그대로
  });
});

describe('자리표 - 저장된 모양 고쳐 읽기', () => {
  it('엉뚱한 값은 기본으로, 한 학생이 두 칸이면 앞의 것만', () => {
    const c = sanitizeChart('x', {
      classKey: '2026_3_2',
      rows: 99,
      cols: 'abc',
      groupCols: 5,
      front: 'left',
      seats: { '0-0': 1, '0-1': 1, bad: 2, '1-1': '3' },
      off: ['0-2', 7, '0-2'],
      history: [{ at: 1, pairs: ['1-2', '3-3', 'x'] }, 'bad'],
    });
    expect(c).toMatchObject({ rows: 10, cols: 6, groupCols: 2, front: 'top', name: '자리표' });
    expect(c.seats).toEqual({ '0-0': 1, '1-1': 3 });
    expect(c.off).toEqual(['0-2']);
    expect(c.history).toEqual([{ at: 1, pairs: ['1-2'] }]);
  });
});
