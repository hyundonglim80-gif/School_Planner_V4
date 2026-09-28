import { describe, it, expect } from 'vitest';
import { dayJournalText, historyOf, recordText, tallyByStudent, type AttendanceDay } from './attendance';

const cls = { classKey: '2026_4_3', year: 2026, grade: '4', classNum: '3' };
const day = (date: string, records: AttendanceDay['records']): AttendanceDay => ({ ...cls, date, records });

describe('출석부 규칙', () => {
  it('한 건을 나이스 말로 적는다 (교시·사유 포함)', () => {
    expect(recordText({ num: 5, name: '김지우', kind: 'absent', reason: 'sick', note: '감기' })).toBe('결석(질병) - 감기');
    expect(recordText({ num: 5, name: '김지우', kind: 'late', reason: 'unexcused', periods: [2, 1] })).toBe('지각(미인정) 1·2교시');
    expect(recordText({ num: 5, name: '김지우', kind: 'result', reason: 'approved', periods: [4] })).toBe('결과(출석인정) 4교시');
  });

  it('결석은 교시를 적지 않는다', () => {
    expect(recordText({ num: 1, name: 'a', kind: 'absent', reason: 'other', periods: [1] })).toBe('결석(기타)');
  });

  it('모두 출석이면 기록 칸에 남길 글이 없다', () => {
    expect(dayJournalText(day('2026-09-28', {}))).toBe('');
  });

  it('기록 칸에 남길 글은 번호 차례', () => {
    const text = dayJournalText(
      day('2026-09-28', {
        '12': { num: 12, name: '박하늘', kind: 'early', reason: 'sick', periods: [5, 6] },
        '5': { num: 5, name: '김지우', kind: 'absent', reason: 'sick', note: '감기' },
      })
    );
    expect(text).toBe('[출결] 4학년 3반\n5번 김지우 결석(질병) - 감기\n12번 박하늘 조퇴(질병) 5·6교시');
  });

  it('학생별로 종류×사유를 센다', () => {
    const days = [
      day('2026-09-01', { '5': { num: 5, name: '김지우', kind: 'absent', reason: 'sick' } }),
      day('2026-09-02', { '5': { num: 5, name: '김지우', kind: 'absent', reason: 'sick' } }),
      day('2026-09-03', { '5': { num: 5, name: '김지우', kind: 'late', reason: 'unexcused' } }),
    ];
    const t = tallyByStudent(days)['5'];
    expect(t.absent.sick).toBe(2);
    expect(t.late.unexcused).toBe(1);
    expect(t.early.sick).toBe(0);
    expect(tallyByStudent(days)['6']).toBeUndefined();
  });

  it('한 학생의 내역을 날짜 차례로', () => {
    const days = [
      day('2026-09-03', { '5': { num: 5, name: '김지우', kind: 'late', reason: 'sick' } }),
      day('2026-09-01', { '5': { num: 5, name: '김지우', kind: 'absent', reason: 'sick' } }),
      day('2026-09-02', { '7': { num: 7, name: '이하나', kind: 'absent', reason: 'sick' } }),
    ];
    expect(historyOf(days, 5).map((h) => h.date)).toEqual(['2026-09-01', '2026-09-03']);
  });
});
