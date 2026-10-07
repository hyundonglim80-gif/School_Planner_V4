// src/lib/moveEntry.ts
//
// 메모·기록의 '자리 옮기기' (19번 U7 - 날짜 칸 = 자리). 쓰는 칸의 '📅 날짜'를 넣고 빼면 항목이 옮겨 간다:
//   메모 → 기록(그 날짜) / 기록 → 메모(날짜 빼기) / 기록 → 다른 날짜의 기록.
// 일정은 옮기지 않는다(라벨 속성·기간/반복 묶음이 있어서 - 사용자와 정함).
//
// 칸은 모두 옮긴다: 글·라벨(메모·기록 라벨은 한 목록 - 19번 U5)·첨부·표·링크·완료·즐겨찾기·처음 쓴 때(createdAt)·keepId.
// 기록 → 메모는 글에 날짜 줄을 더하지 않고 fromDate(V4 전용 칸)에 원래 날짜를 둔다(카드에 '📅 10/6에서'). 메모 → 기록은 fromDate를 뺀다.
//
// 차례: ① 원본을 서버에서 읽는다 → ② 새 자리에 만든다 → ③ 링크로 이어진 상대 쪽의 역링크를 새 항목으로 갈아끼운다
//       → ④ 원본은 휴지통에 넣고('(날짜를 바꿈)') 지운다. ②가 실패하면 원본은 그대로 둔다. 휴지통에 못 넣으면 원본을 지우지 않는다.
// 되돌리기(undoRelocate): 새 항목을 지우고, 휴지통의 원본을 되살리고, 링크를 원본으로 되돌린다.
//
// ⚠️ 기록은 하루치가 journals/{date} 한 배열이다. 캐시로 읽고 쓰면 그날 다른 기록이 사라질 수 있어
//    트랜잭션(늘 서버)으로 읽고 쓰고, 서버가 답하지 않으면 옮기지 않는다(v4-cold-cache-overwrites-day).
import { ensureEntryLabelsQuietly } from './entryLabelSync';
import { addDoc, collection, deleteDoc, doc, runTransaction } from 'firebase/firestore';
import { TABLE_ONLY_CONTENT } from './entryTable';
import { auth, db } from './firebase';
import { autoSourceOf } from './autoJournalSync';
import { moveToTrash } from '../utils/trashHelper';
import { addReverseLink } from '../utils/linkUtils';
import { readJournalEntries } from './journalEntries';
import { restoreTrashIds } from './trashRestore';
import type { JournalEntry } from '../hooks/useDayData';
import type { JournalLabel } from '../hooks/useLabels';

/** 옮길 수 없는 기록인가 (알림장·출석부가 만든 자동 기록 - 옮기면 원본과의 연결이 깨진다) */
export function isMovableJournal(entry: Pick<JournalEntry, 'id'>): boolean {
  return !autoSourceOf(entry as any);
}

const uidOrThrow = () => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요합니다.');
  return uid;
};
const col = (uid: string, groupId: string | null, name: string) =>
  groupId ? collection(db, 'groups', groupId, name) : collection(db, 'users', uid, name);
const dayRef = (uid: string, groupId: string | null, dateStr: string) =>
  groupId ? doc(db, 'groups', groupId, 'journals', dateStr) : doc(db, 'users', uid, 'journals', dateStr);
const memoRef = (uid: string, groupId: string | null, id: string) =>
  groupId ? doc(db, 'groups', groupId, 'tasks', id) : doc(db, 'users', uid, 'tasks', id);

/** Firestore는 undefined를 받지 않는다 */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const newJournalId = () => 'jr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5);
const OFFLINE = '서버에 연결되지 않아 옮기지 못했습니다. 잠시 뒤 다시 해 주세요.';

/** 항목의 자리: 메모(날짜 없음) 또는 그날의 기록 */
export type EntryPlace = { kind: 'memo'; id: string } | { kind: 'journal'; id: string; dateStr: string };

/** 기록 항목의 라벨 이름 (labelIds·label을 라벨 목록으로 푼다 - DayJournal과 같은 규칙) */
export function journalLabelNames(entry: { labelIds?: string[]; label?: string }, journalLabels: JournalLabel[]): string[] {
  const keys = [...(entry.labelIds || []), ...(entry.label ? String(entry.label).split(',') : [])];
  const names: string[] = [];
  for (const key of keys) {
    const k = String(key || '').trim();
    if (!k) continue;
    const found = journalLabels.find((l) => l.id === k || l.name === k);
    if (found && !names.includes(found.name)) names.push(found.name);
  }
  return names;
}

