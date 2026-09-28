import { describe, it, expect } from 'vitest';
import { autoSourceOf, parseAttendanceJournal } from './autoJournalSync';
import { dayJournalText, type AttendanceRecord } from './attendance';

describe('자동 기록 항목 알아보기', () => {
  it('알림장 항목은 날짜를, 출결 항목은 학급을 알아본다', () => {
    expect(autoSourceOf({ id: 'notice_2026-09-28' })).toEqual({ kind: 'notice', dateStr: '2026-09-28' });
    expect(autoSourceOf({ id: 'attendance_2026_4_3' })).toEqual({
      kind: 'attendance',
      classInfo: { classKey: '2026_4_3', year: 2026, grade: '4', classNum: '3' },
    });
  });

  it('보통 기록은 자동 항목이 아니다', () => {
    expect(autoSourceOf({ id: 'j_123' })).toBeNull();
    expect(autoSourceOf({ id: 1727500000000 })).toBeNull();
    expect(autoSourceOf(null)).toBeNull();
  });
});

describe('출결 항목 글을 출결로 되읽기', () => {
  const records: Record<string, AttendanceRecord> = {
    '5': { num: 5, name: '김지우', kind: 'absent', reason: 'sick', note: '감기' },
    '12': { num: 12, name: '박하늘', kind: 'late', reason: 'unexcused', periods: [1, 2] },
    '20': { num: 20, name: '이서준', kind: 'result', reason: 'approved' },
  };

  it('출석부가 쓴 글을 그대로 되읽으면 같은 출결이 된다', () => {
    const text = dayJournalText({ classKey: '2026_4_3', year: 2026, grade: '4', classNum: '3', date: '2026-09-28', records });
    expect(parseAttendanceJournal(text)).toEqual(records);
  });

  it('줄을 지우면 그 학생은 출석이 된다 (출결에서 빠진다)', () => {
    const text = '[출결] 4학년 3반\n5번 김지우 결석(질병) - 감기';
    expect(Object.keys(parseAttendanceJournal(text)!)).toEqual(['5']);
  });

  it('종류·사유·교시·사유 설명을 고친 것을 읽는다', () => {
    const r = parseAttendanceJournal('12번 박하늘 조퇴(기타) 5·6교시 - 병원 진료')!;
    expect(r['12']).toEqual({ num: 12, name: '박하늘', kind: 'early', reason: 'other', periods: [5, 6], note: '병원 진료' });
  });

  it('머리글이 없어도, 빈 줄이 있어도 된다', () => {
    expect(parseAttendanceJournal('\n5번 김지우 결석(질병)\n\n')).toEqual({
      '5': { num: 5, name: '김지우', kind: 'absent', reason: 'sick' },
    });
  });

  it('결석에는 교시를 두지 않는다 (하루 전체)', () => {
    expect(parseAttendanceJournal('5번 김지우 결석(질병) 1교시')!['5'].periods).toBeUndefined();
  });

  it('모두 지우면 모두 출석이다', () => {
    expect(parseAttendanceJournal('[출결] 4학년 3반')).toEqual({});
    expect(parseAttendanceJournal('')).toEqual({});
  });

  it('출결 모양이 아닌 줄이 하나라도 있으면 읽지 않는다 (짐작해서 고치지 않는다)', () => {
    expect(parseAttendanceJournal('5번 김지우 결석(질병)\n오늘 김지우 어머니와 통화함')).toBeNull();
    expect(parseAttendanceJournal('5번 김지우 결석(감기)')).toBeNull(); // 없는 사유
    expect(parseAttendanceJournal('김지우 결석(질병)')).toBeNull(); // 번호가 없음
  });
});
