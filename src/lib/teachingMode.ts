// src/lib/teachingMode.ts
//
// 환경설정 '교사 유형' (docs/ROADMAP-SUBJECT.md S1) - 초등 담임 / 교과 전담 / 교과 + 담임.
// users/{uid}/settings/v4_teaching (V4 전용, 계정에 하나 - PC·휴대폰이 같은 유형을 쓴다).
// 저장은 두 값: 수업 단위 unit('subject' = 과목 / 'class' = 반+과목) + 담임반 유무 hasHomeroom.
// 문서가 없으면 초등 담임(지금까지의 V4). 새 동작은 늘 unit === 'class'일 때만 켠다.
import { arrayRemove, arrayUnion, doc, getDocFromServer, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { subscribeDocWithServerFallback } from './firestoreSubscribe';

export type LessonUnit = 'subject' | 'class';
/** 화면에 보이는 셋: 초등 담임 / 교과 전담 / 교과 + 담임(중등 담임) */
export type TeacherPreset = 'homeroom' | 'subject' | 'subjectHomeroom';

/** 환경설정 카드와 처음 안내 띠가 함께 쓰는 셋 */
export const TEACHER_PRESETS: { value: TeacherPreset; label: string; desc: string }[] = [
  { value: 'homeroom', label: '초등 담임', desc: '한 반의 여러 과목 - 지금까지의 V4' },
  { value: 'subject', label: '교과 전담', desc: '여러 반에 한두 과목 - 알림장·출석부를 숨깁니다' },
  { value: 'subjectHomeroom', label: '교과 + 담임', desc: '여러 반에 과목 + 내 담임반 (중등 담임)' },
];

export interface TeachingMode {
  unit: LessonUnit;
  hasHomeroom: boolean;
  /** 담임반 '5-2' 또는 '' (담임반이 있을 때만 뜻이 있다) */
  homeroomClass: string;
  /** 가르치는 과목 ['과학'] - 시간표 칸 제안에 쓴다 */
  subjects: string[];
  /** '5-2' → 색 이름. 없으면 차례대로 */
  classColors: Record<string, string>;
  updatedAt?: number;
}

export const DEFAULT_TEACHING_MODE: TeachingMode = {
  unit: 'subject',
  hasHomeroom: true,
  homeroomClass: '',
  subjects: [],
  classColors: {},
};

export const teachingModeRef = (uid: string) => doc(db, 'users', uid, 'settings', 'v4_teaching');

/** 반 표기 '학년-반' (예: 5-2) */
const CLASS_RE = /^\d{1,2}-\d{1,2}$/;

/** 과목 이름 목록을 다듬는다 - 앞뒤 빈칸·빈 것·겹치는 것을 뺀다 */
export function cleanSubjects(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const s of list) {
    const name = typeof s === 'string' ? s.trim() : '';
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** 저장된 모양을 믿지 않고 고쳐 읽는다. 빈 문서·모르는 값은 기본값(초등 담임)으로 */
export function sanitizeTeachingMode(raw: unknown): TeachingMode {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const homeroom = typeof r.homeroomClass === 'string' ? r.homeroomClass.trim() : '';
  const colors: Record<string, string> = {};
  if (r.classColors && typeof r.classColors === 'object' && !Array.isArray(r.classColors)) {
    for (const [k, v] of Object.entries(r.classColors as Record<string, unknown>)) {
      if (CLASS_RE.test(k) && typeof v === 'string' && v) colors[k] = v;
    }
  }
  const mode: TeachingMode = {
    unit: r.unit === 'class' ? 'class' : 'subject',
    hasHomeroom: typeof r.hasHomeroom === 'boolean' ? r.hasHomeroom : true,
    homeroomClass: CLASS_RE.test(homeroom) ? homeroom : '',
    subjects: cleanSubjects(r.subjects),
    classColors: colors,
  };
  if (typeof r.updatedAt === 'number') mode.updatedAt = r.updatedAt;
  return mode;
}

/** 저장된 두 값 → 화면의 셋. 과목 단위면 담임반 유무와 관계없이 초등 담임 */
export function presetOf(m: Pick<TeachingMode, 'unit' | 'hasHomeroom'>): TeacherPreset {
  if (m.unit !== 'class') return 'homeroom';
  return m.hasHomeroom ? 'subjectHomeroom' : 'subject';
}

/** 화면의 셋 → 저장할 두 값 */
export function presetPatch(p: TeacherPreset): Pick<TeachingMode, 'unit' | 'hasHomeroom'> {
  if (p === 'subject') return { unit: 'class', hasHomeroom: false };
  if (p === 'subjectHomeroom') return { unit: 'class', hasHomeroom: true };
  return { unit: 'subject', hasHomeroom: true };
}

/**
 * 교사 유형을 구독한다. exists = 문서가 있었나 (처음 안내 띠에 쓴다).
 * '없음'은 서버에 직접 물어 확인한 뒤에만 알린다 - 캐시가 잘못 답한 '없음'으로 띠가 뜨고,
 * 거기서 '나중에'를 누르면 저장된 교과 전담을 초등 담임으로 덮어쓸 수 있다.
 * 서버가 답하지 않으면 알리지 않는다(아직 못 읽은 채로 둔다).
 */
export function subscribeTeachingMode(uid: string, cb: (m: TeachingMode, exists: boolean) => void): () => void {
  const ref = teachingModeRef(uid);
  let cancelled = false;
  let seen = false;
  const unsub = subscribeDocWithServerFallback(
    ref,
    (data) => {
      if (cancelled) return;
      if (data) {
        seen = true;
        cb(sanitizeTeachingMode(data), true);
        return;
      }
      if (seen) {
        // 있던 문서가 지워졌다 (다른 기기에서) - 서버가 답한 변화다
        cb({ ...DEFAULT_TEACHING_MODE }, false);
        return;
      }
      getDocFromServer(ref)
        .then((snap) => {
          if (cancelled || seen) return;
          if (snap.exists()) {
            seen = true;
            cb(sanitizeTeachingMode(snap.data()), true);
          } else cb({ ...DEFAULT_TEACHING_MODE }, false);
        })
        .catch((e) => console.warn('교사 유형을 서버에서 확인하지 못했습니다:', e));
    },
    (err) => console.warn('교사 유형을 불러오지 못했습니다:', err)
  );
  return () => {
    cancelled = true;
    unsub();
  };
}

/** 바꾼 칸만 적는다 (setDoc merge) */
export async function saveTeachingMode(uid: string, patch: Partial<TeachingMode>): Promise<void> {
  const { updatedAt: _ignored, ...rest } = patch;
  await setDoc(teachingModeRef(uid), { ...rest, updatedAt: Date.now() }, { merge: true });
}

/** 가르치는 과목을 더하고 뺀다 - 배열을 통째로 덮지 않는다 (다른 기기에서 더한 과목이 남게) */
export async function addTeachingSubjects(uid: string, names: string[]): Promise<void> {
  const list = cleanSubjects(names);
  if (!list.length) return;
  await setDoc(teachingModeRef(uid), { subjects: arrayUnion(...list), updatedAt: Date.now() }, { merge: true });
}

export async function removeTeachingSubject(uid: string, name: string): Promise<void> {
  await setDoc(teachingModeRef(uid), { subjects: arrayRemove(name), updatedAt: Date.now() }, { merge: true });
}
