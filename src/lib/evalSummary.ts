// src/lib/evalSummary.ts
//
// 조사표 모아 보기 (ROADMAP 9) - 순수 셈. 읽기는 lib/evalArchive.
//
//   - 한 학생의 조사표 값을 사람이 읽는 말로 (학생 카드·누가기록 복사)
//   - 학급 × 조사표 표 (평가 모아 보기, CSV) - 칸 값은 구글 시트 내보내기(lib/sheetsSync)와 같은 규칙
//   - 학기 가르기: 그 학년도의 방학 설정이 있으면 2학기 시작일로, 없으면 9월부터 2학기
import type { EvaluationItem } from '../hooks/useEvaluation';
import { getSemesterRanges, type SemesterConfig } from './semester';

type EvalLike = Pick<EvaluationItem, 'type' | 'records'> & Partial<Pick<EvaluationItem, 'methodObj' | 'groups'>> & { method?: string };

/** 개인·조별 (V3 옛 조사표는 method 글자 하나) */
export function evalMethod(ev: EvalLike): { indiv: boolean; group: boolean } {
  if (ev?.type !== 'eval') return { indiv: false, group: false };
  if (ev.methodObj) return { indiv: !!ev.methodObj.indiv, group: !!ev.methodObj.group };
  return { indiv: ev.method !== 'group', group: ev.method === 'group' };
}

export const EVAL_TYPE_LABEL: Record<string, string> = { eval: '평가', check: '체크', memo: '메모' };

export interface EvalCell {
  /** 평가 단계·O/X·메모 (조별이면 '1모둠 보통') */
  main: string;
  /** 사유·근거 */
  note: string;
}

/** 한 조사표의 한 학생 값 */
export function studentEvalCell(ev: EvalLike, num: number): EvalCell {
  const rec: Record<string, any> = ((ev.records || {}) as Record<string, any>)[String(num)] || {};
  if (ev.type === 'eval') {
    const { indiv, group } = evalMethod(ev);
    const parts: string[] = [];
    if (indiv && (rec.indivScore || rec.score)) parts.push(String(rec.indivScore || rec.score));
    if (group && rec.groupScore) {
      const gName = rec.groupName ?? ev.groups?.find((g) => (g.members || []).includes(num))?.name ?? '';
      parts.push(gName ? `${gName} ${rec.groupScore}` : `조 ${rec.groupScore}`);
    }
    return { main: parts.join(' · '), note: String(rec.reason || '').trim() };
  }
  if (ev.type === 'check') {
    return { main: rec.checked === true ? 'O' : rec.checked === false ? 'X' : '', note: String(rec.reason || '').trim() };
  }
  return { main: String(rec.memo || '').trim(), note: '' };
}

export const isEmptyCell = (c: EvalCell) => !c.main && !c.note;

/** '잘함 - 식을 세워 풂' (값이 없으면 '') */
export function evalCellText(c: EvalCell): string {
  if (c.main && c.note) return `${c.main} - ${c.note}`;
  return c.main || c.note;
}

/** 그 날짜가 몇 학기인가. 그 학년도의 방학 설정이 있으면 그것으로, 없으면 3~8월 1학기 */
export function semesterOf(date: string, schoolYear: number, cfg?: SemesterConfig | null): 1 | 2 {
  if (cfg?.summerStart && Number(cfg.summerStart.slice(0, 4)) === schoolYear && cfg.summerEnd) {
    const { sem2 } = getSemesterRanges(cfg);
    if (sem2.start) return date < sem2.start ? 1 : 2;
  }
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return y === schoolYear && m >= 3 && m <= 8 ? 1 : 2;
}

/** 학년도 범위 (3월 1일 ~ 이듬해 2월 끝) */
export function schoolYearRange(year: number): { start: string; end: string } {
  return { start: `${year}-03-01`, end: `${year + 1}-02-29` };
}

