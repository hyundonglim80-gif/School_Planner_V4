// src/lib/periodBars.ts
//
// 기간 일정을 막대로 (ROADMAP 13). 셈만 한다 - 그리는 것은 MonthGrid·YearMonthCard.
//
//   기간 일정은 날마다 따로 저장된 조각이다. V3·V4 모두 같은 groupId를 붙이고 본문 끝에 며칠째인지 적는다
//   ('기말고사 (2/5)'). V4는 period: true도 붙이지만 V3는 붙이지 않으므로 groupId + '(i/n)'으로 알아본다.
//   반복 일정도 groupId가 있지만 '(i/n)'이 없어 막대가 되지 않는다. 사용자가 한 조각의 글을 고쳐 끝이 달라지면
//   그 조각은 보통 일정으로 남는다(글이 다른 것을 한 막대로 묶으면 고친 글이 숨는다).
//
//   저장된 것은 하나도 바꾸지 않는다. 화면에서만 이어 그린다.

export interface PeriodPiece {
  /** 같은 막대로 이을 열쇠: groupId + 본문(며칠째 뺀 것) + 모두 며칠 */
  key: string;
  /** 며칠째를 뺀 본문 ('기말고사') */
  base: string;
  /** 며칠째 (1부터) */
  index: number;
  /** 모두 며칠 */
  total: number;
}

const PIECE_SUFFIX = /^(.*\S)\s*\((\d+)\/(\d+)\)\s*$/s;

/**
 * 기간 일정의 조각이면 그 정보를, 아니면 null.
 * content는 화면에 보일 본문(라벨 머리 '[…]'를 뗀 것 - eventDisplayContent)을 넘긴다.
 */
export function periodPieceOf(ev: any, content: string): PeriodPiece | null {
  const groupId = ev?.groupId;
  if (!groupId) return null;
  const m = String(content || '').match(PIECE_SUFFIX);
  if (!m) return null;
  const index = Number(m[2]);
  const total = Number(m[3]);
  if (!(total >= 2) || !(index >= 1) || index > total) return null;
  const base = m[1].trim();
  return { key: `${groupId}|${base}|${total}`, base, index, total };
}

export interface BarCell {
  dateStr: string;
  /** 그 칸 안의 차례 (0부터) */
  col: number;
  ev: any;
  index: number;
}

export interface WeekBar {
  key: string;
  base: string;
  total: number;
  /** 시작 칸 (0부터) */
  start: number;
  /** 몇 칸 */
  len: number;
  /** 몇째 줄 (0부터) */
  lane: number;
  cells: BarCell[];
  /** 이 막대가 기간의 첫날에서 시작하나 (아니면 앞 주·앞 달에서 이어진다) */
  startsPeriod: boolean;
  /** 이 막대가 기간의 끝날에서 끝나나 */
  endsPeriod: boolean;
}

export interface WeekColumn {
  dateStr: string;
  events: any[];
}

export interface WeekBarLayout {
  bars: WeekBar[];
  /** 막대 줄 수 */
  lanes: number;
  /** 날마다 막대가 되지 않은 일정 (원래 차례 그대로) */
  rest: Record<string, any[]>;
}

/**
 * 한 주(달력 한 줄)의 기간 일정을 막대로 나눈다.
 *
 *   - 나란한 칸에 같은 열쇠의 조각이 있으면 한 막대. 사이에 빠진 날(공휴일을 건너뛴 기간)이 있으면 두 막대.
 *   - 하루짜리 조각도 막대로 그린다(앞뒤 주에서 이어지는 것이 보이게).
 *   - 한 날에 같은 열쇠가 둘이면 둘째는 보통 일정으로 남긴다.
 *   - 줄은 먼저 시작하는 것, 같으면 긴 것부터 비어 있는 가장 위 줄에 넣는다.
 */
