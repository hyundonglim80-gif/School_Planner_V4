// src/lib/progress.ts
//
// 진도 관리 (docs/ROADMAP.md 5번, 2026-10-01 사용자와 정함).
//
// - 단위는 '시간표 칸 글자'다. 과목 칸이 '국어'면 국어 하나, '3-2 국어'·'3-3 국어'면 반마다 따로(앞뒤 공백만 정리해 견준다).
// - 차시 목록(단원·차시·내용·준비물)은 엑셀·한셀에서 표를 복사해 붙여 넣는다. 한 줄이 한 교시다.
// - 시작일부터 그 글자가 적힌 교시를 날짜·교시 차례로 세어 k번째 교시 = k번째 차시. 수업 문서(schedules)에
//   실제로 적힌 과목을 읽기만 한다(시간표 적용·손으로 고친 것 모두 반영). 수업이 없는 날(lib/classDays)은 건너뛴다.
// - 수업이 빠진 교시는 '밀기'(Planbook의 Bump): 그 교시는 차시를 받지 않고 뒤가 한 칸씩 밀린다. 되돌리면 다시 당겨진다.
//
// 저장: users/{uid}/v4_progress/{id} = { key, startDate, lessons: [{unit, no, content, supplies}], bumps: ['YYYY-MM-DD#교시'], updatedAt }
// 과정(교과 모드, docs/ROADMAP-SUBJECT.md S4): { …, subject: '과학', classes: ['5-1','5-2'] } - 차시 목록 하나를 여러 반이
// 반마다 따로 센다. 반 열쇠는 '5-1 과학'(planKeys)이고 칸 글자는 정규화해 견준다(lib/teachingSlot). key에는 첫 열쇠를 채워 둔다.
// bumps는 과정 하나에 한 배열 - 같은 날·교시에 두 반을 가르칠 수 없으니 '날짜#교시'가 반마다 저절로 다르다.
// V4 전용 문서다. 수업 문서(schedules)는 V3와 함께 쓰고 한 교시 저장이 다른 교시를 덮은 사고가 있어(10-01) 진도는 거기에
// 쓰지 않는다 - 화면에서만 겹쳐 보인다. users/{uid}/** 규칙으로 덮인다. 그룹 공간은 아직 없다(개인 것만).
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { parseClipboardGrid } from './gridNav';
import { parseCsv } from './csv';
import { classOffReason, type ClassDayRules } from './classDays';
import { moveToTrash } from '../utils/trashHelper';
import { formatSlot, normalizeSlotText, parseSlot } from './teachingSlot';

export interface ProgressLesson {
  unit: string;
  /** 표에 적힌 차시 글자 그대로 ('5', '5~6' …). 없으면 '' */
  no: string;
  content: string;
  supplies: string;
}

export interface ProgressPlan {
  id: string;
  /** 시간표 칸 글자 (앞뒤 공백을 뗀 것) */
  key: string;
  /** YYYY-MM-DD. 이날부터 센다 */
  startDate: string;
  lessons: ProgressLesson[];
  /** 민 교시 'YYYY-MM-DD#교시' */
  bumps: string[];
  /** 과정(여러 반): 과목. classes와 함께 있다 */
  subject?: string;
  /** 과정(여러 반): 반 '5-2' 목록. 있으면 과정 */
  classes?: string[];
  updatedAt?: number;
}

type CourseFields = Partial<Pick<ProgressPlan, 'subject' | 'classes'>>;

/** 칸 글자를 견줄 모양으로 (앞뒤 공백만 뗀다 - 사용자가 정함) */
export function progressKey(subject: unknown): string {
  return String(subject ?? '').trim();
}

/** 수업 문서의 교시 값에서 과목 글자. 옛 자료는 값이 문자열이다 */
export function periodSubject(val: unknown): string {
  if (typeof val === 'string') return progressKey(val);
  if (val && typeof val === 'object') return progressKey((val as any).subject);
  return '';
}

/** 수업 문서의 periods → 교시('1'…) → 과목 글자. 빈 교시는 뺀다 */
export function scheduleSubjects(periods: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!periods || typeof periods !== 'object') return out;
  for (const [p, val] of Object.entries(periods as Record<string, unknown>)) {
    if (!/^\d+$/.test(p)) continue;
    const s = periodSubject(val);
    if (s) out[p] = s;
  }
  return out;
}

