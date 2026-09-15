// src/features/month/MonthAgenda.tsx
// 휴대폰 세로 화면용 월간 뷰.
//
// 7열 격자를 412px에 밀어 넣으면 한 칸이 50px 남짓이라 일정 제목이 한두 글자만
// 보인다. 세로로 긴 화면에서는 날짜를 아래로 늘어놓는 편이 훨씬 많이 읽힌다.
// 데이터·토글(주말/수업/일정)은 MonthGrid와 같은 것을 쓴다.
import React, { useState } from 'react';
import type { CalendarDay } from '../../lib/dateUtils';
import type { DaySummary } from '../../hooks/useCalendarData';
import { useLabels } from '../../hooks/useLabels';
import { useAppStore } from '../../store/useAppStore';
import { useGovHolidays } from '../../hooks/useGovHolidays';
import HolidayName from '../../components/HolidayName';
import { useTimetableTemplate } from '../../hooks/useTimetableTemplate';
import { splitHolidayEvents, dayToneOf, DAY_CELL_BG, DAY_NUMBER_COLOR } from '../../lib/holiday';
import { resolveEventLabel, eventDisplayContent, isForwardLabel } from '../../lib/eventLabels';
import DetailEditModal from '../../components/DetailEditModal';
import EventItemActions from '../../components/EventItemActions';

