import React from 'react';
import type { CalendarDay } from '../../lib/dateUtils';
import type { DaySummary } from '../../hooks/useCalendarData';
import { useLabels } from '../../hooks/useLabels';
import { useAppStore } from '../../store/useAppStore';
import { useGovHolidays } from '../../hooks/useGovHolidays';
import DetailEditModal from '../../components/DetailEditModal';
import { useState } from 'react';

interface MonthGridProps {
  days: CalendarDay[];
  dataMap: Record<string, DaySummary>;
  onSelectDate: (dateStr: string) => void;
  onQuickAdd: (dateStr: string) => void;
  showWeekend?: boolean;
}

const ALL_WEEKDAYS = [
  { name: '일', color: 'text-red-500' },
  { name: '월', color: 'text-slate-700' },
  { name: '화', color: 'text-slate-700' },
  { name: '수', color: 'text-slate-700' },
  { name: '목', color: 'text-slate-700' },
  { name: '금', color: 'text-slate-700' },
  { name: '토', color: 'text-blue-500' },
];

export default function MonthGrid({ days, dataMap, onSelectDate, onQuickAdd, showWeekend = true }: MonthGridProps) {
  const currentWeekdays = showWeekend ? ALL_WEEKDAYS : ALL_WEEKDAYS.slice(1, 6);
  const { showClass, showEvents, isMultiSelectMode, selectedEventIds, toggleEventSelection } = useAppStore();
  const displayDays = React.useMemo(() => {
    if (!showWeekend) {
      return days.filter((d) => !d.isSunday && !d.isSaturday);
    }
    return days;
  }, [days, showWeekend]);
  const { getLabelColor } = useLabels();
  const { holidays } = useGovHolidays();
  const [detailModal, setDetailModal] = useState<{
    isOpen: boolean;
    type: 'schedule' | 'event';
    dateStr: string;
    itemId: string | number;
    initialData: any;
  } | null>(null);
  
  return (
    <>
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
      <div className={"grid " + (showWeekend ? "grid-cols-7" : "grid-cols-5") + " border-b border-slate-200 bg-slate-50/70 text-center py-2.5"}>
        {currentWeekdays.map((w) => (
          <div key={w.name} className={"text-xs font-black " + w.color}>
            {w.name}
          </div>
        ))}
      </div>

      <div className={"grid " + (showWeekend ? "grid-cols-7" : "grid-cols-5") + " divide-x divide-y divide-slate-100"}>
        {displayDays.map((dayObj) => {
          const summary = dataMap[dayObj.dateStr] || {};
          const events = summary.eventList || [];
          const schedules = summary.schedules || {};
          const scheduleCount = Object.keys(schedules).length;

          const holidayName = dayObj.holidayName || holidays[dayObj.dateStr];
          const isHoliday = !!holidayName || dayObj.isSunday;

          return (
            <div
              key={dayObj.dateStr}
              onClick={() => onSelectDate(dayObj.dateStr)}
              className={`min-h-[105px] p-2 flex flex-col justify-between transition-all cursor-pointer group hover:bg-blue-50/30 ${
                !dayObj.isCurrentMonth ? 'bg-slate-50/40 opacity-40' : 'bg-white'
              } ${dayObj.isToday ? 'ring-2 ring-inset ring-primary/40' : ''}`}
            >
              <div>
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <div className="flex items-center gap-1">
                    <span
                      className={`text-xs font-black inline-flex items-center justify-center w-6 h-6 rounded-full ${
                        dayObj.isToday
                          ? 'bg-primary text-white shadow-xs'
                          : isHoliday
                          ? 'text-red-500'
                          : dayObj.isSaturday
                          ? 'text-blue-500'
                          : 'text-slate-700'
                      }`}
                    >
                      {dayObj.day}
                    </span>

                    {holidayName && (
                      <span className="text-[10px] font-bold text-red-600 truncate max-w-[65px]">
                        {holidayName}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {showClass && scheduleCount > 0 && (
                      <span className="text-[10px] text-slate-400 font-medium hidden sm:inline" title={`${scheduleCount}개 수업`}>
                        📚 {scheduleCount}
                      </span>
                    )}
                    {/* V3 처럼 항상 호버 시 보이게 함 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); onQuickAdd(dayObj.dateStr); }}
                      className="w-5 h-5 rounded hover:bg-slate-200 text-slate-400 hover:text-primary flex items-center justify-center transition-colors text-xs font-bold leading-none opacity-0 group-hover:opacity-100"
                      title="새 일정 추가"
                    >
                      +
                    </button>
                  </div>
                </div>

                {showEvents && (
                <div className="space-y-1">
                  {events.slice(0, 3).map((ev) => {
                    const hasLabel = !!ev.label;
                    const labelColor = hasLabel ? getLabelColor(ev.label!) : null;

                    return (
                      <div
                        key={ev.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isMultiSelectMode) {
                            toggleEventSelection(ev.id, dayObj.dateStr);
                          } else {
                            setDetailModal({
                              isOpen: true,
                              type: 'event',
                              dateStr: dayObj.dateStr,
                              itemId: ev.id,
                              initialData: ev
                            });
                          }
                        }}
                        className={`px-1.5 py-0.5 rounded text-[11px] font-medium truncate leading-tight flex items-center gap-1 hover:shadow-sm cursor-pointer ${
                          selectedEventIds.includes(ev.id)
                            ? 'bg-primary/10 border border-primary text-primary'
                            : ev.completed
                            ? 'bg-slate-100 text-slate-400 line-through'
                            : 'bg-blue-50 text-blue-800 border border-blue-100'
                        }`}
                        title={ev.content}
                      >
                        {isMultiSelectMode && (
                          <input
                            type="checkbox"
                            checked={selectedEventIds.includes(ev.id)}
                            readOnly
                            className="mr-0.5 pointer-events-none"
                          />
                        )}
                        {hasLabel && labelColor && !isMultiSelectMode && (
                          <span
                            className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0"
                            style={{
                              backgroundColor: ev.completed ? '#f1f5f9' : labelColor.bg,
                              color: ev.completed ? '#94a3b8' : labelColor.text,
                              border: '1px solid ' + (ev.completed ? '#e2e8f0' : labelColor.border)
                            }}
                          >
                            {ev.label}
                          </span>
                        )}
                        <span className="truncate">{ev.content}</span>
                      </div>
                    );
                  })}

                  {events.length > 3 && (
                    <div className="text-[10px] font-bold text-slate-400 pl-1">
                      +{events.length - 3}개 더보기
                    </div>
                  )}
                </div>
                )}
              </div>

              <div className="text-[10px] text-primary font-bold opacity-0 group-hover:opacity-100 transition-opacity text-right">
                보기 ➔
              </div>
            </div>
          );
        })}
      </div>
    </div>
    {detailModal && (
      <DetailEditModal
        isOpen={detailModal.isOpen}
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