export interface OverviewFilter {
  subject?: string;
  semester?: 1 | 2 | null;
  type?: string;
}

/** 거르기: 교과('' = 모두, '(없음)' = 교과 안 고른 것)·학기·유형 */
export function filterEvals<T extends Pick<EvaluationItem, 'subject' | 'dateStr' | 'type'>>(
  evals: T[],
  filter: OverviewFilter,
  schoolYear: number,
  cfg?: SemesterConfig | null
): T[] {
  return evals.filter((ev) => {
    if (filter.subject) {
      const s = String(ev.subject || '');
      if (filter.subject === '(없음)' ? s !== '' : s !== filter.subject) return false;
    }
    if (filter.type && ev.type !== filter.type) return false;
    if (filter.semester && semesterOf(String(ev.dateStr || ''), schoolYear, cfg) !== filter.semester) return false;
    return true;
  });
}

/** 날짜 차례 (같은 날은 교시 차례, 그다음 제목) */
export function sortEvals<T extends Pick<EvaluationItem, 'dateStr' | 'periodStr' | 'title'>>(evals: T[]): T[] {
  return [...evals].sort(
    (a, b) =>
      String(a.dateStr || '').localeCompare(String(b.dateStr || '')) ||
      (Number(a.periodStr) || 99) - (Number(b.periodStr) || 99) ||
      String(a.title || '').localeCompare(String(b.title || ''), 'ko')
  );
}

/** 표 머리: '10/2 수학 단원평가' */
export function evalColumnTitle(ev: Pick<EvaluationItem, 'dateStr' | 'subject' | 'title'>): string {
  const d = String(ev.dateStr || '');
  const md = d.length >= 10 ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : d;
  return [md, ev.subject, ev.title].filter(Boolean).join(' ');
}

export interface OverviewStudent {
  num: number;
  name: string;
  isActive?: boolean;
}

/**
 * 학급 × 조사표 CSV 줄. 머리 두 줄(날짜·교과·유형 / 제목) 뒤에 학생마다 한 줄.
 * 조사표마다 값과 사유 두 칸 (메모는 한 칸).
 */
export function overviewCsvRows(
  evals: Array<EvalLike & Pick<EvaluationItem, 'dateStr' | 'subject' | 'title'>>,
  students: OverviewStudent[]
): string[][] {
  const head1 = ['번호', '이름'];
  const head2 = ['', ''];
  for (const ev of evals) {
    const info = `${ev.dateStr} ${ev.subject || ''} ${EVAL_TYPE_LABEL[ev.type] || ''}`.replace(/\s+/g, ' ').trim();
    if (ev.type === 'memo') {
      head1.push(info);
      head2.push(ev.title || '');
    } else {
      head1.push(info, '');
      head2.push(ev.title || '', '사유');
    }
  }
  const rows = students.map((st) => {
    const row = [String(st.num), st.name + (st.isActive === false ? ' (전출)' : '')];
    for (const ev of evals) {
      const c = studentEvalCell(ev, st.num);
      if (ev.type === 'memo') row.push(c.main);
      else row.push(c.main, c.note);
    }
    return row;
  });
  return [head1, head2, ...rows];
}

/** 조사표 하나의 단계별 사람 수 ('잘함 12 · 보통 8') - 평가만 */
export function stepCounts(ev: EvalLike & Pick<EvaluationItem, 'steps'>, nums: number[]): string {
  if (ev.type !== 'eval') return '';
  const counts = new Map<string, number>();
  for (const n of nums) {
    const rec: Record<string, any> = ((ev.records || {}) as Record<string, any>)[String(n)] || {};
    const v = String(rec.indivScore || rec.score || rec.groupScore || '');
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  const order = [...(ev.steps || []), ...[...counts.keys()].filter((k) => !(ev.steps || []).includes(k))];
  return order
    .filter((s) => counts.get(s))
    .map((s) => `${s} ${counts.get(s)}`)
    .join(' · ');
}
