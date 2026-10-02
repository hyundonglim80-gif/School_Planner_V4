//src/features/month/MonthGrid.tsx

import React, { Suspense } from 'react';
import type { CalendarDay } from '../../lib/dateUtils';
import type { DaySummary } from '../../hooks/useCalendarData';
import { useLabels } from '../../hooks/useLabels';
import { useAppStore } from '../../store/useAppStore';
import { useGovHolidays } from '../../hooks/useGovHolidays';
import HolidayName from '../../components/HolidayName';
import SchoolEventName from '../../components/SchoolEventName';
import { useSchoolSchedule } from '../../hooks/useNeis';
import {
  splitHolidayEvents,
  dayToneOf,
  DAY_CELL_BG,
  DAY_NUMBER_COLOR,
  WEEKDAY_HEADER_COLOR,
} from '../../lib/holiday';
import { fitToWidthFontSize } from '../../lib/typeScale';
import { resolveEventLabel, eventDisplayContent, isForwardLabel, isCalendarVisible } from '../../lib/eventLabels';
import { BODY_TEXT } from '../../lib/typeScale';
import JournalCountBadge from '../../components/JournalCountBadge';
import EvalCountBadge from '../../components/EvalCountBadge';
import { useTimetableTemplate } from '../../hooks/useTimetableTemplate';
import { lazyWithReload } from '../../lib/lazyWithReload';
import EventItemActions from '../../components/EventItemActions';
import { useGroupDelete } from '../../hooks/useGroupDelete';
import { openEntryPanel } from '../../components/EntryPanelHost';
import { useEventDropMove, eventDragSourceProps, DROP_TARGET_CLASS } from '../../hooks/useEventDrag';
import { useState } from 'react';
import { layoutWeekBars, type BarCell } from '../../lib/periodBars';
import PeriodBar from './PeriodBar';

// Layout도 같은 편집기를 따로 불러온다. 여기서 곧바로 불러오면 분리가 무너져
// 편집기가 첫 화면 묶음에 함께 실려 온다. 그래서 여기서도 필요할 때 불러온다.
const DetailEditModal = lazyWithReload(() => import('../../components/DetailEditModal'));

interface MonthGridProps {
  days: CalendarDay[];
  dataMap: Record<string, DaySummary>;
  onSelectDate: (dateStr: string) => void;
  onQuickAdd: (dateStr: string) => void;
  showWeekend?: boolean;
  onToggleEvent: (dateStr: string, eventId: string) => void;
  onDeleteEvent: (dateStr: string, eventId: string, item?: any) => void;
  /**
   * 휴대폰처럼 한 칸이 50px 남짓인 곳에서 쓰는 촘촘한 모양.
   *
   * ⚠️ PC 칸을 그대로 휴대폰에 넣으면 달력 꼴은 남지만 읽을 수가 없다.
   *    재어 보니 390px에서 한 칸이 53px인데, 일정 제목이 한 글자씩 세로로
   *    쪼개지고("독서/록 검/사") 교시 칩 여섯은 알아볼 수 없는 초록 막대가
   *    되며, 한 줄 높이가 261~312px이라 한 화면에 두 주 반밖에 안 들어갔다.
   *
   *    그래서 칸의 '모양'은 그대로 두고 '안에 든 것'만 줄인다.
   *      · 라벨은 이름을 적지 않고 왼쪽 색 띠로만 (이름이 칸의 절반을 먹었다)
   *      · 제목은 한 줄로 자르고, 칸 너비에 맞춰 글자를 줄인다
   *      · 교시는 칩 여섯 대신 과목 첫 글자를 한 줄로
   *    이렇게 하니 줄 높이가 117~134px, 문서 높이가 882px이 되어 한 달이
   *    한 화면에 들어온다.
   */
  compact?: boolean;
  /** 휴대폰에서 그날 목록을 띄운 날짜 - 칸에 테를 두른다 (ROADMAP 15) */
  selectedDate?: string | null;
}

// 요일 머리글도 같은 규칙을 쓴다 (일=빨강, 토=파랑)
const ALL_WEEKDAYS = [
  { name: '일', color: WEEKDAY_HEADER_COLOR.holiday },
  { name: '월', color: WEEKDAY_HEADER_COLOR.normal },
  { name: '화', color: WEEKDAY_HEADER_COLOR.normal },
  { name: '수', color: WEEKDAY_HEADER_COLOR.normal },
  { name: '목', color: WEEKDAY_HEADER_COLOR.normal },
  { name: '금', color: WEEKDAY_HEADER_COLOR.normal },
  { name: '토', color: WEEKDAY_HEADER_COLOR.saturday },
];

