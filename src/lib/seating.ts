// src/lib/seating.ts
//
// 자리표(ROADMAP 8번). 학급마다 여러 장. 학생은 **번호**로 가리킨다(출석부·학생 태그와 같다).
// 여기는 셈만 한다 - 저장은 lib/seatingStore.
//
// 자리는 "줄-열"(0부터) 글자. **0줄이 교탁에 가장 가까운 앞줄**, 0열은 학생이 칠판을 볼 때 왼쪽 끝이다.
// 화면에서 교탁을 아래로 두면(front: 'bottom') 180도 돌려 그린다 - 교탁에서 반을 바라보는 모양.
// 짝 = 같은 줄에서 바로 옆이고 같은 분단인 두 자리. 분단 폭(groupCols)이 2면 0·1열, 2·3열 …이 짝이다.
//
// Firestore는 배열 안에 배열을 담지 못해 학생 두 명의 쌍은 "3-15"(작은 번호 먼저) 글자로 둔다.

export interface SeatingChart {
  id: string;
  /** 학급 키(lib/attendance.classKeyOf) */
  classKey: string;
  name: string;
  rows: number;
  cols: number;
  /** 분단 폭. 이 열 수마다 통로가 있다. 0이면 통로 없음(옆자리가 모두 짝), 1이면 짝이 없다 */
  groupCols: number;
  /** 교탁을 화면 위에 그리나 아래에 그리나 */
  front: 'top' | 'bottom';
  /** "줄-열" → 번호. 빈 자리는 키가 없다 */
  seats: Record<string, number>;
  /** 책상이 없는 칸 */
  off: string[];
  /** 섞어도 그대로 두는 칸 */
  locked: string[];
  /** 지난 섞기 바로 전의 짝들 (최근 것이 앞, MAX_HISTORY개까지) - '지난 짝 피하기' */
  history: Array<{ at: number; pairs: string[] }>;
  createdAt?: number;
  updatedAt?: number;
}

/** 섞기·짝을 셀 때 필요한 학생 정보 (명렬표 Student의 일부) */
export interface SeatStudent {
  num: number;
  name?: string;
  gender?: string;
}

export const MAX_ROWS = 10;
export const MAX_COLS = 10;
export const MAX_HISTORY = 3;
export const GROUP_COL_CHOICES = [0, 1, 2, 3] as const;

export const seatKey = (r: number, c: number) => `${r}-${c}`;

