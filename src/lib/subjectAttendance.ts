// src/lib/subjectAttendance.ts
//
// 교과 출결 (docs/ROADMAP-SUBJECT.md S6). 교과 모드 수업 칸에서 그 반 그 교시의 결과·지각·조퇴를 적는다.
// 담임 출석부(lib/attendance, users/{uid}/attendance)와 따로 둔다 - 담임 출석부는 하루 단위(결석)이고 기록 칸에 '출결'을
// 남기지만, 교과 출결은 교시 단위이고 기록을 만들지 않는다.
//
// 저장: users/{uid}/v4_subjectAttendance/{classKey}_{date} (V4 전용)
//   { classKey, year, grade, classNum, date,
//     periods: { '3': { '12': { num, name, kind: 'absent'|'late'|'early', reason, note? } } }, updatedAt }
// 쓰기는 학생 한 칸(periods.교시.번호)만 - 같은 날 두 교시를 따로 열어 적어도 서로 덮지 않는다(lib/subjectAttendanceStore).
// 적지 않은 학생은 출석이다(담임 출석부와 같다).
import { REASONS, type AttendanceReason } from './attendance';

export type SubjectAttendanceKind = 'absent' | 'late' | 'early';

/** 교시 단위라 absent는 '결과'(그 시간에 없었다)로 부른다 - 나이스 출결 구분과 같다 */
export const SUBJECT_KIND_LABEL: Record<SubjectAttendanceKind, string> = {
  absent: '결과',
  late: '지각',
  early: '조퇴',
};
export const SUBJECT_KINDS: SubjectAttendanceKind[] = ['absent', 'late', 'early'];

export interface SubjectAttendanceRecord {
  num: number;
  /** 적을 때의 이름 - 명렬표 번호가 바뀌어도 누구였는지 남는다 */
  name: string;
  kind: SubjectAttendanceKind;
  reason: AttendanceReason;
  note?: string;
}

export interface SubjectAttendanceDay {
  classKey: string;
  year: number;
  grade: string;
  classNum: string;
  date: string;
  /** 교시('3') → 번호('12') → 기록 */
  periods: Record<string, Record<string, SubjectAttendanceRecord>>;
  updatedAt?: number;
}

export const subjectAttendanceDocId = (classKey: string, date: string) => `${classKey}_${date}`;

/** 저장된 한 칸을 믿지 않고 읽는다. 모르는 모양이면 null */
export function sanitizeSubjectRecord(raw: any, num?: string | number): SubjectAttendanceRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const kind = SUBJECT_KINDS.includes(raw.kind) ? (raw.kind as SubjectAttendanceKind) : null;
  if (!kind) return null;
  const n = Number(raw.num ?? num);
  if (!Number.isFinite(n)) return null;
  const reason = REASONS.includes(raw.reason) ? (raw.reason as AttendanceReason) : 'sick';
  const note = typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim() : '';
  return { num: n, name: typeof raw.name === 'string' ? raw.name : '', kind, reason, ...(note ? { note } : {}) };
}

/** 문서 → 교시별 기록 (모르는 칸은 버린다) */
export function sanitizeSubjectPeriods(raw: any): Record<string, Record<string, SubjectAttendanceRecord>> {
  const out: Record<string, Record<string, SubjectAttendanceRecord>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [p, recs] of Object.entries(raw as Record<string, any>)) {
    if (!/^\d+$/.test(p) || !recs || typeof recs !== 'object') continue;
    const day: Record<string, SubjectAttendanceRecord> = {};
    for (const [n, r] of Object.entries(recs as Record<string, any>)) {
      const rec = sanitizeSubjectRecord(r, n);
      if (rec) day[String(rec.num)] = rec;
    }
    if (Object.keys(day).length > 0) out[p] = day;
  }
  return out;
}

/** 교시 하나의 종류별 수 */
export function periodCounts(records: Record<string, SubjectAttendanceRecord> | undefined): Record<SubjectAttendanceKind, number> {
  const out: Record<SubjectAttendanceKind, number> = { absent: 0, late: 0, early: 0 };
  for (const r of Object.values(records || {})) out[r.kind]++;
  return out;
}

