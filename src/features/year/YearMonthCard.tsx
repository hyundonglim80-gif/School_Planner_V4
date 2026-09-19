// src/features/year/YearMonthCard.tsx
//
// 년간 화면의 달 카드 하나.
//
// ⚠️ 왜 따로 떼어 냈는가.
//    년간은 열두 달을 한 화면에 늘어놓는다. 재어 보니 요소가 11,000개였다
//    (하루 360개, 주간 469개, 월간 1,164개, 메모 1,782개). 이것이 YearScreen
//    한 함수 안에 통째로 들어 있었으므로, 그 화면의 상태가 하나라도 바뀌면
//    — '+ 일정'을 누르거나 항목을 눌러 상세를 열기만 해도 — 열두 달과
//    900개가 넘는 일정이 전부 다시 그려졌다.
//    달 카드를 따로 떼고 React.memo로 감싸면, 바뀐 달만 다시 그린다.
//
//    그러려면 넘기는 값이 판마다 새로 만들어지지 않아야 한다(그러면 memo가
//    아무 일도 못 한다). 부모가 useCallback/useMemo로 붙들어 넘긴다.
import React from 'react';
import { resolveEventLabel, eventDisplayContent, isForwardLabel } from '../../lib/eventLabels';
import { dayToneOf, DAY_CELL_BG, DAY_NUMBER_COLOR } from '../../lib/holiday';
import { BODY_TEXT, SECTION_TITLE, fitToWidthFontSize } from '../../lib/typeScale';
import EventItemActions from '../../components/EventItemActions';
import JournalCountBadge from '../../components/JournalCountBadge';
import EvalCountBadge from '../../components/EvalCountBadge';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export interface MonthInfo {
  year: number;
  month: number;
  label: string;
  semester: number;
}

export interface YearMonthCardProps {
  mInfo: MonthInfo;
  eventsMap: Record<string, any[]>;
  schedulesMap: Record<string, any>;
  journalCountMap: Record<string, number>;
  evalCountMap: Record<string, number>;
  holidays: Record<string, string>;
  eventLabels: any[];
  labelsLoaded: boolean;
  /** 라벨 빛깔. 판마다 새로 만들어지지 않게 부모가 붙들어 넘긴다. */
  labelColorOf: (name: string) => { bg: string; text: string; border: string } | null;
  periodArray: number[];
  showWeekend: boolean;
  showClass: boolean;
  showEvents: boolean;
  isMobile: boolean;
  isOpen: boolean;
  isCurrentMonthCard: boolean;
  realTodayStr: string;
  selectedGroupId: string | null;
  isMultiSelectMode: boolean;
  selectedEventIds: string[];
  onToggleMonth: (monthKey: string, defaultCollapsed: boolean) => void;
  onDateClick: (dateStr: string) => void;
  onToggleEvent: (dateStr: string, eventId: string) => void;
  onDeleteEvent: (dateStr: string, eventId: string, fallbackItem?: any) => void;
  onQuickAdd: (dateStr: string) => void;
  onOpenDetail: (type: 'schedule' | 'event', dateStr: string, itemId: string | number, initialData: any) => void;
  onToggleSelection: (eventId: string, dateStr: string) => void;
  onOpenLinkViewer: (type: 'event', dateStr: string, eventId: string) => void;
}