/**
 * 수업 문서의 periods → 교시 → 수업 메모 첫 줄 (교과 모드 '지난 시간' 줄, ROADMAP-SUBJECT S5).
 * 메모는 memo, 옛 자료는 content (하루 화면 카드와 같다). 빈 메모·옛 문자열 교시는 뺀다.
 */
export function scheduleNotes(periods: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!periods || typeof periods !== 'object') return out;
  for (const [p, val] of Object.entries(periods as Record<string, unknown>)) {
    if (!/^\d+$/.test(p) || !val || typeof val !== 'object') continue;
    const raw = String((val as any).memo || (val as any).content || '');
    const first = raw.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (first) out[p] = first;
  }
  return out;
}

export const slotId = (date: string, period: string | number) => `${date}#${period}`;

/** 진도 관리 창을 '새 과정'으로 열 때 넘기는 자리표 id (명령 창 '과정 만들기', ROADMAP-SUBJECT S10) */
export const NEW_COURSE_PLAN_ID = '__new_course__';

// ── 과정 (여러 반) ──────────────────────────────────────────────────────

/** 반 하나 이상을 가진 과정인가 */
export function isCourse(plan: CourseFields): boolean {
  return Array.isArray(plan.classes) && plan.classes.length > 0;
}

/** 이 진도가 세는 열쇠들. 과정이면 반마다 '5-1 과학', 아니면 [칸 글자] */
export function planKeys(plan: Pick<ProgressPlan, 'key'> & CourseFields): string[] {
  if (isCourse(plan)) return plan.classes!.map((c) => formatSlot(c, plan.subject || ''));
  return [progressKey(plan.key)];
}

/** 열쇠를 견줄 모양 - 과정은 반 표기를 맞추고(lib/teachingSlot), 옛 진도는 앞뒤 공백만 */
const matchKey = (text: unknown, course: boolean) =>
  course ? normalizeSlotText(String(text ?? '')) : progressKey(text);

/** 과정 이름: 반이 모두 같은 학년이면 '5학년 과학', 섞이면 '과학 (5-1 외 3)' */
export function courseTitle(plan: CourseFields): string {
  const classes = plan.classes || [];
  const subject = (plan.subject || '').trim();
  const grades = new Set(classes.map((c) => parseSlot(c).grade));
  if (grades.size === 1) return `${[...grades][0]}학년 ${subject}`.trim();
  const who = classes.length > 1 ? `${classes[0]} 외 ${classes.length - 1}` : classes[0] || '';
  return subject ? `${subject} (${who})` : who;
}

/** 목록·안내에 쓰는 진도 이름 - 과정이면 courseTitle, 아니면 칸 글자 */
export function planLabel(plan: Pick<ProgressPlan, 'key'> & CourseFields): string {
  return isCourse(plan) ? courseTitle(plan) : plan.key;
}

// ── 표 붙여넣기 ─────────────────────────────────────────────────────────

type Field = keyof ProgressLesson;

/** 머리줄 칸 글자 → 어느 칸인가 */
function headerField(cell: string): Field | null {
  const t = cell.replace(/\s+/g, '');
  if (!t) return null;
  if (/^(단원|단원명|대단원|중단원|소단원|영역)$/.test(t)) return 'unit';
  if (/^(차시|순서|번호)$/.test(t)) return 'no';
  if (/^(준비물|준비|자료|학습자료|수업자료|교구)$/.test(t)) return 'supplies';
  if (/^(내용|학습내용|수업내용|주제|학습주제|차시주제|차시명|제재|활동|학습활동|주요활동|학습목표|목표)$/.test(t)) return 'content';
  return null;
}

/**
 * 첫 줄이 머리줄이면 칸마다 어느 칸인지, 아니면 null.
 * 머리줄 이름이 둘 이상이어야 머리줄로 본다(한 칸짜리 표는 그 한 칸) - 내용 칸에 '활동'이라고만 적은 줄을
 * 머리줄로 알고 버리지 않게. 내용 칸 이름을 모르면(예: '오늘 배울 것') 이름을 모르는 첫 칸을 내용으로 본다.
 */
