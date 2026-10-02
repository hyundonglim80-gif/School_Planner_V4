import { describe, it, expect, vi } from 'vitest';

// Firestore를 실제로 부르지 않는다 - 쓰기 인자 모양만 본다. FieldPath·deleteField는 진짜를 쓴다(공통 목에는 없다)
vi.mock('./firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('firebase/firestore', async (importOriginal) => await importOriginal());

import { FieldPath, deleteField } from 'firebase/firestore';
import {
  periodCounts,
  periodSummary,
  sanitizeSubjectPeriods,
  sanitizeSubjectRecord,
  studentTotals,
  subjectHistoryOf,
  subjectHistoryText,
  summaryCsvRows,
  type SubjectAttendanceDay,
  type SubjectAttendanceRecord,
} from './subjectAttendance';
import { subjectRecordWrite } from './subjectAttendanceStore';

// 교과 출결 (docs/ROADMAP-SUBJECT.md S6)

const R = (num: number, kind: SubjectAttendanceRecord['kind'], extra: Partial<SubjectAttendanceRecord> = {}): SubjectAttendanceRecord => ({
  num,
  name: `학생${num}`,
  kind,
  reason: 'sick',
  ...extra,
});

describe('교시 요약', () => {
  it("'결과 2 · 지각 1', 적힌 것이 없으면 ''", () => {
    const recs = { '2': R(2, 'absent'), '5': R(5, 'absent'), '7': R(7, 'late') };
    expect(periodCounts(recs)).toEqual({ absent: 2, late: 1, early: 0 });
    expect(periodSummary(recs)).toBe('결과 2 · 지각 1');
    expect(periodSummary({ '1': R(1, 'early') })).toBe('조퇴 1');
    expect(periodSummary(undefined)).toBe('');
  });
});

describe('학생 누계', () => {
  it('교시마다 하나씩 세고 기간 밖은 뺀다, 이름은 가장 나중 것', () => {
    const days: Array<Pick<SubjectAttendanceDay, 'date' | 'periods'>> = [
      { date: '2026-11-04', periods: { '1': { '2': R(2, 'late', { name: '새이름' }) } } },
      { date: '2026-11-02', periods: { '3': { '2': R(2, 'absent') }, '1': { '2': R(2, 'absent'), '4': R(4, 'early') } } },
      { date: '2026-12-01', periods: { '2': { '2': R(2, 'absent') } } },
    ];
    const t = studentTotals(days, '2026-11-01', '2026-11-30');
    expect(t['2']).toMatchObject({ absent: 2, late: 1, early: 0, name: '새이름' });
    expect(t['2'].items.map((i) => `${i.date}#${i.period}`)).toEqual(['2026-11-02#1', '2026-11-02#3', '2026-11-04#1']);
    expect(t['4']).toMatchObject({ early: 1 });
    expect(studentTotals(days)['2'].absent).toBe(3);
  });
});

describe('누계 CSV와 누가기록 (S7)', () => {
  const days: Array<Pick<SubjectAttendanceDay, 'date' | 'periods'>> = [
    { date: '2026-11-02', periods: { '3': { '2': R(2, 'absent', { note: '보건실' }) } } },
    { date: '2026-11-04', periods: { '1': { '2': R(2, 'late'), '9': R(9, 'early', { name: '전출생' }) } } },
  ];

  it('명렬표 차례, 기록 없는 학생은 0, 명렬표에 없는 번호는 끝에', () => {
    const rows = summaryCsvRows([{ num: 1, name: '가' }, { num: 2, name: '나' }], studentTotals(days));
    expect(rows).toEqual([
      ['번호', '이름', '결과', '지각', '조퇴', '합계'],
      [1, '가', 0, 0, 0, 0],
      [2, '나', 1, 1, 0, 2],
      [9, '전출생', 0, 0, 1, 1],
    ]);
  });

  it('한 학생의 내역 줄', () => {
    const h = subjectHistoryOf(days, 2);
    expect(h.map((x) => `${x.date} ${subjectHistoryText(x, { sick: '질병', unexcused: '미인정', other: '기타', approved: '출석인정' })}`)).toEqual([
      '2026-11-02 3교시 결과(질병) - 보건실',
      '2026-11-04 1교시 지각(질병)',
    ]);
    expect(subjectHistoryOf(days, 5)).toEqual([]);
  });
});

describe('저장된 모양 읽기', () => {
  it('모르는 종류·교시는 버리고 사유는 질병으로', () => {
    expect(sanitizeSubjectRecord({ kind: 'result', num: 1 })).toBeNull();
    expect(sanitizeSubjectRecord({ kind: 'late', reason: 'x', note: '  ' }, '3')).toEqual({ num: 3, name: '', kind: 'late', reason: 'sick' });
    expect(
      sanitizeSubjectPeriods({ '1': { '2': { num: 2, name: '가', kind: 'absent', reason: 'other', note: ' 보건실 ' } }, x: {}, '3': { '1': null } })
    ).toEqual({ '1': { '2': { num: 2, name: '가', kind: 'absent', reason: 'other', note: '보건실' } } });
  });
});

describe('쓰기는 학생 한 칸만 (mergeFields)', () => {
  const cls = { classKey: '2026_5_2', year: 2026, grade: '5', classNum: '2' };

  it('periods.교시.번호 하나와 머리 칸만 고친다', () => {
    const { data, mergeFields } = subjectRecordWrite(cls, '2026-11-02', 3, 12, R(12, 'absent', { note: ' 상담 ' }));
    expect((data.periods as any)['3']['12']).toEqual({ num: 12, name: '학생12', kind: 'absent', reason: 'sick', note: '상담' });
    expect(mergeFields.slice(0, 6)).toEqual(['classKey', 'year', 'grade', 'classNum', 'date', 'updatedAt']);
    expect(mergeFields).toHaveLength(7);
    expect((mergeFields[6] as FieldPath).isEqual(new FieldPath('periods', '3', '12'))).toBe(true);
    expect(data).toMatchObject({ classKey: '2026_5_2', date: '2026-11-02' });
  });

  it('출석으로 되돌리면 그 칸에 deleteField', () => {
    const { data, mergeFields } = subjectRecordWrite(cls, '2026-11-02', '1', '2', null);
    expect((data.periods as any)['1']['2'].isEqual(deleteField())).toBe(true);
    expect(mergeFields.filter((f) => f instanceof FieldPath)).toHaveLength(1);
  });
});
