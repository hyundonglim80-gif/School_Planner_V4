// src/features/year/YearSheet.tsx
//
// 년간 '학사력' 한 장 (ROADMAP 14). 열두 달을 작은 달력으로 늘어놓는다.
//
//   ⚠️ 왜 따로 두는가. 예전 년간(지금의 '자세히')은 1400px에서 다섯 달만 보이고 날마다 과목 칩 여섯이 섰다.
//      학년도를 한눈에 보려는 화면인데 훑어볼 수가 없었다. 여기서는 수업을 빼고 날짜 칸에 공휴일·D-Day·학사일정·
//      '달력' 일정만 점과 막대로 찍고, 달 아래 그 달의 것을 한 줄씩 적는다. 고치기·끌기·여러 개 고르기는 '자세히'에서.
//
//   달 카드는 React.memo - 부모가 넘기는 값은 붙들어 둔다(YearMonthCard와 같은 까닭).
import React, { useState } from 'react';
import type { NeisScheduleItem } from '../../lib/neis';
import type { SchoolEventsByDate } from '../../hooks/useNeis';
import type { DDayItem } from '../../hooks/useDDay';
import { eventDisplayContent, isCalendarVisible, resolveEventLabel } from '../../lib/eventLabels';
import { getHolidayName } from '../../lib/dateUtils';
import { layoutWeekBars } from '../../lib/periodBars';
import { monthWeeks, monthSheetItems, dayTooltip, type SheetItem } from '../../lib/yearSheet';
import type { MonthInfo } from './YearMonthCard';

type LabelColor = { bg: string; text: string; border: string } | null;