function headerFields(row: string[]): Array<Field | null> | null {
  const hits = row.map(headerField);
  const named = hits.filter((f) => f !== null).length;
  const filled = row.filter((c) => c !== '').length;
  if (!(named >= 2 || (named === 1 && filled === 1))) return null;
  if (!hits.includes('content')) {
    const i = hits.findIndex((f, c) => f === null && row[c] !== '');
    if (i >= 0) hits[i] = 'content';
  }
  return hits;
}

/** '5', '5차시', '5~6', '5-6차시' 같은 차시 칸인가 */
const looksLikeNo = (cell: string) => /^\d{1,3}(\s*[~\-–,]\s*\d{1,3})?\s*(차시)?$/.test(cell.trim());

/**
 * 머리줄이 없을 때 칸 차례로 정한다. 차시처럼 보이는(숫자) 칸이 있으면 그 칸을 기준으로.
 * 단원 번호도 숫자일 수 있다 - 합친 칸이라 듬성듬성하니, 숫자 칸 가운데 가장 많이 채워진 칸을 차시로 본다.
 */
function positionalFields(rows: string[][]): Array<Field | null> {
  const width = Math.max(...rows.map((r) => r.length));
  let noCol: number | undefined;
  let best = 0;
  for (let c = 0; c < width; c++) {
    const cells = rows.map((r) => r[c] || '').filter(Boolean);
    const numeric = cells.length > 0 && cells.filter(looksLikeNo).length / cells.length >= 0.6;
    if (numeric && cells.length >= best) {
      noCol = c;
      best = cells.length;
    }
  }

  const fields: Array<Field | null> = Array(width).fill(null);
  if (noCol !== undefined) {
    if (noCol >= 1) fields[noCol - 1] = 'unit';
    fields[noCol] = 'no';
    if (noCol + 1 < width) fields[noCol + 1] = 'content';
    if (noCol + 2 < width) fields[noCol + 2] = 'supplies';
    return fields;
  }
  const order: Field[][] = [
    [],
    ['content'],
    ['unit', 'content'],
    ['unit', 'content', 'supplies'],
  ];
  const pick = order[width] || ['unit', 'no', 'content', 'supplies'];
  pick.forEach((f, i) => (fields[i] = f));
  return fields;
}

/**
 * 엑셀·한셀에서 복사한 차시 표를 읽는다.
 * - 머리줄(단원·차시·내용·준비물 …)이 있으면 건너뛰고, 그 이름으로 칸을 맞춘다. 없으면 '단원 | 차시 | 내용 | 준비물' 차례.
 * - 빈 줄은 뺀다. 단원 칸만 있는 줄은 단원 제목으로 보고 아래 차시들에 붙인다.
 * - 단원 칸이 비면 위 줄의 단원을 잇는다(엑셀에서 합친 칸은 첫 줄에만 글자가 온다).
 */
export function parseLessonTable(text: string): ProgressLesson[] {
  return parseLessonRows(parseClipboardGrid(text));
}

/** CSV 파일의 차시 표 (예시 CSV를 엑셀에서 고쳐 저장한 것 - '단원,차시,내용,준비물'). 읽는 규칙은 붙여넣기와 같다 */
export function parseLessonCsv(text: string): ProgressLesson[] {
  return parseLessonRows(parseCsv(text).map((r) => r.map((c) => c.trim())));
}

/** 칸으로 나뉜 표를 차시 목록으로 (붙여넣기·CSV가 함께 쓴다) */
function parseLessonRows(grid: string[][]): ProgressLesson[] {
  const rows = grid.filter((r) => r.some((c) => c !== ''));
  if (rows.length === 0) return [];

  const header = headerFields(rows[0]);
  const body = header ? rows.slice(1) : rows;
  if (body.length === 0) return [];
  const fields = header || positionalFields(body);

  const out: ProgressLesson[] = [];
  let unit = '';
  for (const row of body) {
    const lesson: ProgressLesson = { unit: '', no: '', content: '', supplies: '' };
    fields.forEach((f, i) => {
      if (f && row[i] && !lesson[f]) lesson[f] = row[i];
    });
    if (lesson.unit) unit = lesson.unit;
    if (!lesson.no && !lesson.content && !lesson.supplies) continue; // 단원 제목 줄 (또는 쓸 칸이 없는 줄)
    out.push({ ...lesson, unit });
  }
  return out;
}

