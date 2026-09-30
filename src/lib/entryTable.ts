// src/lib/entryTable.ts
//
// 메모·기록에 붙이는 표 (2026-09-30 사용자와 정함).
//   - 엑셀·한셀·구글 시트에서 복사해 본문에 붙여넣으면 서식째 표로 붙는다.
//     살리는 것: 보이는 값, 병합, 배경색, 글자색·굵게·기울임·밑줄·크기, 정렬, 테두리, 대각선, 열 너비, 줄 높이.
//     못 살리는 것: 수식(계산된 값만 온다), 차트·그림, 메모(주석), 데이터 유효성.
//   - 붙인 뒤에는 칸 글자만 고치고, 줄·열을 더하고 뺀다. 서식을 크게 바꿀 때는 다시 붙여넣는다.
//   - 본문 아래 첨부처럼 둔다(항목의 tables 칸). V3는 이 칸을 모르고, 보여 주지 않지만 지우지도 않는다
//     (메모는 updateDoc, 기록은 항목째 들고 다닌다).
//
// 저장 모양: Firestore는 배열 안의 배열을 받지 않으므로 rows는 { cells: [...] }의 배열이다.
// 칸은 표 전체를 채우는 격자로 둔다. 병합된 칸의 나머지 자리는 { v: '', x: 1 } (가려진 칸).
// 같은 서식은 styles에 한 번만 두고 칸은 번호(s)로 가리킨다 - 크기를 줄인다.

export interface TableCellStyle {
  /** 배경색 */
  bg?: string;
  /** 글자색 */
  c?: string;
  b?: 1;
  i?: 1;
  u?: 1;
  /** 글자 크기 (pt) */
  fs?: number;
  ha?: 'left' | 'center' | 'right';
  va?: 'top' | 'middle' | 'bottom';
  /** 칸 안에서 줄 바꿈 */
  wrap?: 1;
  /** 테두리 (위·오른쪽·아래·왼쪽). 예: '1px solid #000000' */
  bt?: string;
  br?: string;
  bb?: string;
  bl?: string;
  /** 대각선 ↘(왼쪽 위 → 오른쪽 아래)·↗(왼쪽 아래 → 오른쪽 위). 테두리와 같은 모양. 엑셀의 mso-diagonal-down/up */
  dd?: string;
  du?: string;
}

export interface TableCell {
  /** 보이는 값 (줄 바꿈은 \n) */
  v: string;
  /** 병합: 가로·세로로 차지하는 칸 수 (1이면 없다) */
  cs?: number;
  rs?: number;
  /** 병합으로 가려진 자리 */
  x?: 1;
  /** styles의 번호 */
  s?: number;
}

export interface TableRow {
  /** 줄 높이 (px) */
  h?: number;
  cells: TableCell[];
}

export interface EntryTable {
  id: string;
  rows: TableRow[];
  /** 열 너비 (px). 모르면 0 */
  cols?: number[];
  styles?: TableCellStyle[];
  createdAt: number;
}

/** 표 하나에 둘 수 있는 칸 수. 기록은 하루치가 한 문서(최대 1MB)라 큰 표를 막는다 */
export const MAX_TABLE_CELLS = 3000;
/** 저장 모양(JSON)의 글자 수 한도 */
export const MAX_TABLE_JSON = 200_000;

/** 표만 있고 글이 없는 기록에 넣는 글. V3는 글·라벨·첨부가 없는 기록을 저장할 때 빼 버린다 */
export const TABLE_ONLY_CONTENT = '[표]';

export const newTableId = () => 'tb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);

// ───────────────────────── 붙여넣은 HTML 읽기 ─────────────────────────

type Decls = Record<string, string>;

