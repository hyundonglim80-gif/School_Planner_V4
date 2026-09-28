//src/features/week/WeekGrid.tsx

import React, { Suspense } from 'react';
import type { DaySummary } from '../../hooks/useCalendarData';
import { useLabels } from '../../hooks/useLabels';
import { useTimetableTemplate } from '../../hooks/useTimetableTemplate';
import { useAppStore } from '../../store/useAppStore';
import { useGovHolidays } from '../../hooks/useGovHolidays';
import HolidayName from '../../components/HolidayName';
import { splitHolidayEvents, dayToneOf, DAY_CELL_BG, DAY_NUMBER_COLOR } from '../../lib/holiday';
import { resolveEventLabel, eventDisplayContent, isForwardLabel } from '../../lib/eventLabels';
import { BODY_TEXT } from '../../lib/typeScale';
import JournalCountBadge from '../../components/JournalCountBadge';
import EvalCountBadge from '../../components/EvalCountBadge';
import { lazyWithReload } from '../../lib/lazyWithReload';
import EventItemActions from '../../components/EventItemActions';
import { useGroupDelete } from '../../hooks/useGroupDelete';
import { useState } from 'react';

// Layout도 같은 편집기를 따로 불러온다. 여기서 곧바로 불러오면 분리가 무너져
// 편집기가 첫 화면 묶음에 함께 실려 온다. 그래서 여기서도 필요할 때 불러온다.
const DetailEditModal = lazyWithReload(() => import('../../components/DetailEditModal'));

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
  // 교시 줄 수는 시간표 설정에서 온다 (하루·월간과 같다).
  const { templates, currentTemplateName } = useTimetableTemplate();
  const maxPeriods = templates[currentTemplateName]?.names.length || 6;

  /** 내용이 있는 교시인가 */
  const hasPeriodText = (item: any) =>
    !!(item && (item.subject?.trim() || item.content?.trim() || item.memo?.trim()));

  /**
   * 모든 요일에 같은 수의 교시 줄을 그린다.
   *
   * 예전에는 내용이 있는 교시만 그려서, 수업이 적은 날은 칸이 짧아지고 그 아래
   * '일정'이 위로 당겨졌다. 요일마다 일정이 시작하는 높이가 달라 들쑥날쑥했다.
   * 빈 교시도 자리를 두면 같은 교시가 옆 요일과 나란히 선다.
   * 시간표보다 뒤 교시에 적어 둔 것이 있으면(7교시 보충 등) 그만큼 늘린다.
   */
  const weekPeriodCount = Math.max(
    maxPeriods,
    ...days.flatMap((day) => {
      const sch = dataMap[day.dateStr]?.schedules || {};
      return Object.keys(sch).map(Number).filter((p) => hasPeriodText(sch[p]));
    })
  );
  const weekPeriods = Array.from({ length: weekPeriodCount }, (_, i) => i + 1);

  const [detailModal, setDetailModal] = useState<{
    isOpen: boolean;
    type: 'schedule' | 'event';
    dateStr: string;
    itemId: string | number;
    initialData: any;
  } | null>(null);

  // 기간·반복으로 묶인 일정은 지우기 전에 어디까지 지울지 묻는다
  const { requestDelete, groupDeleteModal } = useGroupDelete({
    fId: selectedGroupId,
    deleteOne: onDeleteEvent,
  });

  return (
    <>
    {/*
      ⚠️ 휴대폰에서 한 줄에 하루씩 두지 않는다.
         예전에는 grid-cols-1이라 날짜 카드가 세로로 일곱 개 쌓였다. 그러면
         '주간'이 아니라 '하루 화면을 일곱 번 이어 붙인 것'처럼 보인다.
         재어 보니 390px에서 두 열로 두어도 칸이 181px이라 '1교시 과학',
         '이월 독서록 검사' 가 잘리지 않고 다 들어간다(넘침 0, 잘린 글자 0).
         세로 길이는 2,885px에서 1,827px로 줄어 한눈에 훑기도 낫다.
         세 열은 390px에서 120px밖에 안 되어 한글 과목명이 들어가지 않으므로,
         세 열은 지금처럼 sm(640px) 이상에서만 쓴다.
    */}
    {/* 한 줄에 요일을 다 늘어놓는 것은 본문 폭 1200px(창 폭 1280px 무렵) 이상에서만 한다.
        모니터 절반(약 940~1050px)에서 한 줄로 서면 카드가 좁고 길어져 아래가
        텅 빈다. 그 폭에서는 두세 줄로 접는다 (7일: 3칸 → 4칸, 5일: 3칸).
        창 폭이 아니라 본문 폭(@container)으로 재므로, 오른쪽 메모·기록 칸이 열리면 그만큼 접는다. */}
    <div className={"grid grid-cols-2 @min-[720px]:grid-cols-3 " + (days.length === 5 ? "@min-[1200px]:grid-cols-5" : "@min-[980px]:grid-cols-4 @min-[1200px]:grid-cols-7") + " gap-2 sm:gap-3"}>
      {days.map((day) => {
        const summary = dataMap[day.dateStr] || {};
        const rawEvents = summary.eventList || [];
        const schedules = summary.schedules || {};


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
              {/* 날짜 줄 높이를 두 줄 자리(min-h-9)로 잡아 둔다. 공휴일 이름이 붙는 날만
                  한 줄 늘어나면 그 요일의 수업·일정이 옆 요일보다 아래로 밀린다. */}
              <div className="flex flex-wrap items-center justify-between gap-x-1 gap-y-1 pb-2.5 border-b border-slate-100 mb-3">
                <div className="flex items-center gap-1 min-w-0 min-h-9">
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
                {/* 빈 교시도 같은 높이의 자리로 둔다. 줄 높이를 h-7로 못 박아
                    🔗 표식이 붙은 줄만 두꺼워지지 않게 한다. */}
                <div className="space-y-1">
                  {weekPeriods.map((p) => {
                    const item = schedules[p];
                    const filled = hasPeriodText(item);
                    const periodText = filled
                      ? item.subject?.trim() || item.content?.trim() || item.memo?.trim()
                      : '';
                    const linkCount = (item?.linkedItems || []).length;
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
                            initialData: item || { subject: '', content: '' },
                          });
                        }}
                        title={filled ? `${p}교시 ${periodText}` : `${p}교시 (비어 있음) - 눌러서 수업 적기`}
                        className={`h-7 flex items-center gap-1.5 px-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                          filled
                            ? 'bg-slate-50 border-slate-100 hover:bg-slate-100'
                            : 'bg-white/40 border-dashed border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span className={`font-bold text-xs shrink-0 ${filled ? 'text-primary' : 'text-slate-300'}`}>{p}교시</span>
                        <span className={`truncate text-xs flex-1 ${filled ? 'font-semibold text-slate-800' : 'text-slate-300'}`}>
                          {filled ? periodText : '-'}
                        </span>
                        {linkCount > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openLinkViewerModal('schedule', day.dateStr, String(p), p);
                            }}
                            className="bg-yellow-100 text-yellow-800 text-2xs leading-none px-1 py-0.5 rounded font-bold border border-yellow-300 shrink-0 hover:bg-yellow-200 cursor-pointer"
                            title={`링크된 항목 ${linkCount}개`}
                          >
                            🔗 {linkCount}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              )}

              {showEvents && (
              <div>
                <div className="h-5 text-xs font-extrabold text-slate-400 mb-2 flex items-center justify-between">
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
                              onDelete={() => requestDelete(day.dateStr, ev.id, ev)}
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
      <Suspense fallback={null}>
        <DetailEditModal
          isOpen={detailModal.isOpen}
          onClose={() => setDetailModal(null)}
          type={detailModal.type}
          dateStr={detailModal.dateStr}
          itemId={detailModal.itemId}
          initialData={detailModal.initialData}
        />
      </Suspense>
    )}

    {groupDeleteModal}
    </>
  );
}