export default function MonthGrid({ days, dataMap, onSelectDate, onQuickAdd, showWeekend = true, onToggleEvent, onDeleteEvent, compact = false, selectedDate = null }: MonthGridProps) {
  const currentWeekdays = showWeekend ? ALL_WEEKDAYS : ALL_WEEKDAYS.slice(1, 6);
  const { showClass, showEvents, isMultiSelectMode, selectedEventIds, toggleEventSelection, openLinkViewerModal, selectedGroupId } = useAppStore();

  const displayDays = React.useMemo(() => {
    if (!showWeekend) {
      return days.filter((d) => !d.isSunday && !d.isSaturday);
    }
    return days;
  }, [days, showWeekend]);
  /** 달력 한 줄(한 주)씩. 기간 일정 막대는 주마다 따로 놓는다 (ROADMAP 13) */
  const weeks = React.useMemo(() => {
    const size = showWeekend ? 7 : 5;
    const out: CalendarDay[][] = [];
    for (let i = 0; i < displayDays.length; i += size) out.push(displayDays.slice(i, i + size));
    return out;
  }, [displayDays, showWeekend]);

  const { getLabelColor, eventLabels, labelsLoaded } = useLabels();
  const { holidays } = useGovHolidays();
  // 우리 학교 학사일정 (나이스 - 표시만, ROADMAP 4-4). 앞뒤 달의 날도 보이므로 그 달들까지
  const { byDate: schoolEvents } = useSchoolSchedule(days.map((d) => d.dateStr.slice(0, 7)));
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

  // 기간·반복으로 묶인 일정은 지우기 전에 어디까지 지울지 묻는다
  const { requestDelete, groupDeleteModal } = useGroupDelete({
    fId: selectedGroupId,
    deleteOne: onDeleteEvent,
  });
  // 일정을 끌어 다른 날짜 칸에 놓으면 그 날로 옮긴다 (마우스 화면에서만)
  const drop = useEventDropMove();

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

      {/* 한 주가 한 줄. 날짜 칸은 줄 높이를 다 차지하고(subgrid), 그 사이 줄에 기간 일정 막대를 놓는다:
          1줄 = 날짜·학사일정·수업 / 막대 줄들 / 마지막 줄 = 그날 일정. 막대가 칸을 건너 이어지도록 막대는 칸 밖(주 격자)에 있다. */}
      <div className="divide-y divide-slate-100">
      {weeks.map((week) => {
        const dayInfos = week.map((dayObj) => {
          const summary = dataMap[dayObj.dateStr] || {};
          const rawEvents = summary.eventList || [];
          // 공휴일 일정은 목록에서 빼고 날짜 옆 빨간 이름으로만 보여준다
          const { events: dayEvents, holidayName: holidayFromEvent } = splitHolidayEvents(rawEvents);
          // '달력' 속성을 켠 일정만 달력에 올린다 (V3 월간과 같은 규칙)
          const events = dayEvents.filter((ev: any) => isCalendarVisible(ev, eventLabels));
          return { dayObj, summary, events, holidayFromEvent };
        });
        const layout = showEvents
          ? layoutWeekBars(dayInfos.map((d) => ({ dateStr: d.dayObj.dateStr, events: d.events })), (ev) => eventDisplayContent(ev, eventLabels))
          : null;
        const lanes = layout?.lanes || 0;
        const currentMonthDates = new Set(week.filter((d) => d.isCurrentMonth).map((d) => d.dateStr));

        return (
        <div
          key={week[0].dateStr}
          data-month-week
          className={`grid ${showWeekend ? 'grid-cols-7' : 'grid-cols-5'} ${compact ? 'min-h-[64px] gap-y-[2px]' : 'min-h-[74px] gap-y-1'}`}
          style={{ gridTemplateRows: `auto${lanes ? ` repeat(${lanes}, auto)` : ''} 1fr` }}
        >
        {dayInfos.map(({ dayObj, summary, events: allEvents, holidayFromEvent }, col) => {
          const schedules = summary.schedules || {};

          const hasClasses = periodArray.some(p => schedules[p]?.subject?.trim() && schedules[p]?.subject?.toUpperCase() !== 'X');
          // 기간 일정 조각은 막대로 그렸으니 칸에는 나머지만
          const events = layout ? layout.rest[dayObj.dateStr] || [] : allEvents;
          const holidayName = dayObj.holidayName || holidays[dayObj.dateStr] || holidayFromEvent;
          // 토요일 파랑 / 일요일·공휴일 빨강 (lib/holiday의 공통 규칙)
          const tone = dayToneOf({ isSunday: dayObj.isSunday, isSaturday: dayObj.isSaturday, holidayName });

          return (
            <div
              key={dayObj.dateStr}
              data-today={dayObj.isToday ? 'true' : undefined}
              onClick={() => onSelectDate(dayObj.dateStr)}
              data-date={dayObj.dateStr}
              {...drop.targetProps(dayObj.dateStr)}
              style={{ gridColumn: col + 1, gridRow: '1 / -1', gridTemplateRows: 'subgrid' }}
              className={`${compact ? 'p-1' : 'p-2'} grid transition-all cursor-pointer group hover:brightness-98 min-w-0 overflow-hidden ${col > 0 ? 'border-l border-slate-100' : ''} ${
                !dayObj.isCurrentMonth ? 'bg-slate-50/40 opacity-40' : DAY_CELL_BG[tone]
              } ${selectedDate === dayObj.dateStr ? 'ring-2 ring-inset ring-primary' : dayObj.isToday ? 'ring-2 ring-inset ring-primary/40' : ''} ${drop.overDate === dayObj.dateStr ? DROP_TARGET_CLASS : ''}`}
              data-selected={selectedDate === dayObj.dateStr ? 'true' : undefined}
            >
              <div className="min-w-0" style={{ gridRow: 1 }}>
                {/* 자리가 모자라면 표식이 아랫줄로 내려간다. 날짜와 공휴일
                    이름을 가리는 것보다 한 줄 더 쓰는 편이 낫다. */}
                <div className={`flex flex-wrap items-center justify-between gap-x-1 gap-y-0.5 ${compact ? 'mb-0.5' : 'mb-1.5'}`}>
                  {/* 날짜 뒤에 공휴일 이름. 남는 자리를 다 쓰도록 min-w-0 flex-1 을 준다.
                      예전에는 max-w-[65px]로 묶어 두어 '대체공휴일'이 '대체공...'으로 잘렸다. */}
                  <div className="flex items-center gap-1 min-w-0">
                    <span
                      className={`text-xs font-black shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full ${
                        dayObj.isToday ? 'bg-primary text-white shadow-xs' : DAY_NUMBER_COLOR[tone]
                      }`}
                    >
                      {dayObj.day}
                    </span>
                    {/* 휴대폰에서는 날짜 옆에 둘 자리가 없어 아래 제 줄로 내린다.
                        여기까지 그리면 '개천절'이 '3 개…' 와 '개천절' 두 번 나온다. */}
                    {holidayName && !compact && <HolidayName name={holidayName} tier="month" />}
                  </div>

                  {/* 표식은 줄어들면 안 된다. 셋이 나란히 설 수 있으므로
                      사이를 좁혀 두고, 칸 밖으로 밀리지 않게 shrink-0을 준다. */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <JournalCountBadge
                      dateStr={dayObj.dateStr}
                      count={dataMap[dayObj.dateStr]?.journalCount || 0}
                      fId={selectedGroupId}
                    />
                    <EvalCountBadge dateStr={dayObj.dateStr} count={dataMap[dayObj.dateStr]?.evalCount || 0} />
                    <button
                      onClick={(e) => { e.stopPropagation(); onQuickAdd(dayObj.dateStr); }}
                      className="w-5 h-5 rounded hover:bg-slate-200 text-slate-400 hover:text-primary flex items-center justify-center transition-colors text-xs font-bold leading-none opacity-0 group-hover:opacity-100"
                      title="빠른 추가"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* 휴대폰에서는 공휴일 이름을 날짜 옆에 둘 자리가 없다.
                    53px 칸에서 '개천절'이 '개…'가 됐다. 제 줄로 내려 칸 너비를
                    다 쓰고, 그래도 길면 글자를 줄인다. */}
                {/* 학사일정은 제 줄 (날짜 옆은 공휴일 이름과 표식으로 이미 빠듯하다) */}
                {schoolEvents[dayObj.dateStr] && (
                  <div className={`w-full mb-0.5 flex min-w-0 ${compact ? 'justify-center' : ''}`}>
                    <SchoolEventName items={schoolEvents[dayObj.dateStr]} tier="month" />
                  </div>
                )}
                {holidayName && compact && (
                  <div
                    className="w-full mb-0.5 text-center overflow-hidden [container-type:inline-size]"
                    title={holidayName}
                  >
                    <span
                      className="font-bold text-red-600 whitespace-nowrap"
                      style={{ fontSize: fitToWidthFontSize(holidayName) }}
                    >
                      {holidayName}
                    </span>
                  </div>
                )}

                {/* 휴대폰에서는 과목 칩을 그리지 않는다 (ROADMAP 15, 2026-10-02).
                    53px 칸에 교시 여섯을 세로 글자로 세워도 읽기 어려웠고 줄 높이만 먹었다. 그날 수업은 날짜를 누르면
                    올라오는 그날 목록(MonthDaySheet)에 적는다. PC 칸은 그대로. */}

                {showClass && hasClasses && !compact && (
                  <div className="flex flex-nowrap gap-[1px] w-full mb-1.5 mt-0.5">
                    {periodArray.map((p) => {
                      const item = schedules[p];
                      const text = item?.subject?.trim() || '';

                      if (text && text.toUpperCase() !== 'X') {
                        // 예전에는 글자 수만 보고 단계를 골랐다. 칸이 얼마나 좁은지는
                        // 보지 않아서, 교시가 6~7개면 칩이 20px 남짓인데 16~18px 글자가
                        // 들어가 잘려 보였다. 칩 너비에 맞춰 줄어들게 한다.
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
                            className="flex-1 min-w-0 h-[20px] flex items-center justify-center border border-emerald-300 rounded-[3px] bg-emerald-50 text-emerald-700 font-bold overflow-hidden cursor-pointer hover:bg-emerald-200 transition-colors [container-type:inline-size]"
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
                      return (
                        <div
                          key={p}
                          title={`${p}교시`}
                          className="flex-1 min-w-0 h-[20px] flex items-center justify-center border border-slate-200 rounded-[3px] bg-slate-50"
                        />
                      );
                    })}
                  </div>
                )}

              </div>
                {showEvents && (
                /* 접지 않고 다 보여준다. 세 개만 두고 '+1개'로 줄이면 그 하나가
                   무엇인지 알 수 없어, 결국 날짜를 눌러 들어가 봐야 한다.
                   접어서 아낀 자리보다 잃는 것이 크다. 줄 높이가 날마다
                   달라지지만, 달력은 그날 무엇이 있는지 보려고 여는 것이다. */
                <div className={`min-w-0 ${compact ? 'space-y-[2px]' : 'space-y-1'}`} style={{ gridRow: lanes + 2 }}>
                  {events.map((ev) => {
                    // 라벨 해석은 lib/eventLabels 한 곳에서만 한다
                    const labelDef = resolveEventLabel(ev, eventLabels, { keepUnknown: !labelsLoaded });
                    const labelName = labelDef?.name || '';
                    const labelColor = labelDef ? getLabelColor(labelName) : null;
                    const forwardLabel = isForwardLabel(labelDef);

                    return (
                      <div
                        key={ev.id}
                        {...eventDragSourceProps(dayObj.dateStr, ev, drop.dragEnabled, drop.clearOver)}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isMultiSelectMode) {
                            toggleEventSelection(ev.id, dayObj.dateStr);
                          } else if (compact) {
                            // 휴대폰: 칸 안 일정은 작아 겨누기 어렵다 - 날짜를 누른 것으로 보고 그날 목록을 연다 (ROADMAP 15)
                            onSelectDate(dayObj.dateStr);
                          } else {
                            // 일정은 오른쪽 칸에서 고친다 (달력을 보면서)
                            openEntryPanel({
                              kind: 'event',
                              groupId: selectedGroupId,
                              dateStr: dayObj.dateStr,
                              entryId: String(ev.id),
                              initial: ev,
                            });
                          }
                        }}
                        style={
                          compact && labelColor && !ev.completed
                            ? { borderLeftWidth: '3px', borderLeftColor: labelColor.border }
                            : undefined
                        }
                        className={`group relative rounded ${BODY_TEXT.month} font-medium leading-tight transition-all border block hover:shadow-sm cursor-pointer ${
                          compact
                            ? 'px-1 py-[1px] truncate whitespace-nowrap [container-type:inline-size]'
                            : 'px-1.5 py-0.5 break-words'
                        } ${
                          selectedEventIds.includes(ev.id)
                            ? 'bg-primary/10 border border-primary text-primary'
                            : ev.completed
                            ? 'bg-slate-100 text-slate-400'
                            : 'bg-blue-50 text-blue-800 border border-blue-100'
                        }`}
                        title={drop.dragEnabled ? '누르면 고치기 · 끌어서 다른 날로 옮기기' : '클릭하여 상세 보기'}
                      >
                        {isMultiSelectMode && (
                          <input
                            type="checkbox"
                            checked={selectedEventIds.includes(ev.id)}
                            readOnly
                            className="inline-block align-middle mr-1 pointer-events-none"
                          />
                        )}
                        {/* 💡 유효한 라벨일 때만 렌더링, 클릭 시 완료 토글(이월 라벨이면 이월도 정지) */}
                        {/* 압축 모드에서는 라벨 이름을 적지 않는다. '달력'·'수업X'
                            같은 이름이 53px 칸의 절반을 먹어, 정작 무슨 일정인지가
                            두 글자밖에 안 남았다. 색은 왼쪽 띠로 남긴다. */}
                        {labelColor && !isMultiSelectMode && !compact && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleEvent(dayObj.dateStr, ev.id);
                            }}
                            title={forwardLabel ? '클릭하여 완료 처리 (이월 정지)' : '클릭하여 완료 처리'}
                            className="inline-block align-middle mr-1 text-2xs font-bold px-1.5 py-0.5 rounded shadow-2xs whitespace-nowrap cursor-pointer"
                            style={{
                              backgroundColor: ev.completed ? 'var(--color-slate-100)' : labelColor.bg,
                              color: ev.completed ? 'var(--color-slate-400)' : labelColor.text,
                              border: '1px solid ' + (ev.completed ? 'var(--color-slate-200)' : labelColor.border)
                            }}
                          >
                            {labelName}
                          </span>
                        )}
                        {/* 압축 모드에서는 칸 너비에 맞춰 글자를 줄인다. 긴 제목은
                            가장 작은 크기(7px)까지 줄어든 뒤 말줄임으로 잘린다.
                            '생활…' 두 글자보다 '생활기록부…' 다섯 글자가 낫다. */}
                        <span
                          className={`inline align-middle ${ev.completed ? 'line-through text-slate-400' : ''}`}
                          style={compact ? { fontSize: fitToWidthFontSize(eventDisplayContent(ev, eventLabels)) } : undefined}
                        >
                          {eventDisplayContent(ev, eventLabels)}
                        </span>

                        {(ev.linkedItems || []).length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openLinkViewerModal('event', dayObj.dateStr, ev.id);
                            }}
                            className="inline-flex align-middle ml-1 bg-yellow-100 text-yellow-800 text-2xs px-1 py-0.5 rounded font-bold border border-yellow-300 hover:bg-yellow-200 cursor-pointer"
                            title={`링크된 항목 ${(ev.linkedItems || []).length}개`}
                          >
                            🔗 {(ev.linkedItems || []).length}
                          </button>
                        )}

                        {!isMultiSelectMode && (
                          <EventItemActions
                            floating
                            onDelete={() => requestDelete(dayObj.dateStr, ev.id, ev)}
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
        {layout?.bars.map((bar) => {
          const first = bar.cells[0].ev;
          const labelDef = resolveEventLabel(first, eventLabels, { keepUnknown: !labelsLoaded });
          const labelName = labelDef?.name || '';
          // 휴대폰은 막대를 눌러도 그날 목록 (칸 안 일정과 같다)
          const openCell = (cell: BarCell) =>
            compact
              ? onSelectDate(cell.dateStr)
              : openEntryPanel({ kind: 'event', groupId: selectedGroupId, dateStr: cell.dateStr, entryId: String(cell.ev.id), initial: cell.ev });
          return (
            <PeriodBar
              key={`${bar.key}@${bar.start}`}
              bar={bar}
              labelName={labelName}
              labelColor={labelDef ? getLabelColor(labelName) : null}
              compact={compact}
              isMultiSelectMode={isMultiSelectMode}
              selectedEventIds={selectedEventIds}
              isCurrentMonth={(d) => currentMonthDates.has(d)}
              onOpen={openCell}
              onToggleSelect={(cell) => toggleEventSelection(cell.ev.id, cell.dateStr)}
              onOpenLinks={(cell) => openLinkViewerModal('event', cell.dateStr, cell.ev.id)}
              dragProps={(cell) => eventDragSourceProps(cell.dateStr, cell.ev, drop.dragEnabled, drop.clearOver)}
              dropProps={(d) => drop.targetProps(d)}
              dragEnabled={drop.dragEnabled}
              style={{ gridColumn: `${bar.start + 1} / span ${bar.len}`, gridRow: bar.lane + 2 }}
            />
          );
        })}
        </div>
        );
      })}
      </div>
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
    {drop.groupMoveModal}
    </>
  );
}