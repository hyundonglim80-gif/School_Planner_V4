// src/features/month/MonthDaySheet.tsx
//
// 휴대폰 월간의 '그날 목록' (ROADMAP 15, 2026-10-02 - 결정은 Claude 추천으로 하라고 사용자가 맡겼다).
//
//   휴대폰 월간 칸은 53px 남짓이라 일정이 한 줄로 잘리고, 과목 칩은 세로 글자로 읽기 어려웠다. 칸 모양은 두고(09-21 '휴대폰도
//   PC와 같은 모양'), 날짜를 누르면 아래 탭바 위에 그날 목록이 올라온다. 달력은 가리지 않아 날짜를 연달아 눌러 볼 수 있고,
//   같은 날을 한 번 더 누르거나 '하루 화면'을 누르면 하루 화면으로 간다.
//
//   팝업(ModalShell)으로 만들지 않은 까닭: 휴대폰 팝업은 오른쪽에서 화면을 덮어 달력이 가려진다. 이것은 화면의 일부다.
import { useLayoutEffect, useState } from 'react';
import type { DaySummary } from '../../hooks/useCalendarData';
import type { NeisScheduleItem } from '../../lib/neis';
import { eventDisplayContent, isCalendarVisible, isForwardLabel, resolveEventLabel } from '../../lib/eventLabels';
import { splitHolidayEvents } from '../../lib/holiday';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

interface MonthDaySheetProps {
  dateStr: string;
  summary: DaySummary | undefined;
  holidayName?: string;
  schoolItems?: NeisScheduleItem[];
  eventLabels: any[];
  labelsLoaded: boolean;
  getLabelColor: (name: string) => { bg: string; text: string; border: string } | null;
  periodArray: number[];
  showClass: boolean;
  showEvents: boolean;
  onClose: () => void;
  onGoDay: () => void;
  onAdd: () => void;
  onOpenEvent: (ev: any) => void;
  /** 라벨 칩을 누르면 완료를 뒤집는다 (주간 칩과 같다). 다중 선택 모드에서는 넘기지 않는다. */
  onToggleEvent?: (ev: any) => void;
  onOpenSchool: (items: NeisScheduleItem[]) => void;
}