/** 'a:b; c:d' → { a: 'b', c: 'd' } (소문자 키) */
function parseDecls(text: string): Decls {
  const out: Decls = {};
  for (const part of text.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

/** <style> 안의 '.xl65 {…}', 'td {…}' 규칙. 엑셀은 칸 서식을 거의 모두 클래스로 준다 */
function parseStyleRules(doc: Document): { byClass: Record<string, Decls>; td: Decls } {
  const byClass: Record<string, Decls> = {};
  let td: Decls = {};
  const css = [...doc.querySelectorAll('style')].map((s) => s.textContent || '').join('\n');
  // 주석(<!-- -->, /* */)을 걷어낸다
  const text = css.replace(/<!--|-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const decls = parseDecls(m[2]);
    for (const sel of m[1].split(',').map((s) => s.trim())) {
      if (sel === 'td' || sel === 'th') td = { ...td, ...decls };
      else {
        const cm = /^(?:td)?\.([\w-]+)$/.exec(sel);
        if (cm) byClass[cm[1]] = { ...(byClass[cm[1]] || {}), ...decls };
      }
    }
  }
  return { byClass, td };
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  windowtext: '#000000',
  window: '#ffffff',
};

/** 믿을 수 있는 색만 받는다 (#rgb, #rrggbb, rgb(), 이름 몇 개). 나머지는 버린다 */
export function safeColor(raw?: string): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase().replace(/\s*!important$/, '');
  if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/.test(v)) return v;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (rgb) {
    if (rgb[4] !== undefined && Number(rgb[4]) === 0) return undefined; // 투명
    const hex = [rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
    return `#${hex}`;
  }
  return NAMED[v];
}

/** 길이 → px. 엑셀은 pt(.5pt 등), 시트는 px */
function toPx(raw: string): number | undefined {
  const m = /^([\d.]+)\s*(pt|px)?$/.exec(raw.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 'pt' ? n * (4 / 3) : n;
}

/** 'border-top: .5pt solid windowtext' 같은 값 → '1px solid #000000'. 없음이면 undefined */
function parseBorder(raw?: string): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (!v || v === 'none' || v.startsWith('0 ') || v === '0') return undefined;
  const parts = v.split(/\s+/);
  let width = 1;
  let style = 'solid';
  let color = '#000000';
  for (const p of parts) {
    if (/^(solid|dashed|dotted|double)$/.test(p)) style = p;
    else if (p === 'none' || p === 'hidden') return undefined;
    else if (p === 'thin') width = 1;
    else if (p === 'medium') width = 2;
    else if (p === 'thick') width = 3;
    else if (/^[\d.]+(pt|px)?$/.test(p)) {
      const px = toPx(p);
      if (px !== undefined) width = px <= 1.2 ? 1 : px <= 2.2 ? 2 : 3;
    } else {
      const c = safeColor(p);
      if (c) color = c;
    }
  }
  if (style === 'double') width = 3;
  return `${width}px ${style} ${color}`;
}

function styleFromDecls(d: Decls, attrs: { align?: string | null; valign?: string | null; isNum: boolean }): TableCellStyle {
  const s: TableCellStyle = {};
  const bg = safeColor(d['background-color'] || d['background']?.split(/\s+/)[0]);
  if (bg && bg !== '#ffffff') s.bg = bg;
  const c = safeColor(d['color']);
  if (c && c !== '#000000') s.c = c;
  const fw = (d['font-weight'] || '').toLowerCase();
  if (fw === 'bold' || fw === 'bolder' || Number(fw) >= 600) s.b = 1;
  if ((d['font-style'] || '').toLowerCase() === 'italic') s.i = 1;
  const deco = `${d['text-decoration'] || ''} ${d['text-decoration-line'] || ''}`.toLowerCase();
  const msoU = (d['text-underline-style'] || '').toLowerCase();
  if (deco.includes('underline') || (msoU && msoU !== 'none')) s.u = 1;
  const fs = d['font-size'] ? toPx(d['font-size'].replace(/\s*!important$/, '')) : undefined;
  // 표준 크기(11pt·10pt 언저리)는 적지 않는다 - 크기가 다른 칸만
  if (fs !== undefined && fs > 0) {
    const pt = Math.round((fs * 3) / 4 * 2) / 2;
    if (pt < 9.5 || pt > 11.5) s.fs = Math.min(36, Math.max(6, pt));
  }
  const ta = (d['text-align'] || attrs.align || '').toLowerCase();
  if (ta === 'center' || ta === 'centre' || ta === 'center-across') s.ha = 'center';
  else if (ta === 'right') s.ha = 'right';
  else if (ta === 'left') s.ha = 'left';
  else if (attrs.isNum) s.ha = 'right'; // 엑셀 '일반' 맞춤: 숫자는 오른쪽
  const va = (d['vertical-align'] || attrs.valign || '').toLowerCase();
  if (va === 'top') s.va = 'top';
  else if (va === 'middle' || va === 'center') s.va = 'middle';
  const ws = (d['white-space'] || '').toLowerCase();
  if (ws === 'normal' || ws === 'pre-wrap') s.wrap = 1;
  const all = parseBorder(d['border']);
  const bt = parseBorder(d['border-top']) ?? all;
  const br = parseBorder(d['border-right']) ?? all;
  const bb = parseBorder(d['border-bottom']) ?? all;
  const bl = parseBorder(d['border-left']) ?? all;
  if (bt) s.bt = bt;
  if (br) s.br = br;
  if (bb) s.bb = bb;
  if (bl) s.bl = bl;
  // 대각선: 엑셀은 mso-diagonal-down/up으로 준다 (구글 시트에는 대각선이 없다)
  const dd = parseBorder(d['mso-diagonal-down']);
  const du = parseBorder(d['mso-diagonal-up']);
  if (dd) s.dd = dd;
  if (du) s.du = du;
  return s;
}

/**
 * 칸의 보이는 글.
 *   - <br>만 줄 바꿈이다. HTML 안의 줄 바꿈·들여쓰기(엑셀은 긴 칸을 여러 줄로 적는다)는 공백 하나.
 *   - &nbsp;(엑셀이 앞에 넣은 공백을 보내는 모양)는 그대로 살린다. 대각선 머리칸의 "    요일 / 교시"처럼
 *     공백으로 글자 자리를 맞춘 것이 흐트러지지 않게.
 *   - 공백뿐인 칸은 빈 칸.
 */
function cellText(el: Element): string {
  const BR = '\u2028';
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('br').forEach((br) => br.replaceWith(BR));
  // 엑셀은 숨긴 글(mso-hide)이나 <style>을 칸 안에 두지 않지만, 웹에서 복사한 표는 그럴 수 있다
  clone.querySelectorAll('style,script').forEach((n) => n.remove());
  const text = (clone.textContent || '').replace(/[ \t\r\n\f\v]+/g, ' ');
  const lines = text.split(BR).map((line) => line.replace(/^ +| +$/g, '').replace(/\u00a0/g, ' '));
  const joined = lines.join('\n').replace(/^\n+|\n+$/g, '');
  return joined.trim() === '' ? '' : joined;
}

function styleKey(s: TableCellStyle): string {
  return JSON.stringify(Object.keys(s).sort().map((k) => [k, (s as any)[k]]));
}

/**
 * 붙여넣은 HTML에서 첫 번째 표를 읽는다. 표가 없으면 null.
 * 칸이 너무 많으면 { error }를 돌려준다.
 */
export function parseClipboardTable(html: string): EntryTable | { error: string } | null {
  if (!html || !/<table[\s>]/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const { byClass, td: tdDefault } = parseStyleRules(doc);

  const trs = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table);
  if (trs.length === 0) return null;

  // 격자 채우기 (colspan/rowspan)
  const grid: (TableCell | undefined)[][] = [];
  const heights: (number | undefined)[] = [];
  const styles: TableCellStyle[] = [];
  const styleIndex = new Map<string, number>();
  const styleOf = (s: TableCellStyle): number | undefined => {
    if (Object.keys(s).length === 0) return undefined;
    const k = styleKey(s);
    let i = styleIndex.get(k);
    if (i === undefined) {
      i = styles.length;
      styles.push(s);
      styleIndex.set(k, i);
    }
    return i;
  };

  let cellCount = 0;
  trs.forEach((tr, r) => {
    grid[r] = grid[r] || [];
    const trDecls = parseDecls(tr.getAttribute('style') || '');
    const h = tr.getAttribute('height') ? Number(tr.getAttribute('height')) : trDecls['height'] ? toPx(trDecls['height']) : undefined;
    heights[r] = h && Number.isFinite(h) ? Math.round(h) : undefined;
    let c = 0;
    for (const td of [...tr.children].filter((el) => /^(td|th)$/i.test(el.tagName))) {
      while (grid[r][c]) c++;
      const cs = Math.max(1, Math.min(100, Number(td.getAttribute('colspan')) || 1));
      const rs = Math.max(1, Math.min(500, Number(td.getAttribute('rowspan')) || 1));
      const classDecls = (td.getAttribute('class') || '')
        .split(/\s+/)
        .filter(Boolean)
        .reduce<Decls>((acc, cls) => ({ ...acc, ...(byClass[cls] || {}) }), {});
      const decls = { ...tdDefault, ...classDecls, ...parseDecls(td.getAttribute('style') || '') };
      const isNum = td.hasAttribute('x:num') || /^[-+]?[\d,]+(\.\d+)?%?$/.test(cellText(td));
      const style = styleFromDecls(decls, { align: td.getAttribute('align'), valign: td.getAttribute('valign'), isNum });
      if (td.tagName.toLowerCase() === 'th' && style.b === undefined) style.b = 1;
      const cell: TableCell = { v: cellText(td) };
      if (cs > 1) cell.cs = cs;
      if (rs > 1) cell.rs = rs;
      const si = styleOf(style);
      if (si !== undefined) cell.s = si;
      for (let dr = 0; dr < rs; dr++) {
        grid[r + dr] = grid[r + dr] || [];
        for (let dc = 0; dc < cs; dc++) {
          if (dr === 0 && dc === 0) grid[r][c] = cell;
          else grid[r + dr][c + dc] = { v: '', x: 1 };
        }
      }
      cellCount += cs * rs;
      if (cellCount > MAX_TABLE_CELLS * 2) break;
      c += cs;
    }
  });

  const nRows = grid.length;
  const nCols = Math.max(0, ...grid.map((row) => row.length));
  if (nRows * nCols > MAX_TABLE_CELLS) {
    return { error: `표가 너무 큽니다 (${nRows}줄 × ${nCols}열). ${MAX_TABLE_CELLS}칸까지 붙일 수 있습니다.` };
  }

  // 열 너비: <col width> (span 포함). 없으면 첫 줄 칸의 width
  const cols: number[] = [];
  for (const col of [...table.querySelectorAll('col')]) {
    const span = Math.max(1, Number(col.getAttribute('span')) || 1);
    const decls = parseDecls(col.getAttribute('style') || '');
    const w = col.getAttribute('width') ? Number(col.getAttribute('width')) : decls['width'] ? toPx(decls['width']) : 0;
    for (let i = 0; i < span; i++) cols.push(w && Number.isFinite(w) ? Math.round(w) : 0);
  }

  const rows: TableRow[] = grid.map((row, r) => {
    const cells: TableCell[] = [];
    for (let c = 0; c < nCols; c++) cells.push(row[c] ?? { v: '' });
    return heights[r] ? { h: heights[r], cells } : { cells };
  });

  const out: EntryTable = { id: newTableId(), rows, createdAt: Date.now() };
  const trimmedCols = cols.slice(0, nCols);
  if (trimmedCols.some((w) => w > 0)) out.cols = [...trimmedCols, ...Array(Math.max(0, nCols - trimmedCols.length)).fill(0)];
  if (styles.length) out.styles = styles;
  if (JSON.stringify(out).length > MAX_TABLE_JSON) {
    return { error: '표가 너무 큽니다. 범위를 나눠서 붙여 주세요.' };
  }
  return out;
}

/** 표 칸 수 (가려진 칸 포함한 격자) */
export function tableSize(t: EntryTable): { rows: number; cols: number } {
  return { rows: t.rows.length, cols: t.rows[0]?.cells.length ?? 0 };
}

/** 칸이 둘 이상인 표만 표로 붙인다. 한 칸만 복사했으면 글자로 붙이는 것이 자연스럽다 */
export function isRealTable(t: EntryTable): boolean {
  const { rows, cols } = tableSize(t);
  return rows * cols >= 2;
}

// ───────────────────────── 고치기 (칸 글자, 줄·열) ─────────────────────────

const cloneRows = (t: EntryTable): TableRow[] =>
  t.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c })) }));

