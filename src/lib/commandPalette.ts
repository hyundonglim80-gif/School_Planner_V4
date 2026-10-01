// src/lib/commandPalette.ts
//
// 명령 창(기본 Ctrl+K, ROADMAP 6-2). 적은 글을 세 가지로 알아듣는다.
//   1) 날짜 - '내일', '다음 주 목', '10/15', '3일 뒤' → 그 날짜로 간다
//   2) 기능 - '출석' → 출석부, '진도' → 진도 관리 (⋮ 메뉴와 단축키 목록의 기능들)
//   3) 나머지 - 통합 검색에 그 글을 넣어 찾는다 (늘 맨 아래에 있다)
//
// 기능 목록은 lib/shortcuts의 SHORTCUT_ACTIONS를 그대로 쓴다. 실제로 하는 일은 Layout의 runShortcut이
// 맡으므로 단축키로 여는 것과 명령 창에서 여는 것이 늘 같다. 여기에는 찾을 말(keywords)과 그림만 더한다.

import { SHORTCUT_ACTIONS, type ShortcutId } from './shortcuts';
import { addDays, daysBetween, formatDateStr, getAcademicYear, parseDateStr } from './dateUtils';

export type PaletteScope = 'day' | 'week' | 'month' | 'year' | 'memo';

// ── 날짜 알아듣기 ────────────────────────────────────────────────────

export interface DateHit {
  dateStr: string;
  /** 무엇을 가리키나. '다음 주'는 주, '다음 달'·'10월'은 달, 나머지는 하루 */
  unit: 'day' | 'week' | 'month';
}

const RELATIVE_DAYS: Record<string, number> = {
  오늘: 0,
  금일: 0,
  내일: 1,
  명일: 1,
  모레: 2,
  내일모레: 2,
  글피: 3,
  어제: -1,
  그제: -2,
  그저께: -2,
};

const WEEK_OFFSET: Record<string, number> = {
  이번: 0,
  다음: 7,
  담: 7,
  다다음: 14,
  지난: -7,
  저번: -7,
};

const MONTH_OFFSET: Record<string, number> = { 이번: 0, 다음: 1, 담: 1, 지난: -1, 저번: -1 };

/** 월요일 = 0 … 일요일 = 6 */
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

const mondayIndex = (dateStr: string) => (parseDateStr(dateStr).getDay() + 6) % 7;

/** 있는 날짜일 때만 'YYYY-MM-DD' (2월 30일 같은 것은 null) */
function validDate(y: number, m: number, d: number): string | null {
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return formatDateStr(date);
}

/** 달만 적었을 때(10/15, 10월): 오늘이 든 학년도(3월 ~ 이듬해 2월)의 그 달 */
function schoolYearOf(month: number, todayStr: string): number {
  const ay = getAcademicYear(parseDateStr(todayStr));
  return month >= 3 ? ay : ay + 1;
}

/** 몇 달 뒤·앞. 31일에서 한 달 뒤가 없는 날이면 그 달 말일로 */
function addMonths(dateStr: string, months: number): string {
  const d = parseDateStr(dateStr);
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return formatDateStr(target);
}

/**
 * 날짜로 읽히는 글인지 본다. 기준은 오늘(보는 날짜가 아니다) - '내일'이 보던 날의 다음 날이면 헷갈린다.
 * 띄어쓰기는 가리지 않는다('다음주 목' = '다음 주 목요일').
 */
