// src/lib/eventDocOps.ts
//
// 하루치 일정 문서(`{sp}/events/{날짜}`)에서 **항목 하나만** 고치거나 지우는 공용 길.
//
// 주간·월간(useCalendarData)과 년간(YearScreen)이 같은 코드를 따로 들고 있었는데, 둘 다 캐시(getDoc)로 읽어
// 그날 목록을 통째로 다시 썼다. 캐시가 '없다'고 하면 빈 목록을 써서 그날 일정이 모두 사라졌고(2026-09-22 사고와
// 같은 모양), 휴지통에는 지운 뒤에 넣어 그게 실패하면 되돌릴 길이 없었다. 년간의 완료 표시는 readEventList도
// 쓰지 않아 id 없는 V3 항목을 못 찾았다.
import { doc, runTransaction, type DocumentReference } from 'firebase/firestore';
import { db, auth } from './firebase';
import { eventDocPayload, readEventList, eventContentOf } from './eventText';
import { getDocTrustingServer } from './firestoreSubscribe';
import { addDays, daysBetween } from './dateUtils';
import { moveToTrash } from '../utils/trashHelper';
import { addReverseLink } from '../utils/linkUtils';

/**
 * 트랜잭션으로 서버의 지금 목록에서 그 항목만 바꾼다. 나머지는 서버에 있는 그대로 둔다.
 * 항목을 찾아 바꿨으면 true.
 */
export async function updateEventInDoc(
  ref: DocumentReference,
  eventId: string,
  change: (item: any) => any
): Promise<boolean> {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return false;
    const list = readEventList(snap.data());
    let found = false;
    const next = list.map((item: any) => {
      if (String(item.id) !== String(eventId)) return item;
      found = true;
      return change(item);
    });
    if (!found) return false;
    tx.set(ref, eventDocPayload(next), { merge: true });
    return true;
  });
}

export class TrashFailedError extends Error {
  constructor(cause: unknown) {
    super('휴지통에 옮기지 못해 지우지 않았습니다.');
    this.name = 'TrashFailedError';
    (this as any).cause = cause;
  }
}

/**
 * 일정 하나를 휴지통에 넣고(먼저), 트랜잭션으로 서버의 지금 목록에서 그 항목만 뺀다.
 * 휴지통에 못 넣으면 지우지 않고 TrashFailedError를 던진다.
 */
export async function deleteEventFromDoc(
  ref: DocumentReference,
  opts: { dateStr: string; fId: string; eventId: string; fallbackItem?: any }
): Promise<void> {
  const { dateStr, fId, eventId, fallbackItem } = opts;
  const { snap } = await getDocTrustingServer(ref);
  const list = snap.exists() ? readEventList(snap.data()) : [];
  const removed = list.find((item: any) => String(item.id) === String(eventId)) || fallbackItem;
  if (removed) {
    try {
      await moveToTrash({
        id: String(eventId),
        type: 'event',
        originalDateStr: dateStr,
        fId: fId || 'personal',
        content: (removed as any).content || '',
        data: removed,
      });
    } catch (err) {
      throw new TrashFailedError(err);
    }
  }
  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists()) return;
    const cur = readEventList(fresh.data());
    const kept = cur.filter((item: any) => String(item.id) !== String(eventId));
    if (kept.length === cur.length) return;
    tx.set(ref, eventDocPayload(kept), { merge: true });
  });
}

// ── 다른 날짜로 옮기기 ───────────────────────────────────────────────

/** "YYYY-MM-DDTHH:mm" 알림 시각을 날 수만큼 옮긴다. 모양이 다르면 그대로 둔다. */
export function shiftAlarmTime(time: string, days: number): string {
  if (!days || !/^\d{4}-\d{2}-\d{2}T/.test(time)) return time;
  return addDays(time.slice(0, 10), days) + time.slice(10);
}

const freshEventId = () => 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);

