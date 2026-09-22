// src/lib/eventGroups.ts
//
// 기간·반복으로 만들어져 여러 날에 걸쳐 있는 일정 묶음을 다룬다.
//
// 묶음은 만들 때 붙인 groupId 하나로 알아본다. V3도 같은 필드를 쓴다
// (js/modules/multiEvent.js의 executeGroupSave). 묶음에 든 일정을 지울 때
// '이 날만'인지 '이 날부터'인지 '전부'인지 고를 수 있어야 하는데, 그러려면
// 같은 groupId를 가진 일정이 어느 날짜에 있는지 먼저 찾아야 한다.
//
// 일정은 events/{날짜} 문서 안의 배열에 들어 있어서 서버에서 골라낼 수 없다.
// 그래서 V3와 같이 날짜 문서를 훑어 배열 안을 직접 본다.
import { collection, doc, getDocsFromServer, writeBatch, type CollectionReference } from 'firebase/firestore';
import { db, auth } from './firebase';
import { eventDocPayload, readEventList } from './eventText';
import { moveToTrash } from '../utils/trashHelper';

/** 한 번에 커밋할 문서 수. Firestore 일괄 쓰기 한도(500)보다 넉넉히 낮춘다. */
const BATCH_CHUNK = 400;

/** 기간 일정 본문 뒤에 붙는 '(3/10)' 표시 */
const NUMBER_SUFFIX = /\s*\(\d+\/\d+\)\s*$/;

/** '(3/10)'을 떼어낸 본래 내용. 기간 일정을 다시 등록할 때 번호가 겹치지 않게 한다. */
export function baseContentOf(content: unknown): string {
  return String(content ?? '').replace(NUMBER_SUFFIX, '').trim();
}

/** 이 일정이 기간·반복 묶음에 속해 있는가. 속해 있으면 묶음 id를 준다. */
export function groupIdOf(item: any): string | null {
  const id = item?.groupId;
  return id ? String(id) : null;
}

/** 일정이 들어 있는 컬렉션. fId가 'personal'이거나 비어 있으면 개인 공간이다. */
export function eventsColRef(fId: string | null | undefined): CollectionReference | null {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  return fId && fId !== 'personal'
    ? collection(db, 'groups', fId, 'events')
    : collection(db, 'users', uid, 'events');
}

export interface GroupHit {
  dateStr: string;
  /** 그 날짜 문서의 일정 전체. 지울 때 남길 것을 여기서 걸러낸다. */
  list: any[];
  /** 그중 이 묶음에 속한 것 */
  items: any[];
}

/**
 * 같은 묶음에 속한 일정을 날짜 순으로 모두 찾는다.
 *
 * ⚠️ 반드시 서버에서 읽는다. 여기서 읽은 목록은 지울 때 '남길 것'으로 그대로
 *    다시 써진다. 캐시가 비었거나 뒤처진 답을 믿으면 (인터넷 사용 기록을 지운
 *    직후가 그렇다) 그 사이 다른 데서 더한 일정까지 함께 지워진다.
 *    못 읽으면 던진다 - 모르는 채로 지우느니 아무것도 안 하는 편이 낫다.
 */
export async function findGroupEvents(
  fId: string | null | undefined,
  groupId: string
): Promise<GroupHit[]> {
  const col = eventsColRef(fId);
  if (!col || !groupId) return [];

  const snap = await getDocsFromServer(col);
  const hits: GroupHit[] = [];
  snap.forEach((docSnap) => {
    const list = readEventList(docSnap.data());
    const items = list.filter((e: any) => groupIdOf(e) === groupId);
    if (items.length > 0) hits.push({ dateStr: docSnap.id, list, items });
  });
  return hits.sort((a, b) => (a.dateStr < b.dateStr ? -1 : 1));
}

/** 기준 날짜와 그 이후의 것만 */
export function hitsFrom(hits: GroupHit[], baseDateStr: string): GroupHit[] {
  return hits.filter((h) => h.dateStr >= baseDateStr);
}

/** 일정 건수 (날짜 수가 아니다 - 한 날짜에 두 건 있을 수 있다) */
export function countGroupItems(hits: GroupHit[]): number {
  return hits.reduce((n, h) => n + h.items.length, 0);
}

/**
 * 찾아 둔 묶음 일정을 지운다. 지운 건수를 준다.
 *
 * 한 건 삭제와 같게 휴지통을 먼저 거친다. 여러 날을 한꺼번에 지우는 일이라
 * 되돌릴 길이 없으면 잘못 고른 한 번이 그대로 손해가 된다.
 */
export async function deleteGroupEvents(
  fId: string | null | undefined,
  hits: GroupHit[]
): Promise<number> {
  const col = eventsColRef(fId);
  if (!col || hits.length === 0) return 0;

  for (const hit of hits) {
    for (const item of hit.items) {
      try {
        await moveToTrash({
          id: String(item.id),
          type: 'event',
          originalDateStr: hit.dateStr,
          fId: fId || 'personal',
          content: String(item.content ?? ''),
          data: item,
        });
      } catch (err) {
        // 휴지통에 못 넣더라도 삭제 자체는 이어 간다. 여기서 멈추면 일부만 지워진 채로 남는다.
        console.error('휴지통으로 옮기지 못했습니다:', err);
      }
    }
  }

  for (let i = 0; i < hits.length; i += BATCH_CHUNK) {
    const batch = writeBatch(db);
    for (const hit of hits.slice(i, i + BATCH_CHUNK)) {
      const ids = new Set(hit.items.map((it) => String(it.id)));
      const rest = hit.list.filter((e: any) => !ids.has(String(e.id)));
      batch.set(doc(col, hit.dateStr), eventDocPayload(rest), { merge: true });
    }
    await batch.commit();
  }

  return countGroupItems(hits);
}