// ── 세기 ───────────────────────────────────────────────────────────────

export interface ProgressSlot {
  date: string;
  period: string;
  /** 이 교시에 하는 차시(lessons의 차례, 0부터). 민 교시면 null. 목록보다 크면 목록이 끝난 뒤다 */
  lesson: number | null;
  bumped: boolean;
}

export interface ProgressTimeline {
  /** 시작일부터 날짜·교시 차례 */
  slots: ProgressSlot[];
  /** slotId → 교시 */
  bySlot: Record<string, ProgressSlot>;
  /** 마지막 차시를 하는 교시. 읽은 범위 안에서 목록이 끝나지 않으면 null */
  last: ProgressSlot | null;
}

/**
 * 시작일부터 그 칸 글자가 적힌 교시를 차례로 세어 차시를 붙인다.
 * subjectsByDate: 날짜 → (교시 → 과목 글자) - scheduleSubjects로 만든 것. isOffDay: 수업이 없는 날.
 * until: 이날부터는 세지 않는다 (같은 칸 글자의 다음 진도가 이어받는 날 - progressUntil).
 */
export function computeProgress(
  plan: Pick<ProgressPlan, 'key' | 'startDate' | 'lessons' | 'bumps'> & CourseFields,
  subjectsByDate: Record<string, Record<string, string>>,
  isOffDay: (date: string) => boolean = () => false,
  until?: string,
  /** 과정이면 셀 반의 열쇠('5-1 과학', planKeys 가운데 하나). 주지 않으면 첫 열쇠 */
  keyOverride?: string
): ProgressTimeline {
  const course = isCourse(plan);
  const key = matchKey(keyOverride ?? planKeys(plan)[0], course);
  const bumps = new Set(plan.bumps || []);
  const slots: ProgressSlot[] = [];
  const bySlot: Record<string, ProgressSlot> = {};
  let last: ProgressSlot | null = null;
  if (!key || !plan.startDate) return { slots, bySlot, last };

  const dates = Object.keys(subjectsByDate)
    .filter((d) => d >= plan.startDate && (!until || d < until))
    .sort();
  let next = 0;
  for (const date of dates) {
    const periods = subjectsByDate[date] || {};
    const matching = Object.keys(periods)
      .filter((p) => matchKey(periods[p], course) === key)
      .sort((a, b) => Number(a) - Number(b));
    if (matching.length === 0 || isOffDay(date)) continue;
    for (const period of matching) {
      const bumped = bumps.has(slotId(date, period));
      const slot: ProgressSlot = { date, period, lesson: bumped ? null : next++, bumped };
      slots.push(slot);
      bySlot[slotId(date, period)] = slot;
      if (slot.lesson === plan.lessons.length - 1) last = slot;
    }
  }
  return { slots, bySlot, last };
}

/**
 * 같은 칸 글자에 진도가 둘 이상이면(예: 2학기 목록을 따로) 시작일이 늦은 것이 그날부터 이어받는다.
 * 이 진도를 세지 않기 시작하는 날 - 같은 열쇠의 다음 진도 시작일. 없으면 undefined.
 * key: 과정이면 셀 반의 열쇠(주지 않으면 첫 열쇠). 과정이 끼면 반 열쇠를 정규화해 견주고(과정·옛 진도 모두),
 * 옛 진도끼리는 지금처럼 칸 글자를 견준다.
 */