export interface MoveEventOptions {
  /** 'personal' 또는 공유 그룹 id - 옮기기는 같은 공간 안에서만 한다 */
  fId: string;
  fromDate: string;
  toDate: string;
  eventId: string;
  /** 옮기면서 함께 고칠 것 (쓰는 칸에서 날짜와 내용을 같이 고쳐 저장할 때) */
  patch?: Record<string, any>;
  /** 알림도 같은 날 수만큼 옮기나. 쓰는 칸에서 알림 시각을 새로 정했으면 false (정한 시각 그대로). 기본 true */
  shiftAlarm?: boolean;
}

export interface MoveEventResult {
  /** 옮긴 뒤의 id. 새 날짜에 같은 id가 이미 있을 때만 새 id를 붙인다. */
  id: string;
  item: any;
}

/**
 * 일정 하나를 같은 공간의 다른 날짜로 옮긴다. 옮긴 일정을 못 찾으면 null.
 *
 * - 두 날짜 문서를 **한 트랜잭션**에서 서버로 읽고, 옛 날짜에서 그 항목만 빼고 새 날짜 목록 끝에 넣는다.
 *   나머지는 서버에 있는 그대로 둔다(ARCHITECTURE 4-1). 두 필드(eventList·eventText)를 함께 쓴다(4-4).
 *   서버가 답하지 않으면 트랜잭션이 실패하고 아무것도 바뀌지 않는다 - 오류를 던진다.
 * - id는 그대로 둔다. 구글 캘린더 보내기(sp_id)와 링크가 id로 알아본다. 다만 V3가 id 없이 쓴 일정은 날마다
 *   ev_0, ev_1 …로 읽히므로 새 날짜에 같은 id가 있으면 새 id를 붙인다.
 * - 이월 사슬(forwardChainId/originalDate)은 그대로 둔다. V3가 찍는 date 칸이 있으면 새 날짜로.
 * - 알림은 같은 날 수만큼 옮기고, 옮긴 시각이 아직 오지 않았으면 다시 울리게 한다.
 * - 이 일정에 걸린 상대 항목의 역링크는 옛 자리(id·날짜)를 새 자리로 고친다. 역링크 고치기가 실패해도
 *   옮기기는 이미 끝났으므로 되돌리지 않는다(링크 창에서 다시 이을 수 있다).
 */
export async function moveEventToDate(opts: MoveEventOptions): Promise<MoveEventResult | null> {
  const { fId, fromDate, toDate, eventId, patch, shiftAlarm = true } = opts;
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요합니다.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate)) throw new Error('옮길 날짜가 올바르지 않습니다.');
  const ref = (date: string) =>
    fId && fId !== 'personal' ? doc(db, 'groups', fId, 'events', date) : doc(db, 'users', uid, 'events', date);
  const days = daysBetween(fromDate, toDate);

  const result = await runTransaction(db, async (tx) => {
    const fromRef = ref(fromDate);
    const fromSnap = await tx.get(fromRef);
    if (!fromSnap.exists()) return null;
    const fromList = readEventList(fromSnap.data());
    const original: any = fromList.find((item: any) => String(item.id) === String(eventId));
    if (!original) return null;

    let moved: any = { ...original, ...(patch || {}) };
    if (patch && patch.content !== undefined) moved.text = patch.content; // V3·백업이 text를 읽는다
    if (days === 0) {
      // 날짜가 같으면 고치기만 한다
      const next = fromList.map((item: any) => (String(item.id) === String(eventId) ? moved : item));
      tx.set(fromRef, eventDocPayload(next), { merge: true });
      return { id: String(eventId), item: moved };
    }

    const toRef = ref(toDate);
    const toSnap = await tx.get(toRef);
    const toList = toSnap.exists() ? readEventList(toSnap.data()) : [];
    const clash = toList.some((item: any) => String(item.id) === String(original.id));
    moved = { ...moved, id: clash ? freshEventId() : String(original.id) };
    if ('date' in moved) moved.date = toDate;
    if (shiftAlarm && moved.time) {
      moved.time = shiftAlarmTime(String(moved.time), days);
      if (new Date(moved.time).getTime() > Date.now()) moved.alarmTriggered = false;
    }
    for (const k of Object.keys(moved)) if (moved[k] === undefined) delete moved[k];

    tx.set(fromRef, eventDocPayload(fromList.filter((item: any) => String(item.id) !== String(eventId))), { merge: true });
    tx.set(toRef, eventDocPayload([...toList, moved]), { merge: true });
    return { id: String(moved.id), item: moved };
  });
  if (!result || days === 0) return result;

  const links: any[] = Array.isArray(result.item.linkedItems) ? result.item.linkedItems : [];
  if (links.length > 0) {
    const sourceMeta = {
      targetType: 'event',
      targetId: result.id,
      targetDate: toDate,
      title: `[${toDate}] ${eventContentOf(result.item)}`,
      targetFId: fId || 'personal',
    };
    for (const link of links) {
      await addReverseLink(link, sourceMeta as any, fId || 'personal', {
        movedFrom: { id: String(eventId), date: fromDate },
      });
    }
  }
  return result;
}