export function parseDateQuery(input: string, todayStr: string): DateHit | null {
  const s = input.replace(/\s+/g, '').replace(/[.]+$/, '');
  if (!s) return null;

  if (s in RELATIVE_DAYS) return { dateStr: addDays(todayStr, RELATIVE_DAYS[s]), unit: 'day' };

  // 3일 뒤, 2주 후, 1달 전, 2개월 뒤
  let m = /^(\d{1,3})(일|주|주일|달|개월)(뒤|후|전)$/.exec(s);
  if (m) {
    const n = Number(m[1]) * (m[3] === '전' ? -1 : 1);
    if (m[2] === '달' || m[2] === '개월') return { dateStr: addMonths(todayStr, n), unit: 'day' };
    return { dateStr: addDays(todayStr, m[2] === '일' ? n : n * 7), unit: 'day' };
  }

  // 다음 주 목, 이번주 금요일, 지난주 월, 목요일(가장 가까운 그 요일 - 오늘이면 오늘)
  m = /^(?:(이번|다음|담|다다음|지난|저번)주?)?([월화수목금토일])(?:요일)?$/.exec(s);
  if (m) {
    const target = WEEKDAYS.indexOf(m[2]);
    const todayIdx = mondayIndex(todayStr);
    if (!m[1]) return { dateStr: addDays(todayStr, (target - todayIdx + 7) % 7), unit: 'day' };
    const monday = addDays(todayStr, -todayIdx + WEEK_OFFSET[m[1]]);
    return { dateStr: addDays(monday, target), unit: 'day' };
  }

  // 다음 주, 이번주 → 그 주 월요일
  m = /^(이번|다음|담|다다음|지난|저번)주$/.exec(s);
  if (m) {
    const monday = addDays(todayStr, -mondayIndex(todayStr) + WEEK_OFFSET[m[1]]);
    return { dateStr: monday, unit: 'week' };
  }

  // 다음 달, 이번달 → 그 달 1일
  m = /^(이번|다음|담|지난|저번)달$/.exec(s);
  if (m) {
    const first = addMonths(`${todayStr.slice(0, 8)}01`, MONTH_OFFSET[m[1]]);
    return { dateStr: first, unit: 'month' };
  }

  // 2026-10-15, 2026.10.15, 2026/10/15, 2026년10월15일, 20261015
  m = /^(\d{4})[-./년](\d{1,2})[-./월](\d{1,2})일?$/.exec(s) || /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) {
    const dateStr = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return dateStr ? { dateStr, unit: 'day' } : null;
  }

  // 10/15, 10.15, 10-15, 10월15일 → 이번 학년도
  m = /^(\d{1,2})[-./월](\d{1,2})일?$/.exec(s);
  if (m) {
    const month = Number(m[1]);
    const dateStr = validDate(schoolYearOf(month, todayStr), month, Number(m[2]));
    return dateStr ? { dateStr, unit: 'day' } : null;
  }

  // 10월 → 이번 학년도의 그 달 1일
  m = /^(\d{1,2})월$/.exec(s);
  if (m) {
    const month = Number(m[1]);
    const dateStr = validDate(schoolYearOf(month, todayStr), month, 1);
    return dateStr ? { dateStr, unit: 'month' } : null;
  }

  // 15일 → 이번 달
  m = /^(\d{1,2})일$/.exec(s);
  if (m) {
    const [y, mo] = todayStr.split('-').map(Number);
    const dateStr = validDate(y, mo, Number(m[1]));
    return dateStr ? { dateStr, unit: 'day' } : null;
  }

  return null;
}

/** '오늘', '내일', '3일 뒤', '2일 전'처럼 오늘에서 얼마나 떨어졌는지 */
export function relativeDayText(dateStr: string, todayStr: string): string {
  const n = daysBetween(todayStr, dateStr);
  if (n === 0) return '오늘';
  if (n === 1) return '내일';
  if (n === 2) return '모레';
  if (n === -1) return '어제';
  return n > 0 ? `${n}일 뒤` : `${-n}일 전`;
}

// ── 기능 찾기 ────────────────────────────────────────────────────────

interface CommandMeta {
  icon: string;
  /** 단축키 목록의 이름과 달리 보여 줄 때 (⋮ 메뉴의 이름에 맞춘다) */
  title?: string;
  /** 이름 말고도 이 말로 찾힌다 */
  keywords: string[];
}