export function parseSeatKey(key: string): [number, number] | null {
  const m = /^(\d+)-(\d+)$/.exec(key);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** 학생 두 명의 쌍. 작은 번호가 앞 */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function parsePairKey(key: string): [number, number] | null {
  const m = /^(\d+)-(\d+)$/.exec(key);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === b ? null : [a, b];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** 열 c 바로 오른쪽에 통로가 있나 (그리기용) */
export function aisleAfter(c: number, cols: number, groupCols: number): boolean {
  return groupCols > 0 && c < cols - 1 && (c + 1) % groupCols === 0;
}

function sameGroup(c1: number, c2: number, groupCols: number): boolean {
  if (groupCols === 0) return true;
  return Math.floor(c1 / groupCols) === Math.floor(c2 / groupCols);
}

type ChartShape = Pick<SeatingChart, 'rows' | 'cols' | 'groupCols' | 'off'>;

/** 표 안에 드는 칸인가 */
export function inBounds(key: string, chart: Pick<SeatingChart, 'rows' | 'cols'>): boolean {
  const rc = parseSeatKey(key);
  return !!rc && rc[0] < chart.rows && rc[1] < chart.cols;
}

/** 앉을 수 있는 칸(책상 없음 빼고). 앞줄부터, 줄 안에서는 왼쪽부터 */
export function usableSeats(chart: Pick<SeatingChart, 'rows' | 'cols' | 'off'>): string[] {
  const off = new Set(chart.off);
  const out: string[] = [];
  for (let r = 0; r < chart.rows; r++) {
    for (let c = 0; c < chart.cols; c++) {
      const k = seatKey(r, c);
      if (!off.has(k)) out.push(k);
    }
  }
  return out;
}

/** 짝인 두 자리 (같은 줄, 바로 옆, 같은 분단, 둘 다 책상이 있다) */
export function deskPairSeats(chart: ChartShape): Array<[string, string]> {
  if (chart.groupCols === 1) return [];
  const off = new Set(chart.off);
  const out: Array<[string, string]> = [];
  for (let r = 0; r < chart.rows; r++) {
    for (let c = 0; c + 1 < chart.cols; c++) {
      if (!sameGroup(c, c + 1, chart.groupCols)) continue;
      const a = seatKey(r, c);
      const b = seatKey(r, c + 1);
      if (!off.has(a) && !off.has(b)) out.push([a, b]);
    }
  }
  return out;
}

/** 지금 짝인 학생 쌍 */
export function currentPairs(chart: ChartShape & Pick<SeatingChart, 'seats'>): string[] {
  const out: string[] = [];
  for (const [a, b] of deskPairSeats(chart)) {
    const na = chart.seats[a];
    const nb = chart.seats[b];
    if (na !== undefined && nb !== undefined && na !== nb) out.push(pairKey(na, nb));
  }
  return out;
}

/** 앞뒤옆(대각선 포함)으로 붙은 두 자리인가. 통로를 사이에 둬도 붙은 것으로 본다 */
export function isNear(a: string, b: string): boolean {
  const pa = parseSeatKey(a);
  const pb = parseSeatKey(b);
  if (!pa || !pb || a === b) return false;
  return Math.abs(pa[0] - pb[0]) <= 1 && Math.abs(pa[1] - pb[1]) <= 1;
}

export interface ShuffleOptions {
  /** 떨어뜨릴 학생 쌍 (pairKey) */
  apart: string[];
  /** 지난 짝(history)과 다시 짝이 되지 않게 */
  avoidPast: boolean;
  /** 짝을 남녀로 */
  mixGender: boolean;
}

export interface LayoutCost {
  /** 붙어 앉은 '떨어뜨릴 학생' 쌍 */
  apart: number;
  /** 지난 짝과 다시 짝 */
  repeat: number;
  /** 같은 성별 짝 (남녀 짝일 때만 센다) */
  sameGender: number;
}

const genderOf = (g: string | undefined) => (g === 'M' || g === '남' ? 'M' : g === 'F' || g === '여' ? 'F' : '');

interface CostContext {
  pairSeats: Array<[string, string]>;
  apart: Array<[number, number]>;
  past: Set<string>;
  gender: Map<number, string>;
  mixGender: boolean;
}

function costContext(chart: SeatingChart, students: SeatStudent[], opts: ShuffleOptions): CostContext {
  const past = new Set<string>();
  if (opts.avoidPast) for (const h of chart.history) for (const p of h.pairs) past.add(p);
  return {
    pairSeats: deskPairSeats(chart),
    apart: opts.apart.map(parsePairKey).filter((p): p is [number, number] => !!p),
    past,
    gender: new Map(students.map((s) => [s.num, genderOf(s.gender)])),
    mixGender: opts.mixGender,
  };
}

function costOf(seats: Record<string, number>, ctx: CostContext): LayoutCost {
  const cost: LayoutCost = { apart: 0, repeat: 0, sameGender: 0 };
  if (ctx.apart.length) {
    const where = new Map<number, string>();
    for (const [k, n] of Object.entries(seats)) where.set(n, k);
    for (const [a, b] of ctx.apart) {
      const ka = where.get(a);
      const kb = where.get(b);
      if (ka && kb && isNear(ka, kb)) cost.apart++;
    }
  }
  for (const [a, b] of ctx.pairSeats) {
    const na = seats[a];
    const nb = seats[b];
    if (na === undefined || nb === undefined) continue;
    if (ctx.past.size && ctx.past.has(pairKey(na, nb))) cost.repeat++;
    if (ctx.mixGender) {
      const ga = ctx.gender.get(na);
      const gb = ctx.gender.get(nb);
      if (ga && ga === gb) cost.sameGender++;
    }
  }
  return cost;
}

/** 떨어뜨릴 학생 > 지난 짝 > 남녀 짝 차례로 무겁다 */
const weightOf = (c: LayoutCost) => c.apart * 10000 + c.repeat * 100 + c.sameGender;

/** 지금 자리에서 조건을 몇 개 못 지켰나 (섞기 결과 안내·화면 표시용) */
export function layoutCost(chart: SeatingChart, students: SeatStudent[], opts: ShuffleOptions): LayoutCost {
  return costOf(chart.seats, costContext(chart, students, opts));
}

export interface ShuffleResult {
  seats: Record<string, number>;
  cost: LayoutCost;
  /** 자리가 모자라 앉히지 못한 학생 */
  unseated: number[];
}

/**
 * 고정 칸과 나머지를 가른다. 고정 칸의 학생이 명단에 없으면(전출 등) 그 칸은 고정이 아닌 것으로 본다.
 * slots[i]는 toPlace의 i번째 학생이 앉을 칸 - 앞줄부터, 자리가 모자라면 남는 학생은 null(자리 없음).
 */
function planSlots(chart: SeatingChart, students: SeatStudent[]) {
  const active = new Set(students.map((s) => s.num));
  const usable = usableSeats(chart);
  const usableSet = new Set(usable);
  const fixed: Record<string, number> = {};
  const lockedKeys = new Set<string>();
  for (const k of chart.locked) {
    if (!usableSet.has(k)) continue;
    const n = chart.seats[k];
    if (n === undefined) {
      lockedKeys.add(k); // 고정한 빈 칸
    } else if (active.has(n)) {
      fixed[k] = n;
      lockedKeys.add(k);
    }
  }
  const fixedNums = new Set(Object.values(fixed));
  const toPlace = students.map((s) => s.num).filter((n) => !fixedNums.has(n)).sort((a, b) => a - b);
  const open = usable.filter((k) => !lockedKeys.has(k));
  const target = open.slice(0, Math.min(open.length, toPlace.length));
  const slots: Array<string | null> = [...target, ...Array(Math.max(0, toPlace.length - target.length)).fill(null)];
  const build = (order: number[]) => {
    const seats: Record<string, number> = { ...fixed };
    order.forEach((n, i) => {
      const k = slots[i];
      if (k) seats[k] = n;
    });
    return seats;
  };
  return { fixed, toPlace, slots, build };
}

/** 고정 칸은 그대로 두고 나머지를 번호 차례로 앞줄부터 앉힌다 */
export function numberOrderSeats(chart: SeatingChart, students: SeatStudent[]): { seats: Record<string, number>; unseated: number[] } {
  const { toPlace, slots, build } = planSlots(chart, students);
  return { seats: build(toPlace), unseated: toPlace.filter((_, i) => slots[i] === null) };
}

/**
 * 무작위로 섞는다. students는 앉힐 학생(재학생)만 준다.
 * - 고정 칸(locked)은 그대로 둔다. 고정 칸의 학생이 명단에 없으면(전출 등) 그 칸도 섞는다. 고정한 빈 칸은 빈 채로.
 * - 자리가 남으면 앞줄부터 채운다(뒤가 빈다).
 * - 여러 번 무작위로 놓고 두 자리씩 바꿔 보며 조건(떨어뜨릴 학생·지난 짝·남녀 짝)을 덜 어기는 쪽을 고른다.
 *   다 지킬 수 없으면(남녀 수가 다르거나 자리가 좁을 때) 가장 덜 어긴 것을 돌려주고 cost에 남은 수를 적는다.
 */
export function shuffleSeats(
  chart: SeatingChart,
  students: SeatStudent[],
  opts: ShuffleOptions,
  rng: () => number = Math.random
): ShuffleResult {
  const { fixed, toPlace, slots, build } = planSlots(chart, students);
  const ctx = costContext(chart, students, opts);
  const rand = (n: number) => Math.min(n - 1, Math.floor(rng() * n));

  let best: { order: number[]; cost: LayoutCost; weight: number } | null = null;
  const RESTARTS = 24;
  const STEPS = 400;
  for (let t = 0; t < RESTARTS && toPlace.length > 0; t++) {
    const order = [...toPlace];
    for (let i = order.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    let cost = costOf(build(order), ctx);
    let weight = weightOf(cost);
    for (let s = 0; s < STEPS && weight > 0 && order.length > 1; s++) {
      const i = rand(order.length);
      let j = rand(order.length - 1);
      if (j >= i) j++;
      [order[i], order[j]] = [order[j], order[i]];
      const c2 = costOf(build(order), ctx);
      const w2 = weightOf(c2);
      if (w2 <= weight) {
        cost = c2;
        weight = w2;
      } else {
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    if (!best || weight < best.weight) best = { order: [...order], cost, weight };
    if (weight === 0) break;
  }

  if (!best) return { seats: { ...fixed }, cost: costOf(fixed, ctx), unseated: [] };
  const unseated = best.order.filter((_, i) => slots[i] === null);
  return { seats: build(best.order), cost: best.cost, unseated };
}

/** 섞기 전 짝을 지난 짝 기록 맨 앞에 넣는다 (짝이 없으면 그대로) */
export function pushHistory(chart: SeatingChart, at: number): SeatingChart['history'] {
  const pairs = currentPairs(chart);
  if (!pairs.length) return chart.history;
  return [{ at, pairs }, ...chart.history].slice(0, MAX_HISTORY);
}

/** 두 칸의 학생을 맞바꾼다 (한쪽이 비었으면 옮긴다) */
export function swapSeats(seats: Record<string, number>, a: string, b: string): Record<string, number> {
  if (a === b) return seats;
  const next = { ...seats };
  const na = seats[a];
  const nb = seats[b];
  delete next[a];
  delete next[b];
  if (nb !== undefined) next[a] = nb;
  if (na !== undefined) next[b] = na;
  return next;
}

/**
 * 학생을 그 칸에 앉힌다. 이미 다른 칸에 앉아 있었으면 그 칸과 맞바꾸고,
 * 자리가 없던 학생이면 그 칸에 있던 학생은 자리 없음이 된다.
 */
export function placeStudent(seats: Record<string, number>, key: string, num: number): Record<string, number> {
  const from = Object.keys(seats).find((k) => seats[k] === num);
  if (from) return swapSeats(seats, from, key);
  return { ...seats, [key]: num };
}

/** 그 칸을 비운다 (학생은 자리 없음으로) */
export function clearSeat(seats: Record<string, number>, key: string): Record<string, number> {
  if (seats[key] === undefined) return seats;
  const next = { ...seats };
  delete next[key];
  return next;
}

/** 목록에 넣거나 뺀다 (책상 없음·고정 칸) */
export function toggleKey(list: string[], key: string, on: boolean): string[] {
  const has = list.includes(key);
  if (on === has) return list;
  return on ? [...list, key] : list.filter((k) => k !== key);
}

/**
 * 자리가 없는 재학생 (번호 차례).
 * 표 밖·책상 없는 칸에 남은 번호도 자리가 없는 것으로 본다.
 */
export function unseatedNums(chart: SeatingChart, students: SeatStudent[]): number[] {
  const seated = new Set<number>();
  const off = new Set(chart.off);
  for (const [k, n] of Object.entries(chart.seats)) {
    if (inBounds(k, chart) && !off.has(k)) seated.add(n);
  }
  return students.map((s) => s.num).filter((n) => !seated.has(n)).sort((a, b) => a - b);
}

/** 줄·열을 바꾼다. 표 밖으로 나간 칸은 지운다(그 학생은 자리 없음이 된다) */
export function resizeChart(
  chart: SeatingChart,
  rows: number,
  cols: number
): Pick<SeatingChart, 'rows' | 'cols' | 'seats' | 'off' | 'locked'> {
  const size = { rows: clamp(Math.round(rows), 1, MAX_ROWS), cols: clamp(Math.round(cols), 1, MAX_COLS) };
  const keep = (k: string) => inBounds(k, size);
  return {
    ...size,
    seats: Object.fromEntries(Object.entries(chart.seats).filter(([k]) => keep(k))),
    off: chart.off.filter(keep),
    locked: chart.locked.filter(keep),
  };
}

/**
 * 새 자리표. 여섯 열·두 칸씩 짝, 학생 수에 맞는 줄 수로 번호 차례대로 앞줄부터 앉힌다.
 * 학생이 없으면 다섯 줄.
 */
export function initialChart(
  classKey: string,
  students: SeatStudent[],
  name: string
): Omit<SeatingChart, 'id'> {
  const cols = 6;
  const nums = students.map((s) => s.num).sort((a, b) => a - b);
  const rows = clamp(nums.length ? Math.ceil(nums.length / cols) : 5, 1, MAX_ROWS);
  const seats: Record<string, number> = {};
  nums.slice(0, rows * cols).forEach((n, i) => {
    seats[seatKey(Math.floor(i / cols), i % cols)] = n;
  });
  return { classKey, name, rows, cols, groupCols: 2, front: 'top', seats, off: [], locked: [], history: [] };
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** 저장된 모양을 믿지 않고 고쳐 읽는다 */
export function sanitizeChart(id: string, raw: any): SeatingChart {
  const rows = clamp(Number(raw?.rows) || 5, 1, MAX_ROWS);
  const cols = clamp(Number(raw?.cols) || 6, 1, MAX_COLS);
  const groupCols = (GROUP_COL_CHOICES as readonly number[]).includes(Number(raw?.groupCols))
    ? Number(raw.groupCols)
    : 2;
  const keyList = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === 'string' && !!parseSeatKey(k)))] : [];
  const seats: Record<string, number> = {};
  const used = new Set<number>();
  if (raw?.seats && typeof raw.seats === 'object') {
    for (const [k, v] of Object.entries(raw.seats)) {
      const n = Number(v);
      // 한 학생이 두 칸에 있으면 앞의 것만 (손으로 고친 문서·두 기기 동시 저장)
      if (!parseSeatKey(k) || !Number.isFinite(n) || used.has(n)) continue;
      seats[k] = n;
      used.add(n);
    }
  }
  const history = Array.isArray(raw?.history)
    ? raw.history
        .filter((h: any) => h && Array.isArray(h.pairs))
        .map((h: any) => ({
          at: Number(h.at) || 0,
          pairs: h.pairs.filter((p: unknown) => typeof p === 'string' && !!parsePairKey(p)),
        }))
        .slice(0, MAX_HISTORY)
    : [];
  return {
    id,
    classKey: str(raw?.classKey),
    name: str(raw?.name) || '자리표',
    rows,
    cols,
    groupCols,
    front: raw?.front === 'bottom' ? 'bottom' : 'top',
    seats,
    off: keyList(raw?.off),
    locked: keyList(raw?.locked),
    history,
    createdAt: typeof raw?.createdAt === 'number' ? raw.createdAt : undefined,
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : undefined,
  };
}

/** 화면에 그릴 줄 차례·열 차례 (교탁을 아래로 두면 180도 돌린다) */
export function displayOrder(chart: Pick<SeatingChart, 'rows' | 'cols' | 'front'>): { rows: number[]; cols: number[] } {
  const rows = Array.from({ length: chart.rows }, (_, i) => i);
  const cols = Array.from({ length: chart.cols }, (_, i) => i);
  return chart.front === 'bottom' ? { rows: rows.reverse(), cols: cols.reverse() } : { rows, cols };
}

/** 떨어뜨릴 학생이 붙어 앉은 칸들 (화면에 ⚠️) */
export function nearApartSeats(seats: Record<string, number>, apart: string[]): Set<string> {
  const where = new Map<number, string>();
  for (const [k, n] of Object.entries(seats)) where.set(n, k);
  const out = new Set<string>();
  for (const p of apart) {
    const pair = parsePairKey(p);
    if (!pair) continue;
    const ka = where.get(pair[0]);
    const kb = where.get(pair[1]);
    if (ka && kb && isNear(ka, kb)) {
      out.add(ka);
      out.add(kb);
    }
  }
  return out;
}

/** 섞기 결과를 사람 말로 */
export function shuffleSummary(cost: LayoutCost, unseated: number, opts: ShuffleOptions): string {
  const left: string[] = [];
  if (cost.apart) left.push(`떨어뜨릴 학생 ${cost.apart}쌍이 붙어 앉았습니다`);
  if (opts.avoidPast && cost.repeat) left.push(`지난 짝 ${cost.repeat}쌍이 다시 짝입니다`);
  if (opts.mixGender && cost.sameGender) left.push(`같은 성별 짝 ${cost.sameGender}쌍`);
  if (unseated) left.push(`자리가 모자라 ${unseated}명은 자리가 없습니다`);
  return left.length ? `🎲 섞었습니다 - ${left.join(', ')}.` : '🎲 섞었습니다.';
}