/** 병합 칸 (왼쪽 위 칸의 자리와 크기) */
function anchors(rows: TableRow[]): { r: number; c: number; rs: number; cs: number }[] {
  const out: { r: number; c: number; rs: number; cs: number }[] = [];
  rows.forEach((row, r) =>
    row.cells.forEach((cell, c) => {
      if (!cell.x && ((cell.rs ?? 1) > 1 || (cell.cs ?? 1) > 1)) out.push({ r, c, rs: cell.rs ?? 1, cs: cell.cs ?? 1 });
    })
  );
  return out;
}

export function setCellText(t: EntryTable, r: number, c: number, v: string): EntryTable {
  const rows = cloneRows(t);
  if (!rows[r]?.cells[c] || rows[r].cells[c].x) return t;
  rows[r].cells[c].v = v;
  return { ...t, rows };
}

/** 줄을 at 자리에 끼운다 (at = 줄 수면 맨 아래). 새 칸은 위(없으면 아래) 줄의 서식을 따른다 */
export function insertRow(t: EntryTable, at: number): EntryTable {
  const rows = cloneRows(t);
  const n = rows[0]?.cells.length ?? 1;
  const spanning = anchors(rows).filter((a) => a.r < at && at < a.r + a.rs);
  const model = rows[at - 1] ?? rows[at];
  const cells: TableCell[] = [];
  for (let c = 0; c < n; c++) {
    const inside = spanning.some((a) => c >= a.c && c < a.c + a.cs);
    const s = model?.cells[c]?.s;
    cells.push(inside ? { v: '', x: 1 } : s !== undefined ? { v: '', s } : { v: '' });
  }
  for (const a of spanning) rows[a.r].cells[a.c].rs = a.rs + 1;
  rows.splice(at, 0, model?.h ? { h: model.h, cells } : { cells });
  return { ...t, rows };
}

