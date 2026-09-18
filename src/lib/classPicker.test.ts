import { describe, it, expect } from 'vitest';
import {
  yearOptions,
  gradeOptions,
  classNumOptions,
  indexOfPick,
  pickOfIndex,
  reconcilePick,
  classesInScope,
  describeClass,
} from './classPicker';
import type { ClassRoster } from '../hooks/useRoster';

const cls = (year: number, grade: string, classNum: string): ClassRoster => ({
  year,
  grade,
  classNum,
  students: [],
});

const classes: ClassRoster[] = [
  cls(2026, '3', '2'),
  cls(2026, '3', '10'),
  cls(2026, '3', '1'),
  cls(2026, '4', '1'),
  cls(2025, '6', '3'),
];

describe('고를 수 있는 값', () => {
  it('학년도는 최근 것이 앞에 온다', () => {
    expect(yearOptions(classes)).toEqual(['2026', '2025']);
  });

  it('학년은 그 학년도 안에서만 나온다', () => {
    expect(gradeOptions(classes, '2026')).toEqual(['3', '4']);
    expect(gradeOptions(classes, '2025')).toEqual(['6']);
  });

  it('반은 숫자 차례로 세운다 (10반이 2반 뒤에)', () => {
    expect(classNumOptions(classes, '2026', '3')).toEqual(['1', '2', '10']);
  });

  it('학년도를 비우면 전체에서 모은다', () => {
    expect(gradeOptions(classes, '')).toEqual(['3', '4', '6']);
  });

  it('빈 값은 목록에 넣지 않는다', () => {
    expect(classNumOptions([cls(2026, '3', ''), cls(2026, '3', '1')], '2026', '3')).toEqual(['1']);
  });
});

describe('고른 것과 목록 자리 사이', () => {
  it('세 값에 맞는 자리를 찾는다', () => {
    expect(indexOfPick(classes, { year: '2026', grade: '3', classNum: '10' })).toBe(1);
  });

  it('없으면 -1', () => {
    expect(indexOfPick(classes, { year: '2026', grade: '9', classNum: '1' })).toBe(-1);
  });

  it('자리로부터 세 값을 되짚는다', () => {
    expect(pickOfIndex(classes, 4)).toEqual({ year: '2025', grade: '6', classNum: '3' });
  });

  it('없는 자리는 빈 값', () => {
    expect(pickOfIndex(classes, 99)).toEqual({ year: '', grade: '', classNum: '' });
  });
});

describe('reconcilePick', () => {
  it('맞는 조합은 그대로 둔다', () => {
    const want = { year: '2026', grade: '3', classNum: '2' };
    expect(reconcilePick(classes, want)).toEqual(want);
  });

  it('학년도를 바꿔 학년이 허공을 가리키면 첫 학년으로 내려앉는다', () => {
    expect(reconcilePick(classes, { year: '2025', grade: '3', classNum: '2' })).toEqual({
      year: '2025',
      grade: '6',
      classNum: '3',
    });
  });

  it('반만 없으면 반만 바뀐다', () => {
    expect(reconcilePick(classes, { year: '2026', grade: '4', classNum: '9' })).toEqual({
      year: '2026',
      grade: '4',
      classNum: '1',
    });
  });

  it('학급이 하나도 없으면 빈 값', () => {
    expect(reconcilePick([], { year: '2026', grade: '3', classNum: '2' })).toEqual({
      year: '',
      grade: '',
      classNum: '',
    });
  });
});

describe('classesInScope', () => {
  it('세 칸을 다 채우면 한 학급', () => {
    expect(classesInScope(classes, { year: '2026', grade: '3', classNum: '2' })).toHaveLength(1);
  });

  it('반을 비우면 그 학년 전체', () => {
    expect(classesInScope(classes, { year: '2026', grade: '3', classNum: '' })).toHaveLength(3);
  });

  it('학년까지 비우면 그 해 전체', () => {
    expect(classesInScope(classes, { year: '2026', grade: '', classNum: '' })).toHaveLength(4);
  });

  it('다 비우면 전부', () => {
    expect(classesInScope(classes, { year: '', grade: '', classNum: '' })).toHaveLength(5);
  });
});

describe('describeClass', () => {
  it('세 토막을 이어 붙인다', () => {
    expect(describeClass({ year: 2026, grade: '3', classNum: '2' })).toBe('2026학년도 3학년 2반');
  });

  it('빈 칸은 건너뛴다', () => {
    expect(describeClass({ year: 2026, grade: '', classNum: '' })).toBe('2026학년도');
  });
});
