import { describe, it, expect } from 'vitest';
import { monthWeeks, monthSheetItems, dayTooltip } from './yearSheet';

describe('monthWeeks', () => {
  it('2026년 10월: 1일이 목요일, 다섯 주', () => {
    const w = monthWeeks(2026, 10, true);
    expect(w).toHaveLength(5);
    expect(w[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(w[4][6]).toBe('2026-10-31');
  });
  it('주말을 숨기면 월~금, 빈 첫 주는 뺀다 (2026년 8월 1일은 토요일)', () => {
    const w = monthWeeks(2026, 8, false);
    expect(w[0]).toEqual(['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']);
    expect(w.every((wk) => wk.length === 5)).toBe(true);
  });
});

describe('monthSheetItems', () => {
  const text = (ev: any) => ev.content;
  it('날짜 차례, 같은 날은 공휴일 → D-Day → 학사일정 → 기간 → 일정, 기간은 처음 날 한 번', () => {
    const items = monthSheetItems({
      dates: ['2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06'],
      holidayOf: (d) => (d === '2026-10-03' ? '개천절' : undefined),
      ddays: [{ id: 'd1', title: '수능', date: '2026-10-05' }, { id: 'd2', title: '다른 달', date: '2026-11-19' }],
      school: { '2026-10-05': [{ date: '2026-10-05', name: '중간고사', grades: [], dayKind: '' }] },
      eventsOf: (d) =>
        ({
          '2026-10-02': [{ id: 'e1', content: '학부모 상담' }],
          '2026-10-05': [{ id: 'p1', content: '시험 (1/2)', groupId: 'g' }, { id: 'e2', content: '회의', completed: true }],
          '2026-10-06': [{ id: 'p2', content: '시험 (2/2)', groupId: 'g' }],
        })[d] || [],
      contentOf: text,
    });
    expect(items.map((i) => [i.dateStr.slice(8), i.kind, i.text])).toEqual([
      ['02', 'event', '학부모 상담'],
      ['03', 'holiday', '개천절'],
      ['05', 'dday', '수능'],
      ['05', 'school', '중간고사'],
      ['05', 'period', '시험'],
      ['05', 'event', '회의'],
    ]);
    const period = items.find((i) => i.kind === 'period')!;
    expect(period).toMatchObject({ endDate: '2026-10-06', done: false, continuesBefore: false, continuesAfter: false });
    expect(items.find((i) => i.text === '회의')!.done).toBe(true);
    // 기간 가운데 날의 풍선에도 기간이 보인다
    expect(dayTooltip('2026-10-06', items)).toBe('10월 6일\n📆 시험');
  });
});