/** 줄 하나를 뺀다. 병합이 걸쳐 있으면 병합을 한 줄 줄이고, 병합의 첫 줄이면 다음 줄로 넘긴다 */
export function deleteRow(t: EntryTable, at: number): EntryTable {
  if (t.rows.length <= 1) return t;
  const rows = cloneRows(t);
  for (const a of anchors(rows)) {
    if (a.r < at && at < a.r + a.rs) rows[a.r].cells[a.c].rs = a.rs - 1 > 1 ? a.rs - 1 : undefined;
    else if (a.r === at && a.rs > 1) {
      const moved = { ...rows[at].cells[a.c], rs: a.rs - 1 > 1 ? a.rs - 1 : undefined };
      delete moved.x;
      rows[at + 1].cells[a.c] = moved;
    }
  }
  rows.splice(at, 1);
  return { ...t, rows: rows.map((row) => ({ ...row, cells: row.cells.map(clean) })) };
}

/** 열을 at 자리에 끼운다 */
export function insertCol(t: EntryTable, at: number): EntryTable {
  const rows = cloneRows(t);
  const spanning = anchors(rows).filter((a) => a.c < at && at < a.c + a.cs);
  rows.forEach((row, r) => {
    const inside = spanning.some((a) => r >= a.r && r < a.r + a.rs);
    const model = row.cells[at - 1] ?? row.cells[at];
    const s = model && !model.x ? model.s : undefined;
    row.cells.splice(at, 0, inside ? { v: '', x: 1 } : s !== undefined ? { v: '', s } : { v: '' });
  });
  for (const a of spanning) rows[a.r].cells[a.c].cs = a.cs + 1;
  const cols = t.cols ? [...t.cols] : undefined;
  if (cols) cols.splice(at, 0, cols[at - 1] ?? cols[at] ?? 0);
  return { ...t, rows, ...(cols ? { cols } : {}) };
}

