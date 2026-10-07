import { describe, it, expect } from 'vitest';
import { courseEvalCompletion, courseOverviewCsvRows, groupCourseEvals } from './courseEvals';

// 과정별 조사표 모아 보기 (docs/ROADMAP-SUBJECT.md S9)

const ev = (id: string, title: string, dateStr: string, extra: Record<string, any> = {}) => ({
  id,
  title,
  type: 'eval' as const,
  subject: '과학',
  dateStr,
  periodStr: 1,
  records: {},
  studentsSnapshot: [1, 2, 3].map((num) => ({ num, name: `학생${num}`, gender: '' })),
  methodObj: { indiv: true, group: false },
  groups: [],
  ...extra,
});

describe('제목+종류로 묶기', () => {
  it('같은 제목은 날짜가 달라도 한 칸, 한 반에만 있는 것도 칸, 종류가 다르면 따로', () => {
    const cols = groupCourseEvals({
      '5-1': [ev('a1', '1단원 평가', '2026-11-02'), ev('b1', '실험 체크', '2026-11-09', { type: 'check' })],
      '5-2': [ev('a2', ' 1단원  평가', '2026-11-04'), ev('c2', '실험 체크', '2026-11-10')],
      '5-3': [ev('x3', '1단원 평가', '2026-11-03', { subject: '수학' })],
    }, '과학');
    expect(cols.map((c) => [c.title, c.type, Object.keys(c.byClass).sort().join(',')])).toEqual([
      ['1단원 평가', 'eval', '5-1,5-2'],
      ['실험 체크', 'check', '5-1'],
      ['실험 체크', 'eval', '5-2'],
    ]);
    expect(cols[0].byClass['5-2'].id).toBe('a2');
  });

  it('같은 반에 같은 제목이 둘이면 이른 것', () => {
    const cols = groupCourseEvals({ '5-1': [ev('late', '평가', '2026-11-09'), ev('early', '평가', '2026-11-02')] });
    expect(cols[0].byClass['5-1'].id).toBe('early');
    expect(cols[0].firstDate).toBe('2026-11-02');
  });
});

describe('완료 수와 CSV', () => {
  const e = ev('a', '평가', '2026-11-02', { records: { 1: { indivScore: '잘함' }, 3: { memo: '' }, 4: { indivScore: '보통' } } });

  it('값이 있는 학생 / 지금 재학생 (명단에 없는 학생은 세지 않는다)', () => {
    expect(courseEvalCompletion(e, [1, 2, 3])).toEqual({ done: 1, total: 3 });
    expect(courseEvalCompletion(e, [1, 2, 3, 4])).toEqual({ done: 1, total: 4 });
  });

  it('반마다 한 줄, 없는 칸은 빈칸', () => {
    const cols = groupCourseEvals({ '5-1': [e] });
    expect(courseOverviewCsvRows(cols, [{ cls: '5-1', nums: [1, 2, 3] }, { cls: '5-2', nums: [1, 2] }])).toEqual([
      ['반', '평가'],
      ['5-1', '1/3'],
      ['5-2', ''],
    ]);
  });
});