export interface GroupMoveResult {
  /** 고치던 일정(맨 먼저 옮긴다)의 옮긴 결과 */
  current: MoveEventResult;
  /** 옮긴 건수 (고치던 일정 포함) */
  moved: number;
  /** 옮기지 못한 건수 */
  failed: number;
}

/**
 * 기간·반복 묶음의 일정 여럿을 같은 날 수만큼 옮긴다.
 *
 * 고치던 일정을 **맨 먼저** 옮긴다 - 그것이 실패하면 아무것도 옮기지 않고 던진다(칸이 그 자리에 남는다).
 * 나머지는 날짜 순으로 하나씩(한 건 = 두 날짜 문서 한 트랜잭션). 같은 묶음끼리 서로의 날짜로 옮겨 가도
 * id로 짝을 맞추므로 차례와 상관없이 맞다. 중간에 몇 건이 실패하면 옮긴 것은 그대로 두고 failed로 알린다
 * (여러 날을 한꺼번에 되돌릴 길이 없어, 다시 옮기기를 누르면 남은 것만 옮겨진다).
 * 쓰는 칸에서 고친 내용(patch)은 고치던 일정에만 쓴다 - 기간 일정은 날마다 '(3/5)' 번호가 달라 같은 글로 덮으면 안 된다.
 */
export async function moveGroupEvents(opts: {
  fId: string;
  items: Array<{ fromDate: string; id: string }>;
  days: number;
  current: { fromDate: string; id: string; patch?: Record<string, any>; shiftAlarm?: boolean };
}): Promise<GroupMoveResult> {
  const { fId, items, days, current } = opts;
  const first = await moveEventToDate({
    fId,
    fromDate: current.fromDate,
    toDate: addDays(current.fromDate, days),
    eventId: current.id,
    patch: current.patch,
    shiftAlarm: current.shiftAlarm,
  });
  if (!first) throw new Error('옮길 일정을 찾지 못했습니다. 그 사이 지워졌거나 다른 날로 옮겨졌을 수 있습니다.');

  let moved = 1;
  let failed = 0;
  const rest = items
    .filter((it) => !(it.fromDate === current.fromDate && String(it.id) === String(current.id)))
    .sort((a, b) => (a.fromDate < b.fromDate ? -1 : a.fromDate > b.fromDate ? 1 : 0));
  for (const it of rest) {
    try {
      const r = await moveEventToDate({ fId, fromDate: it.fromDate, toDate: addDays(it.fromDate, days), eventId: it.id });
      if (r) moved += 1;
    } catch (err) {
      failed += 1;
      console.error('묶음 일정을 옮기지 못했습니다:', it, err);
    }
  }
  return { current: first, moved, failed };
}
