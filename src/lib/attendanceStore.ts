// src/lib/attendanceStore.ts
//
// 출석부를 읽고 쓴다. 규칙(분류·합계·글)은 lib/attendance에 있다.
//
// ⚠️ 쓸 때는 바뀐 학생만 고친다(mergeFields + deleteField).
//    그날 문서를 통째로 덮어쓰면, 기기 캐시가 비어 '문서 없음'으로 읽힌 채
//    저장했을 때 다른 기기에서 적어 둔 출결이 사라진다.
import { collection, deleteField, doc, FieldPath, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db, auth } from './firebase';
import { getDocTrustingServer } from './firestoreSubscribe';
import {
  attendanceDocId,
  dayJournalText,
  type AttendanceDay,
  type AttendanceRecord,
} from './attendance';
import { autoJournalId, upsertAutoJournal } from './autoJournal';

function attendanceCol() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요합니다.');
  return collection(db, 'users', uid, 'attendance');
}

export interface ClassInfo {
  classKey: string;
  year: number;
  grade: string;
  classNum: string;
}

export async function loadAttendanceDay(cls: ClassInfo, date: string): Promise<AttendanceDay> {
  const { snap } = await getDocTrustingServer(doc(attendanceCol(), attendanceDocId(cls.classKey, date)));
  const data = snap.exists() ? (snap.data() as any) : null;
  return { ...cls, date, records: data?.records || {}, updatedAt: data?.updatedAt };
}

/** 학급의 출결 문서를 모두 (날짜 차례로) */
export async function loadAttendanceForClass(classKey: string): Promise<AttendanceDay[]> {
  const snap = await getDocs(query(attendanceCol(), where('classKey', '==', classKey)));
  return snap.docs
    .map((d) => d.data() as AttendanceDay)
    .filter((d) => d && d.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 그날 출결을 저장한다. before(불러왔을 때)와 달라진 학생만 고친다.
 * 저장한 뒤 그날 기록 칸의 '[출결]' 항목도 맞춘다 (모두 출석이면 뺀다).
 */
export async function saveAttendanceDay(
  cls: ClassInfo,
  date: string,
  before: Record<string, AttendanceRecord>,
  after: Record<string, AttendanceRecord>
): Promise<void> {
  const changes: Record<string, unknown> = {};
  const nums = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const n of nums) {
    const a = after[n];
    if (!a) {
      if (before[n]) changes[n] = deleteField();
      continue;
    }
    if (JSON.stringify(a) !== JSON.stringify(before[n])) changes[n] = cleanRecord(a);
  }

  if (Object.keys(changes).length > 0) {
    // mergeFields로 '바뀐 학생의 칸'만 통째로 갈아 끼운다. merge: true 로 쓰면
    // 학생 칸 안까지 합쳐져서, 지각을 결석으로 바꿔도 옛 교시가 남는다.
    await setDoc(
      doc(attendanceCol(), attendanceDocId(cls.classKey, date)),
      { ...cls, date, records: changes, updatedAt: Date.now() },
      {
        mergeFields: [
          'classKey', 'year', 'grade', 'classNum', 'date', 'updatedAt',
          ...Object.keys(changes).map((n) => new FieldPath('records', n)),
        ],
      }
    );
  }

  await upsertAutoJournal({
    kind: 'attendance',
    // 출석부는 개인 공간에만 있으므로 기록도 개인 공간에 남긴다
    groupId: null,
    dateStr: date,
    entryId: autoJournalId('attendance', cls.classKey),
    content: dayJournalText({ ...cls, date, records: after }),
  });
}

/** Firestore는 undefined를 받지 않는다. 빈 값은 키째로 뺀다. */
function cleanRecord(r: AttendanceRecord): AttendanceRecord {
  return {
    num: r.num,
    name: r.name,
    kind: r.kind,
    reason: r.reason,
    ...(r.periods && r.periods.length ? { periods: [...r.periods].sort((a, b) => a - b) } : {}),
    ...(r.note && r.note.trim() ? { note: r.note.trim() } : {}),
  };
}
