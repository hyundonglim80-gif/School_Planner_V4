// src/lib/eventDueStore.ts
//
// 이월 사슬마다 기한 (ROADMAP 11-2). 셈은 lib/eventDue.
//
//   개인   users/{uid}/settings/v4_eventDue      { dues: { [forwardChainId]: 'YYYY-MM-DD' } }
//   그룹   groups/{gid}/settings/v4_eventDue      (그룹 일정의 사슬)
//
// V4 전용. V3가 이월하며 due를 빼먹은 일정도 사슬 id로 기한을 찾게 한다. 한 사슬씩 merge로 쓰고 뺀다.
import { deleteField, doc, setDoc, type DocumentData } from 'firebase/firestore';
import { db } from './firebase';
import { subscribeDocWithServerFallback } from './firestoreSubscribe';
import { isDueDate, type DueMap } from './eventDue';

const dueRef = (uid: string, groupId: string | null) =>
  groupId ? doc(db, 'groups', groupId, 'settings', 'v4_eventDue') : doc(db, 'users', uid, 'settings', 'v4_eventDue');

export function sanitizeDueMap(raw: unknown): DueMap {
  const out: DueMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isDueDate(v)) out[k] = v;
  return out;
}

export function subscribeEventDues(
  uid: string,
  groupId: string | null,
  onData: (map: DueMap) => void,
  onError?: (err: unknown) => void
): () => void {
  return subscribeDocWithServerFallback(dueRef(uid, groupId), (data: DocumentData | null) => onData(sanitizeDueMap(data?.dues)), onError);
}

/** 사슬 하나의 기한을 쓰거나(날짜) 뺀다(''). 실패하면 던진다 */
export async function setChainDue(uid: string, groupId: string | null, chainId: string, due: string): Promise<void> {
  await setDoc(
    dueRef(uid, groupId),
    { dues: { [chainId]: isDueDate(due) ? due : deleteField() }, updatedAt: Date.now() },
    { merge: true }
  );
}
