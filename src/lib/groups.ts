// src/lib/groups.ts
//
// 모둠 만들기 (ROADMAP 8-4) - 순수 셈. 저장은 lib/seatingStore(학급 허브 v4_classHub/{학급키}.groupSets).
//
//   - 무작위: 재학생을 N모둠으로 고르게 나누되 떨어뜨릴 학생(자리표의 apart)은 한 모둠에 넣지 않는다
//   - 자리대로: 자리표에서 앞뒤 두 줄 × 짝(분단 폭)씩 묶는다 - 짝 둘이 앞뒤로 넷
//   - 모둠 모양은 조사표의 조와 같다 { name, members: 번호[] } - 조사표 '조별 평가'가 그대로 불러 쓴다(V3도 같은 모양)
import { pairKey, parsePairKey, parseSeatKey, type SeatingChart } from './seating';

/** 모둠 하나 (조사표 groups와 같은 모양) */
export interface StudentGroup {
  name: string;
  members: number[];
}

/** 이름 붙여 저장한 모둠 나누기 한 벌 */
export interface GroupSet {
  id: string;
  name: string;
  groups: StudentGroup[];
  createdAt: number;
  updatedAt: number;
}

export const MAX_GROUPS = 12;

export const groupName = (i: number) => `${i + 1}모둠`;

/** 재학생 수에 맞는 처음 모둠 수 (넷씩) */
export function defaultGroupCount(students: number): number {
  return Math.max(1, Math.min(MAX_GROUPS, Math.round(students / 4) || 1));
}

/** 모둠 색 (자리표·모둠 칸이 같이 쓴다). 열둘을 넘으면 돌려 쓴다 */
export const GROUP_COLORS = [
  { seat: 'bg-sky-100 border-sky-400', chip: 'bg-sky-50 border-sky-300', text: 'text-sky-700', bar: 'bg-sky-400' },
  { seat: 'bg-emerald-100 border-emerald-400', chip: 'bg-emerald-50 border-emerald-300', text: 'text-emerald-700', bar: 'bg-emerald-400' },
  { seat: 'bg-amber-100 border-amber-400', chip: 'bg-amber-50 border-amber-300', text: 'text-amber-700', bar: 'bg-amber-400' },
  { seat: 'bg-violet-100 border-violet-400', chip: 'bg-violet-50 border-violet-300', text: 'text-violet-700', bar: 'bg-violet-400' },
  { seat: 'bg-rose-100 border-rose-400', chip: 'bg-rose-50 border-rose-300', text: 'text-rose-700', bar: 'bg-rose-400' },
  { seat: 'bg-lime-100 border-lime-500', chip: 'bg-lime-50 border-lime-300', text: 'text-lime-700', bar: 'bg-lime-500' },
  { seat: 'bg-orange-100 border-orange-400', chip: 'bg-orange-50 border-orange-300', text: 'text-orange-700', bar: 'bg-orange-400' },
  { seat: 'bg-cyan-100 border-cyan-400', chip: 'bg-cyan-50 border-cyan-300', text: 'text-cyan-700', bar: 'bg-cyan-400' },
  { seat: 'bg-fuchsia-100 border-fuchsia-400', chip: 'bg-fuchsia-50 border-fuchsia-300', text: 'text-fuchsia-700', bar: 'bg-fuchsia-400' },
  { seat: 'bg-teal-100 border-teal-400', chip: 'bg-teal-50 border-teal-300', text: 'text-teal-700', bar: 'bg-teal-400' },
  { seat: 'bg-indigo-100 border-indigo-400', chip: 'bg-indigo-50 border-indigo-300', text: 'text-indigo-700', bar: 'bg-indigo-400' },
  { seat: 'bg-stone-200 border-stone-400', chip: 'bg-stone-50 border-stone-300', text: 'text-stone-700', bar: 'bg-stone-400' },
] as const;

export const groupColor = (i: number) => GROUP_COLORS[((i % GROUP_COLORS.length) + GROUP_COLORS.length) % GROUP_COLORS.length];

function sanitizeGroups(raw: any): StudentGroup[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  return raw
    .filter((g: any) => g && typeof g === 'object')
    .map((g: any, i: number) => {
      const members: number[] = [];
      for (const v of Array.isArray(g.members) ? g.members : []) {
        const n = Number(v);
        // 한 학생은 한 모둠에만
        if (Number.isInteger(n) && n > 0 && !seen.has(n)) {
          seen.add(n);
          members.push(n);
        }
      }
      return { name: String(g.name || '').trim() || groupName(i), members };
    });
}

