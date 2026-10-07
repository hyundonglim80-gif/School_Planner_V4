// src/lib/labelTree.ts
//
// 메모·기록 라벨의 상위/하위 (2단계). 예: '학교' 밑에 'A초', 'B초', 'C초'.
// 19번 U5(2026-10-07): 메모·기록 라벨은 한 목록 - 트리도 entry 하나(readLabelTree·saveLabelTree).
// 사용자와 정한 것 (2026-09-29):
//   - 메모·기록 라벨만. 일정 라벨은 속성(달력·이월…) 때문에 뺀다.
//   - 2단계까지 (상위 › 하위). 하위를 가진 라벨은 상위를 가질 수 없고, 하위의 하위는 없다.
//   - 거르개에서 상위를 고르면 하위가 붙은 항목까지 보인다.
//   - 옮기기는 라벨마다 '상위 라벨' 고르기 칸(통합 라벨 관리).
//
// 어디에 두나: V4만 쓰는 따로 된 설정 문서(users/{uid}/settings/v4_labelTree)에 "하위 이름 → 상위 이름"만
// 둔다. 라벨 목록과 항목에 붙은 라벨은 그대로라, V3에서는 예전처럼 평평한 목록으로 보이고 깨지는 것이 없다.
// (라벨마다 칸을 더하면 V3가 라벨을 저장할 때 모르는 칸을 지워 버릴 수 있다)
import { doc, setDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { auth, db } from './firebase';
import { subscribeDocWithServerFallback } from './firestoreSubscribe';
import { mergeEntryTrees } from './entryLabels';

export type LabelTreeKind = 'memo' | 'journal';
/** 하위 이름 → 상위 이름 */
export type ParentMap = Record<string, string>;
export interface LabelTree {
  memo: ParentMap;
  journal: ParentMap;
  /**
   * 메모·기록 라벨 한 목록의 트리 (19번 U5). 문서에 entry가 있으면 그것, 없으면 memo와 journal을 합친 것
   * (같은 하위의 상위가 다르면 기록 쪽). useLabelTree는 memo·journal에도 이것을 준다 - 화면은 하나를 본다.
   */
  entry?: ParentMap;
  /** entry가 아직 없을 때 memo·journal에서 상위가 달랐던 하위 이름 (라벨 관리 창이 한 번 알린다) */
  conflicts?: string[];
}

export const EMPTY_TREE: LabelTree = { memo: {}, journal: {}, entry: {}, conflicts: [] };

const treeRef = (uid: string) => doc(db, 'users', uid, 'settings', 'v4_labelTree');

/**
 * 믿을 수 있는 모양으로 다듬는다. 지금 있는 라벨 이름(names)을 주면 없는 라벨은 걸러낸다.
 * 자기 자신이 상위인 것, 상위가 다시 상위를 가진 것(3단계)은 버린다.
 */
export function sanitizeParents(raw: unknown, names?: string[]): ParentMap {
  const out: ParentMap = {};
  if (!raw || typeof raw !== 'object') return out;
  const known = names ? new Set(names) : null;
  for (const [child, parent] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof parent !== 'string' || !child || !parent || child === parent) continue;
    if (known && (!known.has(child) || !known.has(parent))) continue;
    out[child] = parent;
  }
  // 2단계를 넘는 것(상위가 또 하위인 것)은 끊는다
  for (const child of Object.keys(out)) {
    if (out[out[child]]) delete out[child];
  }
  return out;
}

export interface TreeRow {
  name: string;
  /** 0 = 상위(또는 혼자), 1 = 하위 */
  depth: 0 | 1;
  parent?: string;
  hasChildren: boolean;
}

/**
 * 라벨을 트리 차례로 늘어놓는다. 상위는 원래 차례대로, 하위는 제 상위 바로 뒤에 원래 차례대로.
 * 상위가 목록에 없는 하위는 맨 위 단계로 둔다.
 */
export function orderByTree(names: string[], parents: ParentMap): TreeRow[] {
  const set = new Set(names);
  const parentOf = (n: string) => (parents[n] && set.has(parents[n]) && parents[n] !== n ? parents[n] : undefined);
  const rows: TreeRow[] = [];
  for (const name of names) {
    if (parentOf(name)) continue;
    const children = names.filter((c) => parentOf(c) === name);
    rows.push({ name, depth: 0, hasChildren: children.length > 0 });
    for (const c of children) rows.push({ name: c, depth: 1, parent: name, hasChildren: false });
  }
  return rows;
}