/** 열 하나를 뺀다 */
export function deleteCol(t: EntryTable, at: number): EntryTable {
  if ((t.rows[0]?.cells.length ?? 0) <= 1) return t;
  const rows = cloneRows(t);
  for (const a of anchors(rows)) {
    if (a.c < at && at < a.c + a.cs) rows[a.r].cells[a.c].cs = a.cs - 1 > 1 ? a.cs - 1 : undefined;
    else if (a.c === at && a.cs > 1) {
      const moved = { ...rows[a.r].cells[at], cs: a.cs - 1 > 1 ? a.cs - 1 : undefined };
      delete moved.x;
      rows[a.r].cells[at + 1] = moved;
    }
  }
  rows.forEach((row) => row.cells.splice(at, 1));
  const cols = t.cols ? t.cols.filter((_, i) => i !== at) : undefined;
  return { ...t, rows: rows.map((row) => ({ ...row, cells: row.cells.map(clean) })), ...(cols ? { cols } : {}) };
}

/** undefined 칸을 뺀다 (Firestore는 undefined를 받지 않는다) */
function clean(cell: TableCell): TableCell {
  const out: any = {};
  for (const [k, v] of Object.entries(cell)) if (v !== undefined) out[k] = v;
  return out;
}

/** 저장할 모양으로 다듬는다: undefined 없애기 */
export function tableForSave(t: EntryTable): EntryTable {
  const out: any = {
    id: t.id,
    createdAt: t.createdAt,
    rows: t.rows.map((row) => (row.h ? { h: row.h, cells: row.cells.map(clean) } : { cells: row.cells.map(clean) })),
  };
  if (t.cols) out.cols = t.cols;
  if (t.styles) out.styles = t.styles;
  return out;
}