/**
 * 기능마다 그림과 찾을 말. Record라서 단축키에 기능을 더하면 여기도 채워야 빌드가 된다
 * (명령 창에 빠지는 기능이 없게).
 */
const COMMAND_META: Record<ShortcutId, CommandMeta> = {
  commandPalette: { icon: '⚡', keywords: [] },
  search: { icon: '🔍', keywords: ['검색', '찾기', 'search'] },
  scopeDay: { icon: '📋', keywords: ['하루', '일간'] },
  scopeWeek: { icon: '🗓️', keywords: ['주간', '일주일'] },
  scopeMonth: { icon: '📅', keywords: ['월간', '한달', '달력'] },
  scopeYear: { icon: '📊', keywords: ['년간', '연간', '일년', '1년'] },
  scopeMemo: { icon: '📝', keywords: ['메모'] },
  scopePrev: { icon: '⬅️', keywords: ['이전 화면', '앞 화면'] },
  scopeNext: { icon: '➡️', keywords: ['다음 화면', '옆 화면'] },
  datePrev: { icon: '◀', keywords: ['이전 날짜', '전날', '앞으로'] },
  dateNext: { icon: '▶', keywords: ['다음 날짜', '다음날'] },
  dateToday: { icon: '🎯', keywords: ['오늘'] },
  toggleWeekend: { icon: '👁️', keywords: ['주말'] },
  toggleEvents: { icon: '👁️', keywords: ['일정 보이기', '일정 숨기기'] },
  toggleClass: { icon: '👁️', keywords: ['수업 보이기', '수업 숨기기', '시간표 보이기'] },
  lastYear: { icon: '🕰️', title: '작년 이맘때 (주간)', keywords: ['작년', '지난해', '이맘때', '작년 같은 주'] },
  multiSelect: { icon: '☑️', keywords: ['다중 선택', '여러 개', '선택 모드', '한꺼번에'] },
  clipboard: { icon: '📎', keywords: ['클립보드', '복사', '붙여넣기'] },
  calendar: { icon: '📤', title: '구글 캘린더로 보내기', keywords: ['구글', '캘린더', '동기화', 'google'] },
  dday: { icon: '⏳', keywords: ['디데이', 'dday', 'd-day', '남은 날'] },
  trash: { icon: '🗑️', keywords: ['휴지통', '지운 것', '복원', '되살리기'] },
  labels: { icon: '🏷️', keywords: ['라벨', '태그', '분류'] },
  recurring: { icon: '🔁', keywords: ['반복', '매주'] },
  forwarding: { icon: '📥', keywords: ['이월', '미완료', '못 끝낸'] },
  roster: { icon: '🧑‍🤝‍🧑', keywords: ['명렬표', '학생', '학급', '명단', '사진'] },
  notices: { icon: '📢', keywords: ['알림장'] },
  attendance: { icon: '✅', keywords: ['출석', '출결', '결석', '지각', '조퇴'] },
  studentRecord: { icon: '🧑‍🎓', keywords: ['누가기록', '학생', '관찰', '상담'] },
  seating: { icon: '🪑', keywords: ['자리표', '자리', '자리 바꾸기', '좌석', '짝', '섞기'] },
  group: { icon: '👥', keywords: ['공유', '그룹', '동학년'] },
  timetable: { icon: '⏰', keywords: ['시간표', '템플릿'] },
  progress: { icon: '📘', keywords: ['진도', '차시', '밀기'] },
  backup: { icon: '💾', keywords: ['백업', '내보내기', '가져오기', 'json', 'csv'] },
  help: { icon: '💡', keywords: ['설명서', '도움말', '사용법', 'help'] },
  settings: { icon: '⚙️', keywords: ['환경설정', '설정', '옵션'] },
};

export interface PaletteCommand {
  id: ShortcutId;
  icon: string;
  title: string;
}