export function progressUntil(
  plan: Pick<ProgressPlan, 'id' | 'key' | 'startDate'> & CourseFields,
  plans: Array<Pick<ProgressPlan, 'id' | 'key' | 'startDate'> & CourseFields>,
  key?: string
): string | undefined {
  const mine = key ?? planKeys(plan)[0];
  const course = isCourse(plan);
  let until: string | undefined;
  for (const p of plans) {
    if (p.id === plan.id || !p.startDate || p.startDate <= plan.startDate) continue;
    const shares =
      course || isCourse(p)
        ? planKeys(p).some((k) => normalizeSlotText(k) === normalizeSlotText(mine))
        : progressKey(p.key) === progressKey(mine);
    if (!shares) continue;
    if (!until || p.startDate < until) until = p.startDate;
  }
  return until;
}

/** 그 교시에 하는 차시. 민 교시·목록 밖이면 null */
export function lessonAt(
  plan: Pick<ProgressPlan, 'lessons'>,
  timeline: ProgressTimeline,
  date: string,
  period: string | number
): { index: number; lesson: ProgressLesson } | null {
  const slot = timeline.bySlot[slotId(date, period)];
  if (!slot || slot.lesson === null) return null;
  const lesson = plan.lessons[slot.lesson];
  return lesson ? { index: slot.lesson, lesson } : null;
}

/** 수업 칸에 겹쳐 보일 한 교시의 진도 */
export interface ProgressMark {
  planId: string;
  /** 센 열쇠 - 옛 진도는 칸 글자, 과정은 그 반의 '5-1 과학' */
  key: string;
  /** 과정이면 그 반 '5-1' */
  cls?: string;
  /** 차시 차례 (0부터). 민 교시면 null */
  index: number | null;
  total: number;
  lesson: ProgressLesson | null;
  bumped: boolean;
}

/**
 * 모든 진도를 세어 교시마다 겹쳐 보일 것 (slotId → 진도). 목록이 끝난 뒤의 교시는 넣지 않는다.
 * 같은 칸 글자의 진도가 둘이면 늦게 시작하는 쪽이 그날부터 이어받는다(progressUntil).
 */
export function progressMarks(
  plans: ProgressPlan[],
  subjectsByDate: Record<string, Record<string, string>>,
  isOffDay: (date: string) => boolean = () => false
): Record<string, ProgressMark> {
  const out: Record<string, ProgressMark> = {};
  for (const plan of plans) {
    if (plan.lessons.length === 0) continue;
    const course = isCourse(plan);
    // 과정은 반마다 따로 센다 - 목록이 끝나 멈추는 것도 반마다
    for (const key of planKeys(plan)) {
      const t = computeProgress(plan, subjectsByDate, isOffDay, progressUntil(plan, plans, key), key);
      const cls = course ? parseSlot(key).cls : undefined;
      for (const s of t.slots) {
        if (s.lesson !== null && s.lesson >= plan.lessons.length) break; // 목록이 끝났다
        out[slotId(s.date, s.period)] = {
          planId: plan.id,
          key: course ? key : plan.key,
          ...(cls ? { cls } : {}),
          index: s.lesson,
          total: plan.lessons.length,
          lesson: s.lesson === null ? null : plan.lessons[s.lesson],
          bumped: s.bumped,
        };
      }
    }
  }
  return out;
}

/** 그 차시(index, 0부터)를 하는 첫 교시. 밀린 교시는 건너뛴다. 읽은 범위에 없으면 null (S8) */
export function slotOfLesson(timeline: ProgressTimeline, index: number): ProgressSlot | null {
  return timeline.slots.find((s) => s.lesson === index) || null;
}

/** 과정의 반 열쇠마다 센 결과 (progressMarks와 같은 규칙 - 반마다 이어받는 날까지) */
export function courseTimelines(
  plan: ProgressPlan,
  plans: ProgressPlan[],
  subjectsByDate: Record<string, Record<string, string>>,
  isOffDay: (date: string) => boolean = () => false
): Record<string, ProgressTimeline> {
  const out: Record<string, ProgressTimeline> = {};
  for (const key of planKeys(plan)) {
    out[key] = computeProgress(plan, subjectsByDate, isOffDay, progressUntil(plan, plans, key), key);
  }
  return out;
}

export interface CourseEvalTarget {
  cls: string;
  key: string;
  /** 같은 차시를 하는 교시. 아직 시간표에 없으면(읽은 범위 안에서 그 차시에 닿지 않으면) null */
  slot: ProgressSlot | null;
}

