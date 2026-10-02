// src/lib/subjectAttendanceStore.ts
//
// 교과 출결을 읽고 쓴다 (규칙은 lib/subjectAttendance, docs/ROADMAP-SUBJECT.md S6).
//
// ⚠️ 쓸 때는 학생 한 칸(periods.교시.번호)만 갈아 끼운다(mergeFields + FieldPath, 지우기는 deleteField).
//    문서나 교시를 통째로 쓰면 같은 날 다른 교시 칸에서 적은 것, 다른 기기에서 적은 것이 사라진다(CLAUDE.md 4장).
import {
  collection,
  deleteField,
  doc,
  FieldPath,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { subscribeDocWithServerFallback } from './firestoreSubscribe';
import {
  sanitizeSubjectPeriods,
  subjectAttendanceDocId,
  type SubjectAttendanceDay,
  type SubjectAttendanceRecord,
} from './subjectAttendance';
import type { ClassInfo } from './attendanceStore';

function col() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요합니다.');
  return collection(db, 'users', uid, 'v4_subjectAttendance');
}

const META_FIELDS = ['classKey', 'year', 'grade', 'classNum', 'date', 'updatedAt'];

/**
 * 학생 한 칸을 쓸 setDoc 인자 (테스트가 본다). rec가 null이면 그 칸을 지운다(출석으로).
 * mergeFields에 든 칸만 바뀐다 - 같은 문서의 다른 교시·다른 학생은 그대로.
 */
export function subjectRecordWrite(
  cls: ClassInfo,
  date: string,
  period: number | string,
  num: number | string,
  rec: SubjectAttendanceRecord | null
): { data: Record<string, unknown>; mergeFields: Array<string | FieldPath> } {
  const p = String(period);
  const n = String(num);
  const value = rec
    ? {
        num: rec.num,
        name: rec.name,
        kind: rec.kind,
        reason: rec.reason,
        ...(rec.note && rec.note.trim() ? { note: rec.note.trim() } : {}),
      }
    : deleteField();
  return {
    data: { ...cls, date, periods: { [p]: { [n]: value } }, updatedAt: Date.now() },
    mergeFields: [...META_FIELDS, new FieldPath('periods', p, n)],
  };
}

/** 학생 한 칸을 저장한다(rec null = 출석으로 지우기). 실패하면 던진다 */
export async function saveSubjectRecord(
  cls: ClassInfo,
  date: string,
  period: number | string,
  num: number | string,
  rec: SubjectAttendanceRecord | null
): Promise<void> {
  const { data, mergeFields } = subjectRecordWrite(cls, date, period, num, rec);
  await setDoc(doc(col(), subjectAttendanceDocId(cls.classKey, date)), data, { mergeFields });
}

const toDay = (cls: Partial<ClassInfo>, date: string, data: any): SubjectAttendanceDay => ({
  classKey: String(data?.classKey ?? cls.classKey ?? ''),
  year: Number(data?.year ?? cls.year ?? 0),
  grade: String(data?.grade ?? cls.grade ?? ''),
  classNum: String(data?.classNum ?? cls.classNum ?? ''),
  date: String(data?.date ?? date),
  periods: sanitizeSubjectPeriods(data?.periods),
  updatedAt: typeof data?.updatedAt === 'number' ? data.updatedAt : undefined,
});

/** 그 반 그날 문서를 구독한다 (오른쪽 칸). 문서가 없으면 빈 날 */
export function subscribeSubjectAttendanceDay(
  cls: ClassInfo,
  date: string,
  onData: (day: SubjectAttendanceDay) => void,
  onError?: (err: unknown) => void
): () => void {
  return subscribeDocWithServerFallback(
    doc(col(), subjectAttendanceDocId(cls.classKey, date)),
    (data) => onData(toDay(cls, date, data)),
    onError
  );
}

/** 그날 모든 반의 교과 출결 (하루 수업 칸의 '결과 2' 표). classKey → 날 */
export function subscribeSubjectAttendanceDate(
  date: string,
  onData: (byClass: Record<string, SubjectAttendanceDay>) => void,
  onError?: (err: unknown) => void
): () => void {
  return onSnapshot(
    query(col(), where('date', '==', date)),
    (snap) => {
      const out: Record<string, SubjectAttendanceDay> = {};
      snap.forEach((d) => {
        const day = toDay({}, date, d.data());
        if (day.classKey) out[day.classKey] = day;
      });
      onData(out);
    },
    (err) => onError?.(err)
  );
}

/** 한 반의 교과 출결 문서를 모두 (날짜 차례로, 누계) */
export async function loadSubjectAttendanceForClass(classKey: string): Promise<SubjectAttendanceDay[]> {
  const snap = await getDocs(query(col(), where('classKey', '==', classKey)));
  return snap.docs
    .map((d) => toDay({ classKey }, '', d.data()))
    .filter((d) => d.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}
