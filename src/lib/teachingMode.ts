// src/lib/teachingMode.ts
//
// 환경설정 '교사 유형' (docs/ROADMAP-SUBJECT.md S1, 18번 교과 전담 모드).
// users/{uid}/settings/v4_teaching (V4 전용, 계정에 하나 - PC·휴대폰이 같다).
// 화면에는 셋(초등 담임 / 교과 전담 / 교과 + 담임)을 보이고, 저장은 두 값(unit, hasHomeroom)이다.
// 문서가 없으면 초등 담임(unit 'subject', hasHomeroom true) - 지금까지의 V4와 같다.
// 모드는 hooks/useTeachingMode 하나로만 읽는다 (store에 App이 한 번 구독해 넣는다).
import { doc, getDocFromServer, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { subscribeDocWithServerFallback } from './firestoreSubscribe';

/** 수업 단위: 'subject' = 과목(한 반의 여러 과목) / 'class' = 반+과목(여러 반) */
export type LessonUnit = 'subject' | 'class';
/** 화면에 보이는 셋: 초등 담임 / 교과 전담 / 교과 + 담임(중등 담임) */
export type TeacherPreset = 'homeroom' | 'subject' | 'subjectHomeroom';

export interface TeachingMode {
  unit: LessonUnit;
  hasHomeroom: boolean;
  /** '5-2' 또는 '' (담임반이 있을 때만 뜻이 있다) */
  homeroomClass: string;
  /** 가르치는 과목 ['과학'] - 시간표 칸 제안에 쓴다 (S2) */
  subjects: string[];
  /** '5-2' → 색 이름 (S3). 없으면 차례대로 */
  classColors: Record<string, string>;
  updatedAt?: number;
}

/** 화면의 셋 (환경설정 카드·처음 안내 띠) */
export const TEACHER_PRESETS: { value: TeacherPreset; label: string; desc: string }[] = [
  { value: 'homeroom', label: '초등 담임', desc: '한 반의 여러 과목 - 지금까지의 V4' },
  { value: 'subject', label: '교과 전담', desc: '여러 반에 한두 과목 - 알림장·출석부를 숨깁니다' },
  { value: 'subjectHomeroom', label: '교과 + 담임', desc: '여러 반에 과목 + 내 담임반 (중등 담임)' },
];

export const DEFAULT_TEACHING_MODE: TeachingMode = {
  unit: 'subject',
  hasHomeroom: true,
  homeroomClass: '',
  subjects: [],
  classColors: {},
};

export const teachingModeRef = (uid: string) => doc(db, 'users', uid, 'settings', 'v4_teaching');

/** 저장된 모양을 믿지 않고 고쳐 읽는다. 모르는 값·빈 문서는 기본값(초등 담임)으로 채운다 */
export function sanitizeTeachingMode(raw: unknown): TeachingMode {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const subjects = Array.isArray(r.subjects)
    ? [...new Set(r.subjects.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean))]
    : [];
  const classColors: Record<string, string> = {};
  if (r.classColors && typeof r.classColors === 'object' && !Array.isArray(r.classColors)) {
    for (const [k, v] of Object.entries(r.classColors as Record<string, unknown>)) {
      if (typeof v === 'string' && v) classColors[k] = v;
    }
  }
  const out: TeachingMode = {
    unit: r.unit === 'class' ? 'class' : 'subject',
    hasHomeroom: typeof r.hasHomeroom === 'boolean' ? r.hasHomeroom : true,
    homeroomClass: typeof r.homeroomClass === 'string' ? r.homeroomClass.trim() : '',
    subjects,
    classColors,
  };
  if (typeof r.updatedAt === 'number') out.updatedAt = r.updatedAt;
  return out;
}

/** 저장된 두 값 → 화면의 셋. 과목 단위면 담임반 유무와 상관없이 초등 담임 */
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
 * '없음'은 서버에 한 번 물어 확인한 뒤에만 알린다 - 캐시가 비어 '없다'고 답한 순간 띠가 번쩍이지 않게.
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
        // 있던 문서가 지워졌다 (다른 기기·점검)
        cb(DEFAULT_TEACHING_MODE, false);
        return;
      }
      getDocFromServer(ref)
        .then((snap) => {
          if (cancelled) return;
          if (snap.exists()) {
            seen = true;
            cb(sanitizeTeachingMode(snap.data()), true);
          } else cb(DEFAULT_TEACHING_MODE, false);
        })
        .catch((err) => {
          // 서버가 답하지 않으면 '없다'고 단정하지 않는다 - 기본값으로 쓰되 처음 안내는 띄우지 않는다
          if (!cancelled) cb(DEFAULT_TEACHING_MODE, true);
          console.warn('교사 유형을 서버에서 확인하지 못했습니다:', err);
        });
    },
    (err) => console.warn('교사 유형을 불러오지 못했습니다:', err)
  );
  return () => {
    cancelled = true;
    unsub();
  };
}

/** 바뀐 칸만 합쳐 쓴다 */
export async function saveTeachingMode(uid: string, patch: Partial<TeachingMode>): Promise<void> {
  const { updatedAt: _ignored, ...rest } = patch;
  await setDoc(teachingModeRef(uid), { ...rest, updatedAt: Date.now() }, { merge: true });
}
