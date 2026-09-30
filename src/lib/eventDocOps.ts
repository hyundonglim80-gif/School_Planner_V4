// src/lib/eventDocOps.ts
//
// 하루치 일정 문서(`{sp}/events/{날짜}`)에서 **항목 하나만** 고치거나 지우는 공용 길.
//
// 주간·월간(useCalendarData)과 년간(YearScreen)이 같은 코드를 따로 들고 있었는데, 둘 다 캐시(getDoc)로 읽어
// 그날 목록을 통째로 다시 썼다. 캐시가 '없다'고 하면 빈 목록을 써서 그날 일정이 모두 사라졌고(2026-09-22 사고와
// 같은 모양), 휴지통에는 지운 뒤에 넣어 그게 실패하면 되돌릴 길이 없었다. 년간의 완료 표시는 readEventList도
// 쓰지 않아 id 없는 V3 항목을 못 찾았다.
import { runTransaction, type DocumentReference } from 'firebase/firestore';
import { db } from './firebase';
import { eventDocPayload, readEventList } from './eventText';
import { getDocTrustingServer } from './firestoreSubscribe';
import { moveToTrash } from '../utils/trashHelper';

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
