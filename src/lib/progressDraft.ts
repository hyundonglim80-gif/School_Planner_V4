// src/lib/progressDraft.ts
//
// 진도 관리 창(ProgressModal)이 고치는 모양과 저장할 모양 (19번 U2). 순수 함수만 - 창이 쓰고 테스트가 못 박는다.
//   - 행마다 임시 key(_k): 행을 가운데 넣어도 React가 입력 중인 칸을 엉키게 하지 않게. 저장할 때 뺀다(cleanLessons).
//   - 교과 모드는 늘 '과목 + 반 칩'으로 고친다. 옛 '칸 글자 하나' 진도('5-2 과학')는 과목 + 반 하나로 보이되,
//     반을 하나 이하로 두면 그 모양 그대로 저장한다(draftTarget) - 과정으로 바꾸면 칸 견주기가 progressKey →
//     normalizeSlotText로 바뀌어 옛 결과가 달라질 수 있다.
import { formatDate } from './dateUtils';
import { isCourse, newProgressId, progressKey, type ProgressLesson, type ProgressPlan } from './progress';
import { formatSlot, parseSlot } from './teachingSlot';

/** 고치는 중인 행 - _k는 React key (행을 가운데 넣어도 입력 중인 칸이 엉키지 않게). 저장할 때 뺀다 */
export type DraftLesson = ProgressLesson & { _k: string };

export interface Draft {
  id: string;
  key: string;
  startDate: string;
  lessons: DraftLesson[];
  /** 과정(교과 모드)의 과목 */
  subject: string;
  /** 과목 + 반 칩으로 고치면 고른 반들(고르는 중이면 빈 배열), 초등 담임의 과목 하나 진도면 null */
  classes: string[] | null;
  /** 교과 모드에서 연 옛 '칸 글자 하나' 진도(또는 반 없이 과목만 저장한 진도)의 그 글자. 반을 하나 이하로 두면 이 모양 그대로 저장 */
  legacyKey: string | null;
}

let lessonSeq = 0;
export const withKey = (l: ProgressLesson): DraftLesson => ({ ...l, _k: `r${++lessonSeq}` });
export const emptyLesson = (): DraftLesson => withKey({ unit: '', no: '', content: '', page: '', supplies: '' });
export const hasText = (l: ProgressLesson) =>
  !!(l.unit.trim() || l.no.trim() || l.content.trim() || l.page.trim() || l.supplies.trim());
export const trimLesson = (l: ProgressLesson): ProgressLesson => ({
  unit: l.unit.trim(),
  no: l.no.trim(),
  content: l.content.trim(),
  page: l.page.trim(),
  supplies: l.supplies.trim(),
});
/** 저장할 모양: 앞뒤 공백을 떼고 빈 행은 뺀다 (_k도 빠진다) */
export const cleanLessons = (lessons: ProgressLesson[]): ProgressLesson[] => lessons.map(trimLesson).filter(hasText);
export const squeeze = (s: string) => s.trim().replace(/\s+/g, ' ');

/** 저장한 진도 → 고치는 모양. 교과 모드면 옛 칸 글자 진도도 과목 + 반 칩으로('5-2 과학' → 과학 · 5-2, '창체' → 창체) */
export const toDraft = (p: ProgressPlan, classUnit: boolean): Draft => {
  const base = { id: p.id, key: p.key, startDate: p.startDate, lessons: p.lessons.map(withKey) };
  if (isCourse(p)) return { ...base, subject: p.subject || '', classes: [...p.classes!], legacyKey: null };
  if (!classUnit) return { ...base, subject: '', classes: null, legacyKey: null };
  const slot = parseSlot(p.key);
  return { ...base, subject: slot.subject, classes: slot.cls ? [slot.cls] : [], legacyKey: p.key };
};
export const newDraft = (): Draft => ({
  id: newProgressId(),
  key: '',
  startDate: formatDate(new Date()),
  lessons: [],
  subject: '',
  classes: null,
  legacyKey: null,
});
export const newCourseDraft = (subject = ''): Draft => ({ ...newDraft(), subject, classes: [] });

/**
 * 이 초안을 저장할 모양. 과정이면 subject·classes, 아니면 세는 칸 글자 하나(key).
 * 교과 모드: 반 둘 이상 → 과정. 옛 진도에 반 하나 이하 → 옛 모양(과목·반을 그대로 두면 글자도 그대로).
 * 새 진도에 반 하나 → 과정. 반을 고르지 않으면 '창체'처럼 반 없이 과목만 적힌 칸을 세는 진도.
 */
export function draftTarget(d: Draft): { key: string; subject?: string; classes?: string[] } {
  if (!d.classes) return { key: progressKey(d.key) };
  const subject = squeeze(d.subject);
  if (d.legacyKey !== null && d.classes.length <= 1) {
    const cls = d.classes[0] || '';
    const old = parseSlot(d.legacyKey);
    return { key: old.cls === cls && old.subject === subject ? d.legacyKey : progressKey(formatSlot(cls, subject)) };
  }
  if (d.classes.length === 0) return { key: progressKey(subject) };
  return { key: '', subject, classes: d.classes };
}

export const sameAsSaved = (d: Draft, p: ProgressPlan) => {
  const t = draftTarget(d);
  return (
    d.startDate === p.startDate &&
    JSON.stringify(cleanLessons(d.lessons)) === JSON.stringify(p.lessons) &&
    (t.classes
      ? isCourse(p) && t.subject === (p.subject || '') && t.classes.join(',') === p.classes!.join(',')
      : !isCourse(p) && t.key === p.key)
  );
};


/** after 행 바로 아래(after가 -1이면 맨 위)에 빈 행을 넣은 새 목록과 그 행 번호 */
export function insertRowAfter(lessons: DraftLesson[], after: number): { lessons: DraftLesson[]; at: number } {
  const at = Math.max(0, Math.min(after + 1, lessons.length));
  const next = [...lessons];
  next.splice(at, 0, emptyLesson());
  return { lessons: next, at };
}