/**
 * '같은 과정의 다른 반에도 조사표 만들기'(S8): 이 교시(mark)와 **같은 차시**를 하는 다른 반의 첫 교시.
 * mark가 과정의 표식이 아니거나 민 교시면 빈 목록. 이 반(mark.key)은 뺀다.
 */
export function planCourseEvals(
  mark: Pick<ProgressMark, 'key' | 'index' | 'cls'>,
  plan: Pick<ProgressPlan, 'key' | 'subject' | 'classes'>,
  timelinesByKey: Record<string, ProgressTimeline>
): CourseEvalTarget[] {
  if (!isCourse(plan) || !mark.cls || mark.index === null) return [];
  const mine = normalizeSlotText(mark.key);
  return planKeys(plan)
    .filter((k) => normalizeSlotText(k) !== mine)
    .map((key) => {
      const t = timelinesByKey[key];
      return { cls: parseSlot(key).cls, key, slot: t ? slotOfLesson(t, mark.index!) : null };
    });
}

/** 과정 현황표의 한 반 (ROADMAP-SUBJECT S5) */
export interface CourseClassStatus {
  cls: string;
  key: string;
  /** 오늘까지 마지막으로 한 차시 (밀린 교시는 빼고). 없으면 null */
  last: ProgressSlot | null;
  /** 내일부터 처음 할 차시. 목록이 끝났거나 읽은 범위에 수업이 없으면 null */
  next: ProgressSlot | null;
  /** 오늘까지 한 차시 수 (목록 길이를 넘지 않는다) */
  done: number;
  total: number;
  /** 가장 앞선 반보다 몇 차시 늦은가 (0이면 가장 앞) */
  behind: number;
  finished: boolean;
}

/**
 * 과정의 반별 위치. timelinesByKey: 반 열쇠('5-1 과학') → computeProgress 결과. 오늘 수업은 한 것으로 센다
 * (진도 관리 창의 '오늘까지 n차시'와 같다). behind는 가장 많이 한 반과의 차이 - 2 이상이면 화면이 '늦음'으로 칠한다.
 */
export function courseStatus(
  plan: Pick<ProgressPlan, 'key' | 'lessons'> & CourseFields,
  timelinesByKey: Record<string, ProgressTimeline>,
  today: string
): CourseClassStatus[] {
  const total = plan.lessons.length;
  const rows: CourseClassStatus[] = planKeys(plan).map((key) => {
    const slots = (timelinesByKey[key]?.slots || []).filter((s) => s.lesson !== null && s.lesson < total);
    const past = slots.filter((s) => s.date <= today);
    const next = slots.find((s) => s.date > today) || null;
    const done = past.length;
    return {
      cls: parseSlot(key).cls || key,
      key,
      last: past[past.length - 1] || null,
      next,
      done,
      total,
      behind: 0,
      finished: total > 0 && done >= total,
    };
  });
  const most = Math.max(0, ...rows.map((r) => r.done));
  for (const r of rows) r.behind = most - r.done;
  return rows;
}

/** 그날 교시마다 하는 차시의 준비물 (알림장 '다음 수업일 불러오기', 5-4). 민 교시·준비물 없는 차시는 뺀다 */
export function suppliesByPeriod(marks: Record<string, ProgressMark>, date: string): Record<string, string> {
  const out: Record<string, string> = {};
  const prefix = `${date}#`;
  for (const [id, m] of Object.entries(marks)) {
    if (!id.startsWith(prefix) || m.bumped) continue;
    const supplies = (m.lesson?.supplies || '').trim();
    if (supplies) out[id.slice(prefix.length)] = supplies;
  }
  return out;
}

/** 밀기를 켜고 끈 목록 (날짜·교시 차례로) */
export function toggleBump(bumps: string[], date: string, period: string | number): string[] {
  const id = slotId(date, period);
  const set = new Set(bumps || []);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return [...set].sort();
}

/** 여러 날의 events 문서로 '수업이 없는 날'을 가린다 (lib/classDays 규칙) */
export function offDayChecker(eventsByDate: Record<string, any>, rules: ClassDayRules): (date: string) => boolean {
  const memo = new Map<string, boolean>();
  return (date) => {
    let v = memo.get(date);
    if (v === undefined) {
      v = classOffReason(date, eventsByDate[date] || null, rules) !== null;
      memo.set(date, v);
    }
    return v;
  };
}