/** 교시 하나 요약 '결과 2 · 지각 1' (적힌 것이 없으면 '') */
export function periodSummary(records: Record<string, SubjectAttendanceRecord> | undefined): string {
  const c = periodCounts(records);
  return SUBJECT_KINDS.filter((k) => c[k] > 0)
    .map((k) => `${SUBJECT_KIND_LABEL[k]} ${c[k]}`)
    .join(' · ');
}

export interface SubjectStudentTotal {
  num: number;
  name: string;
  absent: number;
  late: number;
  early: number;
  /** 날짜·교시별 내역 (날짜·교시 차례) */
  items: Array<{ date: string; period: number; record: SubjectAttendanceRecord }>;
}

/**
 * 학생 하나하나의 누계 (교시 수). 이름은 가장 나중에 적은 것.
 * from·to(YYYY-MM-DD)를 주면 그 사이 날짜만 센다.
 */
export function studentTotals(
  days: Array<Pick<SubjectAttendanceDay, 'date' | 'periods'>>,
  from?: string,
  to?: string
): Record<string, SubjectStudentTotal> {
  const out: Record<string, SubjectStudentTotal> = {};
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of sorted) {
    if ((from && day.date < from) || (to && day.date > to)) continue;
    const periods = Object.keys(day.periods || {}).sort((a, b) => Number(a) - Number(b));
    for (const p of periods) {
      for (const r of Object.values(day.periods[p] || {})) {
        const key = String(r.num);
        const t = (out[key] ||= { num: r.num, name: r.name, absent: 0, late: 0, early: 0, items: [] });
        t[r.kind]++;
        if (r.name) t.name = r.name;
        t.items.push({ date: day.date, period: Number(p), record: r });
      }
    }
  }
  return out;
}

/** 'n번 이름 결과(질병) - 감기' 한 줄 */
export function subjectRecordText(r: SubjectAttendanceRecord, reasonLabel: Record<AttendanceReason, string>): string {
  return `${SUBJECT_KIND_LABEL[r.kind]}(${reasonLabel[r.reason]})${r.note ? ` - ${r.note}` : ''}`;
}

/** 한 학생의 교과 출결 내역 (날짜·교시 차례) - 학생 기록(누가기록)에 섞는다 (S7) */
export function subjectHistoryOf(
  days: Array<Pick<SubjectAttendanceDay, 'date' | 'periods'>>,
  num: number | string
): Array<{ date: string; period: number; record: SubjectAttendanceRecord }> {
  return studentTotals(days)[String(num)]?.items || [];
}

/** 누가기록 한 줄 '11/2 3교시 결과(질병) - 보건실' 의 날짜 뒤 부분 */
export function subjectHistoryText(
  item: { period: number; record: SubjectAttendanceRecord },
  reasonLabel: Record<AttendanceReason, string>
): string {
  return `${item.period}교시 ${subjectRecordText(item.record, reasonLabel)}`;
}

/**
 * 누계 CSV 줄 (S7): 머리 한 줄 + 학생마다 '번호, 이름, 결과, 지각, 조퇴, 합계'.
 * students: 명렬표 차례(전출 학생도 기록이 있으면 넣는다). 명렬표에 없는 번호의 기록은 끝에 붙인다.
 */
export function summaryCsvRows(
  students: Array<{ num: number; name: string }>,
  totals: Record<string, SubjectStudentTotal>
): (string | number)[][] {
  const rows: (string | number)[][] = [['번호', '이름', '결과', '지각', '조퇴', '합계']];
  const seen = new Set<string>();
  const line = (num: number, name: string) => {
    const t = totals[String(num)];
    const a = t?.absent || 0;
    const l = t?.late || 0;
    const e = t?.early || 0;
    rows.push([num, name || t?.name || '', a, l, e, a + l + e]);
    seen.add(String(num));
  };
  for (const s of students) line(Number(s.num), s.name);
  for (const t of Object.values(totals).sort((x, y) => x.num - y.num)) if (!seen.has(String(t.num))) line(t.num, t.name);
  return rows;
}
