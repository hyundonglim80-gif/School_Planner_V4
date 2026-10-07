// src/lib/teachingMode.ts
//
// 환경설정 '교사 유형' (docs/ROADMAP-SUBJECT.md S1). 초등 담임 / 교과 전담 / 교과 + 담임(중등 담임).
// users/{uid}/settings/v4_teaching (V4 전용, 계정에 하나 - PC·휴대폰이 같은 유형을 본다).
// 저장은 두 값: 수업 단위 unit('subject' = 과목 / 'class' = 반+과목)과 담임반 유무 hasHomeroom.
// 문서가 없으면 초등 담임(지금까지의 V4)이다. 새 동작은 늘 unit === 'class'일 때만 켠다.
// 화면은 이 파일을 직접 구독하지 않고 hooks/useTeachingMode로 읽는다 (App이 한 번 구독해 store에 넣는다).
import { arrayRemove, arrayUnion, doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { subscribeDocWithServerFallback } from './firestoreSubscribe';

export type LessonUnit = 'subject' | 'class';
/** 화면에 보이는 셋: 초등 담임 / 교과 전담 / 교과 + 담임 */
export type TeacherPreset = 'homeroom' | 'subject' | 'subjectHomeroom';

export interface TeachingMode {
  unit: LessonUnit;
  hasHomeroom: boolean;
  /** '5-2' 또는 '' (담임반이 있을 때만 뜻이 있다) */
  homeroomClass: string;
  /** 가르치는 과목 ['과학'] - 시간표 칸 제안에 쓴다 */
  subjects: string[];
  /** 가르치는 반 ['5-1', '5-2'] - 시간표·명렬표에 없는 반도 칸 제안에 넣는다 (19번 U1, '5-2' 꼴만) */
  classes: string[];
  /** '5-2' → 색 이름. 없으면 차례대로 */
  classColors: Record<string, string>;
  updatedAt?: number;
}

export const DEFAULT_TEACHING_MODE: TeachingMode = {
  unit: 'subject',
  hasHomeroom: true,
  homeroomClass: '',
  subjects: [],
  classes: [],
  classColors: {},
};

export const teachingModeRef = (uid: string) => doc(db, 'users', uid, 'settings', 'v4_teaching');

const CLASS_RE = /^\d{1,2}-\d{1,2}$/;

/** 저장된 모양을 믿지 않고 고쳐 읽는다. 모르는 값·빈 문서는 기본값(초등 담임)으로 채운다 */
export function sanitizeTeachingMode(raw: unknown): TeachingMode {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const subjects = Array.isArray(r.subjects)
    ? [...new Set(r.subjects.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean))]
    : [];
  const classes = Array.isArray(r.classes)
    ? [...new Set(r.classes.filter((c): c is string => typeof c === 'string').map((c) => c.trim()).filter((c) => CLASS_RE.test(c)))]
    : [];
  const classColors: Record<string, string> = {};
  if (r.classColors && typeof r.classColors === 'object' && !Array.isArray(r.classColors)) {
    for (const [k, v] of Object.entries(r.classColors as Record<string, unknown>)) {
      if (CLASS_RE.test(k) && typeof v === 'string' && v) classColors[k] = v;
    }
  }
  const homeroomClass = typeof r.homeroomClass === 'string' && CLASS_RE.test(r.homeroomClass) ? r.homeroomClass : '';
  return {
    unit: r.unit === 'class' ? 'class' : 'subject',
    hasHomeroom: typeof r.hasHomeroom === 'boolean' ? r.hasHomeroom : true,
    homeroomClass,
    subjects,
    classes,
    classColors,
    ...(typeof r.updatedAt === 'number' ? { updatedAt: r.updatedAt } : {}),
  };
}

