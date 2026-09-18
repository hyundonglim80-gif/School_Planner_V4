// src/lib/sheetsSync.ts
//
// 구글 시트로 내보내고 시트에서 되읽는다. V3의 backupGoogle.js / backupData.js를
// 옮겨 왔고, 시트의 칸 모양도 V3와 같게 맞췄다. 같은 계정이 두 앱을 오가며
// 같은 시트 하나를 쓰기 때문이다.
//
//   '일정기록' 시트
//     날짜 | 일정 | 1교시..N교시 | 기록 | 일정 메타데이터 | 기록 메타데이터
//     일정·기록 한 줄:  [v] [라벨] 내용      ([v]는 완료 표시)
//     교시 한 칸:       [과목] 메모 [준비물]
//     메타데이터는 id 같은 것을 담는다. 이게 있어야 되읽을 때 같은 항목으로
//     알아본다. 사람이 고치는 칸이 아니라 머리말에 '수정금지'를 적어 둔다.
//
//   '메모' 시트
//     데이터분류 | ID | 내용/이름 | 완료여부(O/X) | 라벨 | 주소/URL | 생성일자
//
//   '조사표_2026-4-1' 시트 (학급마다 하나)
//     머리말 여덟 줄이 조사표 하나하나를 가리키고, 그 아래로 학생 한 명이 한
//     줄이다. 조사표가 무엇인지(제목·유형·학생 명단)는 '일정기록' 시트의
//     조사표 칸에 JSON으로 들어 있고, 이 탭에는 학생별 결과만 담긴다. 사람이
//     손으로 고치는 자리가 이 표다.
import { doc, getDoc, setDoc, getDocs, collection, query, where, documentId } from 'firebase/firestore';
import { db } from './firebase';
import { googleFetch } from './googleApi';
import { readEventList, eventContentOf, eventDocPayload } from './eventText';
import { labelNamesOf, dateRange, type LabelDef } from './calendarSync';

const SHEET_SCHEDULE = '일정기록';
const SHEET_MEMO = '메모';

export interface SheetsScope {
  /** 'personal' 또는 그룹 id */
  scope: string;
  colPathOf: (col: 'events' | 'schedules' | 'journals' | 'tasks' | 'evaluations') => string;
}

export interface SheetsInclude {
  event: boolean;
  class: boolean;
  journal: boolean;
  evaluation: boolean;
  memo: boolean;
}

// ── 한 줄 만들기 / 읽기 ────────────────────────────────────────────────

/** '[v] [회의, 공문] 학년 협의회' */
export function formatItemLine(content: string, labelNames: string[], completed: boolean, fallback: string): string {
  const labelStr = labelNames.length > 0 ? labelNames.join(', ') : fallback;
  return `${completed ? '[v] ' : ''}[${labelStr}] ${content}`;
}

export interface ParsedLine {
  content: string;
  labels: string[];
  completed: boolean;
}

export function parseItemLine(line: string): ParsedLine | null {
  let text = (line || '').trim();
  if (!text) return null;

  let completed = false;
  if (/^\[v\]/i.test(text)) {
    completed = true;
    text = text.slice(3).trim();
  }

  const match = text.match(/^\[(.*?)\]\s*(.*)$/);
  if (!match) return { content: text, labels: [], completed };

  return {
    content: match[2].trim(),
    labels: match[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    completed,
  };
}

/** '[국어] 단원평가 [학습지]' */
export function formatPeriodCell(p: any): string {
  if (!p) return '';
  const parts: string[] = [];
  if (p.subject?.trim()) parts.push(`[${p.subject.trim()}]`);
  if (p.memo?.trim()) parts.push(p.memo.trim());
  if (p.supplies?.trim()) parts.push(`[${p.supplies.trim()}]`);
  return parts.join(' ').trim();
}

export function parsePeriodCell(cell: string): { subject: string; memo: string; supplies: string } {
  let text = (cell || '').trim();
  if (!text) return { subject: '', memo: '', supplies: '' };

  let supplies = '';
  const brackets = text.match(/\[.*?\]/g);
  // 묶음이 둘 이상이면 마지막 것이 준비물이다
  if (brackets && brackets.length >= 2) {
    const last = text.match(/\[([^\]]+)\]\s*$/);
    if (last) {
      supplies = last[1].trim();
      text = text.replace(/\[([^\]]+)\]\s*$/, '').trim();
    }
  }

  const first = text.match(/^\[(.*?)\]/);
  if (first) {
    return { subject: first[1].trim(), memo: text.replace(/^\[(.*?)\]\s*/, '').trim(), supplies };
  }
  return { subject: '', memo: text, supplies };
}

