import { describe, expect, it } from 'vitest';
import {
  dayHead,
  guideHtml,
  guideTable,
  guideTsv,
  nextWeekMonday,
  periodCountOf,
  periodsFromDoc,
  schoolWeekOf,
  shiftWeek,
  suppliesOf,
  weekRangeText,
  type GuideDay,
} from './weeklyGuide';

describe('주 고르기', () => {
  it('그날이 든 주의 월~금, 다음 주 월요일, 주 넘기기', () => {
    expect(schoolWeekOf('2026-10-02')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(schoolWeekOf('2026-10-04')[0]).toBe('2026-09-28'); // 일요일은 그 주(월요일 시작)
    expect(nextWeekMonday('2026-10-02')).toBe('2026-10-05');
    expect(shiftWeek('2026-10-07', -1)).toBe('2026-09-28');
    expect(weekRangeText(schoolWeekOf('2026-10-05'))).toBe('10.5 ~ 10.9');
    expect(dayHead('2026-10-05')).toBe('10/5(월)');
  });
});

describe('periodsFromDoc', () => {
  it('새 모양·V3 글자 모양, 빈 교시는 뺀다, 메모는 memo 먼저', () => {
    expect(
      periodsFromDoc({
        1: { subject: '국어', memo: '시 낭송', content: '옛', supplies: '공책' },
        2: '수학',
        3: { subject: '' },
        x: { subject: '?' },
        4: { subject: '과학', content: '실험' },
      })
    ).toEqual({
      1: { subject: '국어', memo: '시 낭송', supplies: '공책' },
      2: { subject: '수학', memo: '', supplies: '' },
      4: { subject: '과학', memo: '실험', supplies: '' },
    });
    expect(periodsFromDoc(null)).toEqual({});
  });
});

const days: GuideDay[] = [
  { date: '2026-10-05', periods: { 1: { subject: '국어', memo: '시 낭송', supplies: '공책, 색연필' }, 3: { subject: '미술', memo: '', supplies: '색연필·풀' } }, notices: ['우유 급식', '체육복'] },
  { date: '2026-10-06', periods: { 7: { subject: '동아리', memo: '', supplies: '' } }, notices: [] },
];

describe('표', () => {
  it('교시 수는 시간표와 실제 적힌 교시 중 큰 쪽', () => {
    expect(periodCountOf(days, 6)).toBe(7);
    expect(periodCountOf([], 0)).toBe(1);
  });
  it('준비물은 모아서 겹친 것 하나로', () => {
    expect(suppliesOf(days[0])).toEqual(['공책', '색연필', '풀']);
  });
  it('요일 머리, 교시 줄(과목 + 메모), 준비물·알림장 줄 - 끄면 빠진다', () => {
    const t = guideTable(days, ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시'], { memo: true, supplies: true, notices: true });
    expect(t.head).toEqual(['', '10/5(월)', '10/6(화)']);
    expect(t.rows[0]).toEqual(['1교시', '국어\n시 낭송', '']);
    expect(t.rows[6]).toEqual(['7교시', '', '동아리']);
    expect(t.rows[7]).toEqual(['준비물', '공책, 색연필, 풀', '']);
    expect(t.rows[8]).toEqual(['알림장', '1. 우유 급식\n2. 체육복', '']);
    const bare = guideTable(days, [], { memo: false, supplies: false, notices: false });
    expect(bare.rows).toHaveLength(7);
    expect(bare.rows[0][1]).toBe('국어');
  });
  it('복사: HTML 표(이스케이프·줄바꿈)와 탭 글(줄바꿈 칸은 따옴표)', () => {
    const t = guideTable(days, ['1교시'], { memo: true, supplies: false, notices: false });
    const html = guideHtml('주간학습안내 <4-3>', '가정에서\n살펴 주세요', t);
    expect(html).toContain('&lt;4-3&gt;');
    expect(html).toContain('가정에서<br>살펴 주세요');
    expect(html).toContain('국어<br>시 낭송');
    // 칸 안 줄바꿈은 따옴표 안에 그대로 - 줄로 나누면 그 칸이 끊기므로 통째로 본다
    expect(guideTsv(t).startsWith('\t10/5(월)\t10/6(화)\n1교시\t"국어\n시 낭송"\t\n2교시')).toBe(true);
  });
});
