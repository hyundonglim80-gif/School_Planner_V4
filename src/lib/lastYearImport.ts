// src/lib/lastYearImport.ts
//
// 작년 이맘때 - 골라서 올해로 가져오기 (docs/ROADMAP.md 7-2).
// 작년 같은 주 같은 요일의 일정·기록을 올해 그 요일 날짜에 **새 항목으로 복사**한다(작년 것은 그대로).
//
// - 일정: 글·라벨·속성(달력·이월·이월 끔·수업X)만. 완료는 풀고, 알림·링크·첨부·기간/반복 묶음(groupId)·
//   이월 사슬은 가져오지 않는다 - 작년 날짜를 가리키거나(링크·사슬) 엉뚱한 때 울리거나(알림) 작년 묶음과
//   함께 지워지는(groupId) 것들이다. 첨부는 같은 드라이브 파일을 두 항목이 가리키면 한쪽을 영구 삭제할 때
//   다른 쪽의 파일까지 지워진다.
// - 기록: 글·라벨·표만. 알림장·출석부가 만든 자동 기록은 원본과 이어져 있어 가져오지 않는다.
// - 하루치가 문서 하나의 배열이라, 날짜마다 **트랜잭션**으로 서버의 지금 목록을 읽어 끝에 더한다
//   (ARCHITECTURE 4-1). 일정은 eventList·eventText를 함께 쓴다(4-4). 서버가 답하지 않으면 던진다.
// - 그날 같은 글이 이미 있으면 건너뛴다(두 번 눌러도 두 벌이 되지 않게, 반복 일정처럼 올해도 있는 것).
import { doc, runTransaction } from 'firebase/firestore';
import { auth, db } from './firebase';
import { eventContentOf, readEventList } from './eventText';
import { readJournalEntries } from './journalEntries';
import { autoSourceOf } from './autoJournalSync';
import { TABLE_ONLY_CONTENT } from './entryTable';
import { setEventDoc } from './gcalNote';

export interface ImportPick {
  kind: 'event' | 'journal';
  /** 작년 날짜 */
  fromDate: string;
  /** 올해 같은 요일 날짜 */
  toDate: string;
  item: any;
}

/** 고른 것을 가리는 열쇠 (같은 날 같은 id는 하나) */
export const pickKey = (kind: ImportPick['kind'], fromDate: string, id: string | number) => `${kind}|${fromDate}|${id}`;

/** 가져올 수 있는 기록인가 (알림장·출석부가 만든 자동 기록은 안 된다) */
export const isImportableJournal = (entry: { id?: string | number } | null | undefined) => !autoSourceOf(entry as any);

const freshId = (prefix: string) =>
  prefix + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);

const PROPS = ['calendar', 'forward', 'forwardOptOut', 'skip'] as const;

/** 일정 복사본. 본문은 그대로(ARCHITECTURE 4-5), 나머지는 새 일정처럼. */
export function copyEventForImport(item: any, author: { uid: string; name: string }, now = Date.now()) {
  const content = eventContentOf(item);
  const copy: Record<string, any> = {
    id: freshId('ev_'),
    content,
    text: content, // V3·백업이 text를 읽는다
    completed: false,
    label: item?.label || '',
    labelIds: Array.isArray(item?.labelIds) ? item.labelIds : [],
    linkedItems: [],
    attachments: [],
    imageUrl: '',
    authorId: author.uid,
    authorName: author.name,
    createdAt: now,
  };
  for (const k of PROPS) if (typeof item?.[k] === 'boolean') copy[k] = item[k];
  return copy;
}

/** 기록 복사본 */
export function copyJournalForImport(entry: any, now = Date.now()) {
  const tables = Array.isArray(entry?.tables) && entry.tables.length > 0 ? entry.tables : null;
  const body = String(entry?.content || '').trim();
  return {
    id: freshId('jr_'),
    // 글 없이 표만 있으면 '[표]' (V3가 빈 기록을 빼지 않게, lib/entryTable)
    content: body || (tables ? TABLE_ONLY_CONTENT : ''),
    createdAt: now,
    label: entry?.label || '',
    labelIds: Array.isArray(entry?.labelIds) ? entry.labelIds : [],
    imageUrl: '',
    attachments: [],
    linkedItems: [],
    ...(tables ? { tables: JSON.parse(JSON.stringify(tables)) } : {}),
  };
}

/** 같은 일정으로 볼 글 (앞뒤 빈칸만 무시) */
const eventKey = (item: any) => eventContentOf(item);
/** 같은 기록으로 볼 글. 표만 있는 기록은 표 내용으로 */
const journalKey = (entry: any) => {
  const body = String(entry?.content || '').trim();
  if (body && body !== TABLE_ONLY_CONTENT) return body;
  return 'table:' + JSON.stringify(entry?.tables || []);
};

export interface ImportedRef {
  kind: ImportPick['kind'];
  date: string;
  id: string;
}

export interface ImportResult {
  added: ImportedRef[];
  /** 그날 같은 글이 이미 있어 건너뛴 수 */
  skipped: number;
}

/** 일정 문서·기록 문서 자리 */
const refOf = (uid: string, groupId: string | null, col: 'events' | 'journals', date: string) =>
  groupId ? doc(db, 'groups', groupId, col, date) : doc(db, 'users', uid, col, date);

/**
 * 고른 것을 올해 날짜에 더한다. 날짜마다 한 트랜잭션(일정·기록 문서를 함께).
 * 한 날짜가 실패하면 거기서 멈추고 던진다 - 앞 날짜에 이미 더한 것은 `partial`에 담아 되돌릴 수 있게 한다.
 */
