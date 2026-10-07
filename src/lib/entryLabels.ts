// src/lib/entryLabels.ts
//
// 메모·기록 라벨 한 목록 (19번 U5, docs/ROADMAP-REFINE.md). 순수 함수만 - Firestore 없음.
//
// 사용자에게는 '메모·기록 라벨' 하나. 저장 자리는 V3와 같이 쓰는 settings/labels의 두 배열 그대로:
//   - memoLabels: 이름 문자열 또는 { name, color?, id? } (V3 옛 판은 문자열만)
//   - journalLabels: { id, name, color } - 기록 항목은 라벨을 id(labelIds)로 들고 있다. 있던 id는 절대 바꾸지 않는다.
// V4는 둘을 이름(앞뒤 공백을 뗀 것)으로 합쳐 보인다(mergeEntryLabels). 같은 이름의 색이 다르면 기록 쪽 색.
// 저장할 일이 생기면 두 배열에 같은 목록을 쓴다(toMemoLabels·toJournalLabels - 원래 모양과 모르는 칸을 지킨다).
// 메모에만 있던 라벨은 기록 id가 없어서 '기록용 id'를 이름으로 정한다(entryJournalId) - 그 라벨로 기록을 저장하기 전에
// journalLabels에 그 id로 채운다(missingEntryLabels → fillEntryLabels). 읽기만으로는 아무것도 쓰지 않는다.

export interface EntryLabel {
  /** 기록 라벨 id. 메모에만 있던 라벨은 entryJournalId(이름) */
  id: string;
  name: string;
  color: string;
  /** journalLabels에 실제로 있는가 */
  inJournal: boolean;
  /** memoLabels에서의 자리 (없으면 undefined) */
  memoIndex?: number;
}

/** 저장된 기록 라벨 (V3가 더한 모르는 칸이 있을 수 있다 - 펼쳐서 지킨다) */
export interface RawJournalLabel {
  id: string;
  name: string;
  color?: string;
}

const nameOf = (l: unknown): string =>
  typeof l === 'string' ? l.trim() : l && typeof l === 'object' ? String((l as any).name ?? '').trim() : '';

/** 메모에만 있던 라벨의 기록용 id - 이름으로 정해 어느 기기에서 만들어도 같다 */
export const entryJournalId = (name: string) => `jm_${name.trim()}`;

/** 두 배열을 이름으로 합친다. 차례: 기록 라벨 차례 → 메모에만 있는 것 (메모 차례) */
export function mergeEntryLabels(memoRaw: unknown[], journalRaw: RawJournalLabel[]): EntryLabel[] {
  const out: EntryLabel[] = [];
  const byName = new Map<string, EntryLabel>();
  journalRaw.forEach((j, i) => {
    const name = nameOf(j);
    if (!name || byName.has(name)) return;
    const l: EntryLabel = { id: String(j.id || `j_${i}_${name}`), name, color: j.color || 'green', inJournal: true };
    byName.set(name, l);
    out.push(l);
  });
  memoRaw.forEach((m, i) => {
    const name = nameOf(m);
    if (!name) return;
    const have = byName.get(name);
    if (have) {
      if (have.memoIndex === undefined) have.memoIndex = i;
      return;
    }
    const color = typeof m === 'object' && m && typeof (m as any).color === 'string' ? (m as any).color : 'green';
    const l: EntryLabel = { id: entryJournalId(name), name, color, inJournal: false, memoIndex: i };
    byName.set(name, l);
    out.push(l);
  });
  return out;
}

/** 메모 배열이 이름 문자열 모양인가 (V3 옛 판). 비어 있으면 객체 모양으로 쓴다 */
const isStringShape = (memoRaw: unknown[]) => memoRaw.length > 0 && memoRaw.every((m) => typeof m === 'string');

