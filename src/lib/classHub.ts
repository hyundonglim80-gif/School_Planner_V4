// src/lib/classHub.ts
//
// 자리표의 학생 칸 (ROADMAP 8-2) - 순수 셈. 저장은 lib/classHubStore.
//
//   - 한 학생의 오늘 출결 바꾸기: 출석부 칸과 같은 규칙(사유는 이어받고 처음이면 질병, 결석은 교시 없음)
//   - 그 학급의 오늘 조사표 고르기, 한 학생 값만 고치기(그날 목록의 다른 조사표·다른 학생은 그대로)
//   - 관찰 한 줄 = 적은 글 + 학생 태그(#26040305) - 학생 누가기록이 태그로 모은다
import {
  KIND_HAS_PERIODS,
  type AttendanceKind,
  type AttendanceReason,
  type AttendanceRecord,
} from './attendance';
import { findStudentTags, sameStudent, type StudentTag } from './studentTag';
import type { EvaluationItem } from '../hooks/useEvaluation';

/** 학생 칸에서 누르는 것 하나 */
export type AttendanceChange =
  | { kind: AttendanceKind | null }
  | { reason: AttendanceReason }
  | { togglePeriod: number }
  | { note: string };

/**
 * 한 학생의 출결을 바꾼 결과. null = 출석(기록 없음).
 * 출석인 학생의 사유·교시·메모를 바꾸려 하면 그대로 출석이다(바꿀 기록이 없다).
 */
export function changeAttendance(
  prev: AttendanceRecord | undefined,
  num: number,
  name: string,
  change: AttendanceChange
): AttendanceRecord | null {
  if ('kind' in change) {
    const kind = change.kind;
    if (!kind) return null;
    return {
      num,
      name,
      kind,
      // 출석부 칸(AttendanceDrawer.setKind)과 같다 - 사유는 이어받고, 처음이면 질병
      reason: prev?.reason || 'sick',
      ...(KIND_HAS_PERIODS[kind] && prev?.periods?.length ? { periods: prev.periods } : {}),
      ...(prev?.note ? { note: prev.note } : {}),
    };
  }
  if (!prev) return null;
  if ('reason' in change) return { ...prev, reason: change.reason };
  if ('togglePeriod' in change) {
    if (!KIND_HAS_PERIODS[prev.kind]) return prev;
    const set = new Set(prev.periods || []);
    if (set.has(change.togglePeriod)) set.delete(change.togglePeriod);
    else set.add(change.togglePeriod);
    const { periods: _drop, ...rest } = prev;
    return set.size ? { ...rest, periods: [...set].sort((a, b) => a - b) } : rest;
  }
  const note = change.note.trim();
  const { note: _old, ...rest } = prev;
  return note ? { ...rest, note } : rest;
}

/** 그날 출결 표에 한 학생을 넣거나(기록) 뺀다(출석) */
export function withRecord(
  records: Record<string, AttendanceRecord>,
  num: number,
  record: AttendanceRecord | null
): Record<string, AttendanceRecord> {
  const next = { ...records };
  if (record) next[String(num)] = record;
  else delete next[String(num)];
  return next;
}

/** 조사표가 이 학급 것인가 (조사표는 만들 때의 학급을 rosterMeta로 들고 있다) */
export function isClassEval(
  ev: Pick<EvaluationItem, 'rosterMeta'> | null | undefined,
  cls: { year: number | string; grade: string | number; classNum: string | number }
): boolean {
  const m = ev?.rosterMeta;
  return (
    !!m &&
    String(m.year) === String(cls.year) &&
    String(m.grade) === String(cls.grade) &&
    String(m.classNum) === String(cls.classNum)
  );
}

/** 조사표 명단(만들 때 찍어 둔 학생)에 그 번호가 있나 */
export function evalHasStudent(ev: Pick<EvaluationItem, 'studentsSnapshot'>, num: number): boolean {
  return (ev.studentsSnapshot || []).some((s) => Number(s.num) === num);
}

/** 학생 한 명의 조사표 칸 */
export type EvalStudentPatch = Partial<{
  indivScore: string;
  groupScore: string;
  checked: boolean;
  reason: string;
  memo: string;
}>;

/** 조사표 하나의 한 학생 값 */
export function evalStudentValue(ev: Pick<EvaluationItem, 'records'>, num: number): Record<string, any> {
  const records = (ev.records || {}) as Record<string, any>;
  return records[String(num)] || {};
}

/**
 * 그날 조사표 목록에서 한 조사표의 한 학생 값만 고친 목록. 그 조사표가 없으면 null(그 사이 지워졌다).
 * 다른 학생의 값과 그 학생의 다른 칸은 그대로 둔다 - 조사표 창에서 다른 학생을 적던 것을 덮지 않게.
 */
export function patchEvalStudent(
  list: EvaluationItem[],
  evalId: string,
  num: number,
  patch: EvalStudentPatch
): EvaluationItem[] | null {
  if (!list.some((e) => e && e.id === evalId)) return null;
  return list.map((e) => {
    if (!e || e.id !== evalId) return e;
    const records = { ...((e.records || {}) as Record<string, any>) };
    records[String(num)] = { ...(records[String(num)] || {}), ...patch };
    return { ...e, records };
  });
}

/** 관찰 한 줄을 기록에 남길 글. 태그가 이미 있으면 더 붙이지 않는다. 빈 글이면 '' */
export function observationContent(text: string, tag: string): string {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (!line) return '';
  return line.includes(tag) ? line : `${line} ${tag}`;
}

/** 그날 기록 중 이 학생 태그가 적힌 것 (적은 차례) */
export function entriesForStudent<T extends { content?: string; createdAt?: number }>(entries: T[], tag: StudentTag): T[] {
  return entries
    .filter((e) => e && findStudentTags(String(e.content || '')).some((t) => sameStudent(t, tag)))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