function YearMonthCard({
  mInfo,
  eventsMap,
  schedulesMap,
  journalCountMap,
  evalCountMap,
  holidays,
  eventLabels,
  labelsLoaded,
  labelColorOf,
  periodArray,
  showWeekend,
  showClass,
  showEvents,
  isMobile,
  isOpen,
  isCurrentMonthCard,
  realTodayStr,
  selectedGroupId,
  isMultiSelectMode,
  selectedEventIds,
  onToggleMonth,
  onDateClick,
  onToggleEvent,
  onDeleteEvent,
  onQuickAdd,
  onOpenDetail,
  onToggleSelection,
  onOpenLinkViewer,
}: YearMonthCardProps) {
  const monthKey = `${mInfo.year}-${mInfo.month}`;

  const daysInMonth = new Date(mInfo.year, mInfo.month, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    const dateStr = `${mInfo.year}-${String(mInfo.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return { day: d, dateStr, dateObj: new Date(mInfo.year, mInfo.month - 1, d) };
  });

  const activeDays = days.filter((dObj) => {
    const dayOfWeekNum = dObj.dateObj.getDay();
    if (!showWeekend && (dayOfWeekNum === 0 || dayOfWeekNum === 6)) return false;

    const evs = eventsMap[dObj.dateStr] || [];
    const sch = schedulesMap[dObj.dateStr] || {};
    const hasClasses = periodArray.some((p) => sch[p]?.subject?.trim() && sch[p]?.subject?.toUpperCase() !== 'X');

    return evs.length > 0 || (showClass && hasClasses);
  });

  return (
    <div
      className={`bg-white rounded-2xl border shadow-sm p-4 sm:p-5 flex flex-col transition-all ${
        isCurrentMonthCard ? 'border-primary ring-2 ring-primary/10' : 'border-slate-200/80 hover:shadow-md'
      }`}
    >
      <button
        type="button"
        onClick={() => isMobile && onToggleMonth(monthKey, !isCurrentMonthCard)}
        className={`text-center font-black text-blue-800 ${SECTION_TITLE} flex items-center justify-center gap-2 ${
          isOpen ? 'mb-4 pb-2 border-b-2 border-blue-100' : ''
        } ${isMobile ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {isMobile && <span className="text-xs text-slate-400">{isOpen ? '▼' : '▶'}</span>}
        <span>{mInfo.label}</span>
        <span className="text-xs font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-lg">
          {mInfo.semester}학기
        </span>
        {!isOpen && (
          <span className="text-xs font-bold text-slate-400">
            {activeDays.length > 0 ? `${activeDays.length}일` : '비어 있음'}
          </span>
        )}
      </button>

      {/*
        ⚠️ 접힌 달은 아예 그리지 않는다.
           예전에는 그려 놓고 `hidden`으로 감췄다. 휴대폰에서는 한 달만 펼치는데도
           열두 달을 다 그리고 있었던 셈이라, 재어 보니 요소 12,770개 가운데
           11,543개(90%)가 감춰진 것들이었다. 보이지도 않는 것을 그리느라
           화면이 1초 넘게 굳었다.
      */}
      {isOpen && (
        <div className="flex flex-col gap-3 flex-1">
          {activeDays.length > 0 ? (
            activeDays.map((dObj) => {
              const dayOfWeekNum = dObj.dateObj.getDay();
              const dayOfWeek = DAY_NAMES[dayOfWeekNum];
              const isTodayEvent = dObj.dateStr === realTodayStr;

              const evs = eventsMap[dObj.dateStr] || [];
              const sch = schedulesMap[dObj.dateStr] || {};

              const holidayEvent = evs.find((e: any) => e.label === '휴일' || e.labelIds?.includes('휴일'));
              const holidayName = holidays[dObj.dateStr] || holidayEvent?.content;
              // 토요일 파랑 / 일요일·공휴일 빨강 (lib/holiday의 공통 규칙)
              const tone = dayToneOf({
                isSunday: dayOfWeekNum === 0,
                isSaturday: dayOfWeekNum === 6,
                holidayName,
              });

              const visibleEvents = evs.filter((e: any) => e.label !== '휴일' && !e.labelIds?.includes('휴일'));
              const hasClasses = periodArray.some((p) => sch[p]?.subject?.trim() && sch[p]?.subject?.toUpperCase() !== 'X');

              return (
                <div
                  key={dObj.dateStr}
                  data-today={isTodayEvent ? 'true' : undefined}
                  className={`flex flex-col gap-1.5 p-2 -mx-2 rounded-xl border-b border-dashed border-slate-200 last:border-0 ${DAY_CELL_BG[tone]} ${isTodayEvent ? 'ring-1 ring-primary/40 border-solid' : ''}`}
                >
                  {/* 자리가 모자라면 표식이 아랫줄로 내려간다 */}
                  <div className="flex flex-wrap items-center justify-between gap-x-1 gap-y-0.5 min-w-0">
                    {/* 년간은 한 화면에 12개월을 담는 가장 조밀한 화면인데,
                        날짜 숫자만 월간·주간(text-xs)보다 한두 단계 컸다.
                        오늘 강조는 크기 대신 색과 '오늘' 표시로 한다. */}
                    <div
                      className={`font-black cursor-pointer hover:underline flex flex-wrap items-center gap-1 text-xs min-w-0 ${DAY_NUMBER_COLOR[tone]}`}
                      onClick={() => onDateClick(dObj.dateStr)}
                    >
                      <span className="shrink-0">{dObj.day}일 ({dayOfWeek})</span>
                      {isTodayEvent && <span className="text-2xs bg-blue-600 text-white px-1.5 py-0.5 rounded-full ml-1 shrink-0">오늘</span>}
                      {holidayName && <span title={holidayName} className="text-2xs text-red-500 bg-red-50 border border-red-100 px-1 py-0.5 rounded ml-1 shrink-0">{holidayName}</span>}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <JournalCountBadge
                        dateStr={dObj.dateStr}
                        count={journalCountMap[dObj.dateStr] || 0}
                        fId={selectedGroupId}
                      />
                      <EvalCountBadge dateStr={dObj.dateStr} count={evalCountMap[dObj.dateStr] || 0} />
                      <button
                        onClick={(e) => { e.stopPropagation(); onQuickAdd(dObj.dateStr); }}
                        className="text-2xs font-bold text-slate-400 hover:text-primary bg-slate-50 hover:bg-slate-100 px-1.5 py-0.5 rounded transition-colors"
                      >
                        + 일정
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {/* 휴대폰에서는 6칸을 고정으로 나누면 한 칸이 56px도 안 되어 과목명이 잘린다.
                        채워진 교시만 칩으로 보여주고 줄바꿈한다. */}
                    {showClass && hasClasses && isMobile && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {periodArray.map((p) => {
                          const item = sch[p];
                          const text = item?.subject?.trim() || '';
                          if (!text || text.toUpperCase() === 'X') return null;
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenDetail('schedule', dObj.dateStr, p, item);
                              }}
                              className="flex items-center gap-1 px-1.5 py-1 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-2xs font-bold"
                            >
                              <span className="text-2xs text-emerald-500">{p}</span>
                              <span className="max-w-[90px] truncate">{text}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {showClass && hasClasses && !isMobile && (
                      <div className="flex flex-nowrap gap-[1px] w-full mt-0.5">
                        {periodArray.map((p) => {
                          const item = sch[p];
                          const text = item?.subject?.trim() || '';
                          if (text && text.toUpperCase() !== 'X') {
                            // 글자 수를 세어 단계를 고르던 것을 월간과 같은 방식으로 바꿨다.
                            // 그 방식은 칸이 얼마나 좁은지는 보지 않아서, 짧은 과목명에
                            // text-xs가 걸려 옆 칸보다 글자가 튀었다.
                            return (
                              <div
                                key={p}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenDetail('schedule', dObj.dateStr, p, item);
                                }}
                                className="flex-1 min-w-0 h-[22px] flex items-center justify-center border border-emerald-300 rounded-[3px] bg-emerald-50 text-emerald-700 font-bold overflow-hidden cursor-pointer hover:bg-emerald-200 transition-colors shadow-2xs [container-type:inline-size]"
                                title={`${text} (${p}교시)`}
                              >
                                <span
                                  className="text-2xs tracking-tighter whitespace-nowrap leading-none"
                                  style={{ fontSize: fitToWidthFontSize(text) }}
                                >
                                  {text}
                                </span>
                              </div>
                            );
                          }
                          return <div key={p} className="flex-1 min-w-0 h-[22px] flex items-center justify-center border border-slate-200 rounded-[3px] bg-slate-50" />;
                        })}
                      </div>
                    )}

                    {showEvents && visibleEvents.length > 0 && (
                      <div className="flex flex-col gap-1">
                        {visibleEvents.map((ev) => {
                          // 라벨 해석은 lib/eventLabels 한 곳에서만 한다
                          const labelDef = resolveEventLabel(ev, eventLabels, { keepUnknown: !labelsLoaded });
                          const labelName = labelDef?.name || '';
                          const labelColor = labelDef ? labelColorOf(labelName) : null;
                          const forwardLabel = isForwardLabel(labelDef);

                          return (
                            <div
                              key={ev.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isMultiSelectMode) {
                                  onToggleSelection(ev.id, dObj.dateStr);
                                } else {
                                  onOpenDetail('event', dObj.dateStr, ev.id, ev);
                                }
                              }}
                              className={`group relative px-1.5 py-1 rounded-lg ${BODY_TEXT.month} leading-snug transition-all border block hover:shadow-sm cursor-pointer break-words ${
                                selectedEventIds.includes(ev.id)
                                  ? 'bg-primary/10 border-primary text-primary'
                                  : ev.completed
                                  ? 'bg-slate-50 border-slate-100 text-slate-400'
                                  : 'bg-white border-slate-200 text-slate-700 font-medium'
                              }`}
                              title="클릭하여 상세 보기"
                            >
                              {/* 💡 체크박스 삭제 및 인라인 정렬 지원 */}
                              {isMultiSelectMode && (
                                <input type="checkbox" checked={selectedEventIds.includes(ev.id)} readOnly className="inline-block align-middle mr-1.5 pointer-events-none" />
                              )}
                              {/* 라벨 칩 클릭 시 완료 토글(이월 라벨이면 이월도 정지) */}
                              {labelColor && !isMultiSelectMode && (
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleEvent(dObj.dateStr, ev.id);
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
                                    onOpenLinkViewer('event', dObj.dateStr, ev.id);
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
                                  onEdit={() => onOpenDetail('event', dObj.dateStr, ev.id, ev)}
                                  onDelete={() => onDeleteEvent(dObj.dateStr, ev.id, ev)}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center text-slate-400 text-xs py-8 font-semibold">
              기록된 일정이 없습니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(YearMonthCard);
