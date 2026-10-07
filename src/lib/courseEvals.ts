// src/lib/courseEvals.ts
//
// 과정별 조사표 모아 보기 (docs/ROADMAP-SUBJECT.md S9). 과정(여러 반)의 조사표를 반 × 평가 표로 묶는다. 순수 함수만.
// 같은 과정의 반마다 같은 조사표를 만들면(S8) 날짜·교시는 반마다 다르고 제목·종류가 같다 - 제목+종류로 한 칸에 묶는다.
import { evalColumnTitle, isEmptyCell, studentEvalCell } from './evalSummary';
import type { EvaluationItem } from '../hooks/useEvaluation';

type EvalLike = Pick<EvaluationItem, 'id' | 'title' | 'type' | 'subject' | 'dateStr' | 'periodStr' | 'records' | 'studentsSnapshot' | 'methodObj' | 'groups'>;

export interface CourseEvalColumn<T extends EvalLike = EvalLike> {
  /** 묶는 열쇠 '종류|제목' */
  id: string;
  title: string;
  type: string;
  /** 반 '5-2' → 그 반의 조사표 (같은 제목이 둘이면 날짜가 이른 것) */
  byClass: Record<string, T>;
  /** 반들 가운데 가장 이른 날짜 (칸 차례) */
  firstDate: string;
}

const norm = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ');

/**
 * 반마다 모은 조사표를 제목+종류로 묶는다. subject를 주면 그 교과만(과정의 과목). 칸은 가장 이른 날짜 차례.
 */
export function groupCourseEvals<T extends EvalLike>(evalsByClass: Record<string, T[]>, subject?: string): CourseEvalColumn<T>[] {
  const cols = new Map<string, CourseEvalColumn<T>>();
  for (const [cls, evals] of Object.entries(evalsByClass)) {
    for (const ev of evals) {
      if (subject && norm(ev.subject) !== norm(subject)) continue;
      const title = norm(ev.title);
      const id = `${ev.type}|${title}`;
      let col = cols.get(id);
      if (!col) cols.set(id, (col = { id, title, type: ev.type, byClass: {}, firstDate: ev.dateStr }));
      const old = col.byClass[cls];
      if (!old || String(ev.dateStr) < String(old.dateStr)) col.byClass[cls] = ev;
      if (String(ev.dateStr) < col.firstDate) col.firstDate = ev.dateStr;
    }
  }
  return [...cols.values()].sort((a, b) => a.firstDate.localeCompare(b.firstDate) || a.title.localeCompare(b.title, 'ko'));
}

/** 조사표 하나의 '완료 n/m': 값(점수·체크·메모)이 있는 학생 수 / 그 반 학생 수 (nums - 지금 명렬표의 재학생) */
export function courseEvalCompletion(ev: EvalLike, nums: number[]): { done: number; total: number } {
  const listed = new Set((ev.studentsSnapshot || []).map((s) => Number(s.num)));
  let done = 0;
  for (const n of nums) if (listed.has(n) && !isEmptyCell(studentEvalCell(ev, n))) done++;
  return { done, total: nums.length };
}

/** 과정별 CSV 줄: 머리(반, 칸 제목들) + 반마다 '완료/학생 수' (없으면 '') */
export function courseOverviewCsvRows<T extends EvalLike>(
  columns: CourseEvalColumn<T>[],
  classes: Array<{ cls: string; nums: number[] }>
): string[][] {
  const head = ['반', ...columns.map((c) => c.title)];
  const rows = classes.map(({ cls, nums }) => [
    cls,
    ...columns.map((c) => {
      const ev = c.byClass[cls];
      if (!ev) return '';
      const { done, total } = courseEvalCompletion(ev, nums);
      return `${done}/${total}`;
    }),
  ]);
  return [head, ...rows];
}

/** 칸 머리 아래 작은 글: 반마다 다른 날짜는 첫 날짜만 ('11/2~') */
export function courseColumnDate(col: Pick<CourseEvalColumn, 'firstDate'>): string {
  return evalColumnTitle({ dateStr: col.firstDate, subject: '', title: '' });
}
