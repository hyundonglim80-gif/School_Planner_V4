// src/lib/labelUsage.ts
//
// 메모·기록 라벨마다 붙은 항목 수 세기와 '빈 라벨 정리' (19번 U10, docs/ROADMAP-REFINE.md).
// 빈 라벨은 저절로 지우지 않는다(기록 라벨은 id - 지우면 휴지통에서 되살린 기록이 라벨을 잃는다, V3·그룹이 같은 목록을 쓴다).
// 라벨 관리 창에서 '항목 수 세기'를 눌렀을 때만 서버를 한 번 훑는다: 메모 {sp}/tasks, 기록 {sp}/journals (개인 + 내 그룹), 휴지통.
import { collection, getDocsFromServer } from 'firebase/firestore';
import { db } from './firebase';

export interface LabelUsage {
  memo: number;
  journal: number;
  trash: number;
}
export const usageTotal = (u: LabelUsage | undefined) => (u ? u.memo + u.journal + u.trash : 0);

interface Lbl {
  id: string;
  name: string;
}

/** 메모 문서가 단 라벨 이름 */
function memoNames(data: any): string[] {
  return (Array.isArray(data?.labels) ? data.labels : []).filter((n: unknown) => typeof n === 'string').map((n: string) => n.trim());
}

/** 기록 항목이 단 라벨 이름 (labelIds·label은 id 또는 이름, V3 옛 '[라벨] 글'도) */
function journalNames(entry: any, labels: Lbl[]): string[] {
  const keys = [
    ...(Array.isArray(entry?.labelIds) ? entry.labelIds : []),
    ...(entry?.label ? String(entry.label).split(',') : []),
  ];
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw || '').trim();
    const found = k && labels.find((l) => l.id === k || l.name === k);
    if (found && !out.includes(found.name)) out.push(found.name);
  }
  const m = /^\[(.*?)\]/.exec(String(entry?.content ?? entry?.text ?? ''));
  if (m && labels.some((l) => l.name === m[1].trim()) && !out.includes(m[1].trim())) out.push(m[1].trim());
  return out;
}

/**
 * 라벨 이름 → 항목 수. 상위 라벨은 하위의 수를 더한다(parents: 하위 이름 → 상위 이름) - 하위만 붙은 항목도 상위 묶음에 든다.
 * memoDocs: 메모 문서들, journalDocs: 기록 날짜 문서들(entries), trashDocs: 휴지통 문서들(type memo/journal의 data).
 */
export function countEntryLabelUsage(
  input: { memoDocs: any[]; journalDocs: any[]; trashDocs: any[] },
  labels: Lbl[],
  parents: Record<string, string> = {}
): Record<string, LabelUsage> {
  const out: Record<string, LabelUsage> = {};
  for (const l of labels) out[l.name] = { memo: 0, journal: 0, trash: 0 };
  const add = (names: string[], key: keyof LabelUsage) => {
    // 같은 항목이 상위와 하위를 함께 달았으면 상위는 한 번만 센다
    const hit = new Set<string>();
    for (const n of names) {
      hit.add(n);
      if (parents[n]) hit.add(parents[n]);
    }
    for (const n of hit) if (out[n]) out[n][key] += 1;
  };
  for (const d of input.memoDocs) add(memoNames(d), 'memo');
  for (const d of input.journalDocs) for (const e of Array.isArray(d?.entries) ? d.entries : []) add(journalNames(e, labels), 'journal');
  for (const t of input.trashDocs) {
    if (t?.type === 'memo') add(memoNames(t.data), 'trash');
    else if (t?.type === 'journal') add(journalNames(t.data, labels), 'trash');
  }
  return out;
}

/**
 * 정리 목록: 항목이 하나도 없는 라벨과 처음에 체크할지. 하위가 있는 상위와 맨 위(기본) 라벨은 처음에 체크를 뺀다.
 */
export function emptyEntryLabels(
  labels: Lbl[],
  usage: Record<string, LabelUsage>,
  parents: Record<string, string> = {}
): { id: string; name: string; checked: boolean }[] {
  const hasChildren = new Set(Object.values(parents));
  return labels
    .filter((l) => usageTotal(usage[l.name]) === 0)
    .map((l) => ({ id: l.id, name: l.name, checked: !hasChildren.has(l.name) && labels[0]?.id !== l.id }));
}

/** 서버에서 한 번 읽는다 (개인 + 그룹의 메모·기록, 휴지통). onStep으로 진행을 알린다 */
export async function loadEntryLabelUsageInput(
  uid: string,
  groupIds: string[],
  onStep?: (done: number, total: number) => void
): Promise<{ memoDocs: any[]; journalDocs: any[]; trashDocs: any[] }> {
  const bases = [`users/${uid}`, ...groupIds.map((g) => `groups/${g}`)];
  const steps = [
    ...bases.flatMap((b) => [
      { path: `${b}/tasks`, key: 'memoDocs' as const },
      { path: `${b}/journals`, key: 'journalDocs' as const },
    ]),
    { path: `users/${uid}/trash`, key: 'trashDocs' as const },
  ];
  const out = { memoDocs: [] as any[], journalDocs: [] as any[], trashDocs: [] as any[] };
  let done = 0;
  onStep?.(0, steps.length);
  for (const s of steps) {
    // 하나라도 못 읽으면 던진다 - 덜 센 채로 '비었다'고 보이면 쓰는 라벨을 지운다
    const snap = await getDocsFromServer(collection(db, s.path));
    snap.forEach((d) => out[s.key].push(d.data()));
    onStep?.(++done, steps.length);
  }
  return out;
}