/** 그 날이 든 학년도의 마지막 날 (학년도는 3월~이듬해 2월) */
export function schoolYearEnd(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const endYear = m >= 3 ? y + 1 : y;
  const leap = (endYear % 4 === 0 && endYear % 100 !== 0) || endYear % 400 === 0;
  return `${endYear}-02-${leap ? 29 : 28}`;
}

// ── 저장·읽기 ──────────────────────────────────────────────────────────

const progressCol = (uid: string) => collection(db, 'users', uid, 'v4_progress');

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** 저장된 모양을 믿지 않고 고쳐 읽는다 */
export function sanitizePlan(id: string, raw: any): ProgressPlan {
  const lessons: ProgressLesson[] = Array.isArray(raw?.lessons)
    ? raw.lessons
        .filter((l: any) => l && typeof l === 'object')
        .map((l: any) => ({ unit: str(l.unit), no: str(l.no), content: str(l.content), supplies: str(l.supplies) }))
    : [];
  const classes = sanitizeClasses(raw?.classes);
  const course = classes.length > 0 ? { subject: str(raw?.subject).trim().replace(/\s+/g, ' '), classes } : null;
  return {
    id,
    key: progressKey(raw?.key) || (course ? planKeys({ key: '', ...course })[0] : ''),
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(str(raw?.startDate)) ? str(raw.startDate) : '',
    lessons,
    bumps: Array.isArray(raw?.bumps) ? raw.bumps.filter((b: unknown) => typeof b === 'string') : [],
    ...(course || {}),
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : undefined,
  };
}