/** 학급 허브의 groupSets(id → 한 벌)를 만든 차례의 목록으로 */
export function sanitizeGroupSets(raw: any): GroupSet[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([id, v]: [string, any]) => ({
      id,
      name: String(v.name || '').trim() || '모둠',
      groups: sanitizeGroups(v.groups),
      createdAt: Number(v.createdAt) || 0,
      updatedAt: Number(v.updatedAt) || 0,
    }))
    .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name, 'ko'));
}

/** 번호 → 모둠 차례 */
export function groupIndexByNum(groups: StudentGroup[]): Map<number, number> {
  const map = new Map<number, number>();
  groups.forEach((g, i) => g.members.forEach((n) => map.set(n, i)));
  return map;
}

/** 한 모둠에 같이 든 떨어뜨릴 학생 쌍 (pairKey) */
export function apartInGroups(groups: StudentGroup[], apart: string[]): string[] {
  if (apart.length === 0) return [];
  const idx = groupIndexByNum(groups);
  return apart.filter((key) => {
    const pair = parsePairKey(key);
    return !!pair && idx.has(pair[0]) && idx.get(pair[0]) === idx.get(pair[1]);
  });
}

const sortNums = (list: number[]) => [...list].sort((a, b) => a - b);
const named = (lists: number[][]): StudentGroup[] => lists.map((m, i) => ({ name: groupName(i), members: sortNums(m) }));

/**
 * 무작위 모둠. 크기는 많아야 한 명 차이, 떨어뜨릴 학생은 되도록 다른 모둠으로.
 * 무작위로 여러 번 나누고 두 학생씩 바꿔 보며 한 모둠에 든 떨어뜨릴 쌍이 가장 적은 것을 고른다.
 */
export function randomGroups(nums: number[], count: number, apart: string[] = [], rand: () => number = Math.random): StudentGroup[] {
  const list = [...new Set(nums)];
  if (list.length === 0) return [];
  const k = Math.max(1, Math.min(count, list.length, MAX_GROUPS));
  const apartSet = new Set(apart);
  const cost = (lists: number[][]) => {
    let c = 0;
    for (const m of lists) for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) if (apartSet.has(pairKey(m[i], m[j]))) c++;
    return c;
  };
  const deal = () => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    const lists: number[][] = Array.from({ length: k }, () => []);
    a.forEach((n, i) => lists[i % k].push(n));
    return lists;
  };
  let best = deal();
  let bestCost = cost(best);
  const tries = apartSet.size === 0 || k === 1 ? 0 : 12;
  for (let t = 0; t < tries && bestCost > 0; t++) {
    const lists = deal();
    let c = cost(lists);
    for (let step = 0; step < 300 && c > 0; step++) {
      const g1 = Math.floor(rand() * k);
      const g2 = Math.floor(rand() * k);
      if (g1 === g2 || lists[g1].length === 0 || lists[g2].length === 0) continue;
      const i1 = Math.floor(rand() * lists[g1].length);
      const i2 = Math.floor(rand() * lists[g2].length);
      [lists[g1][i1], lists[g2][i2]] = [lists[g2][i2], lists[g1][i1]];
      const next = cost(lists);
      if (next <= c) c = next;
      else [lists[g1][i1], lists[g2][i2]] = [lists[g2][i2], lists[g1][i1]];
    }
    if (c < bestCost) {
      best = lists;
      bestCost = c;
    }
  }
  return named(best);
}

/**
 * 자리대로 모둠: 앞뒤 두 줄 × 분단(짝)씩 한 모둠. 줄이 홀수면 맨 뒷줄은 바로 앞 모둠에 붙인다.
 * 분단 폭이 2·3이면 그 폭으로, 통로 없음·한 칸씩이면 두 열씩 묶는다.
 * 빈 자리 탓에 혼자가 된 학생은 가장 가까운 모둠(앞뒤 먼저)으로, 자리 없는 재학생은 작은 모둠부터 넣는다.
 * 앞줄(교탁 쪽)·왼쪽부터 1모둠.
 */
