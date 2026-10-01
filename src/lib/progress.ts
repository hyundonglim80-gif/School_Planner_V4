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
import { classOffReason, type ClassDayRules } from './classDays';
import { moveToTrash } from '../utils/trashHelper';

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
  updatedAt?: number;
}

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

export const slotId = (date: string, period: string | number) => `${date}#${period}`;

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
  const rows = parseClipboardGrid(text).filter((r) => r.some((c) => c !== ''));
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
  plan: Pick<ProgressPlan, 'key' | 'startDate' | 'lessons' | 'bumps'>,
  subjectsByDate: Record<string, Record<string, string>>,
  isOffDay: (date: string) => boolean = () => false,
  until?: string
): ProgressTimeline {
  const key = progressKey(plan.key);
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
      .filter((p) => progressKey(periods[p]) === key)
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
 * 이 진도를 세지 않기 시작하는 날 - 같은 글자의 다음 진도 시작일. 없으면 undefined.
 */
export function progressUntil(
  plan: Pick<ProgressPlan, 'id' | 'key' | 'startDate'>,
  plans: Array<Pick<ProgressPlan, 'id' | 'key' | 'startDate'>>
): string | undefined {
  const key = progressKey(plan.key);
  let until: string | undefined;
  for (const p of plans) {
    if (p.id === plan.id || progressKey(p.key) !== key || !p.startDate || p.startDate <= plan.startDate) continue;
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
  return {
    id,
    key: progressKey(raw?.key),
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(str(raw?.startDate)) ? str(raw.startDate) : '',
    lessons,
    bumps: Array.isArray(raw?.bumps) ? raw.bumps.filter((b: unknown) => typeof b === 'string') : [],
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : undefined,
  };
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
  plan: Pick<ProgressPlan, 'id' | 'key' | 'startDate' | 'lessons'>
): Promise<void> {
  await setDoc(
    doc(progressCol(uid), plan.id),
    {
      key: progressKey(plan.key),
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

/** 휴지통에 먼저 넣고 지운다 (휴지통에 못 넣으면 지우지 않는다 - 던진다). 복원은 TrashModal 'progress' */
export async function deleteProgressPlan(uid: string, plan: ProgressPlan): Promise<void> {
  const { id, ...data } = plan;
  await moveToTrash({
    id,
    type: 'progress',
    content: `${plan.key} 진도 (${plan.lessons.length}차시)`,
    data: { id, ...data },
  });
  await deleteDoc(doc(progressCol(uid), id));
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
    updatedAt: Date.now(),
  });
}

export interface ProgressInputs {
  /** 날짜 → (교시 → 과목 글자) */
  subjectsByDate: Record<string, Record<string, string>>;
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
  let eventsByDate: Record<string, any> | null = null;
  const emit = () => {
    if (subjectsByDate && eventsByDate) onData({ subjectsByDate, eventsByDate });
  };

  const unsubSchedules = onSnapshot(
    range('schedules'),
    (snap) => {
      const next: Record<string, Record<string, string>> = {};
      snap.forEach((d) => {
        const subjects = scheduleSubjects(d.data().periods);
        if (Object.keys(subjects).length > 0) next[d.id] = subjects;
      });
      subjectsByDate = next;
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
