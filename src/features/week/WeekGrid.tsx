//src/features/week/WeekGrid.tsx

import React from 'react';
import type { DaySummary } from '../../hooks/useCalendarData';
import { useLabels } from '../../hooks/useLabels';
import { useAppStore } from '../../store/useAppStore';
import { useGovHolidays } from '../../hooks/useGovHolidays';
import HolidayName from '../../components/HolidayName';
import { splitHolidayEvents, dayToneOf, DAY_CELL_BG, DAY_NUMBER_COLOR } from '../../lib/holiday';
import { resolveEventLabel, eventDisplayContent, isForwardLabel } from '../../lib/eventLabels';
import { BODY_TEXT } from '../../lib/typeScale';
import JournalCountBadge from '../../components/JournalCountBadge';
import EvalCountBadge from '../../components/EvalCountBadge';
import DetailEditModal from '../../components/DetailEditModal';
import EventItemActions from '../../components/EventItemActions';
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
  onDeleteEvent: (dateStr: string, eventId: string, item?: any) => void;
}

export default function WeekGrid({ days, dataMap, onSelectDate, onQuickAdd, onToggleEvent, onDeleteEvent }: WeekGridProps) {
  const { getLabelColor, eventLabels, labelsLoaded } = useLabels();
  const { showClass, showEvents, isMultiSelectMode, selectedEventIds, toggleEventSelection, openLinkViewerModal, selectedGroupId } = useAppStore();
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
        
        // 공휴일 일정은 목록에서 빼고 빨간 이름으로만 보여준다
        const { events, holidayName: holidayFromEvent } = splitHolidayEvents(rawEvents);
        const holidayName = holidays[day.dateStr] || holidayFromEvent;
        // 토요일 파랑 / 일요일·공휴일 빨강 (lib/holiday의 공통 규칙)
        const tone = dayToneOf({
          isSunday: day.dayName === '일',
          isSaturday: day.dayName === '토',
          holidayName,
        });

        return (
          <div
            key={day.dateStr}
            data-today={day.isToday ? 'true' : undefined}
            onClick={() => onSelectDate(day.dateStr)}
            className={`${DAY_CELL_BG[tone]} rounded-2xl border p-2.5 flex flex-col justify-between transition-all cursor-pointer group hover:shadow-md hover:border-primary/50 min-h-[250px] min-w-0 overflow-hidden ${
              day.isToday ? 'border-primary ring-2 ring-primary/20 shadow-xs' : 'border-slate-200/80 shadow-xs'
            }`}
          >
            <div>
              {/* 표식은 오른쪽 끝에 세운다. 예전에는 날짜와 한 덩이로 묶여
                  있어서, 기록과 조사표가 둘 다 있는 날이면 칸 밖으로 밀려
                  나갔다. 줄어들 수 있는 쪽(날짜·공휴일)과 줄어들면 안 되는
                  쪽(표식)을 갈라 둔다. */}
              {/* 자리가 모자라면 표식이 아랫줄로 내려간다. 글자를 줄이거나
                  가리는 대신 줄을 바꾼다. 날짜와 공휴일 이름은 그대로 다 보여야
                  하는 것들이다. */}
              <div className="flex flex-wrap items-center justify-between gap-x-1 gap-y-1 pb-2.5 border-b border-slate-100 mb-3">
                <div className="flex items-center gap-1 min-w-0">
                  {/*
                    ⚠️ bg-white/70 을 함께 두면 안 된다. 같은 성질(배경색)의
                       두 클래스는 적는 차례가 아니라 스타일시트에 실린 차례로
                       이긴다. 실제로 bg-white/70 이 bg-primary 를 이겨서,
                       오늘 칸의 요일 글자가 흰 바탕에 흰 글씨가 되어 통째로
                       보이지 않았다. 오늘이 아닐 때만 흰 바탕을 준다.
                  */}
                  <span
                    className={`w-6 h-6 shrink-0 rounded-lg flex items-center justify-center font-black text-xs ${
                      day.isToday ? 'bg-primary text-white shadow-xs' : `bg-white/70 ${DAY_NUMBER_COLOR[tone]}`
                    }`}
                  >
                    {day.dayName}
                  </span>

                  <div className="flex flex-col min-w-0">
                    <span className={`text-xs font-bold ${DAY_NUMBER_COLOR[tone]}`}>
                      {Number(month)}.{Number(dateNum)}
                    </span>
                    {/* 세로로 쌓이는 자리라 flex-1은 주지 않는다 (세로로 늘어난다) */}
                    {holidayName && <HolidayName name={holidayName} tier="week" fill={false} />}
                  </div>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  <JournalCountBadge
                    dateStr={day.dateStr}
                    count={dataMap[day.dateStr]?.journalCount || 0}
                    fId={selectedGroupId}
                  />
                  <EvalCountBadge dateStr={day.dateStr} count={dataMap[day.dateStr]?.evalCount || 0} />
                </div>
              </div>

              {showClass && (
              <div className="mb-4">
                <div className="text-xs font-extrabold text-slate-400 mb-2 flex items-center gap-1">
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
                          <span className="font-bold text-xs text-primary shrink-0">{p}교시</span>
                          <span className="font-semibold text-slate-800 truncate text-xs flex-1">
                            {periodText}
                          </span>
                          {(item.linkedItems || []).length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openLinkViewerModal('schedule', day.dateStr, String(p), p);
                              }}
                              className="bg-yellow-100 text-yellow-800 text-2xs px-1 py-0.5 rounded font-bold border border-yellow-300 shrink-0 hover:bg-yellow-200 cursor-pointer"
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
                  <div className="text-xs text-slate-300 py-1 pl-1">
                    일정이 없습니다.
                  </div>
                )}
              </div>
              )}

              {showEvents && (
              <div>
                <div className="text-xs font-extrabold text-slate-400 mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span>일정</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {events.length > 0 && (
                      <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full font-bold">
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
                      // 라벨 해석은 lib/eventLabels 한 곳에서만 한다 (화면마다 다르면
                      // 라벨 이름을 바꿀 때 칩이 보이는 화면과 안 보이는 화면이 갈린다)
                      const labelDef = resolveEventLabel(ev, eventLabels, { keepUnknown: !labelsLoaded });
                      const labelName = labelDef?.name || '';
                      const labelColor = labelDef ? getLabelColor(labelName) : null;
                      const forwardLabel = isForwardLabel(labelDef);

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
                          className={`group relative px-2 py-1.5 rounded-lg ${BODY_TEXT.week} leading-snug transition-all border block hover:shadow-sm cursor-pointer break-words ${
                            selectedEventIds.includes(ev.id)
                              ? 'bg-primary/10 border-primary text-primary'
                              : ev.completed
                              ? 'bg-slate-50 border-slate-100 text-slate-400'
                              : 'bg-blue-50/60 border-blue-100 text-slate-800 font-medium'
                          }`}
                          title="클릭하여 상세 보기"
                        >
                          {isMultiSelectMode && (
                            <input
                              type="checkbox"
                              checked={selectedEventIds.includes(ev.id)}
                              readOnly
                              className="inline-block align-middle mr-1.5 pointer-events-none"
                            />
                          )}
                          {/* 💡 유효한 라벨일 때만 렌더링, 클릭 시 완료 토글(이월 라벨이면 이월도 정지) */}
                          {labelColor && !isMultiSelectMode && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleEvent(day.dateStr, ev.id);
                              }}
                              title={forwardLabel ? '클릭하여 완료 처리 (이월 정지)' : '클릭하여 완료 처리'}
                              className="inline-block align-middle mr-1.5 text-2xs font-bold px-1.5 py-0.5 rounded shadow-2xs whitespace-nowrap cursor-pointer"
                              style={{
                                backgroundColor: ev.completed ? '#f1f5f9' : labelColor.bg,
                                color: ev.completed ? '#94a3b8' : labelColor.text,
                                border: '1px solid ' + (ev.completed ? '#e2e8f0' : labelColor.border)
                              }}
                            >
                              {labelName}
                            </span>
                          )}
                          <span className={`inline align-middle ${ev.completed ? 'line-through text-slate-400' : ''}`}>
                            {eventDisplayContent(ev)}
                          </span>
                          
                          {(ev.linkedItems || []).length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openLinkViewerModal('event', day.dateStr, ev.id);
                              }}
                              className="inline-flex align-middle ml-1 bg-yellow-100 text-yellow-800 text-2xs px-1 py-0.5 rounded font-bold border border-yellow-300 shrink-0 hover:bg-yellow-200 cursor-pointer"
                              title={`링크된 항목 ${(ev.linkedItems || []).length}개`}
                            >
                              🔗 {(ev.linkedItems || []).length}
                            </button>
                          )}

                          {!isMultiSelectMode && (
                            <EventItemActions
                              floating
                              onEdit={() =>
                                setDetailModal({
                                  isOpen: true,
                                  type: 'event',
                                  dateStr: day.dateStr,
                                  itemId: ev.id,
                                  initialData: ev,
                                })
                              }
                              onDelete={() => onDeleteEvent(day.dateStr, ev.id, ev)}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-slate-300 py-1 pl-1">
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