/**
 * 한 목록 → memoLabels. 원래 모양(문자열/객체)과 객체의 모르는 칸을 지킨다.
 * memoIndex로 원래 항목을 찾으므로 이름을 고친 것도 같은 항목을 고친다.
 */
export function toMemoLabels(list: EntryLabel[], memoRaw: unknown[], now = Date.now()): unknown[] {
  const strings = isStringShape(memoRaw);
  return list.map((l, i) => {
    const orig = l.memoIndex !== undefined ? memoRaw[l.memoIndex] : undefined;
    if (strings) return l.name;
    if (orig && typeof orig === 'object') return { ...(orig as object), name: l.name, color: l.color };
    return { id: `memo_${now + i}`, name: l.name, color: l.color };
  });
}

/** 한 목록 → journalLabels. 있던 id와 모르는 칸을 지키고, 메모에만 있던 라벨은 entryJournalId로 */
export function toJournalLabels(list: EntryLabel[], journalRaw: RawJournalLabel[]): RawJournalLabel[] {
  return list.map((l) => {
    const orig = journalRaw.find((j) => String(j.id) === l.id);
    return orig ? { ...(orig as object), id: l.id, name: l.name, color: l.color } : { id: l.id, name: l.name, color: l.color };
  });
}

/** 이 이름들로 저장하기 전에 두 배열 가운데 어디에 빠졌나 */
export function missingEntryLabels(
  names: string[],
  memoRaw: unknown[],
  journalRaw: RawJournalLabel[]
): { memo: string[]; journal: string[] } {
  const memoNames = new Set(memoRaw.map(nameOf));
  const journalNames = new Set(journalRaw.map(nameOf));
  const want = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  return { memo: want.filter((n) => !memoNames.has(n)), journal: want.filter((n) => !journalNames.has(n)) };
}

/**
 * 빠진 라벨을 두 배열 끝에 채운 새 배열 (바꿀 것이 없는 쪽은 undefined).
 * 메모는 원래 모양으로, 기록은 merged의 id(메모에만 있던 것은 entryJournalId)·색으로.
 * 빈 배열(클라우드에 아직 없음 - V3 localStorage·기본값으로 보이는 중)은 건드리지 않는다: 한 개만 써 두면 나머지가 사라진다.
 */
export function fillEntryLabels(
  names: string[],
  memoRaw: unknown[],
  journalRaw: RawJournalLabel[],
  now = Date.now()
): { memoLabels?: unknown[]; journalLabels?: RawJournalLabel[] } {
  const miss = missingEntryLabels(names, memoRaw, journalRaw);
  const merged = mergeEntryLabels(memoRaw, journalRaw);
  const colorOf = (n: string) => merged.find((l) => l.name === n)?.color || 'green';
  const out: { memoLabels?: unknown[]; journalLabels?: RawJournalLabel[] } = {};
  if (miss.memo.length > 0 && memoRaw.length > 0) {
    const strings = isStringShape(memoRaw);
    out.memoLabels = [
      ...memoRaw,
      ...miss.memo.map((n, i) => (strings ? n : { id: `memo_${now + i}`, name: n, color: colorOf(n) })),
    ];
  }
  if (miss.journal.length > 0 && journalRaw.length > 0) {
    out.journalLabels = [...journalRaw, ...miss.journal.map((n) => ({ id: entryJournalId(n), name: n, color: colorOf(n) }))];
  }
  return out;
}

/**
 * 상위/하위 트리 합치기: 같은 하위의 상위가 다르면 기록 쪽. conflicts는 상위가 달랐던 하위 이름 (라벨 관리 창에 한 번 알린다)
 */
export function mergeEntryTrees(
  memo: Record<string, string>,
  journal: Record<string, string>
): { entry: Record<string, string>; conflicts: string[] } {
  const entry: Record<string, string> = { ...memo, ...journal };
  const conflicts = Object.keys(memo).filter((c) => journal[c] && journal[c] !== memo[c]);
  return { entry, conflicts };
}