/** 원본 항목 → 옮겨 갈 기록 항목 (모르는 칸은 기록 → 기록일 때만 그대로 둔다) */
export function toJournalEntry(src: any, from: EntryPlace['kind'], names: string[], journalLabels: JournalLabel[], id: string): any {
  const labelIds = names.map((n) => journalLabels.find((l) => l.name === n)?.id).filter((x): x is string => !!x);
  const content = String(src.content ?? src.text ?? '');
  const tables = Array.isArray(src.tables) && src.tables.length > 0 ? src.tables : undefined;
  const base: any = from === 'journal' ? { ...src } : {};
  delete base.fromDate;
  delete base.completed;
  delete base.favorite;
  return clean({
    ...base,
    id,
    // 글 없이 표만 있으면 '[표]' (V3가 빈 기록을 빼지 않게, lib/entryTable)
    content: content.trim() || (tables ? TABLE_ONLY_CONTENT : ''),
    createdAt: src.createdAt || Date.now(),
    label: names[0] || '',
    labelIds,
    imageUrl: src.imageUrl || '',
    attachments: src.attachments || [],
    linkedItems: src.linkedItems || [],
    ...(tables ? { tables } : {}),
    ...(src.completed ? { completed: true } : {}),
    ...(src.favorite ? { favorite: true } : {}),
    ...(src.keepId ? { keepId: src.keepId } : {}),
  });
}

/** 원본 항목 → 옮겨 갈 메모 문서. 기록에서 오면 fromDate에 원래 날짜(글은 바꾸지 않는다) */
export function toMemoDoc(
  src: any,
  names: string[],
  fromDate: string | null,
  author: { uid: string; name: string },
  groupId: string | null,
  now = Date.now()
): any {
  const tables = Array.isArray(src.tables) && src.tables.length > 0 ? src.tables : undefined;
  // 표만 있던 기록의 '[표]'는 메모로 옮기지 않는다
  const raw = String(src.content ?? src.text ?? '');
  const content = raw === TABLE_ONLY_CONTENT && tables ? '' : raw.trim();
  return clean({
    text: content,
    content,
    completed: !!src.completed,
    ...(src.completed ? { completedAt: src.completedAt || now } : {}),
    ...(src.favorite ? { favorite: true } : {}),
    order: -now,
    createdAt: src.createdAt || now,
    labels: names,
    imageUrl: src.imageUrl || '',
    attachments: src.attachments || [],
    linkedItems: src.linkedItems || [],
    ...(tables ? { tables } : {}),
    ...(src.keepId ? { keepId: src.keepId } : {}),
    ...(fromDate ? { fromDate } : {}),
    authorId: src.authorId || author.uid,
    authorName: src.authorName || author.name,
    sharedGroupIds: groupId ? [groupId] : [],
  });
}

/** 링크로 이어진 상대 쪽의 '옛 항목' 역링크를 새 항목으로 갈아끼운다 */
async function retargetLinks(links: any[] | undefined, oldId: string, newMeta: any, fId: string) {
  for (const link of links || []) {
    await addReverseLink(link, newMeta, fId, { retargetFromIds: [oldId] });
  }
}

const linkMeta = (place: EntryPlace, content: string, groupId: string | null) =>
  place.kind === 'memo'
    ? { targetType: 'memo', targetId: place.id, targetDate: '', title: `[메모] ${content.substring(0, 20)}`, targetFId: groupId || 'personal' }
    : {
        targetType: 'journal',
        targetId: place.id,
        targetDate: place.dateStr,
        title: `[${place.dateStr}] ${content.substring(0, 20)}`,
        targetFId: groupId || 'personal',
      };

/** 그날 기록 묶음에서 그 항목을 뺀다 (서버의 지금 목록에서 - 그 사이 더해진 기록은 남는다) */
async function removeJournal(uid: string, groupId: string | null, dateStr: string, id: string) {
  await runTransaction(db, async (tx) => {
    const ref = dayRef(uid, groupId, dateStr);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const entries = readJournalEntries(snap.data());
    const rest = entries.filter((j) => String(j.id) !== String(id));
    if (rest.length === entries.length) return;
    tx.set(ref, { entries: rest, updatedAt: Date.now() }, { merge: true });
  });
}

export interface RelocateResult {
  /** 새 자리 */
  place: EntryPlace;
  /** 새 항목 (칸이 구독을 받기 전에 보일 것) */
  item: any;
  /** 휴지통에 넣은 원본 (되돌리기) */
  trashId?: string;
  /** 원래 자리 (되돌리기) */
  from: EntryPlace;
  /** 원래 항목 (되돌린 뒤 칸이 보일 것) */
  src: any;
  groupId: string | null;
}

/**
 * 항목을 다른 자리로 옮긴다. toDate가 null이면 메모, 날짜면 그날의 기록. 같은 자리면 null(아무것도 하지 않는다).
 * 같은 공간(개인/그룹) 안에서만. 실패하면 던진다(원본은 남는다).
 */