export interface YearSheetMonthProps {
  mInfo: MonthInfo;
  eventsMap: Record<string, any[]>;
  holidays: Record<string, string>;
  schoolEvents: SchoolEventsByDate;
  ddays: DDayItem[];
  eventLabels: any[];
  labelsLoaded: boolean;
  labelColorOf: (name: string) => LabelColor;
  showWeekend: boolean;
  showEvents: boolean;
  isCurrentMonthCard: boolean;
  realTodayStr: string;
  onDateClick: (dateStr: string) => void;
  onMonthClick: (year: number, month: number) => void;
  onOpenEvent: (dateStr: string, ev: any) => void;
  onOpenSchool: (dateStr: string, items: NeisScheduleItem[]) => void;
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const DEFAULT_DOT = '#60a5fa';
const SCHOOL_DOT = '#14b8a6';
/** 달 아래 목록을 처음에 몇 줄까지 (더 있으면 '+N개') */
const LIST_LIMIT = 8;
/** 막대 한 줄의 높이·사이 (px) */
const LANE = 5;

/** 공휴일 표시용 일정 (날짜 이름으로만 쓴다) */
const isHolidayEvent = (e: any) => e.label === '휴일' || e.labelIds?.includes('휴일');
const md = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;

function YearSheetMonth({
  mInfo,
  eventsMap,
  holidays,
  schoolEvents,
  ddays,
  eventLabels,
  labelsLoaded,
  labelColorOf,
  showWeekend,
  showEvents,
  isCurrentMonthCard,
  realTodayStr,
  onDateClick,
  onMonthClick,
  onOpenEvent,
  onOpenSchool,
}: YearSheetMonthProps) {
  const [expanded, setExpanded] = useState(false);
  const weeks = monthWeeks(mInfo.year, mInfo.month, showWeekend);
  const cols = showWeekend ? 7 : 5;
  const dayNames = showWeekend ? DAY_NAMES : DAY_NAMES.slice(1, 6);
  const dates = weeks.flat().filter((d): d is string => !!d);

  const holidayOf = (d: string) =>
    getHolidayName(d) || holidays[d] || (eventsMap[d] || []).find(isHolidayEvent)?.content || undefined;
  const eventsOf = (d: string) =>
    showEvents ? (eventsMap[d] || []).filter((e: any) => !isHolidayEvent(e) && isCalendarVisible(e, eventLabels)) : [];
  const contentOf = (ev: any) => eventDisplayContent(ev, eventLabels);
  const colorOf = (ev: any): LabelColor => {
    const def = resolveEventLabel(ev, eventLabels, { keepUnknown: !labelsLoaded });
    return def ? labelColorOf(def.name) : null;
  };

  const items = monthSheetItems({ dates, holidayOf, ddays, school: schoolEvents, eventsOf, contentOf });
  const ddayDates = new Set(ddays.map((d) => d.date));

  const openItem = (it: SheetItem) => {
    if ((it.kind === 'event' || it.kind === 'period') && it.ev) onOpenEvent(it.dateStr, it.ev);
    else if (it.kind === 'school' && it.school) onOpenSchool(it.dateStr, it.school);
    else onDateClick(it.dateStr);
  };

  return (
    <div
      data-sheet-month={`${mInfo.year}-${mInfo.month}`}
      className={`bg-white rounded-2xl border p-3 flex flex-col gap-1.5 break-inside-avoid ${
        isCurrentMonthCard ? 'border-primary ring-2 ring-primary/10' : 'border-slate-200/80'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onMonthClick(mInfo.year, mInfo.month)}
          title="월간 화면으로"
          className="font-black text-blue-800 text-sm hover:underline"
        >
          {mInfo.label}
        </button>
        <span className="text-2xs font-bold px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-md">{mInfo.semester}학기</span>
      </div>

      <div className="grid text-center text-2xs font-bold text-slate-400" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {dayNames.map((n) => (
          <div key={n} className={n === '일' ? 'text-red-400' : n === '토' ? 'text-blue-400' : ''}>
            {n}
          </div>
        ))}
      </div>

      <div className="flex flex-col">
        {weeks.map((week, wi) => {
          const layout = layoutWeekBars(
            week.map((d) => ({ dateStr: d || `-${wi}`, events: d ? eventsOf(d) : [] })),
            contentOf,
          );
          return (
            <div
              key={wi}
              className="relative grid"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, height: 26 + layout.lanes * LANE }}
            >
              {week.map((d, col) => {
                if (!d) return <div key={`e${col}`} />;
                const holiday = holidayOf(d);
                const dow = new Date(d + 'T00:00:00').getDay();
                const isToday = d === realTodayStr;
                const dots = [
                  ...(schoolEvents[d]?.length ? [SCHOOL_DOT] : []),
                  ...(layout.rest[d] || []).map((ev: any) => (ev.completed ? '#cbd5e1' : colorOf(ev)?.border || DEFAULT_DOT)),
                ];
                return (
                  <button
                    key={d}
                    type="button"
                    data-sheet-date={d}
                    onClick={() => onDateClick(d)}
                    title={dayTooltip(d, items)}
                    className={`relative flex flex-col items-center pt-0.5 rounded-md hover:bg-slate-100 ${holiday ? 'bg-red-50/70' : ''}`}
                  >
                    <span
                      className={`text-2xs font-bold w-[18px] h-[16px] leading-[16px] rounded-full tabular-nums ${
                        isToday
                          ? 'bg-primary text-white'
                          : holiday || dow === 0
                          ? 'text-red-500'
                          : dow === 6
                          ? 'text-blue-500'
                          : 'text-slate-700'
                      } ${ddayDates.has(d) ? 'ring-[1.5px] ring-amber-400' : ''}`}
                    >
                      {Number(d.slice(8, 10))}
                    </span>
                    {dots.length > 0 && (
                      <span className="absolute bottom-[2px] left-0 right-0 flex justify-center gap-[2px]">
                        {dots.slice(0, 4).map((c, i) => (
                          <span key={i} className="w-[4px] h-[4px] rounded-full" style={{ backgroundColor: c }} />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
              {layout.bars.map((bar) => {
                const first = bar.cells[0].ev;
                const color = colorOf(first);
                const done = bar.cells.every((c) => !!c.ev.completed);
                return (
                  <div
                    key={`${bar.key}@${bar.start}`}
                    data-sheet-bar={first.groupId}
                    title={`📆 ${bar.base} (${md(bar.cells[0].dateStr)} ~ ${md(bar.cells[bar.cells.length - 1].dateStr)})`}
                    className="absolute pointer-events-none"
                    style={{
                      left: `calc(${(bar.start / cols) * 100}% + ${bar.startsPeriod ? 3 : 0}px)`,
                      width: `calc(${(bar.len / cols) * 100}% - ${(bar.startsPeriod ? 3 : 0) + (bar.endsPeriod ? 3 : 0)}px)`,
                      top: 18 + bar.lane * LANE,
                      height: 3,
                      borderRadius: `${bar.startsPeriod ? 2 : 0}px ${bar.endsPeriod ? 2 : 0}px ${bar.endsPeriod ? 2 : 0}px ${bar.startsPeriod ? 2 : 0}px`,
                      backgroundColor: done ? '#cbd5e1' : color?.border || DEFAULT_DOT,
                    }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {items.length > 0 && (
        <ul className="border-t border-slate-100 pt-1.5 flex flex-col gap-[3px]" data-sheet-list>
          {items.map((it, i) => {
            const color = it.ev ? colorOf(it.ev) : null;
            const dow = DAY_NAMES[new Date(it.dateStr + 'T00:00:00').getDay()];
            // 넘치는 줄은 화면에서만 접는다 - 인쇄에는 다 찍힌다 (index.css data-sheet-extra)
            const extra = !expanded && i >= LIST_LIMIT;
            return (
              <li key={`${it.kind}-${it.dateStr}-${i}`} className={extra ? 'hidden' : ''} data-sheet-extra={extra ? '' : undefined}>
                <button
                  type="button"
                  data-sheet-item={it.kind}
                  onClick={() => openItem(it)}
                  className="w-full flex items-start gap-1.5 text-left text-2xs leading-snug rounded hover:bg-slate-50 px-0.5"
                  title={it.kind === 'event' || it.kind === 'period' ? '누르면 오른쪽 칸에서 고치기' : it.kind === 'school' ? '학사일정 보기' : '그날 하루 화면'}
                >
                  <span className={`shrink-0 w-[34px] tabular-nums font-bold ${it.kind === 'holiday' ? 'text-red-500' : 'text-slate-400'}`}>
                    {Number(it.dateStr.slice(8, 10))}({dow})
                  </span>
                  <span
                    className="shrink-0 mt-[4px] w-[6px] h-[6px] rounded-full"
                    style={{
                      backgroundColor:
                        it.kind === 'holiday' ? '#ef4444' : it.kind === 'dday' ? '#f59e0b' : it.kind === 'school' ? SCHOOL_DOT : it.done ? '#cbd5e1' : color?.border || DEFAULT_DOT,
                    }}
                  />
                  <span
                    className={`min-w-0 break-words ${
                      it.kind === 'holiday'
                        ? 'text-red-600 font-bold'
                        : it.kind === 'dday'
                        ? 'text-amber-700 font-bold'
                        : it.kind === 'school'
                        ? 'text-teal-700 font-semibold'
                        : it.done
                        ? 'text-slate-400 line-through'
                        : 'text-slate-700 font-medium'
                    }`}
                  >
                    {it.kind === 'dday' && '🎯 '}
                    {it.kind === 'period' && it.continuesBefore && '◂ '}
                    {it.text}
                    {it.kind === 'period' && it.endDate && it.endDate !== it.dateStr && (
                      <span className="text-slate-400 font-semibold"> ~{md(it.endDate)}</span>
                    )}
                    {it.kind === 'period' && it.continuesAfter && ' ▸'}
                  </span>
                </button>
              </li>
            );
          })}
          {items.length > LIST_LIMIT && (
            <li data-print-hide>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-2xs font-bold text-slate-400 hover:text-primary px-0.5"
              >
                {expanded ? '접기' : `+${items.length - LIST_LIMIT}개 더`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default React.memo(YearSheetMonth);