/** 저장된 두 값 → 화면의 셋. 과목 단위면 담임반 유무와 상관없이 초등 담임이다 */
export function presetOf(m: Pick<TeachingMode, 'unit' | 'hasHomeroom'>): TeacherPreset {
  if (m.unit !== 'class') return 'homeroom';
  return m.hasHomeroom ? 'subjectHomeroom' : 'subject';
}

export function presetPatch(p: TeacherPreset): Pick<TeachingMode, 'unit' | 'hasHomeroom'> {
  if (p === 'subject') return { unit: 'class', hasHomeroom: false };
  if (p === 'subjectHomeroom') return { unit: 'class', hasHomeroom: true };
  return { unit: 'subject', hasHomeroom: true };
}

export const TEACHER_PRESETS: { value: TeacherPreset; label: string; desc: string }[] = [
  // 이름은 2026-10-07 사용자가 정함: (초등) 담임 / 전담 / (중등) 전담 + 담임
  { value: 'homeroom', label: '(초등) 담임', desc: '한 반의 여러 과목 - 지금까지의 V4' },
  { value: 'subject', label: '전담', desc: '여러 반에 한두 과목 - 시간표 칸에 학년-반과 과목, 알림장·출석부를 숨깁니다' },
  { value: 'subjectHomeroom', label: '(중등) 전담 + 담임', desc: '여러 반에 과목 + 내 담임반 - 시간표 칸에 학년-반과 과목' },
];

/** 그 학년도 명렬표의 반을 '5-2'처럼, 학년·반 차례로 */
export function homeroomClassOptions(
  rosters: { year: number | string; grade: string; classNum: string }[],
  schoolYear: number
): string[] {
  const keys = rosters
    .filter((r) => Number(r.year) === schoolYear)
    .map((r) => `${String(r.grade).trim()}-${String(r.classNum).trim()}`)
    .filter((k) => CLASS_RE.test(k));
  return [...new Set(keys)].sort((a, b) => {
    const [ga, ca] = a.split('-').map(Number);
    const [gb, cb] = b.split('-').map(Number);
    return ga - gb || ca - cb;
  });
}

/** 문서가 없으면 exists=false와 기본값을 준다 (처음 안내 띠에 쓴다) */
export function subscribeTeachingMode(uid: string, cb: (m: TeachingMode, exists: boolean) => void): () => void {
  return subscribeDocWithServerFallback(
    teachingModeRef(uid),
    (data) => cb(sanitizeTeachingMode(data), !!data),
    (err) => console.warn('교사 유형 설정을 불러오지 못했습니다:', err)
  );
}

/** 바뀐 칸만 덧쓴다 (setDoc merge) */
export async function saveTeachingMode(uid: string, patch: Partial<Omit<TeachingMode, 'updatedAt'>>): Promise<void> {
  await setDoc(teachingModeRef(uid), { ...patch, updatedAt: Date.now() }, { merge: true });
}

/** 과목 하나를 더하거나 뺀다 - 다른 기기에서 같이 고쳐도 서로 지우지 않게 배열 연산으로 */
export async function addTeachingSubject(uid: string, subject: string): Promise<void> {
  await setDoc(teachingModeRef(uid), { subjects: arrayUnion(subject), updatedAt: Date.now() }, { merge: true });
}

export async function removeTeachingSubject(uid: string, subject: string): Promise<void> {
  await setDoc(teachingModeRef(uid), { subjects: arrayRemove(subject), updatedAt: Date.now() }, { merge: true });
}

/** 가르치는 반을 더하거나 뺀다 - 과목과 같게 배열 연산으로 */
export async function addTeachingClasses(uid: string, classes: string[]): Promise<void> {
  if (!classes.length) return;
  await setDoc(teachingModeRef(uid), { classes: arrayUnion(...classes), updatedAt: Date.now() }, { merge: true });
}

export async function removeTeachingClass(uid: string, cls: string): Promise<void> {
  await setDoc(teachingModeRef(uid), { classes: arrayRemove(cls), updatedAt: Date.now() }, { merge: true });
}
