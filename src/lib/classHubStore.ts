// src/lib/classHubStore.ts
//
// 자리표의 학생 칸 (ROADMAP 8-2) - 읽고 쓰기. 셈은 lib/classHub.
//
//   출결   users/{uid}/attendance/{학급키}_{날짜}  출석부와 같은 저장(saveAttendanceDay - 바뀐 학생만, 그날 기록의 '출결' 항목도)
//   조사표 {sp}/evaluations/{날짜}               지금 보는 공간. 트랜잭션으로 서버 목록을 읽어 한 조사표의 한 학생 값만 고친다
//   관찰   users/{uid}/journals/{날짜}            개인 공간 기록에 한 줄(학생 태그를 붙여). 학생 정보라 출석부처럼 개인에만
//
// ⚠️ 그날 문서를 화면이 든 값으로 덮지 않는다(하루치가 통째로 지워진 사고 - ARCHITECTURE 4장).
//    출결은 서버에서 그날을 읽어 한 학생만 바꾸고, 조사표·기록은 트랜잭션에서 서버 목록을 읽어 한 칸만 바꾼다.
import { doc, runTransaction, type DocumentData } from 'firebase/firestore';
import { db } from './firebase';
import { attendanceDocId, type AttendanceRecord } from './attendance';
import { loadAttendanceDay, saveAttendanceDay, type ClassInfo } from './attendanceStore';
import { SOURCE_CHANGED_EVENT, type SourceChangedDetail } from './autoJournalSync';
import { evalDocPayload, readEvalList } from './evalList';
import { readJournalEntries } from './journalEntries';
import { subscribeDocWithServerFallback } from './firestoreSubscribe';
import { changeAttendance, patchEvalStudent, withRecord, type AttendanceChange, type EvalStudentPatch } from './classHub';
import type { EvaluationItem } from '../hooks/useEvaluation';

const attendanceRef = (uid: string, classKey: string, date: string) =>
  doc(db, 'users', uid, 'attendance', attendanceDocId(classKey, date));
const evalRef = (uid: string, groupId: string | null, date: string) =>
  groupId ? doc(db, 'groups', groupId, 'evaluations', date) : doc(db, 'users', uid, 'evaluations', date);
const journalRef = (uid: string, date: string) => doc(db, 'users', uid, 'journals', date);

type Unsub = () => void;

/** 그 학급의 그날 출결(번호 → 기록)을 구독한다. 출석한 학생은 없다 */
export function subscribeAttendanceDay(
  uid: string,
  classKey: string,
  date: string,
  onData: (records: Record<string, AttendanceRecord>) => void,
  onError?: (err: unknown) => void
): Unsub {
  return subscribeDocWithServerFallback(
    attendanceRef(uid, classKey, date),
    (data: DocumentData | null) => onData((data?.records as Record<string, AttendanceRecord>) || {}),
    onError
  );
}

/**
 * 한 학생의 출결을 바꿔 저장한다(출석부와 같은 길). 바꾼 뒤의 기록을 돌려준다(null = 출석).
 * 그날을 서버에서 다시 읽고 그 학생만 바꾼다 - 다른 기기·출석부 칸에서 적은 다른 학생을 덮지 않게.
 * 열린 출석부 칸이 다시 읽도록 알린다(적던 것이 있으면 그 칸이 덮지 않는다).
 */
export async function saveStudentAttendance(
  info: ClassInfo,
  date: string,
  num: number,
  name: string,
  change: AttendanceChange
): Promise<AttendanceRecord | null> {
  const day = await loadAttendanceDay(info, date);
  const before = day.records || {};
  const next = changeAttendance(before[String(num)], num, name, change);
  const after = withRecord(before, num, next);
  if (JSON.stringify(after) === JSON.stringify(before)) return next;
  await saveAttendanceDay(info, date, before, after);
  if (typeof window !== 'undefined') {
    const detail: SourceChangedDetail = { kind: 'attendance', groupId: null, dateStr: date, classKey: info.classKey };
    window.dispatchEvent(new CustomEvent(SOURCE_CHANGED_EVENT, { detail }));
  }
  return next;
}

/** 그날 조사표 목록을 구독한다 (V3·V4 두 이름은 readEvalList가 맞춘다) */
export function subscribeEvalDay(
  uid: string,
  groupId: string | null,
  date: string,
  onData: (list: EvaluationItem[]) => void,
  onError?: (err: unknown) => void
): Unsub {
  return subscribeDocWithServerFallback(
    evalRef(uid, groupId, date),
    (data) => onData(readEvalList(data) as EvaluationItem[]),
    onError
  );
}

/** 한 조사표의 한 학생 값만 고친다. 그 사이 조사표가 지워졌으면 던진다 */
export async function saveStudentEval(
  uid: string,
  groupId: string | null,
  date: string,
  evalId: string,
  num: number,
  patch: EvalStudentPatch
): Promise<void> {
  const ref = evalRef(uid, groupId, date);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const fresh = (snap.exists() ? readEvalList(snap.data()) : []) as EvaluationItem[];
    const next = patchEvalStudent(fresh, evalId, num, patch);
    if (!next) throw new Error('그 조사표가 없습니다. 그 사이 지워졌거나 옮겨졌습니다.');
    tx.set(ref, evalDocPayload(next), { merge: true });
  });
}

/** 개인 공간의 그날 기록을 구독한다 (id 없는 옛 항목은 jr_차례로 - 하루 화면과 같다) */
export function subscribeJournalDay(
  uid: string,
  date: string,
  onData: (entries: any[]) => void,
  onError?: (err: unknown) => void
): Unsub {
  return subscribeDocWithServerFallback(journalRef(uid, date), (data) => onData(readJournalEntries(data)), onError);
}

export function newJournalId(): string {
  return 'jr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5);
}

/** 개인 공간 그날 기록에 한 줄을 더한다. 새 항목 id를 돌려준다 */
export async function addJournalLine(uid: string, date: string, content: string): Promise<string> {
  const id = newJournalId();
  const entry = { id, content, createdAt: Date.now(), label: '', labelIds: [], linkedItems: [], imageUrl: '' };
  const ref = journalRef(uid, date);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const fresh = snap.exists() ? readJournalEntries(snap.data()) : [];
    tx.set(ref, { entries: [...fresh, entry], updatedAt: Date.now() }, { merge: true });
  });
  return id;
}

/**
 * 방금 더한 한 줄을 뺀다(안내의 되돌리기). 휴지통을 거치지 않는다 - 방금 만든 것이라.
 * 그 사이 고쳐졌으면(글이 달라졌으면) 빼지 않고 false.
 */
export async function removeJournalLine(uid: string, date: string, id: string, content: string): Promise<boolean> {
  const ref = journalRef(uid, date);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const fresh = snap.exists() ? readJournalEntries(snap.data()) : [];
    const target = fresh.find((e) => e && String(e.id) === id);
    if (!target || String(target.content || '') !== content) return false;
    tx.set(ref, { entries: fresh.filter((e) => e !== target), updatedAt: Date.now() }, { merge: true });
    return true;
  });
}
