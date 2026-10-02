// src/lib/teachingSlot.ts
//
// 교과 모드의 시간표 칸 글자 '5-2 과학' (docs/ROADMAP-SUBJECT.md S2). 순수 함수만 - Firestore 없음.
// 반·과목은 V3와 같이 쓰는 수업 문서에 칸을 더하지 않고 칸 글자에 담는다 - V3에도 그 글자로 보인다.
// 사람마다 '5학년 2반 과학', '5-2과학', '５-２ 과학'처럼 적으니 읽을 때 반을 찾아 한 모양으로 맞춘다.
// 초등 담임 모드에서는 이 정규화를 쓰지 않는다 ('3-2 국어'를 적는 담임도 있다 - 화면 쪽에서 isClassUnit일 때만 부른다).
import type { ClassRoster } from '../hooks/useRoster';

export interface SlotParts {
  /** '5-2', 반을 못 찾으면 '' */
  cls: string;
  grade: string;
  classNum: string;
  /** 반 뒤의 나머지 (반이 없으면 글 전체), 앞뒤 공백 정리·가운데 공백 하나로 */
  subject: string;
}

const CLASS_RE = /^\d{1,2}-\d{1,2}$/;

/** 전각 숫자·여러 줄표를 반각으로 (반을 찾는 데만 쓴다) */
function toAscii(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐‑‒–—―－−]/g, '-');
}

const squeeze = (s: string) => s.trim().replace(/\s+/g, ' ');

// 학년·반은 1~2자리, 반 숫자 바로 뒤에 숫자가 더 오면 반이 아니다 ('5-123').
// '1-2차시'처럼 글자가 붙으면 반으로 읽는다 - 시간표 칸에는 차시를 쓰지 않는다. '5-2반 과학'의 '반'은 뗀다.
const DASH_RE = /^\s*(\d{1,2})\s*-\s*(\d{1,2})(?!\d)\s*반?(.*)$/s;
const KOREAN_RE = /^\s*(\d{1,2})\s*학년\s*(\d{1,2})\s*반(.*)$/s;

export function parseSlot(text: string): SlotParts {
  const src = toAscii(String(text ?? ''));
  const m = DASH_RE.exec(src) || KOREAN_RE.exec(src);
  if (m) {
    const g = Number(m[1]);
    const c = Number(m[2]);
    if (g >= 1 && c >= 1) {
      return { cls: `${g}-${c}`, grade: String(g), classNum: String(c), subject: squeeze(m[3]) };
    }
  }
  return { cls: '', grade: '', classNum: '', subject: squeeze(String(text ?? '')) };
}

/** '5-2 과학', 과목이 없으면 '5-2', 반이 없으면 과목만 */
export function formatSlot(cls: string, subject: string): string {
  const s = squeeze(subject);
  if (!cls) return s;
  return s ? `${cls} ${s}` : cls;
}

/** 반을 찾으면 '5-2 과학' 모양으로, 못 찾으면 앞뒤 공백만 정리 */
export function normalizeSlotText(text: string): string {
  const p = parseSlot(text);
  return p.cls ? formatSlot(p.cls, p.subject) : String(text ?? '').trim();
}

/** 명렬표 하나의 반 표기 '5-2' ('05'·' 5 '도 '5'로). 숫자가 아니면 적힌 그대로 */
export function classLabelOf(r: { grade: string | number; classNum: string | number }): string {
  const g = String(r.grade ?? '').trim();
  const c = String(r.classNum ?? '').trim();
  const num = (s: string) => (/^\d+$/.test(s) ? String(Number(s)) : s);
  return `${num(g)}-${num(c)}`;
}

/** 그 학년도 명렬표의 반들을 학년·반 숫자 차례로 ('5-10'은 '5-9' 뒤). 같은 반이 둘이면 앞의 것 */
export function classesForYear(rosters: ClassRoster[], schoolYear: number): { label: string; roster: ClassRoster }[] {
  const seen = new Set<string>();
  const out: { label: string; roster: ClassRoster }[] = [];
  for (const roster of rosters) {
    if (Number(roster.year) !== schoolYear) continue;
    const label = classLabelOf(roster);
    if (!CLASS_RE.test(label) || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, roster });
  }
  return out.sort((a, b) => {
    const [ga, ca] = a.label.split('-').map(Number);
    const [gb, cb] = b.label.split('-').map(Number);
    return ga - gb || ca - cb;
  });
}

/** 칸 제안: 반 × 과목 ('5-1 과학', '5-1 실과', '5-2 과학'…). 과목이 없으면 반만 */
export function slotSuggestions(classLabels: string[], subjects: string[]): string[] {
  const subs = [...new Set(subjects.map(squeeze).filter(Boolean))];
  if (subs.length === 0) return [...classLabels];
  return classLabels.flatMap((cls) => subs.map((s) => formatSlot(cls, s)));
}

