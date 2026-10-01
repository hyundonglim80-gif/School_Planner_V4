import { describe, expect, it } from 'vitest';
import {
  evalCellText,
  evalColumnTitle,
  filterEvals,
  isEmptyCell,
  overviewCsvRows,
  semesterOf,
  sortEvals,
  stepCounts,
  studentEvalCell,
} from './evalSummary';

const base = { dateStr: '2026-04-10', periodStr: 2, subject: '수학', title: '단원평가', steps: ['잘함', '보통', '노력'] };

describe('studentEvalCell', () => {
  it('개인 평가 + 근거', () => {
    const ev = { ...base, type: 'eval' as const, methodObj: { indiv: true, group: false }, records: { 3: { indivScore: '잘함', reason: '식을 세움' } } };
    const c = studentEvalCell(ev, 3);
    expect(c).toEqual({ main: '잘함', note: '식을 세움' });
    expect(evalCellText(c)).toBe('잘함 - 식을 세움');
  });

  it('조별은 조 이름(적은 것 먼저, 없으면 나눈 조)과 함께', () => {
    const ev = {
      ...base,
      type: 'eval' as const,
      methodObj: { indiv: true, group: true },
      groups: [{ name: '1모둠', members: [3, 4] }],
      records: { 3: { indivScore: '보통', groupScore: '잘함' }, 4: { groupScore: '잘함', groupName: 'A조' } },
    };
    expect(studentEvalCell(ev, 3).main).toBe('보통 · 1모둠 잘함');
    expect(studentEvalCell(ev, 4).main).toBe('A조 잘함');
  });

  it('V3 옛 조사표 (method 글자, score)', () => {
    const ev = { ...base, type: 'eval' as const, method: 'indiv', records: { 1: { score: '노력' } } } as any;
    expect(studentEvalCell(ev, 1).main).toBe('노력');
  });

  it('체크 O/X, 안 적으면 빈 칸', () => {
    const ev = { ...base, type: 'check' as const, records: { 1: { checked: true }, 2: { checked: false, reason: '안 가져옴' } } };
    expect(studentEvalCell(ev, 1).main).toBe('O');
    expect(evalCellText(studentEvalCell(ev, 2))).toBe('X - 안 가져옴');
    expect(isEmptyCell(studentEvalCell(ev, 3))).toBe(true);
  });

  it('메모', () => {
    const ev = { ...base, type: 'memo' as const, records: { 1: { memo: ' 발표 잘함 ' } } };
    expect(studentEvalCell(ev, 1)).toEqual({ main: '발표 잘함', note: '' });
  });
});

describe('semesterOf', () => {
  const cfg = { summerStart: '2026-07-20', summerEnd: '2026-08-14', winterStart: '2027-01-04', winterEnd: '2027-02-26' };
  it('그 학년도의 방학 설정이 있으면 2학기 시작일로', () => {
    expect(semesterOf('2026-08-14', 2026, cfg)).toBe(1);
    expect(semesterOf('2026-08-15', 2026, cfg)).toBe(2);
    expect(semesterOf('2027-02-10', 2026, cfg)).toBe(2);
  });
  it('다른 해 설정이거나 없으면 3~8월이 1학기', () => {
    expect(semesterOf('2025-08-30', 2025, cfg)).toBe(1);
    expect(semesterOf('2025-09-01', 2025, cfg)).toBe(2);
    expect(semesterOf('2026-01-10', 2025, null)).toBe(2);
  });
});

describe('filterEvals · sortEvals · evalColumnTitle', () => {
  const evs = [
    { id: 'a', dateStr: '2026-09-02', periodStr: 1, subject: '수학', type: 'eval', title: '나' },
    { id: 'b', dateStr: '2026-04-02', periodStr: 3, subject: '', type: 'check', title: '준비물' },
    { id: 'c', dateStr: '2026-04-02', periodStr: 1, subject: '수학', type: 'eval', title: '가' },
  ] as any[];
  it('교과·(없음)·학기·유형', () => {
    expect(filterEvals(evs, { subject: '수학' }, 2026).map((e) => e.id)).toEqual(['a', 'c']);
    expect(filterEvals(evs, { subject: '(없음)' }, 2026).map((e) => e.id)).toEqual(['b']);
    expect(filterEvals(evs, { semester: 1 }, 2026).map((e) => e.id)).toEqual(['b', 'c']);
    expect(filterEvals(evs, { type: 'check' }, 2026).map((e) => e.id)).toEqual(['b']);
  });
  it('날짜·교시 차례, 머리 글', () => {
    expect(sortEvals(evs).map((e) => e.id)).toEqual(['c', 'b', 'a']);
    expect(evalColumnTitle(evs[0])).toBe('9/2 수학 나');
  });
});

describe('overviewCsvRows · stepCounts', () => {
  const ev1 = { ...base, type: 'eval' as const, methodObj: { indiv: true, group: false }, records: { 1: { indivScore: '잘함', reason: '근거' }, 2: { indivScore: '잘함' } } };
  const ev2 = { ...base, dateStr: '2026-04-11', subject: '', title: '소감', type: 'memo' as const, records: { 2: { memo: '재미있음' } } };
  it('머리 두 줄 + 학생마다 (값·사유, 메모는 한 칸), 전출 표시', () => {
    const rows = overviewCsvRows([ev1, ev2], [
      { num: 1, name: '가람' },
      { num: 2, name: '나래', isActive: false },
    ]);
    expect(rows[0]).toEqual(['번호', '이름', '2026-04-10 수학 평가', '', '2026-04-11 메모']);
    expect(rows[1]).toEqual(['', '', '단원평가', '사유', '소감']);
    expect(rows[2]).toEqual(['1', '가람', '잘함', '근거', '']);
    expect(rows[3]).toEqual(['2', '나래 (전출)', '잘함', '', '재미있음']);
  });
  it('단계별 사람 수', () => {
    expect(stepCounts(ev1, [1, 2, 3])).toBe('잘함 2');
    expect(stepCounts(ev2 as any, [1, 2])).toBe('');
  });
});