/** 저장된 값을 믿을 수 있는 표 목록으로 (모양이 이상한 것은 뺀다) */
export function normalizeTables(raw: unknown): EntryTable[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is EntryTable =>
      !!t && typeof t === 'object' && Array.isArray((t as any).rows) && (t as any).rows.every((r: any) => r && Array.isArray(r.cells))
  );
}

/**
 * 대각선을 칸 배경으로 그린다. 칸 크기에 맞춰 늘어나는 SVG 선이라, 굵기는 그대로 두고
 * 점선·파선도 그린다. 색은 safeColor를 거친 #rrggbb 뿐이라 URL에 그대로 넣어도 안전하다.
 */
function diagonalImage(spec: string, down: boolean): string | undefined {
  const m = /^(\d)px (solid|dashed|dotted|double) (#[0-9a-f]{3,6})$/.exec(spec);
  if (!m) return undefined;
  const width = m[2] === 'double' ? 1 : Number(m[1]);
  const dash = m[2] === 'dashed' ? " stroke-dasharray='6 3'" : m[2] === 'dotted' ? " stroke-dasharray='1 2'" : '';
  const [y1, y2] = down ? [0, 100] : [100, 0];
  const line = (offset: number) =>
    `<line x1='0' y1='${y1 + offset}' x2='100' y2='${y2 + offset}' stroke='${m[3]}' stroke-width='${width}' vector-effect='non-scaling-stroke'${dash}/>`;
  // 이중선은 가는 선 두 줄
  const lines = m[2] === 'double' ? line(-1.5) + line(1.5) : line(0);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>${lines}</svg>`;
  return `url("data:image/svg+xml,${svg.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}")`;
}

/** 칸 서식 → 화면 스타일 */
export function cellCss(s?: TableCellStyle): Record<string, string | number> {
  if (!s) return {};
  const css: Record<string, string | number> = {};
  if (s.bg) css.backgroundColor = s.bg;
  if (s.c) css.color = s.c;
  if (s.b) css.fontWeight = 700;
  if (s.i) css.fontStyle = 'italic';
  if (s.u) css.textDecoration = 'underline';
  if (s.fs) css.fontSize = `${s.fs}pt`;
  if (s.ha) css.textAlign = s.ha;
  if (s.va) css.verticalAlign = s.va;
  if (s.bt) css.borderTop = s.bt;
  if (s.br) css.borderRight = s.br;
  if (s.bb) css.borderBottom = s.bb;
  if (s.bl) css.borderLeft = s.bl;
  const diagonals = [s.dd && diagonalImage(s.dd, true), s.du && diagonalImage(s.du, false)].filter(Boolean);
  if (diagonals.length) {
    css.backgroundImage = diagonals.join(', ');
    css.backgroundSize = '100% 100%';
    css.backgroundRepeat = 'no-repeat';
  }
  return css;
}