export async function relocateEntry(opts: {
  from: EntryPlace;
  toDate: string | null;
  groupId: string | null;
  journalLabels: JournalLabel[];
  /** 방금 이 저장으로 만든 항목이면 휴지통을 거치지 않고 지운다 (새로 쓰며 날짜를 바꾼 경우 - 휴지통에 빈 사본이 쌓이지 않게) */
  justCreated?: boolean;
}): Promise<RelocateResult | null> {
  const { from, toDate, groupId, journalLabels, justCreated } = opts;
  if (toDate !== null && !isDay(toDate)) throw new Error('날짜를 YYYY-MM-DD로 골라 주세요.');
  if (from.kind === 'memo' && toDate === null) return null;
  if (from.kind === 'journal' && toDate === from.dateStr) return null;
  if (from.kind === 'journal' && !isMovableJournal({ id: from.id })) throw new Error('알림장·출석부가 만든 기록은 옮길 수 없습니다.');
  const uid = uidOrThrow();
  const user = auth.currentUser!;

  // ① 원본을 서버에서 읽는다
  const src: any = await runTransaction(db, async (tx) => {
    if (from.kind === 'memo') {
      const snap = await tx.get(memoRef(uid, groupId, from.id));
      return snap.exists() ? snap.data() : null;
    }
    const snap = await tx.get(dayRef(uid, groupId, from.dateStr));
    const entries = snap.exists() ? readJournalEntries(snap.data()) : [];
    return entries.find((j) => String(j.id) === String(from.id)) || null;
  }).catch(() => {
    throw new Error(OFFLINE);
  });
  if (!src) throw new Error('옮길 항목을 찾지 못했습니다. 다른 곳에서 지웠을 수 있습니다.');

  const names: string[] =
    from.kind === 'memo' ? (src.labels || []).map((n: unknown) => String(n)) : journalLabelNames(src, journalLabels);
  // 메모·기록 라벨은 한 목록 - 메모에만 있던 라벨이면 기록 라벨 목록에도 채운다 (U5)
  await ensureEntryLabelsQuietly(names);

  // ② 새 자리에 만든다
  let place: EntryPlace;
  let item: any;
  if (toDate !== null) {
    const id = newJournalId();
    item = toJournalEntry(src, from.kind, names, journalLabels, id);
    await runTransaction(db, async (tx) => {
      const ref = dayRef(uid, groupId, toDate);
      const snap = await tx.get(ref);
      const entries: any[] = snap.exists() ? readJournalEntries(snap.data()) : [];
      if (entries.some((j) => String(j.id) === id)) return;
      tx.set(ref, { entries: [...entries, item], updatedAt: Date.now() }, { merge: true });
    }).catch(() => {
      throw new Error(OFFLINE);
    });
    place = { kind: 'journal', id, dateStr: toDate };
  } else {
    const fromDate = from.kind === 'journal' ? from.dateStr : null;
    const data = toMemoDoc(src, names, fromDate, { uid: user.uid, name: user.displayName || '이름 없음' }, groupId);
    const ref = await addDoc(col(uid, groupId, 'tasks'), data);
    item = { ...data, firestoreId: ref.id };
    place = { kind: 'memo', id: ref.id };
  }

  // ③ 역링크 갈아끼우기
  const text = String(item.content || '');
  await retargetLinks(src.linkedItems, String(from.id), linkMeta(place, text, groupId), groupId || 'personal');

  // ④ 원본은 휴지통으로, 그다음 지운다. 휴지통에 못 넣으면 원본을 남겨 둔다.
  let trashId: string | undefined;
  if (!justCreated) try {
    trashId = await moveToTrash({
      id: String(from.id),
      type: from.kind,
      ...(from.kind === 'journal' ? { originalDateStr: from.dateStr } : {}),
      fId: groupId || 'personal',
      content: `(날짜를 바꿈) ${String(src.content ?? src.text ?? '')}`,
      data: from.kind === 'memo' ? { ...src, firestoreId: from.id } : src,
    });
  } catch (e) {
    console.warn('옮긴 원본을 휴지통에 넣지 못했습니다:', e);
    throw new Error('새 자리에 만들었지만 원본을 휴지통에 넣지 못해 그대로 두었습니다. 원본을 직접 지워 주세요.');
  }
  try {
    if (from.kind === 'memo') await deleteDoc(memoRef(uid, groupId, from.id));
    else await removeJournal(uid, groupId, from.dateStr, from.id);
  } catch {
    throw new Error('새 자리에 만들었지만 서버에 연결되지 않아 원본을 지우지 못했습니다. 원본을 직접 지워 주세요.');
  }

  return { place, item, trashId, from, src: from.kind === 'memo' ? { ...src, firestoreId: from.id } : src, groupId };
}

/** 옮기기를 되돌린다: 새 항목을 지우고, 휴지통의 원본을 되살리고, 링크를 원본으로 되돌린다 */
export async function undoRelocate(r: RelocateResult): Promise<void> {
  const uid = uidOrThrow();
  if (!r.trashId) throw new Error('휴지통에 원본이 없어 되돌리지 못했습니다.');
  if (r.place.kind === 'memo') await deleteDoc(memoRef(uid, r.groupId, r.place.id));
  else await removeJournal(uid, r.groupId, r.place.dateStr, r.place.id);
  await restoreTrashIds([r.trashId]);
  await retargetLinks(r.item.linkedItems, r.place.id, linkMeta(r.from, String(r.item.content || ''), r.groupId), r.groupId || 'personal');
}
