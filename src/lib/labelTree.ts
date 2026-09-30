// src/lib/labelTree.ts
//
// 메모·기록 라벨의 상위/하위 (2단계). 예: '학교' 밑에 'A초', 'B초', 'C초'.
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

export type LabelTreeKind = 'memo' | 'journal';
/** 하위 이름 → 상위 이름 */
export type ParentMap = Record<string, string>;
export interface LabelTree {
  memo: ParentMap;
  journal: ParentMap;
}

export const EMPTY_TREE: LabelTree = { memo: {}, journal: {} };

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
 * 라벨 거르개 (여러 개 고르기). 2026-09-30 사용자가 정함:
 *   - 라벨은 여러 개 고를 수 있고, 고른 라벨 중 하나라도 붙은 항목이 보인다.
 *   - 상위를 골라도 하위는 들어가지 않는다. 상위 앞 '하위 포함' 체크를 켠 상위만 하위까지 넣는다.
 */
export interface LabelFilter {
  labels: string[];
  /** '하위 포함'을 켠 상위 (labels에 든 것만 뜻이 있다) */
  withChildren: string[];
}

export const EMPTY_FILTER: LabelFilter = { labels: [], withChildren: [] };

/** 거르개가 보여 줄 라벨 이름. 아무것도 안 골랐으면 null (= 전체) */
export function filterLabelSet(filter: LabelFilter, parents: ParentMap): Set<string> | null {
  if (filter.labels.length === 0) return null;
  const out = new Set<string>();
  for (const name of filter.labels) {
    if (filter.withChildren.includes(name)) expandLabel(name, parents).forEach((n) => out.add(n));
    else out.add(name);
  }
  return out;
}

/** 라벨 칩을 눌렀을 때. 고른 것을 다시 누르면 빠지고, 빠진 상위의 '하위 포함'도 끈다 */
export function toggleFilterLabel(filter: LabelFilter, name: string): LabelFilter {
  if (filter.labels.includes(name)) {
    return {
      labels: filter.labels.filter((l) => l !== name),
      withChildren: filter.withChildren.filter((l) => l !== name),
    };
  }
  return { labels: [...filter.labels, name], withChildren: filter.withChildren };
}

/**
 * 라벨 칩을 윈도우 탐색기처럼 고른다 (2026-09-30 사용자가 정함).
 *   - 그냥 누르기: 그 라벨 하나만 (다른 것은 뗀다)
 *   - Ctrl(맥은 ⌘) + 누르기: 붙이고 떼기 (여러 개)
 *   - Shift + 누르기: 기준(마지막으로 그냥·Ctrl로 누른 라벨)부터 여기까지 보이는 차례대로 (Ctrl+Shift는 더하기)
 * order는 화면에 보이는 라벨 차례. '하위 포함'은 계속 골라져 있는 상위에만 남긴다.
 */
export type FilterClick = { ctrl: boolean; shift: boolean };

export function clickFilterLabel(
  filter: LabelFilter,
  name: string,
  click: FilterClick,
  order: string[],
  anchor: string | null
): LabelFilter {
  const keepWith = (labels: string[]) => ({
    labels,
    withChildren: filter.withChildren.filter((l) => labels.includes(l)),
  });
  if (click.shift && anchor && order.includes(anchor) && order.includes(name)) {
    const [a, b] = [order.indexOf(anchor), order.indexOf(name)].sort((x, y) => x - y);
    const range = order.slice(a, b + 1);
    const labels = click.ctrl ? [...filter.labels, ...range.filter((l) => !filter.labels.includes(l))] : range;
    return keepWith(labels);
  }
  if (click.ctrl) return toggleFilterLabel(filter, name);
  return keepWith([name]);
}

/** '하위 포함' 체크. 켜면 그 상위도 함께 고른다. 끄면 상위만 남는다 */
export function toggleFilterChildren(filter: LabelFilter, parent: string): LabelFilter {
  if (filter.withChildren.includes(parent)) {
    return { labels: filter.labels, withChildren: filter.withChildren.filter((l) => l !== parent) };
  }
  return {
    labels: filter.labels.includes(parent) ? filter.labels : [...filter.labels, parent],
    withChildren: [...filter.withChildren, parent],
  };
}

/** 지금 있는 라벨만 남긴다 (지워진 라벨을 기억한 채로 두지 않는다) */
export function pruneFilter(filter: LabelFilter, names: string[]): LabelFilter {
  const known = new Set(names);
  const labels = filter.labels.filter((l) => known.has(l));
  return { labels, withChildren: filter.withChildren.filter((l) => labels.includes(l)) };
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

/** 트리를 저장한다 (계정에 하나. 메모·기록을 함께) */
export async function saveLabelTree(tree: LabelTree): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요합니다.');
  await setDoc(treeRef(uid), { memo: tree.memo, journal: tree.journal, updatedAt: Date.now() });
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
      (data) => setTree({ memo: sanitizeParents(data?.memo), journal: sanitizeParents(data?.journal) }),
      (err) => console.warn('라벨 상위/하위를 불러오지 못했습니다:', err)
    );
  }, [uid]);
  return tree;
}