export async function importLastYear(groupId: string | null, picks: ImportPick[]): Promise<ImportResult> {
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  const author = { uid: user.uid, name: user.displayName || '' };
  const byDate = new Map<string, ImportPick[]>();
  for (const p of picks) {
    if (p.kind === 'journal' && !isImportableJournal(p.item)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.toDate)) continue;
    byDate.set(p.toDate, [...(byDate.get(p.toDate) || []), p]);
  }

  const result: ImportResult = { added: [], skipped: 0 };
  for (const [date, list] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const events = list.filter((p) => p.kind === 'event');
    const journals = list.filter((p) => p.kind === 'journal');
    try {
      const done = await runTransaction(db, async (tx) => {
        const added: ImportedRef[] = [];
        let skipped = 0;
        // 트랜잭션은 읽기를 모두 마친 뒤 써야 한다
        const evRef = refOf(user.uid, groupId, 'events', date);
        const jrRef = refOf(user.uid, groupId, 'journals', date);
        const evSnap = events.length > 0 ? await tx.get(evRef) : null;
        const jrSnap = journals.length > 0 ? await tx.get(jrRef) : null;

        if (evSnap) {
          const cur = evSnap.exists() ? readEventList(evSnap.data()) : [];
          const seen = new Set(cur.map(eventKey));
          const next = [...cur];
          for (const p of events) {
            const key = eventKey(p.item);
            if (!key || seen.has(key)) {
              skipped++;
              continue;
            }
            seen.add(key);
            const copy = copyEventForImport(p.item, author);
            next.push(copy as any);
            added.push({ kind: 'event', date, id: copy.id });
          }
          if (next.length > cur.length) setEventDoc(tx, evRef, next);
        }
        if (jrSnap) {
          const cur = jrSnap.exists() ? readJournalEntries(jrSnap.data()) : [];
          const seen = new Set(cur.map(journalKey));
          const next = [...cur];
          for (const p of journals) {
            const copy = copyJournalForImport(p.item);
            const key = journalKey(copy);
            if (!copy.content || seen.has(key)) {
              skipped++;
              continue;
            }
            seen.add(key);
            next.push(copy);
            added.push({ kind: 'journal', date, id: copy.id });
          }
          if (next.length > cur.length) tx.set(jrRef, { entries: next, updatedAt: Date.now() }, { merge: true });
        }
        return { added, skipped };
      });
      result.added.push(...done.added);
      result.skipped += done.skipped;
    } catch (e) {
      throw new ImportFailedError(date, result, e);
    }
  }
  return result;
}

/** 어느 날짜에서 실패했는지와 그 앞까지 더한 것 */
export class ImportFailedError extends Error {
  date: string;
  partial: ImportResult;
  constructor(date: string, partial: ImportResult, cause: unknown) {
    super('서버에 연결되지 않아 가져오지 못했습니다. 잠시 뒤 다시 해 주세요.');
    this.name = 'ImportFailedError';
    this.date = date;
    this.partial = partial;
    (this as any).cause = cause;
  }
}

/**
 * 가져온 것을 다시 뺀다(안내의 '되돌리기'). 방금 만든 복사본이라 휴지통을 거치지 않는다.
 * 날짜마다 트랜잭션으로 서버의 지금 목록에서 그 id만 뺀다. 뺀 수를 돌려준다.
 */
export async function undoLastYearImport(groupId: string | null, added: ImportedRef[]): Promise<number> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요합니다.');
  const dates = [...new Set(added.map((a) => a.date))];
  let removed = 0;
  for (const date of dates) {
    const evIds = new Set(added.filter((a) => a.date === date && a.kind === 'event').map((a) => a.id));
    const jrIds = new Set(added.filter((a) => a.date === date && a.kind === 'journal').map((a) => a.id));
    removed += await runTransaction(db, async (tx) => {
      const evRef = refOf(uid, groupId, 'events', date);
      const jrRef = refOf(uid, groupId, 'journals', date);
      const evSnap = evIds.size > 0 ? await tx.get(evRef) : null;
      const jrSnap = jrIds.size > 0 ? await tx.get(jrRef) : null;
      let n = 0;
      if (evSnap?.exists()) {
        const cur = readEventList(evSnap.data());
        const kept = cur.filter((item: any) => !evIds.has(String(item.id)));
        if (kept.length < cur.length) {
          n += cur.length - kept.length;
          setEventDoc(tx, evRef, kept);
        }
      }
      if (jrSnap?.exists()) {
        const cur = readJournalEntries(jrSnap.data());
        const kept = cur.filter((j: any) => !jrIds.has(String(j.id)));
        if (kept.length < cur.length) {
          n += cur.length - kept.length;
          tx.set(jrRef, { entries: kept, updatedAt: Date.now() }, { merge: true });
        }
      }
      return n;
    });
  }
  return removed;
}

/** 가져온 결과를 사람 말로 */
export function importedMessage(r: ImportResult): string {
  const ev = r.added.filter((a) => a.kind === 'event').length;
  const jr = r.added.filter((a) => a.kind === 'journal').length;
  const parts = [ev > 0 ? `일정 ${ev}개` : '', jr > 0 ? `기록 ${jr}개` : ''].filter(Boolean);
  const head = parts.length > 0 ? `🕰️ 작년 ${parts.join('·')}를 올해로 가져왔습니다.` : '가져온 것이 없습니다.';
  return r.skipped > 0 ? `${head} 그날 같은 글이 있어 ${r.skipped}개는 건너뛰었습니다.` : head;
}