interface MonthAgendaProps {
  days: CalendarDay[];
  dataMap: Record<string, DaySummary>;
  onSelectDate: (dateStr: string) => void;
  onQuickAdd: (dateStr: string) => void;
  showWeekend?: boolean;
  onToggleEvent: (dateStr: string, eventId: string) => void;
  onDeleteEvent: (dateStr: string, eventId: string, item?: any) => void;
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export default function MonthAgenda({
  days,
  dataMap,
  onSelectDate,
  onQuickAdd,
  showWeekend = true,
  onToggleEvent,
  onDeleteEvent,
}: MonthAgendaProps) {
  const { showClass, showEvents, isMultiSelectMode, selectedEventIds, toggleEventSelection, openLinkViewerModal } =
    useAppStore();
  const { getLabelColor, eventLabels } = useLabels();
  const { holidays } = useGovHolidays();
  const { templates, currentTemplateName } = useTimetableTemplate();

  const maxPeriods = templates[currentTemplateName]?.names.length || 6;
  const periodArray = Array.from({ length: maxPeriods }, (_, i) => i + 1);

  const [detailModal, setDetailModal] = useState<{
    type: 'schedule' | 'event';
    dateStr: string;
    itemId: string | number;
    initialData: any;
  } | null>(null);

  // 이번 달 날짜만. 격자에 채워 넣던 앞뒤 달은 목록에서는 군더더기다.
  const listDays = React.useMemo(() => {
    const inMonth = days.filter((d) => d.isCurrentMonth);
    return showWeekend ? inMonth : inMonth.filter((d) => !d.isSunday && !d.isSaturday);
  }, [days, showWeekend]);

  return (
    <>
      <div className="flex flex-col gap-2">
        {listDays.map((dayObj) => {
          const summary = dataMap[dayObj.dateStr] || {};
          const schedules = summary.schedules || {};
          const { events, holidayName: holidayFromEvent } = splitHolidayEvents(summary.eventList || []);
          const holidayName = dayObj.holidayName || holidays[dayObj.dateStr] || holidayFromEvent;
          // 토요일 파랑 / 일요일·공휴일 빨강 (lib/holiday의 공통 규칙)
          const tone = dayToneOf({ isSunday: dayObj.isSunday, isSaturday: dayObj.isSaturday, holidayName });

          const subjects = periodArray
            .map((p) => ({ period: p, item: schedules[p] }))
            .filter(({ item }) => {
              const s = item?.subject?.trim();
              return !!s && s.toUpperCase() !== 'X';
            });

          const visibleEvents = showEvents ? events : [];
          const visibleSubjects = showClass ? subjects : [];
          const isEmpty = visibleEvents.length === 0 && visibleSubjects.length === 0;

          return (
            <div
              key={dayObj.dateStr}
              data-today={dayObj.isToday ? 'true' : undefined}
              className={`rounded-xl border bg-white overflow-hidden ${
                dayObj.isToday ? 'border-primary ring-1 ring-primary/30' : 'border-slate-200/80'
              }`}
            >
              {/* 날짜 줄 - 누르면 그 날의 하루 화면으로 */}
              <div
                className={`flex items-center gap-2 px-3 py-2 ${isEmpty ? '' : 'border-b border-slate-100'} ${
                  dayObj.isToday ? 'bg-primary/5' : DAY_CELL_BG[tone]
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectDate(dayObj.dateStr)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  <span
                    className={`shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-black ${
                      dayObj.isToday ? 'bg-primary text-white' : DAY_NUMBER_COLOR[tone]
                    }`}
                  >
                    {dayObj.day}
                  </span>
                  <span className={`shrink-0 text-xs font-bold ${DAY_NUMBER_COLOR[tone]}`}>
                    {DAY_NAMES[new Date(dayObj.dateStr + 'T00:00:00').getDay()]}
                  </span>
                  {holidayName && <HolidayName name={holidayName} tier="month" />}
                  {isEmpty && <span className="text-xs text-slate-300 truncate">일정 없음</span>}
                </button>

                {visibleEvents.length > 0 && (
                  <span className="shrink-0 text-xs font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">
                    {visibleEvents.length}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onQuickAdd(dayObj.dateStr)}
                  className="shrink-0 w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-primary hover:border-primary/40 flex items-center justify-center text-sm font-bold"
                  title="일정 빠른 추가"
                >
                  +
                </button>
              </div>

              {!isEmpty && (
                <div className="px-3 py-2 flex flex-col gap-2">
                  {/* 수업 과목 - 교시 번호와 함께 한 줄로 */}
                  {visibleSubjects.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {visibleSubjects.map(({ period, item }) => (
                        <button
                          key={period}
                          type="button"
                          onClick={() =>
                            setDetailModal({ type: 'schedule', dateStr: dayObj.dateStr, itemId: period, initialData: item })
                          }
                          className="flex items-center gap-1 px-1.5 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold"
                        >
                          <span className="text-2xs text-emerald-500">{period}</span>
                          <span className="max-w-[90px] truncate">{item!.subject!.trim()}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 일정 - 한 줄에 하나씩, 제목이 잘리지 않게 */}
                  {visibleEvents.map((ev) => {
                    // 라벨 해석은 lib/eventLabels 한 곳에서만 한다
                    const labelDef = resolveEventLabel(ev, eventLabels);
                    const labelName = labelDef?.name || '';
                    const labelColor = labelDef ? getLabelColor(labelName) : null;
                    const forwardLabel = isForwardLabel(labelDef);
                    const linkCount = (ev.linkedItems || []).length;

                    return (
                      <div
                        key={ev.id}
                        onClick={() => {
                          if (isMultiSelectMode) toggleEventSelection(ev.id, dayObj.dateStr);
                          else setDetailModal({ type: 'event', dateStr: dayObj.dateStr, itemId: ev.id, initialData: ev });
                        }}
                        className={`group relative flex items-start gap-1.5 px-2 py-1.5 rounded-lg border text-sm leading-snug break-words cursor-pointer ${
                          selectedEventIds.includes(ev.id)
                            ? 'bg-primary/10 border-primary text-primary'
                            : ev.completed
                            ? 'bg-slate-50 border-slate-100 text-slate-400'
                            : 'bg-blue-50/50 border-blue-100 text-slate-800'
                        }`}
                      >
                        {isMultiSelectMode && (
                          <input
                            type="checkbox"
                            checked={selectedEventIds.includes(ev.id)}
                            readOnly
                            className="mt-0.5 pointer-events-none shrink-0 w-4 h-4"
                          />
                        )}

                        <div className="flex-1 min-w-0">
                          {labelColor && !isMultiSelectMode && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleEvent(dayObj.dateStr, ev.id);
                              }}
                              title={forwardLabel ? '눌러서 완료 처리 (이월 정지)' : '눌러서 완료 처리'}
                              className="inline-block align-middle mr-1.5 text-xs font-bold px-1.5 py-0.5 rounded shadow-2xs whitespace-nowrap"
                              style={{
                                backgroundColor: ev.completed ? '#f1f5f9' : labelColor.bg,
                                color: ev.completed ? '#94a3b8' : labelColor.text,
                                border: '1px solid ' + (ev.completed ? '#e2e8f0' : labelColor.border),
                              }}
                            >
                              {labelName}
                            </span>
                          )}
                          <span className={`align-middle ${ev.completed ? 'line-through' : ''}`}>
                            {eventDisplayContent(ev)}
                          </span>
                          {linkCount > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openLinkViewerModal('event', dayObj.dateStr, ev.id);
                              }}
                              className="inline-flex align-middle ml-1 bg-yellow-100 text-yellow-800 text-xs px-1 py-0.5 rounded font-bold border border-yellow-300"
                            >
                              🔗 {linkCount}
                            </button>
                          )}
                        </div>

                        {!isMultiSelectMode && (
                          <EventItemActions
                            onEdit={() =>
                              setDetailModal({ type: 'event', dateStr: dayObj.dateStr, itemId: ev.id, initialData: ev })
                            }
                            onDelete={() => onDeleteEvent(dayObj.dateStr, ev.id, ev)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {detailModal && (
        <DetailEditModal
          isOpen
          onClose={() => setDetailModal(null)}
          type={detailModal.type}
          dateStr={detailModal.dateStr}
          itemId={detailModal.itemId}
          initialData={detailModal.initialData}
        />
      )}
    </>
  );
}
