import React from 'react';
import type { DaySummary } from '../../hooks/useCalendarData';
import { useLabels } from '../../hooks/useLabels';
import { useAppStore } from '../../store/useAppStore';
import { useGovHolidays } from '../../hooks/useGovHolidays';
import DetailEditModal from '../../components/DetailEditModal';
import { useState } from 'react';

interface WeekDayItem {
  dateStr: string;
  dayName: string;
  isToday: boolean;
  isWeekend: boolean;
}

interface WeekGridProps {
  days: WeekDayItem[];
  dataMap: Record<string, DaySummary>;
  onSelectDate: (dateStr: string) => void;
  onQuickAdd: (dateStr: string) => void;
  onToggleEvent: (dateStr: string, eventId: string) => void;
}

export default function WeekGrid({ days, dataMap, onSelectDate, onQuickAdd, onToggleEvent }: WeekGridProps) {
  const { getLabelColor, getLabel } = useLabels();
  const { showClass, showEvents, isMultiSelectMode, selectedEventIds, toggleEventSelection, openLinkViewerModal } = useAppStore();
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
    <div className={"grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 " + (days.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-7") + " gap-3"}>
      {days.map((day) => {
        const summary = dataMap[day.dateStr] || {};
        const rawEvents = summary.eventList || [];
        const schedules = summary.schedules || {};

        const periodKeys = Object.keys(schedules)
          .map(Number)
          .filter((p) => {
            const item = schedules[p];
            return item && !!(item.subject?.trim() || item.content?.trim() || item.memo?.trim());
          })
          .sort((a, b) => a - b);

        const [, month, dateNum] = day.dateStr.split('-');
        
        const holidayEvent = rawEvents.find((e: any) => e.label === '휴일' || e.labelIds?.includes('휴일'));
        const holidayName = holidays[day.dateStr] || holidayEvent?.content;
        const isHoliday = !!holidayName || day.dayName === '일';
        
        const events = rawEvents.filter((e: any) => e.label !== '휴일' && !e.labelIds?.includes('휴일'));

        return (
          <div
            key={day.dateStr}
            onClick={() => onSelectDate(day.dateStr)}
            className={`bg-white rounded-2xl border p-3.5 flex flex-col justify-between transition-all cursor-pointer group hover:shadow-md hover:border-primary/50 min-h-[380px] ${
              day.isToday ? 'border-primary ring-2 ring-primary/20 shadow-xs' : 'border-slate-200/80 shadow-xs'
            }`}
          >
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-7 h-7 rounded-xl flex items-center justify-center font-black text-xs ${
                      day.isToday
                        ? 'bg-primary text-white shadow-xs'
                        : isHoliday
                        ? 'bg-rose-50 text-rose-600'
                        : day.isWeekend
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {day.dayName}
                  </span>
                  
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-700">
                      {Number(month)}.{Number(dateNum)}
                    </span>
                    {holidayName && (
                      <span className="text-[10px] font-bold text-red-600 truncate max-w-[65px]">
                        {holidayName}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {showClass && (
              <div className="mb-4">
                <div className="text-[11px] font-extrabold text-slate-400 mb-2 flex items-center gap-1">
                  <span>수업</span>
                </div>
                {periodKeys.length > 0 ? (
                  <div className="space-y-1">
                    {periodKeys.map((p) => {
                      const item = schedules[p];
                      const periodText = item.subject?.trim() || item.content?.trim() || item.memo?.trim();
                      return (
                        <div
                          key={p}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailModal({
                              isOpen: true,
                              type: 'schedule',
                              dateStr: day.dateStr,
                              itemId: p,
                              initialData: item
                            });
                          }}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 text-xs hover:bg-slate-100 cursor-pointer transition-colors"
                        >
                          <span className="font-bold text-[10px] text-primary shrink-0">{p}교시</span>
                          <span className="font-semibold text-slate-800 truncate text-[11px] flex-1">
                            {periodText}
                          </span>
                          {(item.linkedItems || []).length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openLinkViewerModal('schedule', day.dateStr, String(p), p);
                              }}
                              className="bg-yellow-100 text-yellow-800 text-[9px] px-1 py-0.5 rounded font-bold border border-yellow-300 shrink-0 hover:bg-yellow-200 cursor-pointer"
                              title={`링크된 항목 ${(item.linkedItems || []).length}개`}
                            >
                              🔗 {(item.linkedItems || []).length}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-300 py-1 pl-1">
                    일정이 없습니다.
                  </div>
                )}
              </div>
              )}

              {showEvents && (
              <div>
                <div className="text-[11px] font-extrabold text-slate-400 mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span>일정</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {events.length > 0 && (
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full font-bold">
                        {events.length}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onQuickAdd(day.dateStr); }}
                      className="ml-1 w-5 h-5 rounded hover:bg-slate-200 text-slate-400 hover:text-primary flex items-center justify-center transition-colors text-xs font-bold leading-none"
                      title="일정 빠른 추가"
                    >
                      +
                    </button>
                  </div>
                </div>

                {events.length > 0 ? (
                  <div className="space-y-1.5">
                    {events.map((ev) => {
                      const hasLabel = !!ev.label;
                      const labelColor = hasLabel ? getLabelColor(ev.label!) : null;
                      const labelDef = hasLabel ? getLabel(ev.label!) : null;
                      // 라벨이 없으면 무조건 이월 기능 불가
                      const isCompletable = labelDef ? !!(labelDef.forward || (labelDef as any).isForward) : false;

                      return (
                        <div
                          key={ev.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isMultiSelectMode) {
                              toggleEventSelection(ev.id, day.dateStr);
                            } else if (isCompletable) {
                              onToggleEvent(day.dateStr, ev.id);
                            } else {
                              setDetailModal({
                                isOpen: true,
                                type: 'event',
                                dateStr: day.dateStr,
                                itemId: ev.id,
                                initialData: ev
                              });
                            }
                          }}
                          className={`px-2 py-1.5 rounded-lg text-xs leading-snug transition-all border block hover:shadow-sm cursor-pointer break-words ${
                            selectedEventIds.includes(ev.id)
                              ? 'bg-primary/10 border-primary text-primary'
                              : ev.completed && isCompletable
                              ? 'bg-slate-50 border-slate-100 text-slate-400'
                              : 'bg-blue-50/60 border-blue-100 text-slate-800 font-medium'
                          }`}
                          title={isCompletable ? '클릭하여 완료 상태 변경' : '클릭하여 상세 보기'}
                        >
                          {/* 체크박스가 완전히 제거되고 인라인 정렬 적용 */}
                          {isMultiSelectMode && (
                            <input
                              type="checkbox"
                              checked={selectedEventIds.includes(ev.id)}
                              readOnly
                              className="inline-block align-middle mr-1.5 pointer-events-none"
                            />
                          )}
                          {hasLabel && labelColor && !isMultiSelectMode && (
                            <span
                              className="inline-block align-middle mr-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap shadow-2xs"
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
                                openLinkViewerModal('event', day.dateStr, ev.id);
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
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-300 py-1 pl-1">
                    일정이 없습니다.
                  </div>
                )}
              </div>
              )}
            </div>
          </div>
        );
      })}
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