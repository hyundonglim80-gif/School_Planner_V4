import { describe, it, expect } from 'vitest';
import {
  changeAttendance,
  entriesForStudent,
  evalHasStudent,
  evalStudentValue,
  isClassEval,
  observationContent,
  patchEvalStudent,
  withRecord,
} from './classHub';
import type { AttendanceRecord } from './attendance';
import type { EvaluationItem } from '../hooks/useEvaluation';

const late: AttendanceRecord = { num: 5, name: '김지우', kind: 'late', reason: 'unexcused', periods: [1], note: '늦잠' };

describe('changeAttendance', () => {
  it('처음 고르면 사유는 질병, 출석으로 돌리면 null', () => {
    expect(changeAttendance(undefined, 5, '김지우', { kind: 'absent' })).toEqual({ num: 5, name: '김지우', kind: 'absent', reason: 'sick' });
    expect(changeAttendance(late, 5, '김지우', { kind: null })).toBeNull();
  });

  it('종류를 바꾸면 사유·메모는 이어받고, 결석은 교시를 버린다', () => {
    expect(changeAttendance(late, 5, '김지우', { kind: 'early' })).toEqual({ ...late, kind: 'early' });
    const absent = changeAttendance(late, 5, '김지우', { kind: 'absent' });
    expect(absent).toEqual({ num: 5, name: '김지우', kind: 'absent', reason: 'unexcused', note: '늦잠' });
  });

  it('교시는 켜고 끄고, 차례로 둔다. 다 끄면 칸을 뺀다', () => {
    const two = changeAttendance(late, 5, '김지우', { togglePeriod: 3 });
    expect(two?.periods).toEqual([1, 3]);
    const none = changeAttendance({ ...late, periods: [3] }, 5, '김지우', { togglePeriod: 3 });
    expect(none && 'periods' in none).toBe(false);
  });

  it('메모는 다듬고, 비우면 칸을 뺀다. 출석인 학생은 바꿀 것이 없다', () => {
    expect(changeAttendance(late, 5, '김지우', { note: '  감기 ' })?.note).toBe('감기');
    const cleared = changeAttendance(late, 5, '김지우', { note: '' });
    expect(cleared && 'note' in cleared).toBe(false);
    expect(changeAttendance(undefined, 5, '김지우', { reason: 'other' })).toBeNull();
    expect(changeAttendance(undefined, 5, '김지우', { togglePeriod: 1 })).toBeNull();
  });

  it('결석의 교시는 누를 수 없다', () => {
    const absent: AttendanceRecord = { num: 5, name: '김지우', kind: 'absent', reason: 'sick' };
    expect(changeAttendance(absent, 5, '김지우', { togglePeriod: 2 })).toBe(absent);
  });
});

describe('withRecord', () => {
  it('넣고 빼도 다른 학생은 그대로', () => {
    const other = { ...late, num: 7 };
    const day = { '7': other };
    expect(withRecord(day, 5, late)).toEqual({ '7': other, '5': late });
    expect(withRecord({ '5': late, '7': other }, 5, null)).toEqual({ '7': other });
    expect(day).toEqual({ '7': other }); // 원본을 바꾸지 않는다
  });
});

const ev = (id: string, extra: Partial<EvaluationItem> = {}): EvaluationItem => ({
  id,
  title: id,
  subject: '수학',
  type: 'eval',
  methodObj: { indiv: true, group: false },
  steps: ['잘함', '보통'],
  groups: [],
  dateStr: '2026-10-01',
  periodStr: 1,
  context: { source: 'schedule', period: 1 },
  rosterMeta: { year: 2026, grade: '4', classNum: '3' },
  studentsSnapshot: [{ num: 5, name: '김지우', gender: 'F' }],
  records: {},
  ...extra,
});

describe('조사표', () => {
  it('학급은 글자로 견준다 (V3는 숫자로 쓰기도 한다)', () => {
    const cls = { year: '2026', grade: 4, classNum: '3' };
    expect(isClassEval(ev('a'), cls)).toBe(true);
    expect(isClassEval(ev('b', { rosterMeta: { year: 2026, grade: '4', classNum: '2' } }), cls)).toBe(false);
    expect(isClassEval({ rosterMeta: undefined as any }, cls)).toBe(false);
  });

  it('명단에 있나', () => {
    expect(evalHasStudent(ev('a'), 5)).toBe(true);
    expect(evalHasStudent(ev('a'), 6)).toBe(false);
  });

  it('한 학생 값만 고치고, 다른 학생·다른 칸·다른 조사표는 그대로', () => {
    const list = [
      ev('a', { records: { 5: { indivScore: '보통', reason: '발표' }, 6: { indivScore: '잘함' } } as any }),
      ev('b', { records: { 5: { checked: true } } as any }),
    ];
    const next = patchEvalStudent(list, 'a', 5, { indivScore: '잘함' })!;
    expect(evalStudentValue(next[0], 5)).toEqual({ indivScore: '잘함', reason: '발표' });
    expect(evalStudentValue(next[0], 6)).toEqual({ indivScore: '잘함' });
    expect(next[1]).toBe(list[1]);
    expect(evalStudentValue(list[0], 5).indivScore).toBe('보통'); // 원본을 바꾸지 않는다
  });

  it('값이 없던 학생에도 넣는다. 조사표가 없으면 null', () => {
    const next = patchEvalStudent([ev('a')], 'a', 5, { checked: true })!;
    expect(evalStudentValue(next[0], 5)).toEqual({ checked: true });
    expect(patchEvalStudent([ev('a')], 'zz', 5, { checked: true })).toBeNull();
  });
});

describe('관찰 한 줄', () => {
  it('글 뒤에 태그를 붙인다. 이미 있으면 그대로, 빈 글은 빈 글', () => {
    expect(observationContent(' 발표를\n잘함 ', '#26040305')).toBe('발표를 잘함 #26040305');
    expect(observationContent('#26040305 칭찬', '#26040305')).toBe('#26040305 칭찬');
    expect(observationContent('   ', '#26040305')).toBe('');
  });

  it('그날 기록에서 그 학생 태그가 적힌 것만, 적은 차례로', () => {
    const tag = { year: 2026, grade: 4, classNum: 3, num: 5 };
    const entries = [
      { id: '2', content: '두 번째 #26040305', createdAt: 20 },
      { id: 'x', content: '다른 학생 #26040306', createdAt: 5 },
      { id: '1', content: '첫 번째 #26040305', createdAt: 10 },
      { id: 'y', content: '긴 숫자 #2604030512', createdAt: 1 },
    ];
    expect(entriesForStudent(entries, tag).map((e) => e.id)).toEqual(['1', '2']);
  });
});
