import { describe, it, expect } from 'vitest';
import { periodPieceOf, layoutWeekBars, collapsePeriods, periodRangeLabel, periodIndexLabel } from './periodBars';

const text = (ev: any) => String(ev.content ?? '');
const piece = (id: string, groupId: string, content: string, extra: any = {}) => ({ id, groupId, content, ...extra });

describe('periodPieceOf', () => {
  it('groupId + (i/n)이면 조각 (V3는 period 표시가 없다)', () => {
    expect(periodPieceOf({ groupId: 'g1' }, '기말고사 (2/5)')).toEqual({ key: 'g1|기말고사|5', base: '기말고사', index: 2, total: 5 });
  });
  it('groupId가 없거나, (i/n)이 없거나(반복 일정), 수가 맞지 않으면 아니다', () => {
    expect(periodPieceOf({}, '기말고사 (2/5)')).toBeNull();
    expect(periodPieceOf({ groupId: 'g1' }, '주간 회의')).toBeNull();
    expect(periodPieceOf({ groupId: 'g1' }, '기말고사 (6/5)')).toBeNull();
    expect(periodPieceOf({ groupId: 'g1' }, '하루 (1/1)')).toBeNull();
    // 사용자가 끝에 글을 더한 조각은 보통 일정으로 남는다
    expect(periodPieceOf({ groupId: 'g1' }, '기말고사 (2/5) 수학')).toBeNull();
  });
});

describe('layoutWeekBars', () => {
  const week = (cols: any[][]) => cols.map((events, i) => ({ dateStr: `2026-10-0${i + 4}`, events }));

  it('나란한 날의 조각을 한 막대로, 나머지는 날마다 그대로', () => {
    const solo = { id: 'x', content: '회의' };
    const { bars, lanes, rest } = layoutWeekBars(
      week([[], [piece('a1', 'g', '시험 (1/3)'), solo], [piece('a2', 'g', '시험 (2/3)')], [piece('a3', 'g', '시험 (3/3)')], [], [], []]),
      text,
    );
    expect(lanes).toBe(1);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ base: '시험', start: 1, len: 3, lane: 0, startsPeriod: true, endsPeriod: true });
    expect(bars[0].cells.map((c) => c.ev.id)).toEqual(['a1', 'a2', 'a3']);
    expect(rest['2026-10-05']).toEqual([solo]);
    expect(rest['2026-10-06']).toEqual([]);
  });

  it('빠진 날(공휴일)이 있으면 두 막대, 앞뒤 주에서 이어지면 끝이 열린다', () => {
    const { bars } = layoutWeekBars(
      week([[], [piece('a2', 'g', '방학 (2/9)')], [], [piece('a3', 'g', '방학 (3/9)')], [], [], []]),
      text,
    );
    expect(bars.map((b) => [b.start, b.len, b.lane, b.startsPeriod, b.endsPeriod])).toEqual([
      [1, 1, 0, false, false],
      [3, 1, 0, false, false],
    ]);
  });

  it('겹치는 기간은 다른 줄, 먼저 시작하고 긴 것이 위', () => {
    const { bars, lanes } = layoutWeekBars(
      week([
        [piece('b1', 'h', '체험학습 (1/2)')],
        [piece('b2', 'h', '체험학습 (2/2)'), piece('a1', 'g', '시험 (1/4)')],
        [piece('a2', 'g', '시험 (2/4)')],
        [piece('a3', 'g', '시험 (3/4)')],
        [piece('a4', 'g', '시험 (4/4)'), piece('c1', 'k', '상담 (1/2)')],
        [piece('c2', 'k', '상담 (2/2)')],
        [],
      ]),
      text,
    );
    expect(lanes).toBe(2);
    const by = Object.fromEntries(bars.map((b) => [b.base, [b.start, b.len, b.lane]]));
    expect(by['체험학습']).toEqual([0, 2, 0]);
    expect(by['시험']).toEqual([1, 4, 1]);
    // 체험학습이 끝난 줄 0이 비어 있어 상담이 그리 들어간다
    expect(by['상담']).toEqual([4, 2, 0]);
  });

  it('한 날에 같은 기간 조각이 둘이면 둘째는 보통 일정', () => {
    const dup = piece('a1b', 'g', '시험 (1/2)');
    const { bars, rest } = layoutWeekBars(week([[piece('a1', 'g', '시험 (1/2)'), dup], [], [], [], [], [], []]), text);
    expect(bars).toHaveLength(1);
    expect(rest['2026-10-04']).toEqual([dup]);
  });
});

describe('collapsePeriods (년간)', () => {
  it('처음 나오는 날에 한 번만, 나머지 날에서는 뺀다', () => {
    const solo = { id: 's', content: '회의' };
    const { rest, starts } = collapsePeriods(
      [
        { dateStr: '2026-10-06', events: [piece('a2', 'g', '시험 (2/3)'), solo] },
        { dateStr: '2026-10-05', events: [piece('a1', 'g', '시험 (1/3)')] },
        { dateStr: '2026-10-07', events: [piece('a3', 'g', '시험 (3/3)')] },
      ],
      text,
    );
    expect(rest).toEqual({ '2026-10-05': [], '2026-10-06': [solo], '2026-10-07': [] });
    expect(Object.keys(starts)).toEqual(['2026-10-05']);
    const g = starts['2026-10-05'][0];
    expect(g.cells.map((c) => c.ev.id)).toEqual(['a1', 'a2', 'a3']);
    expect([g.startsPeriod, g.endsPeriod]).toEqual([true, true]);
    expect(periodRangeLabel(g.cells)).toBe('10.5 ~ 10.7 · 3일');
    expect(periodIndexLabel(g.cells, g.total)).toBe('1~3/3');
  });

  it('달 밖에서 이어지면 끝이 열린다', () => {
    const { starts } = collapsePeriods([{ dateStr: '2026-11-01', events: [piece('a9', 'g', '방학 (9/12)')] }], text);
    const g = starts['2026-11-01'][0];
    expect([g.startsPeriod, g.endsPeriod]).toEqual([false, false]);
    expect(periodRangeLabel(g.cells)).toBe('11.1');
    expect(periodIndexLabel(g.cells, g.total)).toBe('9/12');
  });
});