// ── '일정기록' 시트 ────────────────────────────────────────────────────

export interface ScheduleSheetArgs {
  dates: string[];
  events: Record<string, any>;
  schedules: Record<string, any>;
  journals: Record<string, any>;
  evaluations: Record<string, any>;
  include: SheetsInclude;
  periodNames: string[];
  eventLabels: LabelDef[];
  journalLabels: LabelDef[];
}

export function buildScheduleRows(args: ScheduleSheetArgs): string[][] {
  const { dates, events, schedules, journals, evaluations, include, periodNames, eventLabels, journalLabels } = args;

  const header = ['날짜'];
  if (include.event) header.push('일정');
  if (include.class) periodNames.forEach((p) => header.push(p));
  if (include.journal) header.push('기록');
  if (include.evaluation) header.push('조사표');
  if (include.event) header.push('일정 메타데이터 (수정금지)');
  if (include.journal) header.push('기록 메타데이터 (수정금지)');

  const rows: string[][] = [header];

  for (const dateStr of dates) {
    const row: string[] = [dateStr];
    let eventMeta = '';
    let journalMeta = '';

    if (include.event) {
      const list = events[dateStr] ? readEventList(events[dateStr]) : [];
      row.push(
        list
          .map((e: any) => formatItemLine(eventContentOf(e), labelNamesOf(e, eventLabels), !!e.completed, '일정'))
          .join('\n')
      );
      eventMeta = JSON.stringify(
        list.map((e: any) => ({
          id: e.id || '',
          forwardChainId: e.forwardChainId || null,
          authorId: e.authorId || null,
          originalDate: e.originalDate || null,
        }))
      );
    }

    if (include.class) {
      const periods = schedules[dateStr]?.periods || {};
      for (let i = 1; i <= periodNames.length; i++) row.push(formatPeriodCell(periods[i]));
    }

    if (include.journal) {
      const entries = journals[dateStr]?.entries || [];
      row.push(
        entries
          .map((j: any) => formatItemLine(j.content || '', labelNamesOf(j, journalLabels), !!j.completed, '기록'))
          .join('\n')
      );
      journalMeta = JSON.stringify(entries.map((j: any) => ({ id: j.id || '', authorId: j.authorId || null })));
    }

    // 조사표가 무엇인지는 이 칸에 JSON 한 덩이로 담는다. 학생별 결과는 학급별
    // 탭에 표로 한 번 더 들어간다. 사람이 고치는 자리는 그 표다.
    if (include.evaluation) row.push(JSON.stringify(readEvalList(evaluations[dateStr])));
    if (include.event) row.push(eventMeta);
    if (include.journal) row.push(journalMeta);

    rows.push(row);
  }

  return rows;
}

export interface ParsedSchedule {
  events: Record<string, any[]>;
  schedules: Record<string, Record<number, any>>;
  journals: Record<string, any[]>;
  evaluations: Record<string, any[]>;
}

