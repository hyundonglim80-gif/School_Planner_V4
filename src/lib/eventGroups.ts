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
import { collection, doc, getDocsFromServer, runTransaction, type CollectionReference } from 'firebase/firestore';
import { db, auth } from './firebase';
import { readEventList } from './eventText';
import { moveToTrash } from '../utils/trashHelper';
import { addDays } from './dateUtils';
import { setEventDoc } from './gcalNote';

/** 날짜 문서를 한 번에 몇 개씩 고칠지 (날짜마다 트랜잭션 하나) */
const PARALLEL_DATES = 8;

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
 * 찾아 둔 묶음 일정을 지운다. 지운 건수와 휴지통 문서 id들(지운 뒤 안내의 '되돌리기')을 준다.
 *
 * 한 건 삭제와 같게 휴지통을 먼저 거친다. 여러 날을 한꺼번에 지우는 일이라
 * 되돌릴 길이 없으면 잘못 고른 한 번이 그대로 손해가 된다.
 *
 * ⚠️ 예전에는 창을 열 때 읽어 둔 그날 목록(hit.list)에서 묶음 일정을 뺀 것을 일괄로 덮어써서,
 *    창을 연 채 고민하는 사이 그 날짜들에 더해진 일정(다른 기기·V3·다른 칸)이 사라졌다.
 *    그리고 휴지통에 못 넣은 일정도 지워서 되돌릴 길이 없었다.
 *    이제 휴지통에 넣은 것만, 날짜마다 트랜잭션으로 서버의 지금 목록에서 뺀다.
 *    휴지통에 못 넣은 것이 있으면 그것은 남기고 오류를 던진다.
 */
export async function deleteGroupEvents(
  fId: string | null | undefined,
  hits: GroupHit[]
): Promise<{ removed: number; trashIds: string[] }> {
  const col = eventsColRef(fId);
  if (!col || hits.length === 0) return { removed: 0, trashIds: [] };
  const trashIds: string[] = [];

  const trashedByDate = new Map<string, Set<string>>();
  let failed = 0;
  for (const hit of hits) {
    for (const item of hit.items) {
      try {
        const trashId = await moveToTrash({
          id: String(item.id),
          type: 'event',
          originalDateStr: hit.dateStr,
          fId: fId || 'personal',
          content: String(item.content ?? ''),
          data: item,
        });
        if (trashId) trashIds.push(trashId);
        if (!trashedByDate.has(hit.dateStr)) trashedByDate.set(hit.dateStr, new Set());
        trashedByDate.get(hit.dateStr)!.add(String(item.id));
      } catch (err) {
        failed += 1;
        console.error('휴지통으로 옮기지 못했습니다:', err);
      }
    }
  }

  let removed = 0;
  const dates = [...trashedByDate.entries()];
  for (let i = 0; i < dates.length; i += PARALLEL_DATES) {
    const counts = await Promise.all(
      dates.slice(i, i + PARALLEL_DATES).map(([dateStr, ids]) =>
        runTransaction(db, async (tx) => {
          const ref = doc(col, dateStr);
          const snap = await tx.get(ref);
          if (!snap.exists()) return 0;
          const cur = readEventList(snap.data());
          const rest = cur.filter((e: any) => !ids.has(String(e.id)));
          if (rest.length === cur.length) return 0;
          setEventDoc(tx, ref, rest);
          return cur.length - rest.length;
        })
      )
    );
    removed += counts.reduce((n, c) => n + c, 0);
  }

  if (failed > 0) {
    throw new Error(`${failed}건은 휴지통에 옮기지 못해 지우지 않았습니다 (${removed}건은 지웠습니다). 네트워크를 확인해 주세요.`);
  }
  return { removed, trashIds };
}

// ── 묶음 옮기기 ─────────────────────────────────────────────────────

export interface GroupMovePlanItem {
  fromDate: string;
  toDate: string;
  id: string;
  content: string;
}

/** 찾아 둔 묶음 일정을 같은 날 수만큼 옮기면 어디서 어디로 가는지 (날짜 순) */
export function planGroupMove(hits: GroupHit[], days: number): GroupMovePlanItem[] {
  return hits.flatMap((hit) =>
    hit.items.map((item: any) => ({
      fromDate: hit.dateStr,
      toDate: addDays(hit.dateStr, days),
      id: String(item.id),
      content: String(item.content ?? item.text ?? ''),
    }))
  );
}
