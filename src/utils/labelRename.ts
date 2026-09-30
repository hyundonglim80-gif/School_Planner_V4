// src/utils/labelRename.ts
//
// 라벨 이름을 바꾸면, 이미 저장된 항목들은 여전히 옛 이름을 들고 있다.
// 항목의 라벨은 이름으로 저장되기 때문에(일정의 label은 콤마로 이은 이름 목록,
// 기록은 label/labelIds, 메모는 labels 배열) 등록된 라벨과 이름이 어긋나는 순간
// 라벨 칩이 사라지고 필터에도 걸리지 않는다.
// 그래서 이름을 바꿀 때 저장된 항목의 이름도 함께 고쳐 준다.
import { collection, doc, getDocs, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { eventDocPayload, readEventList } from '../lib/eventText';

export interface LabelRename {
  from: string;
  to: string;
}

export interface RenameResult {
  events: number;
  journals: number;
  memos: number;
}

/** 이름 목록에서 바뀐 이름을 갈아끼운다. 중복은 하나로 합친다. */
function renameList(names: unknown, map: Map<string, string>): { next: string[]; changed: boolean } {
  const list = Array.isArray(names) ? names : [];
  let changed = false;
  const next: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    const mapped = map.get(name);
    const value = mapped ?? name;
    if (mapped) changed = true;
    if (value && !next.includes(value)) next.push(value);
  }
  return { next, changed };
}

/** 일정의 label 필드는 "회의,완료" 처럼 콤마로 이어진 이름 목록이다. */
function renameCommaField(value: unknown, map: Map<string, string>): { next: string; changed: boolean } {
  if (typeof value !== 'string' || !value) return { next: '', changed: false };
  const { next, changed } = renameList(value.split(','), map);
  return { next: next.join(','), changed };
}

// V3가 남긴 항목은 라벨을 본문 앞의 "[회의] 교직원 회의" 로만 들고 있는 경우가 있다.
function renameContentPrefix(value: unknown, map: Map<string, string>): { next: string; changed: boolean } {
  const content = typeof value === 'string' ? value : '';
  const match = content.match(/^\[(.*?)\]\s*(.*)$/);
  if (!match) return { next: content, changed: false };
  const mapped = map.get(match[1].trim());
  if (!mapped) return { next: content, changed: false };
  return { next: `[${mapped}] ${match[2]}`.trim(), changed: true };
}

function toMap(renames: LabelRename[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const { from, to } of renames) {
    const a = from.trim();
    const b = to.trim();
    if (a && b && a !== b) map.set(a, b);
  }
  return map;
}

/** 날짜·메모 문서를 한 번에 몇 개씩 고칠지 (문서마다 트랜잭션 하나) */
const PARALLEL_DOCS = 8;

/**
 * 컬렉션을 훑어 바뀔 문서를 고르고, 문서마다 트랜잭션으로 서버의 지금 값에 다시 적용해 쓴다. 고친 문서 수를 준다.
 *
 * ⚠️ 예전에는 모두 읽은 뒤 한 번의 일괄 쓰기로 썼다. 일괄 쓰기는 500건까지라, 라벨이 500일 넘게 쓰였으면 통째로
 *    실패해 경고만 남고 아무것도 바뀌지 않았다(칩이 사라짐). 또 읽고 쓰는 사이 그날 바뀐 것을 옛 모습으로 덮었다.
 */
async function renameInCollection(
  basePath: string,
  colName: string,
  transform: (data: any) => Record<string, any> | null
): Promise<number> {
  const snap = await getDocs(collection(db, `${basePath}/${colName}`));
  const ids: string[] = [];
  snap.forEach((docSnap) => {
    if (transform(docSnap.data())) ids.push(docSnap.id);
  });
  let touched = 0;
  for (let i = 0; i < ids.length; i += PARALLEL_DOCS) {
    const results = await Promise.all(
      ids.slice(i, i + PARALLEL_DOCS).map((id) =>
        runTransaction(db, async (tx) => {
          const ref = doc(db, `${basePath}/${colName}`, id);
          const fresh = await tx.get(ref);
          if (!fresh.exists()) return false;
          const payload = transform(fresh.data());
          if (!payload) return false;
          tx.set(ref, payload, { merge: true });
          return true;
        })
      )
    );
    touched += results.filter(Boolean).length;
  }
  return touched;
}

