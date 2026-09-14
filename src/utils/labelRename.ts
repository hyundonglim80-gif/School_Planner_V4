// src/utils/labelRename.ts
//
// 라벨 이름을 바꾸면, 이미 저장된 항목들은 여전히 옛 이름을 들고 있다.
// 항목의 라벨은 이름으로 저장되기 때문에(일정의 label은 콤마로 이은 이름 목록,
// 기록은 label/labelIds, 메모는 labels 배열) 등록된 라벨과 이름이 어긋나는 순간
// 라벨 칩이 사라지고 필터에도 걸리지 않는다.
// 그래서 이름을 바꿀 때 저장된 항목의 이름도 함께 고쳐 준다.
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
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

function toMap(renames: LabelRename[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const { from, to } of renames) {
    const a = from.trim();
    const b = to.trim();
    if (a && b && a !== b) map.set(a, b);
  }
  return map;
}

async function renameInEvents(basePath: string, map: Map<string, string>): Promise<number> {
  const snap = await getDocs(collection(db, `${basePath}/events`));
  const batch = writeBatch(db);
  let touched = 0;

  snap.forEach((docSnap) => {
    const list = readEventList(docSnap.data());
    if (list.length === 0) return;

    let docChanged = false;
    const nextList = list.map((item: any) => {
      const label = renameCommaField(item.label, map);
      const ids = renameList(item.labelIds, map);
      if (!label.changed && !ids.changed) return item;
      docChanged = true;
      return {
        ...item,
        ...(label.changed ? { label: label.next } : {}),
        ...(ids.changed ? { labelIds: ids.next } : {}),
      };
    });

    if (docChanged) {
      // eventDocPayload로 써야 V3가 읽는 eventText도 같이 갱신된다.
      batch.set(doc(db, `${basePath}/events`, docSnap.id), eventDocPayload(nextList), { merge: true });
      touched += 1;
    }
  });

  if (touched > 0) await batch.commit();
  return touched;
}

async function renameInJournals(basePath: string, map: Map<string, string>): Promise<number> {
  const snap = await getDocs(collection(db, `${basePath}/journals`));
  const batch = writeBatch(db);
  let touched = 0;

  snap.forEach((docSnap) => {
    const entries = docSnap.data().entries;
    if (!Array.isArray(entries) || entries.length === 0) return;

    let docChanged = false;
    const nextEntries = entries.map((entry: any) => {
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

    if (docChanged) {
      batch.set(
        doc(db, `${basePath}/journals`, docSnap.id),
        { entries: nextEntries, updatedAt: Date.now() },
        { merge: true }
      );
      touched += 1;
    }
  });

  if (touched > 0) await batch.commit();
  return touched;
}

async function renameInMemos(basePath: string, map: Map<string, string>): Promise<number> {
  const snap = await getDocs(collection(db, `${basePath}/tasks`));
  const batch = writeBatch(db);
  let touched = 0;

  snap.forEach((docSnap) => {
    const { next, changed } = renameList(docSnap.data().labels, map);
    if (!changed) return;
    batch.set(doc(db, `${basePath}/tasks`, docSnap.id), { labels: next }, { merge: true });
    touched += 1;
  });

  if (touched > 0) await batch.commit();
  return touched;
}

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