/** 상위 하나와 그 하위 (자기 자신 포함) */
export function expandLabel(name: string, parents: ParentMap): string[] {
  return [name, ...Object.keys(parents).filter((c) => parents[c] === name)];
}

/**
 * 라벨 거르개 (여러 개 고르기). 2026-10-06 사용자가 바꿈 (19번 U8 - 예전 9-30 규칙 '상위를 골라도 하위는 들어가지 않는다'를 버림):
 *   - 라벨은 여러 개 고를 수 있고, 고른 라벨 중 하나라도 붙은 항목이 보인다.
 *   - **상위를 고르면 하위도 함께** 걸린다. 하위 하나만 고르면 그것만.
 *   - 하위가 있는 상위 밑에 가상 칩 **'기타'**: 그 상위가 붙었지만 그 하위는 하나도 안 붙은 항목 (others = 상위 이름).
 *   - '하위 포함' 체크는 없앴다. 옛 기억값의 withChildren은 읽을 때 버린다(readLabelFilter).
 */
export interface LabelFilter {
  labels: string[];
  /** '기타' 칩을 고른 상위 이름 */
  others: string[];
}

export const EMPTY_FILTER: LabelFilter = { labels: [], others: [] };

/** '기타' 칩의 열쇠 (칩 차례·Shift 범위에서 라벨 이름과 함께 다룬다). 라벨 이름에 들 수 없는 글자로 시작한다 */
const OTHER_MARK = '\u0000기타:';
export const otherKey = (parent: string) => OTHER_MARK + parent;
export const isOtherKey = (key: string) => key.startsWith(OTHER_MARK);
export const otherParentOf = (key: string) => key.slice(OTHER_MARK.length);

/** 기억해 둔 값(옛 모양 { labels, withChildren }·글자 하나 포함)을 지금 모양으로 */
export function readLabelFilter(raw: unknown): LabelFilter {
  if (typeof raw === 'string') return raw ? { labels: [raw], others: [] } : EMPTY_FILTER;
  if (!raw || typeof raw !== 'object') return EMPTY_FILTER;
  const r = raw as { labels?: unknown; others?: unknown };
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);
  return { labels: strs(r.labels), others: strs(r.others) };
}

export const isEmptyFilter = (f: LabelFilter) => f.labels.length === 0 && f.others.length === 0;

/** 하위 이름들 */
const childrenOf = (parent: string, parents: ParentMap) => Object.keys(parents).filter((c) => parents[c] === parent);

/**
 * 이 항목(붙은 라벨 이름들)이 거르개에 걸리나. 아무것도 안 골랐으면 늘 참.
 * 고른 라벨이 붙었거나(상위면 그 하위 하나라도), '기타'를 고른 상위가 붙고 그 하위는 하나도 없으면 참.
 */
export function matchEntry(itemLabels: string[], filter: LabelFilter, parents: ParentMap): boolean {
  if (isEmptyFilter(filter)) return true;
  const has = new Set(itemLabels);
  for (const name of filter.labels) {
    if (has.has(name)) return true;
    if (childrenOf(name, parents).some((c) => has.has(c))) return true;
  }
  for (const parent of filter.others) {
    if (has.has(parent) && !childrenOf(parent, parents).some((c) => has.has(c))) return true;
  }
  return false;
}

const toKeys = (f: LabelFilter) => [...f.labels, ...f.others.map(otherKey)];
const fromKeys = (keys: string[]): LabelFilter => ({
  labels: keys.filter((k) => !isOtherKey(k)),
  others: keys.filter(isOtherKey).map(otherParentOf),
});

/** 칩(라벨 이름 또는 otherKey)을 붙이고 뗀다 */
export function toggleFilterLabel(filter: LabelFilter, key: string): LabelFilter {
  const keys = toKeys(filter);
  return fromKeys(keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]);
}

/**
 * 라벨 칩을 윈도우 탐색기처럼 고른다 (2026-09-30 사용자가 정함).
 *   - 그냥 누르기: 그 칩 하나만 (다른 것은 뗀다)
 *   - Ctrl(맥은 ⌘) + 누르기: 붙이고 떼기 (여러 개)
 *   - Shift + 누르기: 기준(마지막으로 그냥·Ctrl로 누른 칩)부터 여기까지 보이는 차례대로 (Ctrl+Shift는 더하기)
 * key·order·anchor는 라벨 이름 또는 '기타' 칩의 otherKey(상위).
 */
