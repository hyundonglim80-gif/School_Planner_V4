// src/lib/yearSheet.ts
//
// 년간 '학사력' 한 장 (ROADMAP 14). 셈만 한다 - 그리는 것은 features/year/YearSheet.
//
//   열두 달을 작은 달력으로 늘어놓고, 날짜 칸에는 공휴일·D-Day·학사일정(나이스)·'달력' 일정을 점과 막대로만,
//   달 아래에는 그 달의 것을 날짜 차례로 한 줄씩 적는다. 수업 칩은 그리지 않는다(그것은 '자세히').
import type { NeisScheduleItem } from './neis';
import { collapsePeriods } from './periodBars';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 한 달을 주(일~토)로 나눈다. 칸 밖 날은 null.
 * 주말을 숨기면 월~금 다섯 칸으로, 그러고 나서 빈 주(1일이 토요일인 달의 첫 주 등)는 뺀다.
 */
export function monthWeeks(year: number, month: number, showWeekend: boolean): (string | null)[][] {
  const first = new Date(year, month - 1, 1);
  const days = new Date(year, month, 0).getDate();
  const cells: (string | null)[] = Array(first.getDay()).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${pad(month)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    const shown = showWeekend ? week : week.slice(1, 6);
    if (shown.some(Boolean)) weeks.push(shown);
  }
  return weeks;
}

export type SheetItemKind = 'holiday' | 'dday' | 'school' | 'period' | 'event';

export interface SheetItem {
  dateStr: string;
  kind: SheetItemKind;
  text: string;
  /** 기간 일정: 이 달에서 마지막 날 */
  endDate?: string;
  /** 일정·기간 일정(첫 조각) */
  ev?: any;
  /** 학사일정 (그날 것을 함께) */
  school?: NeisScheduleItem[];
  /** 끝낸 것 (기간은 모든 조각을 끝냈을 때) */
  done?: boolean;
  /** 기간이 앞 달에서 이어지나 / 다음 달로 이어지나 */
  continuesBefore?: boolean;
  continuesAfter?: boolean;
}

const KIND_ORDER: Record<SheetItemKind, number> = { holiday: 0, dday: 1, school: 2, period: 3, event: 4 };

export interface SheetSources {
  /** 그 달에서 보일 날짜 (주말을 숨기면 평일만) */
  dates: string[];
  holidayOf: (dateStr: string) => string | undefined;
  ddays: { id: string; title: string; date: string }[];
  school: Record<string, NeisScheduleItem[] | undefined>;
  /** 그날 달력에 올릴 일정 ('달력' 속성, 공휴일 표시용은 뺀 것) */
  eventsOf: (dateStr: string) => any[];
  /** 화면에 보일 본문 (라벨 머리를 뗀 것) */
  contentOf: (ev: any) => string;
}

/** 달 아래 목록: 날짜 차례, 같은 날은 공휴일 → D-Day → 학사일정 → 기간 → 일정 */
export function monthSheetItems(src: SheetSources): SheetItem[] {
  const shown = new Set(src.dates);
  const items: SheetItem[] = [];
  for (const dateStr of src.dates) {
    const holiday = src.holidayOf(dateStr);
    if (holiday) items.push({ dateStr, kind: 'holiday', text: holiday });
    const school = src.school[dateStr];
    if (school?.length) items.push({ dateStr, kind: 'school', text: school.map((s) => s.name).join(' · '), school });
  }
  for (const dd of src.ddays) {
    if (shown.has(dd.date)) items.push({ dateStr: dd.date, kind: 'dday', text: dd.title });
  }
  const { rest, starts } = collapsePeriods(
    src.dates.map((dateStr) => ({ dateStr, events: src.eventsOf(dateStr) })),
    src.contentOf,
  );
  for (const [dateStr, groups] of Object.entries(starts)) {
    for (const g of groups) {
      items.push({
        dateStr,
        kind: 'period',
        text: g.base,
        endDate: g.cells[g.cells.length - 1].dateStr,
        ev: g.cells[0].ev,
        done: g.cells.every((c) => !!c.ev.completed),
        continuesBefore: !g.startsPeriod,
        continuesAfter: !g.endsPeriod,
      });
    }
  }
  for (const [dateStr, evs] of Object.entries(rest)) {
    for (const ev of evs) items.push({ dateStr, kind: 'event', text: src.contentOf(ev), ev, done: !!ev.completed });
  }
  // 정렬은 안정적이다 - 같은 날·같은 종류는 넣은 차례(그날 일정 차례) 그대로
  return items.sort((a, b) => a.dateStr.localeCompare(b.dateStr) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/** 날짜 칸에 걸 풍선 글 (그날 것을 줄마다) */
export function dayTooltip(dateStr: string, items: SheetItem[]): string {
  const lines = items
    .filter((it) => it.dateStr === dateStr || (it.kind === 'period' && it.endDate && it.dateStr <= dateStr && dateStr <= it.endDate))
    .map((it) => {
      if (it.kind === 'holiday') return `🔴 ${it.text}`;
      if (it.kind === 'dday') return `🎯 ${it.text}`;
      if (it.kind === 'school') return `🏫 ${it.text}`;
      if (it.kind === 'period') return `📆 ${it.text}`;
      return `• ${it.text}`;
    });
  const md = `${Number(dateStr.slice(5, 7))}월 ${Number(dateStr.slice(8, 10))}일`;
  return lines.length ? `${md}\n${lines.join('\n')}` : md;
}
