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
}

export default function WeekGrid({ days, dataMap, onSelectDate, onQuickAdd }: WeekGridProps) {
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
        const events = summary.eventList || [];
        const schedules = summary.schedules || {};
        const periodKeys = Object.keys(schedules)
          .map(Number)
          .filter((p) => {
            const item = schedules[p];
            return item && !!(item.subject?.trim() || item.content?.trim() || item.memo?.trim());
          })
          .sort((a, b) => a - b);

        const [, month, dateNum] = day.dateStr.split('-');
        
        // 공휴일 이벤트 찾기
        const holidayEvent = events.find((e) => e.label === '공휴일' || e.labelIds?.includes('공휴일'));
        const holidayName = holidays[day.dateStr] || holidayEvent?.content;
        const isHoliday = !!holidayName || day.dayName === '일';

        return (
          <div
            key={day.dateStr}
            onClick={() => onSelectDate(day.dateStr)}
            className={`bg-white rounded-2xl border p-3.5 flex flex-col justify-between transition-all cursor-pointer group hover:shadow-md hover:border-primary/50 min-h-[380px] ${
              day.isToday ? 'border-primary ring-2 ring-primary/20 shadow-xs' : 'border-slate-200/80 shadow-xs'
            }`}
          >
            <div>
              {/* 상단 날짜 및 요일 헤더 */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-7 h-7 rounded-xl flex items-center justify-center font-black text-xs ${
                      day.isToday
                        ? 'bg-primary text-white shadow-xs'
                        : isHoliday
                        ? 'bg-rose-50 text-rose-600'
                        : day.isWeekend // 토요일 등
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

                <span className="text-[10px] text-primary font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                  하루 ➔
                </span>
              </div>

              {/* 시간표 섹션 */}
              {showClass && (
              <div className="mb-4">
                <div className="text-[11px] font-extrabold text-slate-400 mb-2 flex items-center gap-1">
                  <span>⏰</span> 시간표
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
                              className="bg-yellow-100 text-yellow-800 text-[9px] px-1 py-0.2 rounded font-bold border border-yellow-300 shrink-0 hover:bg-yellow-200 cursor-pointer"
                              title="연결된 항목 보기 및 수정"
                            >
                              📑 {(item.linkedItems || []).length}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-300 py-1 pl-1">
                    수업 없음
                  </div>
                )}
              </div>
              )}

              {/* 일정 섹션 */}
              {showEvents && (
              <div>
                <div className="text-[11px] font-extrabold text-slate-400 mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span>📌</span> 일정
                  </div>
                  <div className="flex items-center gap-1">
                    {events.length > 0 && (
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded-full font-bold">
                        {events.length}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onQuickAdd(day.dateStr); }}
                      className="ml-1 w-5 h-5 rounded hover:bg-slate-200 text-slate-400 hover:text-primary flex items-center justify-center transition-colors text-xs font-bold leading-none"
                      title="새 일정 추가"
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
                      const isCompletable = labelDef ? !!labelDef.forward : true;

                      return (
                        <div
                          key={ev.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isMultiSelectMode) {
                              toggleEventSelection(ev.id, day.dateStr);
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
                          className={`px-2 py-1.5 rounded-lg text-xs leading-tight transition-all border flex items-center gap-1.5 hover:shadow-sm cursor-pointer ${
                            selectedEventIds.includes(ev.id)
                              ? 'bg-primary/10 border-primary text-primary'
                              : ev.completed
                              ? 'bg-slate-50 border-slate-100 text-slate-400 line-through'
                              : 'bg-blue-50/60 border-blue-100 text-slate-800 font-medium'
                          }`}
                        >
                          {isMultiSelectMode && (
                            <input
                              type="checkbox"
                              checked={selectedEventIds.includes(ev.id)}
                              readOnly
                              className="pointer-events-none"
                            />
                          )}
                          {hasLabel && labelColor && !isMultiSelectMode && (
                            <span
                              className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0 whitespace-nowrap"
                              style={{
                                backgroundColor: ev.completed ? '#f1f5f9' : labelColor.bg,
                                color: ev.completed ? '#94a3b8' : labelColor.text,
                                border: '1px solid ' + (ev.completed ? '#e2e8f0' : labelColor.border)
                              }}
                            >
                              {ev.label}
                            </span>
                          )}
                          <span className="break-words flex-1">{ev.content}</span>
                          {(ev.linkedItems || []).length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openLinkViewerModal('event', day.dateStr, ev.id);
                              }}
                              className="bg-yellow-100 text-yellow-800 text-[9px] px-1 py-0.2 rounded font-bold border border-yellow-300 shrink-0 hover:bg-yellow-200 cursor-pointer"
                              title="연결된 내용 보기 및 수정"
                            >
                              📑 {(ev.linkedItems || []).length}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-300 py-1 pl-1">
                    등록된 일정 없음
                  </div>
                )}
              </div>
              )}
            </div>

            {/* 하단 푸터 영역 */}
            <div className="pt-3 mt-3 border-t border-slate-50 text-[10px] text-slate-400 text-center">
              자세히 보기
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