export type FilterClick = { ctrl: boolean; shift: boolean };

export function clickFilterLabel(
  filter: LabelFilter,
  key: string,
  click: FilterClick,
  order: string[],
  anchor: string | null
): LabelFilter {
  const keys = toKeys(filter);
  if (click.shift && anchor && order.includes(anchor) && order.includes(key)) {
    const [a, b] = [order.indexOf(anchor), order.indexOf(key)].sort((x, y) => x - y);
    const range = order.slice(a, b + 1);
    return fromKeys(click.ctrl ? [...keys, ...range.filter((k) => !keys.includes(k))] : range);
  }
  if (click.ctrl) return toggleFilterLabel(filter, key);
  return fromKeys([key]);
}

/**
 * 화면에 보이는 거르개 칩 차례 (Shift 범위에 쓴다): 상위 → 그 하위들 → 그 상위의 '기타'.
 * 접힌 상위의 하위·기타는 빼되, 골라 둔 것은 보인다.
 */
export function filterChipOrder(rows: TreeRow[], isOpen: (parent: string) => boolean, isSelected: (key: string) => boolean): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.depth === 1) continue;
    out.push(r.name);
    if (!r.hasChildren) continue;
    const open = isOpen(r.name);
    for (const c of rows) if (c.parent === r.name && (open || isSelected(c.name))) out.push(c.name);
    const other = otherKey(r.name);
    if (open || isSelected(other)) out.push(other);
  }
  return out;
}

/** 지금 있는 라벨만 남긴다 (지워진 라벨을 기억한 채로 두지 않는다). 트리는 늦게 올 수 있어 '기타'도 이름만 본다 */
export function pruneFilter(filter: LabelFilter, names: string[]): LabelFilter {
  const known = new Set(names);
  return { labels: filter.labels.filter((l) => known.has(l)), others: filter.others.filter((p) => known.has(p)) };
}

/** 칩에 마우스를 올렸을 때 보일 이름. 하위면 '상위 › 하위' */
export function labelPath(name: string, parents: ParentMap): string {
  return parents[name] ? `${parents[name]} › ${name}` : name;
}

/**
 * '상위 라벨' 고르기 칸에 보일 후보. 자기 자신, 이미 하위인 라벨(3단계가 되므로)은 빠진다.
 * 자기에게 하위가 있으면 상위를 가질 수 없으므로 빈 목록.
 */
export function parentCandidates(name: string, names: string[], parents: ParentMap): string[] {
  if (Object.values(parents).includes(name)) return [];
  return names.filter((n) => n !== name && !parents[n]);
}

/**
 * 트리를 저장한다 (계정에 하나). 19번 U5부터 메모·기록 라벨은 한 목록이라 entry 하나를 memo·journal에도 같게 쓴다
 * (아직 새 판을 받지 않은 다른 기기의 V4가 memo·journal을 읽어도 같게 보이게).
 */
export async function saveLabelTree(tree: { entry: ParentMap }): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요합니다.');
  const entry = sanitizeParents(tree.entry);
  await setDoc(treeRef(uid), { entry, memo: entry, journal: entry, updatedAt: Date.now() });
}

/** 저장된 문서 → 화면이 쓸 트리. entry가 있으면 그것, 없으면 memo·journal을 합친다(같은 하위는 기록 쪽 상위) */
export function readLabelTree(data: any): LabelTree {
  const memo = sanitizeParents(data?.memo);
  const journal = sanitizeParents(data?.journal);
  if (data?.entry && typeof data.entry === 'object') {
    const entry = sanitizeParents(data.entry);
    return { memo: entry, journal: entry, entry, conflicts: [] };
  }
  const merged = mergeEntryTrees(memo, journal);
  const entry = sanitizeParents(merged.entry);
  return { memo: entry, journal: entry, entry, conflicts: merged.conflicts };
}

/** 라벨 트리를 구독한다 */
export function useLabelTree(): LabelTree {
  const [tree, setTree] = useState<LabelTree>(EMPTY_TREE);
  const uid = auth.currentUser?.uid;
  useEffect(() => {
    if (!uid) {
      setTree(EMPTY_TREE);
      return;
    }
    return subscribeDocWithServerFallback(
      treeRef(uid),
      (data) => setTree(readLabelTree(data)),
      (err) => console.warn('라벨 상위/하위를 불러오지 못했습니다:', err)
    );
  }, [uid]);
  return tree;
}