function renameEventDoc(data: any, map: Map<string, string>): Record<string, any> | null {
  const list = readEventList(data);
  if (list.length === 0) return null;
  let docChanged = false;
  const nextList = list.map((item: any) => {
    const label = renameCommaField(item.label, map);
    const ids = renameList(item.labelIds, map);
    const content = renameContentPrefix(item.content ?? item.text, map);
    if (!label.changed && !ids.changed && !content.changed) return item;
    docChanged = true;
    return {
      ...item,
      ...(label.changed ? { label: label.next } : {}),
      ...(ids.changed ? { labelIds: ids.next } : {}),
      ...(content.changed ? { content: content.next } : {}),
    };
  });
  // eventDocPayload로 써야 V3가 읽는 eventText도 같이 갱신된다.
  return docChanged ? eventDocPayload(nextList) : null;
}

function renameJournalDoc(data: any, map: Map<string, string>): Record<string, any> | null {
  const entries = data?.entries;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  let docChanged = false;
  const nextEntries = entries.map((entry: any) => {
    if (!entry || typeof entry !== 'object') return entry;
    const label = renameCommaField(entry.label, map);
    const ids = renameList(entry.labelIds, map);
    if (!label.changed && !ids.changed) return entry;
    docChanged = true;
    return {
      ...entry,
      ...(label.changed ? { label: label.next } : {}),
      ...(ids.changed ? { labelIds: ids.next } : {}),
    };
  });
  return docChanged ? { entries: nextEntries, updatedAt: Date.now() } : null;
}

function renameMemoDoc(data: any, map: Map<string, string>): Record<string, any> | null {
  const { next, changed } = renameList(data?.labels, map);
  return changed ? { labels: next } : null;
}

const renameInEvents = (basePath: string, map: Map<string, string>) =>
  renameInCollection(basePath, 'events', (d) => renameEventDoc(d, map));
const renameInJournals = (basePath: string, map: Map<string, string>) =>
  renameInCollection(basePath, 'journals', (d) => renameJournalDoc(d, map));
const renameInMemos = (basePath: string, map: Map<string, string>) =>
  renameInCollection(basePath, 'tasks', (d) => renameMemoDoc(d, map));

/**
 * 바뀐 라벨 이름을 저장된 항목들에 일괄 반영한다.
 * 종류별로 이름 공간이 다르므로(일정/기록/메모) 각각 따로 받는다.
 */
export async function applyLabelRenames(
  uid: string,
  groupIds: string[],
  renames: { event: LabelRename[]; journal: LabelRename[]; memo: LabelRename[] }
): Promise<RenameResult> {
  const eventMap = toMap(renames.event);
  const journalMap = toMap(renames.journal);
  const memoMap = toMap(renames.memo);

  const result: RenameResult = { events: 0, journals: 0, memos: 0 };
  if (eventMap.size === 0 && journalMap.size === 0 && memoMap.size === 0) return result;

  const basePaths = [`users/${uid}`, ...groupIds.map((g) => `groups/${g}`)];

  for (const base of basePaths) {
    // 한 곳이 실패해도 나머지는 반영한다. 이름이 어긋난 채로 남는 게 더 나쁘다.
    if (eventMap.size > 0) {
      try {
        result.events += await renameInEvents(base, eventMap);
      } catch (e) {
        console.warn(`라벨 이름 일괄 변경 실패 (events, ${base}):`, e);
      }
    }
    if (journalMap.size > 0) {
      try {
        result.journals += await renameInJournals(base, journalMap);
      } catch (e) {
        console.warn(`라벨 이름 일괄 변경 실패 (journals, ${base}):`, e);
      }
    }
    if (memoMap.size > 0) {
      try {
        result.memos += await renameInMemos(base, memoMap);
      } catch (e) {
        console.warn(`라벨 이름 일괄 변경 실패 (tasks, ${base}):`, e);
      }
    }
  }

  return result;
}

/** 불러온 시점과 지금을 ID로 맞춰 보고, 이름이 바뀐 것만 추려낸다. */
export function diffLabelNames(
  original: { id: string; name: string }[],
  current: { id: string; name: string }[]
): LabelRename[] {
  const renames: LabelRename[] = [];
  for (const before of original) {
    const after = current.find((l) => l.id === before.id);
    if (!after) continue; // 삭제된 라벨은 여기서 다루지 않는다
    if (before.name.trim() && after.name.trim() && before.name.trim() !== after.name.trim()) {
      renames.push({ from: before.name.trim(), to: after.name.trim() });
    }
  }
  return renames;
}