/** 명령 창에 나오는 기능 전부 (단축키 목록 차례, 명령 창 자신은 뺀다) */
export const PALETTE_COMMANDS: PaletteCommand[] = SHORTCUT_ACTIONS.filter((a) => a.id !== 'commandPalette').map(
  (a) => ({ id: a.id, icon: COMMAND_META[a.id].icon, title: COMMAND_META[a.id].title || a.label })
);

const CHOSUNG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/** 한글 낱자의 첫소리만 ('출석부' → 'ㅊㅅㅂ'). 한글이 아닌 글자는 그대로 */
export function chosungOf(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0) - 0xac00;
    out += code >= 0 && code < 11172 ? CHOSUNG[Math.floor(code / 588)] : ch;
  }
  return out;
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/**
 * 얼마나 잘 맞나 (0 = 안 맞음). 글자로 같으면 6, 앞이 같으면 5, 들어 있으면 4.
 * 첫소리는 같으면 3, 앞이 같으면 2, 들어 있으면 1 - 'ㅈㄷ'이 '반복 일정 등록'(…ㅇㅈㄷㄹ)보다 '진도'에 먼저 맞게.
 */
function commandScore(cmd: PaletteCommand, q: string): number {
  const words = [cmd.title, SHORTCUT_ACTIONS.find((a) => a.id === cmd.id)!.label, ...COMMAND_META[cmd.id].keywords];
  const onlyJamo = /^[ㄱ-ㅎ]+$/.test(q);
  let best = 0;
  for (const word of words) {
    const w = squash(word);
    const cho = onlyJamo ? chosungOf(w) : '';
    const score =
      w === q ? 6
      : w.startsWith(q) ? 5
      : w.includes(q) ? 4
      : !onlyJamo ? 0
      : cho === q ? 3
      : cho.startsWith(q) ? 2
      : cho.includes(q) ? 1
      : 0;
    best = Math.max(best, score);
  }
  return best;
}

/** 적은 글에 맞는 기능. 비어 있으면 전부, 잘 맞는 것부터 (같으면 목록 차례) */
export function matchCommands(input: string): PaletteCommand[] {
  const q = squash(input);
  if (!q) return PALETTE_COMMANDS;
  return PALETTE_COMMANDS.map((cmd, i) => ({ cmd, i, score: commandScore(cmd, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.cmd);
}

// ── 목록 만들기 ───────────────────────────────────────────────────────

export type PaletteItem =
  | { kind: 'date'; dateStr: string; scope: PaletteScope }
  | { kind: 'command'; command: PaletteCommand }
  | { kind: 'search'; text: string };

/**
 * 명령 창에 보일 줄들. 날짜로 읽히면 그 날짜가 맨 위, 맞는 기능, 맨 아래는 늘 '통합 검색'.
 * 날짜는 하루 화면으로 가는 것이 먼저다('다음 주'는 주간, '다음 달'은 월간).
 * 주간·월간·년간을 보고 있었으면 그 화면에서 그 날짜로 가는 줄도 하나 더.
 */
export function buildPaletteItems(input: string, todayStr: string, scope: PaletteScope): PaletteItem[] {
  const items: PaletteItem[] = [];
  const text = input.trim();

  const hit = text ? parseDateQuery(text, todayStr) : null;
  if (hit) {
    const first: PaletteScope = hit.unit === 'week' ? 'week' : hit.unit === 'month' ? 'month' : 'day';
    items.push({ kind: 'date', dateStr: hit.dateStr, scope: first });
    const second: PaletteScope | null =
      hit.unit === 'month' ? null : first !== 'day' ? 'day' : scope === 'week' || scope === 'month' || scope === 'year' ? scope : null;
    if (second && second !== first) items.push({ kind: 'date', dateStr: hit.dateStr, scope: second });
  }

  for (const command of matchCommands(text)) items.push({ kind: 'command', command });

  if (text) items.push({ kind: 'search', text });
  return items;
}
