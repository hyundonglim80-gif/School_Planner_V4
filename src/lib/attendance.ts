// src/lib/attendance.ts
//
// 출석부의 규칙. 나이스(NEIS) 출결 구분과 같게 둔다.
//   종류: 결석 · 지각 · 조퇴 · 결과
//   사유: 질병 · 미인정 · 기타 · 출석인정
// 학기 말에 생활기록부로 옮겨 적을 때 표가 그대로 맞아야 한다.
//
// 기본값은 '출석'이다. 달라진 학생만 적어 두고, 적힌 것이 없으면 출석으로 본다.
// 날마다 25명을 하나씩 누르게 하면 아무도 쓰지 않는다.
//
// 저장 자리: users/{uid}/attendance/{학급키}_{날짜}
//   명렬표처럼 개인 공간에만 둔다(학생 개인정보다).

export type AttendanceKind = 'absent' | 'late' | 'early' | 'result';
export type AttendanceReason = 'sick' | 'unexcused' | 'other' | 'approved';

export const KIND_LABEL: Record<AttendanceKind, string> = {
  absent: '결석',
  late: '지각',
  early: '조퇴',
  result: '결과',
};
export const KINDS: AttendanceKind[] = ['absent', 'late', 'early', 'result'];

export const REASON_LABEL: Record<AttendanceReason, string> = {
  sick: '질병',
  unexcused: '미인정',
  other: '기타',
  approved: '출석인정',
};
export const REASONS: AttendanceReason[] = ['sick', 'unexcused', 'other', 'approved'];

/** 교시를 적는 종류 (결석은 하루 전체라 교시가 없다) */
export const KIND_HAS_PERIODS: Record<AttendanceKind, boolean> = {
  absent: false,
  late: true,
  early: true,
  result: true,
};

export interface AttendanceRecord {
  num: number;
  /** 적을 때의 이름. 번호가 밀려도 누구였는지 알 수 있게 함께 둔다. */
  name: string;
  kind: AttendanceKind;
  reason: AttendanceReason;
  /** 지각·조퇴·결과의 교시 */
  periods?: number[];
  /** 사유 설명 (감기, 체험학습 등) */
  note?: string;
}

export interface AttendanceDay {
  classKey: string;
  year: number;
  grade: string;
  classNum: string;
  /** 2026-09-28 */
  date: string;
  /** 번호(문자열) → 기록. 출석한 학생은 들어 있지 않다. */
  records: Record<string, AttendanceRecord>;
  updatedAt?: number;
}

/** 학급 하나를 가리키는 키. 명렬표 저장에서 쓰는 모양과 같다. */
export function classKeyOf(c: { year: number | string; grade: string | number; classNum: string | number }): string {
  return `${c.year}_${c.grade}_${c.classNum}`;
}

export function attendanceDocId(classKey: string, date: string): string {
  return `${classKey}_${date}`;
}

/** '결석(질병)', '지각(미인정) 1교시' 처럼 한 건을 글로 */
export function recordText(r: AttendanceRecord): string {
  const periods = KIND_HAS_PERIODS[r.kind] && r.periods?.length ? ` ${[...r.periods].sort((a, b) => a - b).join('·')}교시` : '';
  const note = r.note?.trim() ? ` - ${r.note.trim()}` : '';
  return `${KIND_LABEL[r.kind]}(${REASON_LABEL[r.reason]})${periods}${note}`;
}

/** 번호 차례로 */
export function sortedRecords(day: Pick<AttendanceDay, 'records'>): AttendanceRecord[] {
  return Object.values(day.records || {}).sort((a, b) => a.num - b.num);
}

/**
 * 그날 출결을 기록 칸에 남길 글. 모두 출석이면 빈 글이다(기록 항목을 만들지 않는다).
 *
 *   [출결] 4학년 3반
 *   5번 김지우 결석(질병) - 감기
 *   12번 박하늘 지각(미인정) 1교시
 */
export function dayJournalText(day: AttendanceDay): string {
  const rows = sortedRecords(day);
  if (rows.length === 0) return '';
  return [
    `[출결] ${day.grade}학년 ${day.classNum}반`,
    ...rows.map((r) => `${r.num}번 ${r.name} ${recordText(r)}`),
  ].join('\n');
}

/** 종류×사유 칸의 합계. 결석은 날 수, 지각·조퇴·결과는 횟수다(나이스와 같다). */
export type Tally = Record<AttendanceKind, Record<AttendanceReason, number>>;

export function emptyTally(): Tally {
  const t = {} as Tally;
  for (const k of KINDS) {
    t[k] = { sick: 0, unexcused: 0, other: 0, approved: 0 };
  }
  return t;
}

/** 학생별 합계. 번호(문자열) → 합계 */
export function tallyByStudent(days: AttendanceDay[]): Record<string, Tally> {
  const out: Record<string, Tally> = {};
  for (const day of days) {
    for (const r of Object.values(day.records || {})) {
      const key = String(r.num);
      out[key] = out[key] || emptyTally();
      out[key][r.kind][r.reason] += 1;
    }
  }
  return out;
}

/** 한 학생의 출결 기록을 날짜 차례로 */
export function historyOf(days: AttendanceDay[], num: number): Array<{ date: string; record: AttendanceRecord }> {
  return days
    .filter((d) => d.records?.[String(num)])
    .map((d) => ({ date: d.date, record: d.records[String(num)] }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