export function seatGroups(chart: Pick<SeatingChart, 'rows' | 'cols' | 'groupCols' | 'seats'>, activeNums: number[]): StudentGroup[] {
  const active = new Set(activeNums);
  const width = chart.groupCols >= 2 ? chart.groupCols : 2;
  const lastBlock = chart.rows >= 3 && chart.rows % 2 === 1 ? Math.floor((chart.rows - 2) / 2) : Infinity;
  const blocks = new Map<string, { rb: number; cb: number; cells: Array<[number, number, number]> }>();
  const seated = new Set<number>();
  for (const [key, num] of Object.entries(chart.seats || {})) {
    const rc = parseSeatKey(key);
    if (!rc || !active.has(num) || seated.has(num)) continue;
    const [r, c] = rc;
    if (r >= chart.rows || c >= chart.cols) continue;
    seated.add(num);
    const rb = Math.min(Math.floor(r / 2), lastBlock);
    const cb = Math.floor(c / width);
    const id = `${rb}-${cb}`;
    if (!blocks.has(id)) blocks.set(id, { rb, cb, cells: [] });
    blocks.get(id)!.cells.push([r, c, num]);
  }
  const list = [...blocks.values()].sort((a, b) => a.rb - b.rb || a.cb - b.cb);
  // 혼자 남은 학생은 가까운 모둠으로 (앞뒤가 옆보다 가깝다)
  for (let i = 0; i < list.length; i++) {
    const one = list[i];
    if (one.cells.length !== 1 || list.length === 1) continue;
    let target = -1;
    let bestDist = Infinity;
    list.forEach((b, j) => {
      if (j === i || b.cells.length === 0) return;
      const dist = Math.abs(b.rb - one.rb) + 1.5 * Math.abs(b.cb - one.cb) + b.cells.length / 100;
      if (dist < bestDist) {
        bestDist = dist;
        target = j;
      }
    });
    if (target >= 0) {
      list[target].cells.push(...one.cells);
      one.cells = [];
    }
  }
  const lists = list
    .filter((b) => b.cells.length > 0)
    .map((b) => b.cells.sort((x, y) => x[0] - y[0] || x[1] - y[1]).map(([, , n]) => n));
  // 자리 없는 재학생은 작은 모둠부터
  const rest = sortNums(activeNums.filter((n) => !seated.has(n)));
  if (lists.length === 0) return rest.length ? named([rest]) : [];
  for (const n of rest) {
    let small = 0;
    lists.forEach((m, j) => {
      if (m.length < lists[small].length) small = j;
    });
    lists[small].push(n);
  }
  return named(lists);
}

/** 한 학생을 다른 모둠으로 옮긴다 (빈 모둠도 그대로 둔다) */
export function moveMember(groups: StudentGroup[], num: number, toIndex: number): StudentGroup[] {
  if (toIndex < 0 || toIndex >= groups.length) return groups;
  return groups.map((g, i) => {
    const without = g.members.filter((n) => n !== num);
    return i === toIndex ? { ...g, members: sortNums([...without, num]) } : without.length === g.members.length ? g : { ...g, members: without };
  });
}

/**
 * 두 학생을 서로 바꾼다 (모둠 크기는 그대로). 한쪽이 모둠 없는 학생이면 그 자리를 넘겨받는다.
 * 같은 모둠이면 그대로.
 */
export function swapMembers(groups: StudentGroup[], a: number, b: number): StudentGroup[] {
  const ia = groups.findIndex((g) => g.members.includes(a));
  const ib = groups.findIndex((g) => g.members.includes(b));
  if (ia === ib) return groups;
  return groups.map((g, i) =>
    i === ia || i === ib ? { ...g, members: sortNums(g.members.map((n) => (n === a ? b : n === b ? a : n))) } : g
  );
}

/**
 * 조사표 '조별 평가'에 넣을 조. 조사표 명단(재학생)에 있는 학생만, 빈 모둠은 뺀다.
 * 모둠에 없는 학생은 조가 비어 조사표 표에서 손으로 적는다.
 */
export function evalGroupsFrom(set: Pick<GroupSet, 'groups'>, rosterNums: number[]): StudentGroup[] {
  const ok = new Set(rosterNums);
  return set.groups
    .map((g) => ({ name: g.name, members: g.members.filter((n) => ok.has(n)) }))
    .filter((g) => g.members.length > 0);
}

/** '6모둠 · 25명' */
export function groupSetSummary(groups: StudentGroup[]): string {
  const filled = groups.filter((g) => g.members.length > 0);
  const people = filled.reduce((s, g) => s + g.members.length, 0);
  return `${filled.length}모둠 · ${people}명`;
}