/** 시트에서 읽은 줄들을 앱이 쓰는 모양으로 되돌린다 */
export function parseScheduleRows(rows: string[][], include: SheetsInclude): ParsedSchedule {
  const out: ParsedSchedule = { events: {}, schedules: {}, journals: {}, evaluations: {} };
  if (!rows || rows.length < 2) return out;

  const header = rows[0].map((h) => String(h ?? ''));
  const findIdx = (test: (h: string) => boolean) => header.findIndex((h) => test(h));

  const dateIdx = findIdx((h) => h.includes('날짜'));
  const eventIdx = findIdx((h) => h.includes('일정') && !h.includes('메타'));
  const journalIdx = findIdx((h) => h.includes('기록') && !h.includes('메타'));
  const eventMetaIdx = findIdx((h) => h.includes('일정 메타'));
  const journalMetaIdx = findIdx((h) => h.includes('기록 메타'));
  const evalIdx = findIdx((h) => h.trim() === '조사표');
  if (dateIdx === -1) return out;

  // 남는 칸이 교시다. 머리말에 교시 이름이 그대로 적혀 있으므로 자리로 센다.
  // 조사표 칸을 여기 빠뜨리면 그 칸까지 교시로 세어 수업이 한 칸씩 밀린다.
  const known = new Set(
    [dateIdx, eventIdx, journalIdx, eventMetaIdx, journalMetaIdx, evalIdx].filter((i) => i !== -1)
  );
  const periodCols: number[] = [];
  for (let i = 0; i < header.length; i++) if (!known.has(i)) periodCols.push(i);

  const readMeta = (cell: string): any[] => {
    if (!cell || !cell.trim()) return [];
    try {
      const parsed = JSON.parse(cell);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const toItems = (text: string, metaCell: string, kind: 'event' | 'journal') => {
    const meta = readMeta(metaCell);
    const prefix = kind === 'journal' ? 'jr_' : 'ev_';
    return String(text || '')
      .split('\n')
      .map((line) => parseItemLine(line))
      .filter((p): p is ParsedLine => p !== null)
      .map((p, idx) => {
        const m = meta[idx] || {};
        const id =
          typeof m.id === 'string' && m.id.trim()
            ? m.id
            : `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const labels = p.labels.length > 0 ? p.labels : [];
        return {
          id,
          content: p.content,
          text: p.content, // V3 호환
          completed: p.completed,
          // 이름으로 담는다. 라벨 id는 앱마다 다를 수 있어 되읽을 때 맞지 않는다.
          label: labels[0] || '',
          labels,
          labelIds: labels,
          ...(m.forwardChainId ? { forwardChainId: m.forwardChainId } : {}),
          ...(m.authorId ? { authorId: m.authorId } : {}),
          ...(m.originalDate ? { originalDate: m.originalDate } : {}),
        };
      });
  };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const dateStr = String(row[dateIdx] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

    if (include.event && eventIdx !== -1) {
      out.events[dateStr] = toItems(row[eventIdx], eventMetaIdx !== -1 ? row[eventMetaIdx] : '', 'event');
    }
    if (include.journal && journalIdx !== -1) {
      out.journals[dateStr] = toItems(row[journalIdx], journalMetaIdx !== -1 ? row[journalMetaIdx] : '', 'journal');
    }
    if (include.evaluation && evalIdx !== -1) {
      const list = readEvalJson(row[evalIdx]);
      if (list.length > 0) out.evaluations[dateStr] = list;
    }
    if (include.class && periodCols.length > 0) {
      const periods: Record<number, any> = {};
      periodCols.forEach((col, i) => {
        periods[i + 1] = parsePeriodCell(row[col]);
      });
      out.schedules[dateStr] = periods;
    }
  }

  return out;
}

// ── '조사표_학년도-학년-반' 시트 ──────────────────────────────────────

export const EVAL_SHEET_PREFIX = '조사표_';

const COL_GROUP_NAME = '조이름';
const COL_GROUP_SCORE = '조별결과';
const COL_INDIV_SCORE = '개별결과';
const COL_REASON = '미평가사유(메모)';
const COL_CHECK = '체크결과';
const COL_MEMO = '메모내용';

/** V3는 evalList, V4는 list라는 이름으로 같은 목록을 담는다 */
export function readEvalList(data: any): any[] {
  if (!data) return [];
  const list = data.list || data.evalList || [];
  return Array.isArray(list) ? list : [];
}

/** 일정기록 시트의 조사표 칸(JSON 한 덩이)을 목록으로 되돌린다 */
export function readEvalJson(cell: string): any[] {
  let text = String(cell ?? '').trim();
  if (!text) return [];
  // 시트가 앞에 작은따옴표를 붙여 두는 일이 있다. V3도 같은 것을 벗겨 낸다.
  if (text.startsWith("'")) text = text.slice(1);
  if (text.endsWith("'")) text = text.slice(0, -1);
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 조사표가 어느 학급 탭으로 가는지. 학급을 모르면 '조사표_기타'로 모은다. */
export function evalSheetNameOf(rosterMeta: any): string {
  if (rosterMeta?.year) {
    return `${EVAL_SHEET_PREFIX}${rosterMeta.year}-${rosterMeta.grade}-${rosterMeta.classNum}`;
  }
  return `${EVAL_SHEET_PREFIX}기타`;
}

/**
 * 평가 방식.
 *
 * V3는 한때 method라는 글자 하나로 적었고 지금은 methodObj를 쓴다. 옛 자료가
 * 그대로 남아 있어 둘 다 읽는다.
 */
function methodOf(ev: any): { indiv: boolean; group: boolean } {
  if (ev?.type !== 'eval') return { indiv: false, group: false };
  if (ev.methodObj) return { indiv: !!ev.methodObj.indiv, group: !!ev.methodObj.group };
  return { indiv: ev.method !== 'group', group: ev.method === 'group' };
}

/** 한 학급 안에서 학생 하나를 가리키는 열쇠. 번호만으로는 모자란다. */
function studentKeyOf(num: number | string, name: string): string {
  return `${num} ${String(name || '').trim()}`;
}

/** 조사표 하나가 표에서 차지하는 칸 이름들 */
function columnsOf(ev: any): string[] {
  if (ev?.type === 'eval') {
    const { indiv, group } = methodOf(ev);
    const cols: string[] = [];
    if (group) cols.push(COL_GROUP_NAME, COL_GROUP_SCORE);
    if (indiv) cols.push(COL_INDIV_SCORE);
    cols.push(COL_REASON);
    return cols;
  }
  if (ev?.type === 'check') return [COL_CHECK, COL_REASON];
  return [COL_MEMO];
}

/** 날짜별 조사표를 학급별 탭으로 나눈다 */
export function groupEvalsBySheet(evaluations: Record<string, any>): Record<string, any[]> {
  const bySheet: Record<string, any[]> = {};
  for (const [dateStr, data] of Object.entries(evaluations)) {
    for (const ev of readEvalList(data)) {
      const name = evalSheetNameOf(ev.rosterMeta);
      if (!bySheet[name]) bySheet[name] = [];
      bySheet[name].push({ ...ev, dateStr: ev.dateStr || dateStr });
    }
  }
  return bySheet;
}

/**
 * 학급 탭 하나를 만든다.
 *
 * 머리말이 여덟 줄인 것은 조사표 하나가 칸을 여럿 차지하기 때문이다. 제목과
 * id는 첫 칸에만 적고 나머지는 비워 둔다. 읽을 때는 빈 칸을 바로 앞 조사표에
 * 딸린 것으로 본다. V3가 쓰는 모양 그대로다.
 */
export function buildEvalRows(evals: any[]): string[][] {
  // 번호가 아니라 번호와 이름을 함께 열쇠로 삼는다. 전출한 학생의 번호를
  // 전입한 학생이 이어받는 일이 있는데, 번호만으로 묶으면 둘이 한 줄이 되어
  // 나중에 온 학생의 이름과 점수가 통째로 사라진다.
  const studentMap = new Map<string, any>();
  for (const ev of evals) {
    for (const st of ev.studentsSnapshot || []) {
      const key = studentKeyOf(st.num, st.name);
      if (!studentMap.has(key)) studentMap.set(key, st);
    }
  }
  const students = Array.from(studentMap.values()).sort(
    (a, b) => a.num - b.num || String(a.name || '').localeCompare(String(b.name || ''))
  );

  const rows: string[][] = [
    ['상위 항목(조사표 제목)', '', ''],
    ['조사표 ID (수정금지)', '', ''],
    ['하위 항목(날짜)', '', ''],
    ['하위 항목(교시)', '', ''],
    ['하위 항목(유형)', '', ''],
    ['하위 항목(교과)', '', ''],
    ['하위 항목(방식)', '', ''],
    ['번호', '이름', '성별'],
  ];

  for (const ev of evals) {
    const cols = columnsOf(ev);
    const { indiv, group } = methodOf(ev);
    // 첫 칸에만 적고 나머지는 빈 칸으로 채운다
    const spread = (v: string) => [v, ...Array(cols.length - 1).fill('')];

    rows[0].push(...spread(ev.title || ''));
    rows[1].push(...spread(ev.id || ''));
    rows[2].push(...spread(ev.dateStr || ''));
    rows[3].push(...spread(ev.periodStr ? `${ev.periodStr}교시` : ''));
    rows[4].push(...spread(ev.type === 'eval' ? '평가' : ev.type === 'check' ? '체크' : '메모'));
    rows[5].push(...spread(ev.subject || ''));
    rows[6].push(...spread([indiv ? '개인' : '', group ? '조별' : ''].filter(Boolean).join(', ')));
    rows[7].push(...cols);
  }

  for (const st of students) {
    const row = [String(st.num), st.name || '', st.gender || ''];
    for (const ev of evals) {
      const rec = (ev.records || {})[st.num] || {};
      if (ev.type === 'eval') {
        const { indiv, group } = methodOf(ev);
        if (group) row.push(rec.groupName || '', rec.groupScore || '');
        if (indiv) row.push(rec.indivScore || rec.score || '');
        row.push(rec.reason || '');
      } else if (ev.type === 'check') {
        row.push(rec.checked === true ? 'O' : rec.checked === false ? 'X' : '', rec.reason || '');
      } else {
        row.push(rec.memo || '');
      }
    }
    rows.push(row);
  }

  return rows;
}

/** 학급 탭의 한 칸이 누구의 무슨 값인지 */
export interface EvalCellUpdate {
  evalId: string;
  studentNum: number;
  /** 번호를 이어받은 학생을 가려내려면 이름이 있어야 한다 */
  studentName: string;
  colName: string;
  value: string;
}

/** 학급 탭을 읽어 학생별 결과를 뽑는다 */
export function parseEvalRows(rows: string[][]): EvalCellUpdate[] {
  const out: EvalCellUpdate[] = [];
  if (!rows || rows.length < 8) return out;

  const idRow = rows.find((r) => r[0] === '조사표 ID (수정금지)');
  const headerRow = rows.find((r) => r[0] === '번호' && r[1] === '이름');
  if (!idRow || !headerRow) return out;

  // 조사표 하나가 칸을 여럿 차지한다. id는 첫 칸에만 적혀 있으므로, 빈 칸은
  // 바로 앞에 나온 id에 딸린 것으로 본다.
  const colMap: Record<number, { evalId: string; colName: string }> = {};
  let currentId = '';
  for (let c = 3; c < headerRow.length; c++) {
    const cell = String(idRow[c] ?? '').trim();
    if (cell) currentId = cell;
    if (currentId) colMap[c] = { evalId: currentId, colName: String(headerRow[c] ?? '').trim() };
  }

  for (const row of rows.slice(rows.indexOf(headerRow) + 1)) {
    const num = parseInt(String(row[0] ?? ''), 10);
    if (isNaN(num)) continue;
    const name = String(row[1] ?? '').trim();
    for (let c = 3; c < row.length; c++) {
      const m = colMap[c];
      if (!m) continue;
      out.push({
        evalId: m.evalId,
        studentNum: num,
        studentName: name,
        colName: m.colName,
        value: String(row[c] ?? '').trim(),
      });
    }
  }

  return out;
}

/**
 * 표에서 읽은 값을 조사표에 되붙인다.
 *
 * 조사표가 무엇인지는 '일정기록' 시트의 조사표 칸에 들어 있다. 학급 탭에는
 * 결과만 있어 id로 짝을 맞춰 얹는다. 짝이 없는 값은 버린다. 시트에만 남아
 * 있는 조사표를 되살리지 않기 위해서다.
 *
 * 학생은 번호가 아니라 그 조사표가 담고 있는 명단을 따라 맞춘다. 전출한
 * 학생의 번호를 전입한 학생이 이어받으면 한 학급 탭에 같은 번호가 두 줄
 * 생기는데, 번호만 보면 남의 점수를 가져다 붙이게 된다. 이름까지 같은 줄을
 * 찾고, 그 번호를 쓰는 줄이 하나뿐일 때만 이름이 달라도 같은 학생으로 본다.
 * (사람이 시트에서 이름을 고쳤을 수 있다.)
 */
export function applyEvalUpdates(evaluations: Record<string, any[]>, updates: EvalCellUpdate[]): number {
  if (updates.length === 0) return 0;

  // 조사표 → 번호 → [{ 이름, 칸값 }]
  const byEval: Record<string, Record<number, Array<{ name: string; cells: Record<string, string> }>>> = {};
  for (const u of updates) {
    if (!byEval[u.evalId]) byEval[u.evalId] = {};
    if (!byEval[u.evalId][u.studentNum]) byEval[u.evalId][u.studentNum] = [];
    const forNum = byEval[u.evalId][u.studentNum];
    let entry = forNum.find((e) => e.name === u.studentName);
    if (!entry) {
      entry = { name: u.studentName, cells: {} };
      forNum.push(entry);
    }
    entry.cells[u.colName] = u.value;
  }

  let touched = 0;
  for (const list of Object.values(evaluations)) {
    for (const ev of list) {
      const perStudent = byEval[ev.id];
      if (!perStudent) continue;
      if (!ev.records) ev.records = {};

      // 이 조사표가 담고 있는 학생만 본다. 명단이 없는 옛 조사표는 번호대로
      // 맞추는 수밖에 없다.
      const snapshot: any[] =
        ev.studentsSnapshot?.length > 0
          ? ev.studentsSnapshot
          : Object.keys(perStudent).map((n) => ({ num: Number(n), name: '' }));

      for (const st of snapshot) {
        const forNum = perStudent[st.num];
        if (!forNum || forNum.length === 0) continue;

        const wanted = String(st.name || '').trim();
        const matched = forNum.find((e) => e.name === wanted) || (forNum.length === 1 ? forNum[0] : null);
        if (!matched) continue;
        const cells = matched.cells;

        const num = st.num;
        if (!ev.records[num]) ev.records[num] = {};
        const rec = ev.records[num];

        if (ev.type === 'eval') {
          if (cells[COL_GROUP_NAME] !== undefined) rec.groupName = cells[COL_GROUP_NAME];
          if (cells[COL_GROUP_SCORE] !== undefined) rec.groupScore = cells[COL_GROUP_SCORE];
          if (cells[COL_INDIV_SCORE] !== undefined) {
            rec.indivScore = cells[COL_INDIV_SCORE];
            rec.score = cells[COL_INDIV_SCORE]; // V3 호환
          }
          if (cells[COL_REASON] !== undefined) rec.reason = cells[COL_REASON];
        } else if (ev.type === 'check') {
          if (cells[COL_CHECK] !== undefined) {
            if (cells[COL_CHECK] === 'O') rec.checked = true;
            else if (cells[COL_CHECK] === 'X') rec.checked = false;
            else delete rec.checked;
          }
          if (cells[COL_REASON] !== undefined) rec.reason = cells[COL_REASON];
        } else if (cells[COL_MEMO] !== undefined) {
          rec.memo = cells[COL_MEMO];
        }
        touched++;
      }
    }
  }

  return touched;
}

// ── '메모' 시트 ────────────────────────────────────────────────────────

export function buildMemoRows(tasks: Array<{ id: string; data: any }>): string[][] {
  const rows: string[][] = [['데이터분류', 'ID', '내용/이름', '완료여부(O/X)', '라벨', '주소/URL', '생성일자(타임스탬프)']];
  for (const { id, data } of tasks) {
    rows.push([
      'MEMO',
      id,
      data.content || data.text || '',
      data.completed ? 'O' : 'X',
      (data.labels || []).join(','),
      data.imageUrl || '',
      String(data.createdAt || ''),
    ]);
  }
  return rows;
}

export interface ParsedMemo {
  id: string;
  content: string;
  completed: boolean;
  labels: string[];
  imageUrl: string;
  createdAt: number;
}

export function parseMemoRows(rows: string[][]): ParsedMemo[] {
  if (!rows || rows.length < 2) return [];
  const out: ParsedMemo[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    // V3는 링크(LINK)도 같은 시트에 담는다. 메모만 가져온다.
    if (String(row[0] ?? '').trim().toUpperCase() !== 'MEMO') continue;
    const id = String(row[1] ?? '').trim();
    const content = String(row[2] ?? '').trim();
    if (!id || !content) continue;

    out.push({
      id,
      content,
      completed: String(row[3] ?? '').trim().toUpperCase() === 'O',
      labels: String(row[4] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      imageUrl: String(row[5] ?? '').trim(),
      createdAt: Number(row[6]) || Date.now(),
    });
  }
  return out;
}

// ── 시트 파일 ──────────────────────────────────────────────────────────

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * 연결된 시트를 찾고 없으면 만든다.
 * 주소는 V3와 같은 자리(users/{uid}/settings/backup_config)에 둔다.
 */
export async function getOrCreateSpreadsheet(token: string, uid: string): Promise<string> {
  const configRef = doc(db, 'users', uid, 'settings', 'backup_config');
  const snap = await getDoc(configRef);
  let spreadsheetId: string | null = snap.exists() ? snap.data().spreadsheetId || null : null;

  // 적어 둔 시트가 지워졌을 수 있다
  if (spreadsheetId) {
    try {
      await googleFetch(`${SHEETS_API}/${spreadsheetId}?fields=spreadsheetId`, 'GET', token);
    } catch {
      spreadsheetId = null;
    }
  }

  if (!spreadsheetId) {
    const created = await googleFetch<any>(SHEETS_API, 'POST', token, {
      properties: { title: '업무 및 수업 계획표 클라우드 백업' },
      sheets: [{ properties: { title: SHEET_SCHEDULE } }, { properties: { title: SHEET_MEMO } }],
    });
    spreadsheetId = created.spreadsheetId;
    await setDoc(configRef, { spreadsheetId, updatedAt: Date.now() }, { merge: true });
  }

  return spreadsheetId!;
}

async function ensureSheetExists(token: string, spreadsheetId: string, title: string) {
  try {
    await googleFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, 'POST', token, {
      requests: [{ addSheet: { properties: { title } } }],
    });
  } catch {
    // 이미 있으면 실패한다. 그게 정상이다.
  }
}

/** 시트 파일 안에 든 탭 이름들. 학급 탭이 몇 개인지 미리 알 수 없어 물어본다. */
async function listSheetTitles(token: string, spreadsheetId: string): Promise<string[]> {
  try {
    const meta = await googleFetch<any>(
      `${SHEETS_API}/${spreadsheetId}?fields=sheets.properties.title`,
      'GET',
      token
    );
    return (meta?.sheets || []).map((s: any) => String(s?.properties?.title || '')).filter(Boolean);
  } catch {
    return [];
  }
}

async function writeValues(token: string, spreadsheetId: string, sheet: string, values: string[][], clear: boolean) {
  if (clear) {
    await googleFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${sheet}!A:Z`)}:clear`, 'POST', token, {});
  }
  await googleFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${sheet}!A1`)}?valueInputOption=USER_ENTERED`,
    'PUT',
    token,
    { values }
  );
}

async function readValues(token: string, spreadsheetId: string, sheet: string): Promise<string[][]> {
  const res = await googleFetch<any>(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${sheet}!A:Z`)}`,
    'GET',
    token
  );
  return res?.values || [];
}

// ── 내보내기 / 가져오기 ────────────────────────────────────────────────

export interface SheetsExportArgs extends SheetsScope {
  token: string;
  uid: string;
  startStr: string;
  endStr: string;
  include: SheetsInclude;
  periodNames: string[];
  eventLabels: LabelDef[];
  journalLabels: LabelDef[];
  onProgress?: (msg: string) => void;
}

async function readRange(colPath: string, startStr: string, endStr: string) {
  const ref = collection(db, colPath);
  const snap = await getDocs(query(ref, where(documentId(), '>=', startStr), where(documentId(), '<=', endStr)));
  const map: Record<string, any> = {};
  snap.forEach((d) => (map[d.id] = d.data()));
  return map;
}

export async function exportToSheets(
  args: SheetsExportArgs
): Promise<{ spreadsheetId: string; days: number; memos: number; evaluations: number }> {
  const { token, uid, startStr, endStr, include, colPathOf, onProgress } = args;

  onProgress?.('시트 파일을 확인하는 중...');
  const spreadsheetId = await getOrCreateSpreadsheet(token, uid);

  let days = 0;
  let evaluations = 0;
  if (include.event || include.class || include.journal || include.evaluation) {
    onProgress?.('일정·수업·기록·조사표를 모으는 중...');
    const [events, schedules, journals, evals] = await Promise.all([
      include.event ? readRange(colPathOf('events'), startStr, endStr) : Promise.resolve({}),
      include.class ? readRange(colPathOf('schedules'), startStr, endStr) : Promise.resolve({}),
      include.journal ? readRange(colPathOf('journals'), startStr, endStr) : Promise.resolve({}),
      include.evaluation ? readRange(colPathOf('evaluations'), startStr, endStr) : Promise.resolve({}),
    ]);

    const dates = dateRange(startStr, endStr);
    days = dates.length;
    const rows = buildScheduleRows({ ...args, dates, events, schedules, journals, evaluations: evals });

    onProgress?.('시트에 쓰는 중...');
    await ensureSheetExists(token, spreadsheetId, SHEET_SCHEDULE);
    // 기간 안의 모든 날짜를 다시 쓰므로, 남아 있던 옛 줄은 지우고 시작한다
    await writeValues(token, spreadsheetId, SHEET_SCHEDULE, rows, true);

    // 조사표는 학급별 탭에 표로 한 번 더 쓴다. 위의 조사표 칸은 JSON이라
    // 사람이 고칠 수 없다. 점수를 손으로 고치는 자리가 이 표다.
    if (include.evaluation) {
      const bySheet = groupEvalsBySheet(evals);
      for (const [sheetName, list] of Object.entries(bySheet)) {
        onProgress?.(`조사표를 [${sheetName}]에 쓰는 중...`);
        await ensureSheetExists(token, spreadsheetId, sheetName);
        await writeValues(token, spreadsheetId, sheetName, buildEvalRows(list), true);
        evaluations += list.length;
      }
    }
  }

  let memos = 0;
  if (include.memo) {
    onProgress?.('메모를 모으는 중...');
    const snap = await getDocs(collection(db, colPathOf('tasks')));
    const tasks: Array<{ id: string; data: any }> = [];
    snap.forEach((d) => tasks.push({ id: d.id, data: d.data() }));
    tasks.sort((a, b) => (a.data.createdAt || 0) - (b.data.createdAt || 0));
    memos = tasks.length;

    await ensureSheetExists(token, spreadsheetId, SHEET_MEMO);
    await writeValues(token, spreadsheetId, SHEET_MEMO, buildMemoRows(tasks), true);
  }

  return { spreadsheetId, days, memos, evaluations };
}

export interface SheetsImportArgs extends SheetsScope {
  token: string;
  uid: string;
  include: SheetsInclude;
  onProgress?: (msg: string) => void;
}

export async function importFromSheets(
  args: SheetsImportArgs
): Promise<{ events: number; schedules: number; journals: number; memos: number; evaluations: number }> {
  const { token, uid, include, colPathOf, onProgress } = args;

  const snap = await getDoc(doc(db, 'users', uid, 'settings', 'backup_config'));
  const spreadsheetId = snap.exists() ? snap.data().spreadsheetId : null;
  if (!spreadsheetId) {
    throw new Error("연결된 시트가 없습니다. 먼저 '내보내기'를 한 번 해주세요.");
  }

  const counts = { events: 0, schedules: 0, journals: 0, memos: 0, evaluations: 0 };

  if (include.event || include.class || include.journal || include.evaluation) {
    onProgress?.('시트를 읽는 중...');
    const parsed = parseScheduleRows(await readValues(token, spreadsheetId, SHEET_SCHEDULE), include);

    // 조사표가 무엇인지는 위에서 읽은 JSON에 들어 있고, 학생별 결과는 학급별
    // 탭에 표로 들어 있다. 사람이 고치는 자리가 표이므로 표를 나중에 얹는다.
    if (include.evaluation) {
      const updates: EvalCellUpdate[] = [];
      for (const title of await listSheetTitles(token, spreadsheetId)) {
        if (!title.startsWith(EVAL_SHEET_PREFIX)) continue;
        onProgress?.(`[${title}]를 읽는 중...`);
        updates.push(...parseEvalRows(await readValues(token, spreadsheetId, title)));
      }
      applyEvalUpdates(parsed.evaluations, updates);

      onProgress?.('조사표를 되돌리는 중...');
      for (const [dateStr, list] of Object.entries(parsed.evaluations)) {
        // 두 이름에 같이 쓴다. 한쪽만 쓰면 다른 앱이 옛 목록을 계속 보게 된다.
        await setDoc(
          doc(db, colPathOf('evaluations'), dateStr),
          { list, evalList: list, updatedAt: Date.now() },
          { merge: true }
        );
        counts.evaluations += list.length;
      }
    }

    onProgress?.('일정·수업·기록을 되돌리는 중...');
    for (const [dateStr, list] of Object.entries(parsed.events)) {
      await setDoc(doc(db, colPathOf('events'), dateStr), eventDocPayload(list), { merge: true });
      counts.events += list.length;
    }
    for (const [dateStr, periods] of Object.entries(parsed.schedules)) {
      await setDoc(doc(db, colPathOf('schedules'), dateStr), { periods, updatedAt: Date.now() }, { merge: true });
      counts.schedules++;
    }
    for (const [dateStr, entries] of Object.entries(parsed.journals)) {
      await setDoc(doc(db, colPathOf('journals'), dateStr), { entries, updatedAt: Date.now() }, { merge: true });
      counts.journals += entries.length;
    }
  }

  if (include.memo) {
    onProgress?.('메모를 되돌리는 중...');
    const memos = parseMemoRows(await readValues(token, spreadsheetId, SHEET_MEMO));
    for (const memo of memos) {
      await setDoc(
        doc(db, colPathOf('tasks'), memo.id),
        {
          content: memo.content,
          text: memo.content, // V3 호환
          completed: memo.completed,
          labels: memo.labels,
          ...(memo.imageUrl ? { imageUrl: memo.imageUrl } : {}),
          createdAt: memo.createdAt,
        },
        { merge: true }
      );
    }
    counts.memos = memos.length;
  }

  return counts;
}

export const sheetUrlOf = (spreadsheetId: string) => `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