export function layoutWeekBars(columns: WeekColumn[], contentOf: (ev: any) => string): WeekBarLayout {
  const rest: Record<string, any[]> = {};
  /** 열쇠 → 칸 → 조각 */
  const byKey = new Map<string, { base: string; total: number; cols: Map<number, BarCell> }>();

  columns.forEach((column, col) => {
    const kept: any[] = [];
    for (const ev of column.events || []) {
      const piece = periodPieceOf(ev, contentOf(ev));
      if (!piece) {
        kept.push(ev);
        continue;
      }
      let entry = byKey.get(piece.key);
      if (!entry) {
        entry = { base: piece.base, total: piece.total, cols: new Map() };
        byKey.set(piece.key, entry);
      }
      if (entry.cols.has(col)) {
        kept.push(ev);
        continue;
      }
      entry.cols.set(col, { dateStr: column.dateStr, col, ev, index: piece.index });
    }
    rest[column.dateStr] = kept;
  });

  const runs: Omit<WeekBar, 'lane'>[] = [];
  for (const [key, entry] of byKey) {
    const cols = [...entry.cols.keys()].sort((a, b) => a - b);
    let run: BarCell[] = [];
    const flush = () => {
      if (run.length === 0) return;
      runs.push({
        key,
        base: entry.base,
        total: entry.total,
        start: run[0].col,
        len: run.length,
        cells: run,
        startsPeriod: run[0].index === 1,
        endsPeriod: run[run.length - 1].index === entry.total,
      });
      run = [];
    };
    for (const col of cols) {
      if (run.length > 0 && run[run.length - 1].col !== col - 1) flush();
      run.push(entry.cols.get(col)!);
    }
    flush();
  }

  runs.sort((a, b) => a.start - b.start || b.len - a.len || a.key.localeCompare(b.key));
  /** 줄마다 마지막으로 쓴 칸 */
  const laneEnds: number[] = [];
  const bars: WeekBar[] = runs.map((run) => {
    let lane = laneEnds.findIndex((end) => end < run.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(-1);
    }
    laneEnds[lane] = run.start + run.len - 1;
    return { ...run, lane };
  });

  return { bars, lanes: laneEnds.length, rest };
}

export interface CollapsedPeriod {
  base: string;
  total: number;
  /** 이 달에 든 조각 (날짜 차례) */
  cells: { dateStr: string; ev: any; index: number }[];
  startsPeriod: boolean;
  endsPeriod: boolean;
}

/**
 * 년간처럼 날을 세로로 늘어놓는 곳: 같은 기간의 조각은 처음 나오는 날 한 번만 보이고(그 달에 든 날을 함께),
 * 나머지 날에서는 뺀다. 날짜 → 그날 보일 일정(조각은 빠지고), 날짜 → 그날 시작하는 묶음.
 */
export function collapsePeriods(
  days: { dateStr: string; events: any[] }[],
  contentOf: (ev: any) => string,
): { rest: Record<string, any[]>; starts: Record<string, CollapsedPeriod[]> } {
  const rest: Record<string, any[]> = {};
  const starts: Record<string, CollapsedPeriod[]> = {};
  const seen = new Map<string, CollapsedPeriod>();
  const sorted = [...days].sort((a, b) => a.dateStr.localeCompare(b.dateStr));
  for (const day of sorted) {
    const kept: any[] = [];
    const usedHere = new Set<string>();
    for (const ev of day.events || []) {
      const piece = periodPieceOf(ev, contentOf(ev));
      if (!piece || usedHere.has(piece.key)) {
        kept.push(ev);
        continue;
      }
      usedHere.add(piece.key);
      const cell = { dateStr: day.dateStr, ev, index: piece.index };
      const found = seen.get(piece.key);
      if (found) {
        found.cells.push(cell);
        continue;
      }
      const group: CollapsedPeriod = { base: piece.base, total: piece.total, cells: [cell], startsPeriod: false, endsPeriod: false };
      seen.set(piece.key, group);
      (starts[day.dateStr] ||= []).push(group);
    }
    rest[day.dateStr] = kept;
  }
  for (const group of seen.values()) {
    group.startsPeriod = group.cells[0].index === 1;
    group.endsPeriod = group.cells[group.cells.length - 1].index === group.total;
  }
  return { rest, starts };
}

/** '10.5' */
const md = (dateStr: string) => `${Number(dateStr.slice(5, 7))}.${Number(dateStr.slice(8, 10))}`;

/** 막대·묶음에 붙일 범위 글: '10.5 ~ 10.9 · 5일' (하루면 '10.5') */
export function periodRangeLabel(cells: { dateStr: string }[]): string {
  if (cells.length === 0) return '';
  const first = cells[0].dateStr;
  const last = cells[cells.length - 1].dateStr;
  return first === last ? md(first) : `${md(first)} ~ ${md(last)} · ${cells.length}일`;
}

/** 며칠째 범위: '1~3/5' (하루면 '2/5') */
export function periodIndexLabel(cells: { index: number }[], total: number): string {
  if (cells.length === 0) return '';
  const a = cells[0].index;
  const b = cells[cells.length - 1].index;
  return a === b ? `${a}/${total}` : `${a}~${b}/${total}`;
}
