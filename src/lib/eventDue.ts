// src/lib/eventDue.ts
//
// 일정 기한 (ROADMAP 11-2) - 순수 셈. 저장은 lib/eventDueStore.
//
//   일정의 due('YYYY-MM-DD', V4 전용 칸)가 기한이다. 끝내지 않은 일정에 D-3 · D-day · 기한 지남을 붙인다.
//   V3의 이월은 정해진 칸만 새 일정에 옮겨(forwarding.js) due가 빠진다. 그래서 기한을 정할 때 이월 사슬 id(forwardChainId)를
//   붙여 두고, 사슬마다 기한을 V4 전용 문서에도 적는다 - V3가 옮긴 일정은 사슬 id로 기한을 찾는다.

export type DueMap = Record<string, string>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isDueDate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v);

/** 그 일정의 기한 (일정 칸 먼저, 없으면 사슬 기한). 없으면 '' */
export function dueOf(ev: { due?: string; forwardChainId?: string } | null | undefined, map: DueMap = {}): string {
  if (!ev) return '';
  if (isDueDate(ev.due)) return ev.due;
  // due를 ''로 비운 일정은 기한을 뗀 것이다 - 사슬 기한으로 되살리지 않는다
  if (ev.due === '') return '';
  const chained = ev.forwardChainId ? map[ev.forwardChainId] : '';
  return isDueDate(chained) ? chained : '';
}

/** 이월 사슬 id (V3와 같은 모양) */
export function newChainId(): string {
  return 'chain_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export interface DueBadge {
  text: string;
  /** soon: 3일 안, today: 오늘, over: 지남, later: 그 뒤 */
  tone: 'later' | 'soon' | 'today' | 'over';
  /** 기한까지 남은 날 (지났으면 음수) */
  days: number;
}

/** 기한 표시. 기한이 없거나 끝낸 일정이면 null */
export function dueBadge(due: string, today: string, completed = false): DueBadge | null {
  if (!isDueDate(due) || completed) return null;
  const days = dayNumber(due) - dayNumber(today);
  if (days > 0) return { text: `D-${days}`, tone: days <= 3 ? 'soon' : 'later', days };
  if (days === 0) return { text: 'D-day', tone: 'today', days };
  return { text: `기한 ${-days}일 지남`, tone: 'over', days };
}

export const DUE_TONE_CLASS: Record<DueBadge['tone'], string> = {
  later: 'text-slate-600 bg-slate-50 border-slate-200',
  soon: 'text-amber-700 bg-amber-50 border-amber-200',
  today: 'text-rose-700 bg-rose-50 border-rose-300',
  over: 'text-white bg-rose-500 border-rose-500',
};
