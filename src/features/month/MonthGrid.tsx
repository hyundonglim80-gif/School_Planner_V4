import React from 'react';
import type { CalendarDay } from '../../lib/dateUtils';
import type { DaySummary } from '../../hooks/useCalendarData';
import { useLabels } from '../../hooks/useLabels';
import { useAppStore } from '../../store/useAppStore';
import { useGovHolidays } from '../../hooks/useGovHolidays';
import { useTimetableTemplate } from '../../hooks/useTimetableTemplate';
import DetailEditModal from '../../components/DetailEditModal';
import { useState } from 'react';

interface MonthGridProps {
  days: CalendarDay[];
  dataMap: Record<string, DaySummary>;
  onSelectDate: (dateStr: string) => void;
  onQuickAdd: (dateStr: string) => void;
  showWeekend?: boolean;
  onToggleEvent: (dateStr: string, eventId: string) => void;
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

export default function MonthGrid({ days, dataMap, onSelectDate, onQuickAdd, showWeekend = true, onToggleEvent }: MonthGridProps) {
  const currentWeekdays = showWeekend ? ALL_WEEKDAYS : ALL_WEEKDAYS.slice(1, 6);
  const { showClass, showEvents, isMultiSelectMode, selectedEventIds, toggleEventSelection, openLinkViewerModal } = useAppStore();

  const displayDays = React.useMemo(() => {
    if (!showWeekend) {
      return days.filter((d) => !d.isSunday && !d.isSaturday);
    }
    return days;
  }, [days, showWeekend]);

  const { getLabelColor, getLabel } = useLabels();
  const { holidays } = useGovHolidays();
  const { templates, currentTemplateName } = useTimetableTemplate();
  
  const maxPeriods = templates[currentTemplateName]?.names.length || 6;
  const periodArray = Array.from({ length: maxPeriods }, (_, i) => i + 1);

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
          const rawEvents = summary.eventList || [];
          const schedules = summary.schedules || {};
          
          const hasClasses = periodArray.some(p => schedules[p]?.subject?.trim() && schedules[p]?.subject?.toUpperCase() !== 'X');
          
          const holidayEvent = rawEvents.find((e: any) => e.label === '휴일' || e.labelIds?.includes('휴일'));
          const holidayName = dayObj.holidayName || holidays[dayObj.dateStr] || holidayEvent?.content;
          const isHoliday = !!holidayName || dayObj.isSunday;
          
          const events = rawEvents.filter((e: any) => e.label !== '휴일' && !e.labelIds?.includes('휴일'));

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
                    <button
                      onClick={(e) => { e.stopPropagation(); onQuickAdd(dayObj.dateStr); }}
                      className="w-5 h-5 rounded hover:bg-slate-200 text-slate-400 hover:text-primary flex items-center justify-center transition-colors text-xs font-bold leading-none opacity-0 group-hover:opacity-100"
                      title="빠른 추가"
                    >
                      +
                    </button>
                  </div>
                </div>
                
                {showClass && hasClasses && (
                  <div className="flex flex-nowrap gap-[1px] w-full mb-1.5 mt-0.5">
                    {periodArray.map((p) => {
                      const item = schedules[p];
                      const text = item?.subject?.trim() || '';
                      
                      if (text && text.toUpperCase() !== 'X') {
                        let fontSize = "text-[11px]";
                        let tracking = "tracking-normal";
                        if (text.length >= 5) { fontSize = "text-[7px]"; tracking = "tracking-tighter"; }
                        else if (text.length === 4) { fontSize = "text-[9px]"; tracking = "tracking-tighter"; }
                        else if (text.length === 3) { fontSize = "text-[10px]"; tracking = "tracking-tight"; }

                        return (
                          <div
                            key={p}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetailModal({
                                isOpen: true,
                                type: 'schedule',
                                dateStr: dayObj.dateStr,
                                itemId: p,
                                initialData: item
                              });
                            }}
                            className={`flex-1 min-w-0 h-[20px] flex items-center justify-center border border-emerald-300 rounded-[3px] bg-emerald-50 text-emerald-700 font-bold ${fontSize} ${tracking} whitespace-nowrap overflow-hidden cursor-pointer hover:bg-emerald-200 transition-colors`}
                            title={`${text} (${p}교시)`}
                          >
                            {text}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={p}
                          className="flex-1 min-w-0 h-[20px] flex items-center justify-center border border-slate-200 rounded-[3px] bg-slate-50"
                        />
                      );
                    })}
                  </div>
                )}

                {showEvents && (
                <div className="space-y-1">
                  {events.slice(0, 3).map((ev) => {
					  const hasLabel = !!ev.label;
					  const labelDef = hasLabel ? getLabel(ev.label!) : null;
					  const isValidLabel = !!labelDef; // 💡 등록된 라벨인지 확인
					  const labelColor = isValidLabel ? getLabelColor(ev.label!) : null;
					  const isCompletable = labelDef ? !!(labelDef.forward || (labelDef as any).isForward) : false;

					  return (
                      <div
                        key={ev.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isMultiSelectMode) {
                            toggleEventSelection(ev.id, dayObj.dateStr);
                          } else if (isCompletable) {
                            onToggleEvent(dayObj.dateStr, ev.id);
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
                        className={`px-1.5 py-0.5 rounded text-[11px] font-medium leading-tight transition-all border block hover:shadow-sm cursor-pointer break-words ${
                          selectedEventIds.includes(ev.id)
                            ? 'bg-primary/10 border border-primary text-primary'
                            : ev.completed && isCompletable
                            ? 'bg-slate-100 text-slate-400'
                            : 'bg-blue-50 text-blue-800 border border-blue-100'
                        }`}
                        title={isCompletable ? '클릭하여 완료 상태 변경' : '클릭하여 상세 보기'}
                      >
                        {isMultiSelectMode && (
                          <input
                            type="checkbox"
                            checked={selectedEventIds.includes(ev.id)}
                            readOnly
                            className="inline-block align-middle mr-1 pointer-events-none"
                          />
                        )}
                        {isValidLabel && labelColor && !isMultiSelectMode && (
                                        <span
                                          className="inline-block align-middle mr-1 text-[9px] font-bold px-1.5 py-0.5 rounded shadow-2xs whitespace-nowrap"
                            style={{
                              backgroundColor: (ev.completed && isCompletable) ? '#f1f5f9' : labelColor.bg,
                              color: (ev.completed && isCompletable) ? '#94a3b8' : labelColor.text,
                              border: '1px solid ' + ((ev.completed && isCompletable) ? '#e2e8f0' : labelColor.border)
                            }}
                          >
                            {ev.label}
                          </span>
                        )}
                        <span className={`inline align-middle ${ev.completed && isCompletable ? 'line-through text-slate-400' : ''}`}>
                          {ev.content}
                        </span>
                        
                        {(ev.linkedItems || []).length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openLinkViewerModal('event', dayObj.dateStr, ev.id);
                            }}
                            className="inline-flex align-middle ml-1 bg-yellow-100 text-yellow-800 text-[9px] px-1 py-0.5 rounded font-bold border border-yellow-300 hover:bg-yellow-200 cursor-pointer"
                            title={`링크된 항목 ${(ev.linkedItems || []).length}개`}
                          >
                            🔗 {(ev.linkedItems || []).length}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {events.length > 3 && (
                    <div className="text-[10px] font-bold text-slate-400 pl-1">
                      +{events.length - 3}개
                    </div>
                  )}
                </div>
                )}
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