/** 칸 글자의 반에 맞는 그 학년도 명렬표. 반이 없거나 명렬표에 없으면 null */
export function rosterForSlot(rosters: ClassRoster[], text: string, schoolYear: number): ClassRoster | null {
  const { cls } = parseSlot(text);
  if (!cls) return null;
  return classesForYear(rosters, schoolYear).find((c) => c.label === cls)?.roster ?? null;
}

/**
 * 수업 칸에서 조사표를 새로 만들 때 고를 학급·과목 (S8). 칸 글자 '5-2 과학' → 그 날짜 학년도의 5-2 명렬표 차례(rosters 안의 자리)와 '과학'.
 * 반이 없거나 명렬표에 없으면 null (지금처럼 골라 둔 학급·적힌 과목 그대로).
 */
export function evalDefaultsForSlot(
  rosters: ClassRoster[],
  text: string,
  date: string
): { rosterIndex: number; subject: string } | null {
  const { cls, subject } = parseSlot(text);
  if (!cls) return null;
  const y = Number(date.slice(0, 4));
  const schoolYear = Number(date.slice(5, 7)) >= 3 ? y : y - 1;
  const roster = rosterForSlot(rosters, text, schoolYear);
  if (!roster) return null;
  return { rosterIndex: rosters.indexOf(roster), subject };
}

// ── 지난 시간 (S5) ──────────────────────────────────────────────────────────

/**
 * 같은 칸 글자(정규화해 견준다 - '5-2과학'도 '5-2 과학')의 바로 앞 교시. 같은 날 앞 교시도 본다.
 * subjectsByDate: 날짜 → (교시 → 칸 글자) (lib/progress scheduleSubjects). isOffDay인 날은 건너뛴다. 없으면 null.
 */
export function previousSlotOf(
  subjectsByDate: Record<string, Record<string, string>>,
  text: string,
  date: string,
  period: string | number,
  isOffDay: (date: string) => boolean = () => false
): { date: string; period: string } | null {
  const key = normalizeSlotText(text);
  if (!key) return null;
  const dates = Object.keys(subjectsByDate)
    .filter((d) => d <= date)
    .sort()
    .reverse();
  for (const d of dates) {
    if (d !== date && isOffDay(d)) continue;
    const periods = subjectsByDate[d] || {};
    const hits = Object.keys(periods)
      .filter((p) => (d < date || Number(p) < Number(period)) && normalizeSlotText(periods[p]) === key)
      .sort((a, b) => Number(b) - Number(a));
    if (hits.length > 0) return { date: d, period: hits[0] };
  }
  return null;
}

// ── 반 색 (S3) ──────────────────────────────────────────────────────────────
// 교과 모드의 수업 칸은 반마다 색이 다르다. 환경설정 '교사 유형'에서 반마다 고르고(classColors),
// 고르지 않은 반은 그 학년도 반 차례로 8색을 돌려쓴다. Tailwind 클래스만 돌려준다(hex X - 다크 모드는 dark.css가 바꾼다).
// 클래스 이름은 통째로 적어 둔다 - 문자열을 이어 붙이면 Tailwind가 만들지 않는다.

export interface ClassColorClasses {
  /** 색 이름 'sky' */
  name: string;
  /** 카드 왼쪽 막대 */
  bar: string;
  /** 반 칩 (배경+글자) */
  chip: string;
  /** 색 고르기 점 */
  dot: string;
}

export const CLASS_COLORS: ClassColorClasses[] = [
  { name: 'sky', bar: 'border-l-sky-500', chip: 'bg-sky-100 text-sky-800', dot: 'bg-sky-500' },
  { name: 'emerald', bar: 'border-l-emerald-500', chip: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  { name: 'amber', bar: 'border-l-amber-500', chip: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  { name: 'rose', bar: 'border-l-rose-500', chip: 'bg-rose-100 text-rose-800', dot: 'bg-rose-500' },
  { name: 'violet', bar: 'border-l-violet-500', chip: 'bg-violet-100 text-violet-800', dot: 'bg-violet-500' },
  { name: 'teal', bar: 'border-l-teal-500', chip: 'bg-teal-100 text-teal-800', dot: 'bg-teal-500' },
  { name: 'orange', bar: 'border-l-orange-500', chip: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500' },
  { name: 'indigo', bar: 'border-l-indigo-500', chip: 'bg-indigo-100 text-indigo-800', dot: 'bg-indigo-500' },
];

/**
 * 반 '5-2'의 색. 정한 색(classColors) → 그 학년도 반 차례(allLabels)로 돌려쓰기 →
 * 명렬표에 없는 반은 반 이름으로 고른 색(늘 같은 색). 모르는 색 이름은 정하지 않은 것으로 본다.
 */
export function classColor(label: string, classColors: Record<string, string>, allLabels: string[]): ClassColorClasses {
  const picked = CLASS_COLORS.find((c) => c.name === classColors[label]);
  if (picked) return picked;
  const i = allLabels.indexOf(label);
  if (i >= 0) return CLASS_COLORS[i % CLASS_COLORS.length];
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CLASS_COLORS[h % CLASS_COLORS.length];
}