export default function MonthDaySheet({
  dateStr,
  summary,
  holidayName,
  schoolItems,
  eventLabels,
  labelsLoaded,
  getLabelColor,
  periodArray,
  showClass,
  showEvents,
  onClose,
  onGoDay,
  onAdd,
  onOpenEvent,
  onToggleEvent,
  onOpenSchool,
}: MonthDaySheetProps) {
  // 아래 탭바(MobileTabBar) 바로 위에 붙는다. 탭바 높이는 기기 안전 여백에 따라 달라 재서 쓴다.
  const [tabBarHeight, setTabBarHeight] = useState(0);
  useLayoutEffect(() => {
    const bar = document.querySelector('[data-mobile-tabbar]') as HTMLElement | null;
    if (!bar) return;
    const update = () => setTabBarHeight(bar.getBoundingClientRect().height);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  const d = new Date(dateStr + 'T00:00:00');
  const title = `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_NAMES[d.getDay()]})`;
  const { events: dayEvents, holidayName: holidayFromEvent } = splitHolidayEvents(summary?.eventList || []);
  const holiday = holidayName || holidayFromEvent;
  const events = dayEvents.filter((ev: any) => isCalendarVisible(ev, eventLabels));
  const hiddenCount = dayEvents.length - events.length;
  const schedules = summary?.schedules || {};
  const classes = periodArray
    .map((p) => ({ p, subject: schedules[p]?.subject?.trim() || '' }))
    .filter((c) => c.subject && c.subject.toUpperCase() !== 'X');

  return (
    <section
      data-month-day-sheet={dateStr}
      aria-label={`${title} 목록`}
      style={{ bottom: tabBarHeight }}
      className="fixed left-0 right-0 z-30 bg-white border-t border-slate-200 shadow-[0_-6px_20px_rgba(15,23,42,0.12)] rounded-t-2xl max-h-[46vh] flex flex-col animate-fade-in"
    >
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-2 border-b border-slate-100 shrink-0">
        <h3 className={`font-black text-sm whitespace-nowrap ${holiday || d.getDay() === 0 ? 'text-red-600' : d.getDay() === 6 ? 'text-blue-600' : 'text-slate-800'}`}>{title}</h3>
        {holiday && <span className="text-xs font-bold text-red-500 truncate">{holiday}</span>}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button type="button" onClick={onAdd} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold">
            + 일정
          </button>
          <button type="button" onClick={onGoDay} className="px-2 py-1 rounded-lg bg-primary text-white text-xs font-bold">
            하루 화면 →
          </button>
          <button type="button" onClick={onClose} title="닫기" className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 text-slate-500 font-bold">
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2 flex flex-col gap-2" data-scroll-lock>
        {schoolItems && schoolItems.length > 0 && (
          <button type="button" onClick={() => onOpenSchool(schoolItems)} className="text-left text-xs font-bold text-teal-700">
            🏫 {schoolItems.map((s) => s.name).join(' · ')}
          </button>
        )}

        {showClass && classes.length > 0 && (
          <div className="flex flex-wrap gap-1" data-sheet-classes>
            {classes.map((c) => (
              <span key={c.p} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold">
                <span className="text-2xs text-emerald-500">{c.p}</span>
                {c.subject}
              </span>
            ))}
          </div>
        )}

        {showEvents && (
          <ul className="flex flex-col gap-1">
            {events.map((ev: any) => {
              const def = resolveEventLabel(ev, eventLabels, { keepUnknown: !labelsLoaded });
              const color = def ? getLabelColor(def.name) : null;
              const links = (ev.linkedItems || []).length;
              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    data-sheet-event={ev.id}
                    onClick={() => onOpenEvent(ev)}
                    className={`w-full text-left flex items-start gap-1.5 px-2 py-1.5 rounded-lg border text-sm leading-snug ${
                      ev.completed ? 'bg-slate-50 border-slate-100 text-slate-400' : 'bg-white border-slate-200 text-slate-800'
                    }`}
                  >
                    {def && color && (
                      // 감싼 것이 <button>이라 칩은 span(role=button)이다 - 누르면 일정을 열지 않고 완료만 뒤집는다
                      <span
                        role={onToggleEvent ? 'button' : undefined}
                        data-sheet-event-chip={ev.id}
                        title={onToggleEvent ? (isForwardLabel(def) ? '클릭하여 완료 처리 (이월 정지)' : '클릭하여 완료 처리') : undefined}
                        onClick={
                          onToggleEvent
                            ? (e) => {
                                e.stopPropagation();
                                onToggleEvent(ev);
                              }
                            : undefined
                        }
                        className={`shrink-0 text-2xs font-bold px-1.5 py-0.5 rounded ${onToggleEvent ? 'cursor-pointer' : ''}`}
                        style={{
                          backgroundColor: ev.completed ? 'var(--color-slate-100)' : color.bg,
                          color: ev.completed ? 'var(--color-slate-400)' : color.text,
                          border: `1px solid ${ev.completed ? 'var(--color-slate-200)' : color.border}`,
                        }}
                      >
                        {def.name}
                      </span>
                    )}
                    <span className={`min-w-0 break-words ${ev.completed ? 'line-through' : ''}`}>{eventDisplayContent(ev, eventLabels)}</span>
                    {links > 0 && <span className="ml-auto shrink-0 text-2xs font-bold text-yellow-700">🔗 {links}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {showEvents && events.length === 0 && classes.length === 0 && !schoolItems?.length && (
          <p className="text-xs text-slate-400 py-2 text-center">달력에 올린 일정이 없습니다.</p>
        )}
        {showEvents && hiddenCount > 0 && (
          <button type="button" onClick={onGoDay} className="text-left text-xs text-slate-400">
            달력에 올리지 않은 일정 {hiddenCount}개 - 하루 화면에서 봅니다 →
          </button>
        )}
      </div>
    </section>
  );
}