/** 과정의 반 목록: '5-2' 모양만(앞뒤 공백·'05-02'는 맞춘다), 중복은 하나로, 차례는 그대로 */
export function sanitizeClasses(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(v);
    if (!m || Number(m[1]) < 1 || Number(m[2]) < 1) continue;
    const c = `${Number(m[1])}-${Number(m[2])}`;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** 새 진도 문서 id */
export function newProgressId(): string {
  return `pg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 진도 목록을 구독한다 (칸 글자 차례). 끊으면 함수를 부른다 */
export function subscribeProgressPlans(
  uid: string,
  onData: (plans: ProgressPlan[]) => void,
  onError?: (err: unknown) => void
): () => void {
  return onSnapshot(
    progressCol(uid),
    (snap) => {
      const plans = snap.docs.map((d) => sanitizePlan(d.id, d.data()));
      plans.sort((a, b) => a.key.localeCompare(b.key, 'ko') || a.startDate.localeCompare(b.startDate));
      onData(plans);
    },
    (err) => onError?.(err)
  );
}

/**
 * 칸 글자·시작일·차시 목록을 쓴다. 밀기(bumps)는 건드리지 않는다 - 다른 기기에서 민 것을 덮지 않게
 * 밀기는 setProgressBump가 한 칸씩 더하고 뺀다. 실패하면 던진다.
 */
export async function saveProgressPlan(
  uid: string,
  plan: Pick<ProgressPlan, 'id' | 'key' | 'startDate' | 'lessons'> & CourseFields
): Promise<void> {
  const course = isCourse(plan);
  await setDoc(
    doc(progressCol(uid), plan.id),
    {
      // 과정도 key를 채워 둔다 - 옛 코드가 key를 읽어도 깨지지 않게
      key: course ? planKeys(plan)[0] : progressKey(plan.key),
      ...(course ? { subject: (plan.subject || '').trim(), classes: sanitizeClasses(plan.classes) } : {}),
      startDate: plan.startDate,
      lessons: plan.lessons.map((l) => ({ unit: l.unit, no: l.no, content: l.content, supplies: l.supplies })),
      updatedAt: Date.now(),
    },
    { merge: true }
  );
}

/** 그 교시를 밀거나(on) 되돌린다. 문서를 읽지 않고 한 칸만 더하고 뺀다. 실패하면 던진다 */
export async function setProgressBump(
  uid: string,
  planId: string,
  date: string,
  period: string | number,
  on: boolean
): Promise<void> {
  const id = slotId(date, period);
  await updateDoc(doc(progressCol(uid), planId), {
    bumps: on ? arrayUnion(id) : arrayRemove(id),
    updatedAt: Date.now(),
  });
}

/**
 * 휴지통에 먼저 넣고 지운다 (휴지통에 못 넣으면 지우지 않는다 - 던진다). 복원은 lib/trashRestore 'progress'.
 * 휴지통 문서 id를 돌려준다(지운 뒤 안내의 '되돌리기').
 */
export async function deleteProgressPlan(uid: string, plan: ProgressPlan): Promise<string | undefined> {
  const { id, ...data } = plan;
  const trashId = await moveToTrash({
    id,
    type: 'progress',
    content: `${planLabel(plan)} 진도 (${plan.lessons.length}차시)`,
    data: { id, ...data },
  });
  await deleteDoc(doc(progressCol(uid), id));
  return trashId;
}

/** 휴지통에서 되살린다. 같은 id 문서가 이미 있으면 덮지 않고 새 id로 */
export async function restoreProgressPlan(uid: string, data: any): Promise<void> {
  const plan = sanitizePlan(String(data?.id || newProgressId()), data);
  const taken = (await getDoc(doc(progressCol(uid), plan.id))).exists();
  await setDoc(doc(progressCol(uid), taken ? newProgressId() : plan.id), {
    key: plan.key,
    startDate: plan.startDate,
    lessons: plan.lessons,
    bumps: plan.bumps,
    ...(isCourse(plan) ? { subject: plan.subject || '', classes: plan.classes } : {}),
    updatedAt: Date.now(),
  });
}

export interface ProgressInputs {
  /** 날짜 → (교시 → 과목 글자) */
  subjectsByDate: Record<string, Record<string, string>>;
  /** 날짜 → (교시 → 수업 메모 첫 줄) - 같은 수업 문서에서 꺼낸다(읽기를 더 하지 않는다) */
  notesByDate: Record<string, Record<string, string>>;
  /** 날짜 → 그날 events 문서 데이터 (수업이 없는 날을 가리는 데만 쓴다) */
  eventsByDate: Record<string, any>;
}

/**
 * 진도를 세는 데 필요한 수업·일정 문서를 범위 쿼리 두 개로 구독한다 (개인 공간). 읽기만 한다.
 * 두 쿼리가 모두 한 번씩 답한 뒤부터 onData를 부른다.
 */
export function subscribeProgressInputs(
  uid: string,
  from: string,
  to: string,
  onData: (inputs: ProgressInputs) => void,
  onError?: (err: unknown) => void
): () => void {
  const range = (name: string) =>
    query(collection(db, 'users', uid, name), where(documentId(), '>=', from), where(documentId(), '<=', to));

  let subjectsByDate: Record<string, Record<string, string>> | null = null;
  let notesByDate: Record<string, Record<string, string>> = {};
  let eventsByDate: Record<string, any> | null = null;
  const emit = () => {
    if (subjectsByDate && eventsByDate) onData({ subjectsByDate, notesByDate, eventsByDate });
  };

  const unsubSchedules = onSnapshot(
    range('schedules'),
    (snap) => {
      const next: Record<string, Record<string, string>> = {};
      const notes: Record<string, Record<string, string>> = {};
      snap.forEach((d) => {
        const periods = d.data().periods;
        const subjects = scheduleSubjects(periods);
        if (Object.keys(subjects).length > 0) next[d.id] = subjects;
        const memo = scheduleNotes(periods);
        if (Object.keys(memo).length > 0) notes[d.id] = memo;
      });
      subjectsByDate = next;
      notesByDate = notes;
      emit();
    },
    (err) => onError?.(err)
  );
  const unsubEvents = onSnapshot(
    range('events'),
    (snap) => {
      const next: Record<string, any> = {};
      snap.forEach((d) => {
        next[d.id] = d.data();
      });
      eventsByDate = next;
      emit();
    },
    (err) => onError?.(err)
  );
  return () => {
    unsubSchedules();
    unsubEvents();
  };
}
