// src/lib/trashRestore.ts
//
// 휴지통 항목을 원래 자리로 되살린다. 휴지통 창(TrashModal)의 '복원'과, 지운 뒤 안내의 '되돌리기'(lib/undoToast)가
// 같은 길을 쓴다 - 자리마다 따로 두면 한 곳만 고쳐진다.
import { doc, getDoc, setDoc, runTransaction } from 'firebase/firestore';
import { db, auth } from './firebase';
import { completeRestoreFromTrash, type TrashItem } from '../utils/trashHelper';
import { readEventList } from './eventText';
import { readJournalEntries } from './journalEntries';
import { readEvalList, evalDocPayload } from './evalList';
import { syncAutoSourceAndTell } from './autoJournalSync';
import { restoreClipFromTrash } from './clipboardHistory';
import { restoreProgressPlan } from './progress';
import { restoreGroupSet, restoreSeatingChart } from './seatingStore';
import { getDocTrustingServer } from './firestoreSubscribe';
import { setEventDoc } from './gcalNote';

/** 클립보드 휴지통 항목은 계정 휴지통과 id가 겹치지 않게 앞에 붙인다 (TrashModal이 목록을 만들 때) */
export const CLIP_TRASH_PREFIX = 'clip:';

/** 휴지통 항목 하나를 원래 자리에 되살리고 휴지통에서 뺀다. 못 하면 던진다. */
export async function restoreTrashItem(item: TrashItem): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  if (item.type === 'clip') {
    await restoreClipFromTrash(item.id.slice(CLIP_TRASH_PREFIX.length));
    return;
  }

  // 💡 V3는 같은 문서를 dateStr 이라는 이름으로 쓴다. 둘 다 받아준다.
  const { type, fId, data } = item;
  const originalDateStr = item.originalDateStr || (item as any).dateStr;
  const isGroup = fId && fId !== 'personal';

  if (type === 'memo') {
    const targetRef = isGroup
      ? doc(db, 'groups', fId, 'tasks', data.firestoreId || item.id)
      : doc(db, 'users', user.uid, 'tasks', data.firestoreId || item.id);
    const { firestoreId, ...memoData } = data;
    await setDoc(targetRef, memoData, { merge: true });
  } else if (type === 'event' || type === 'journal') {
    if (!originalDateStr) throw new Error('원래 날짜 정보가 없어 복원할 수 없습니다.');
    const col = type === 'event' ? 'events' : 'journals';
    const targetRef = isGroup
      ? doc(db, 'groups', fId, col, originalDateStr)
      : doc(db, 'users', user.uid, col, originalDateStr);

    // ⚠️ 그날 배열은 트랜잭션으로 서버의 지금 목록을 읽고 되살릴 한 건만 더한다.
    //    예전에는 getDoc(캐시)으로 읽어 통째로 써서, 캐시가 '없다'고 하면 되살린 한 건만 든 배열로
    //    그날 다른 일정·기록을 덮을 수 있었다(2026-09-22 하루치가 사라진 사고와 같은 모양).
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(targetRef);
      const currentData = snap.exists() ? snap.data() : {};
      if (type === 'event') {
        // V3 옛 글(eventText)만 있는 날이면 그것을 목록으로 읽는다. eventList만 보면 빈 목록 위에
        // 되살린 한 건만 써서, 그날 V3 일정이 모두 사라진다.
        const list = readEventList(currentData);
        // 이미 돌아와 있으면(두 번 누름·다른 기기에서 먼저 복원) 또 넣지 않는다
        if (!list.some((e: any) => String(e?.id) === String(data?.id))) list.push(data);
        setEventDoc(tx, targetRef, list);
      } else {
        // id 없는 옛 기록은 화면과 같은 이름(jr_차례)으로 맞춘다
        const entries = readJournalEntries(currentData);
        if (!entries.some((e: any) => String(e?.id) === String(data?.id))) entries.push(data);
        tx.set(targetRef, { entries, updatedAt: Date.now() }, { merge: true });
      }
    });
    if (type === 'journal') {
      // 알림장·출결 자동 항목이면 지울 때 비웠던 알림장·출석부도 되살린다
      await syncAutoSourceAndTell({
        entry: data,
        groupId: isGroup ? fId : null,
        dateStr: originalDateStr,
        content: String(data?.content || ''),
        restored: true,
      });
    }
  } else if (type === 'eval') {
    if (!originalDateStr) throw new Error('원래 날짜 정보가 없어 복원할 수 없습니다.');
    const targetRef = isGroup
      ? doc(db, 'groups', fId, 'evaluations', originalDateStr)
      : doc(db, 'users', user.uid, 'evaluations', originalDateStr);
    // V3는 evalList만 읽는다. list만 쓰던 탓에 되살린 조사표가 V3에 안 보였고, V3가 쓴 조사표가 있는 날은
    // 옛 list 위에 더해 V3 것이 가려졌다. 두 이름을 가려 읽고(readEvalList) 두 이름에 함께 쓴다.
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(targetRef);
      const list = snap.exists() ? [...readEvalList(snap.data())] : [];
      if (!list.some((e: any) => e.id === data.id)) list.push(data);
      tx.set(targetRef, evalDocPayload(list), { merge: true });
    });
  } else if (type === 'dday') {
    const prefRef = doc(db, 'users', user.uid, 'settings', 'preferences');
    // V3의 설정 문서다. 트랜잭션으로 서버의 지금 목록에 한 건만 더한다
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(prefRef);
      const dDayList = snap.exists() && Array.isArray(snap.data().dDayList) ? [...snap.data().dDayList] : [];
      if (!dDayList.some((d: any) => d.id === data.id)) dDayList.push(data);
      tx.set(prefRef, { dDayList }, { merge: true });
    });
  } else if (type === 'roster') {
    const rosterRef = doc(db, 'users', user.uid, 'settings', 'rosters');
    const snap = await getDoc(rosterRef);
    const list: any[] = snap.exists() ? (snap.data().classList || snap.data().rosters || []) : [];
    const keyOf = (c: any) => `${c.year}_${c.grade}_${c.classNum}`;

    if (data.kind === 'class') {
      const key = keyOf(data.class);
      if (!list.some((c) => keyOf(c) === key)) list.push(data.class);
    } else {
      const key = keyOf(data.classKey);
      const target = list.find((c) => keyOf(c) === key);
      if (target) {
        target.students = target.students || [];
        if (!target.students.some((s: any) => s.num === data.student.num)) {
          target.students.push(data.student);
        }
      } else {
        // 학급 자체도 함께 삭제되어 없는 경우, 학생만 담을 새 학급을 만들어 복원한다.
        list.push({ ...data.classKey, students: [data.student] });
      }
    }
    await setDoc(rosterRef, { classList: list, rosters: list, updatedAt: Date.now() }, { merge: true });
  } else if (type === 'label') {
    const labelRef = doc(db, 'users', user.uid, 'settings', 'labels');
    const snap = await getDoc(labelRef);
    const cur = snap.exists() ? snap.data() : {};
    const field = data.kind === 'event' ? 'eventLabels' : data.kind === 'journal' ? 'journalLabels' : 'memoLabels';
    const list: any[] = cur[field] || [];
    if (!list.some((l: any) => l.id === data.label.id)) list.push(data.label);
    const payload: any = { [field]: list, updatedAt: Date.now() };
    if (field === 'eventLabels') payload.labels = list; // V3 호환성
    await setDoc(labelRef, payload, { merge: true });
  } else if (type === 'template') {
    const tplRef = doc(db, 'users', user.uid, 'settings', 'timetable_v5');
    const snap = await getDoc(tplRef);
    const templates = snap.exists() ? (snap.data().templates || {}) : {};
    const name = templates[data.name] ? `${data.name} (복원됨)` : data.name;
    templates[name] = data.template;
    await setDoc(tplRef, { templates, updatedAt: Date.now() }, { merge: true });
  } else if (type === 'progress') {
    // 진도 관리 (V4 전용 v4_progress). 같은 id가 이미 있으면 새 id로 되살린다
    await restoreProgressPlan(user.uid, data);
  } else if (type === 'seating') {
    // 자리표 (V4 전용 v4_seating). 같은 id가 이미 있으면 새 id로 되살린다
    await restoreSeatingChart(user.uid, data);
  } else if (type === 'groupSet') {
    // 모둠 (V4 전용 v4_classHub.groupSets). 같은 id가 이미 있으면 새 id로 되살린다
    await restoreGroupSet(user.uid, data);
  } else {
    throw new Error('이 항목 유형은 아직 복원을 지원하지 않습니다.');
  }

  await completeRestoreFromTrash(item.id);
}

export interface RestoreByIdResult {
  restored: number;
  /** 휴지통에 이미 없던 것 (휴지통 창에서 먼저 되살렸거나 비움) */
  missing: number;
}

/**
 * 휴지통 문서 id로 되살린다 (지운 뒤 안내의 '되돌리기').
 * 휴지통 문서는 서버에서 읽는다 - 캐시가 '없다'고 하면 되살릴 것을 놓친다. 하나라도 못 되살리면 던진다.
 */
export async function restoreTrashIds(trashIds: string[]): Promise<RestoreByIdResult> {
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  const result: RestoreByIdResult = { restored: 0, missing: 0 };
  // 같은 날짜 문서를 여럿이 건드릴 수 있어 하나씩 (휴지통 창의 일괄 복원과 같다)
  for (const id of trashIds) {
    const { snap } = await getDocTrustingServer(doc(db, 'users', user.uid, 'trash', id));
    if (!snap.exists()) {
      result.missing += 1;
      continue;
    }
    await restoreTrashItem({ ...(snap.data() as TrashItem), id });
    result.restored += 1;
  }
  return result;
}
