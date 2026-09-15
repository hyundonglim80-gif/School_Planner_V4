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
  colPathOf: (col: 'events' | 'schedules' | 'journals' | 'tasks') => string;
}

export interface SheetsInclude {
  event: boolean;
  class: boolean;
  journal: boolean;
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
  include: SheetsInclude;
  periodNames: string[];
  eventLabels: LabelDef[];
  journalLabels: LabelDef[];
}

export function buildScheduleRows(args: ScheduleSheetArgs): string[][] {
  const { dates, events, schedules, journals, include, periodNames, eventLabels, journalLabels } = args;

  const header = ['날짜'];
  if (include.event) header.push('일정');
  if (include.class) periodNames.forEach((p) => header.push(p));
  if (include.journal) header.push('기록');
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
}

/** 시트에서 읽은 줄들을 앱이 쓰는 모양으로 되돌린다 */
export function parseScheduleRows(rows: string[][], include: SheetsInclude): ParsedSchedule {
  const out: ParsedSchedule = { events: {}, schedules: {}, journals: {} };
  if (!rows || rows.length < 2) return out;

  const header = rows[0].map((h) => String(h ?? ''));
  const findIdx = (test: (h: string) => boolean) => header.findIndex((h) => test(h));

  const dateIdx = findIdx((h) => h.includes('날짜'));
  const eventIdx = findIdx((h) => h.includes('일정') && !h.includes('메타'));
  const journalIdx = findIdx((h) => h.includes('기록') && !h.includes('메타'));
  const eventMetaIdx = findIdx((h) => h.includes('일정 메타'));
  const journalMetaIdx = findIdx((h) => h.includes('기록 메타'));
  if (dateIdx === -1) return out;

  // 남는 칸이 교시다. 머리말에 교시 이름이 그대로 적혀 있으므로 자리로 센다.
  const known = new Set([dateIdx, eventIdx, journalIdx, eventMetaIdx, journalMetaIdx].filter((i) => i !== -1));
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

export async function exportToSheets(args: SheetsExportArgs): Promise<{ spreadsheetId: string; days: number; memos: number }> {
  const { token, uid, startStr, endStr, include, colPathOf, onProgress } = args;

  onProgress?.('시트 파일을 확인하는 중...');
  const spreadsheetId = await getOrCreateSpreadsheet(token, uid);

  let days = 0;
  if (include.event || include.class || include.journal) {
    onProgress?.('일정·수업·기록을 모으는 중...');
    const [events, schedules, journals] = await Promise.all([
      include.event ? readRange(colPathOf('events'), startStr, endStr) : Promise.resolve({}),
      include.class ? readRange(colPathOf('schedules'), startStr, endStr) : Promise.resolve({}),
      include.journal ? readRange(colPathOf('journals'), startStr, endStr) : Promise.resolve({}),
    ]);

    const dates = dateRange(startStr, endStr);
    days = dates.length;
    const rows = buildScheduleRows({ ...args, dates, events, schedules, journals });

    onProgress?.('시트에 쓰는 중...');
    await ensureSheetExists(token, spreadsheetId, SHEET_SCHEDULE);
    // 기간 안의 모든 날짜를 다시 쓰므로, 남아 있던 옛 줄은 지우고 시작한다
    await writeValues(token, spreadsheetId, SHEET_SCHEDULE, rows, true);
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

  return { spreadsheetId, days, memos };
}

export interface SheetsImportArgs extends SheetsScope {
  token: string;
  uid: string;
  include: SheetsInclude;
  onProgress?: (msg: string) => void;
}

export async function importFromSheets(
  args: SheetsImportArgs
): Promise<{ events: number; schedules: number; journals: number; memos: number }> {
  const { token, uid, include, colPathOf, onProgress } = args;

  const snap = await getDoc(doc(db, 'users', uid, 'settings', 'backup_config'));
  const spreadsheetId = snap.exists() ? snap.data().spreadsheetId : null;
  if (!spreadsheetId) {
    throw new Error("연결된 시트가 없습니다. 먼저 '내보내기'를 한 번 해주세요.");
  }

  const counts = { events: 0, schedules: 0, journals: 0, memos: 0 };

  if (include.event || include.class || include.journal) {
    onProgress?.('시트를 읽는 중...');
    const parsed = parseScheduleRows(await readValues(token, spreadsheetId, SHEET_SCHEDULE), include);

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
