//src/features/day/DayScreen.tsx

import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { formatDateStr, parseDateStr } from '../../lib/dateUtils';
import { useDayData } from '../../hooks/useDayData';
import { useTimetableTemplate } from '../../hooks/useTimetableTemplate';
import DayEvents from './DayEvents';
import DaySchedule from './DaySchedule';
import DayJournal from './DayJournal';

export default function DayScreen() {
  const { currentDate, setCurrentDate, selectedGroupId, showClass, showEvents } = useAppStore();
  const { templates, currentTemplateName } = useTimetableTemplate();
  const maxPeriods = templates[currentTemplateName]?.names.length || 6;

  const dateStr = formatDateStr(new Date(currentDate));

  const {
    eventList,
    schedules,
    journals,
    loading,
    addEventItem,
    toggleEventItem,
    deleteEventItem,
    updateEventItem,
    reorderEvents,
    savePeriod,
    addJournalEntry,
    deleteJournalEntry,
    updateJournalEntry,
    reorderJournals,
    reorderPeriods,
    forwardIncompleteEvents,
  } = useDayData(dateStr, selectedGroupId);

  const handleDateChange = (newDateStr: string) => {
    setCurrentDate(parseDateStr(newDateStr));
  };

  return (
    <div className="animate-fade-in pb-12">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">데이터를 불러오는 중입니다...</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* 일정과 수업을 둘 다 끄면 윗칸 자체를 걷어낸다(빈 칸이 남아 기록이 밀리지 않게) */}
          {/* 수업·일정을 나란히 두는 기준은 본문 폭 720px (창 폭 768px 무렵).
              모니터 절반(약 940px)에서도 둘이 옆으로 선다. 창 폭이 아니라 본문 폭(@container)으로
              재므로, 오른쪽 메모·기록 칸이 열려 본문이 좁아지면 위아래로 쌓는다. */}
          {(showEvents || showClass) && (
          <div className="grid grid-cols-1 @min-[720px]:grid-cols-12 gap-6">
            {/* 상단 왼쪽: 수업 및 시간표 - showClass에 따른 조건부 렌더링.
                주간·월간·년간이 모두 수업을 먼저 보여 주므로 하루도 수업을 앞에 둔다. */}
            {showClass && (
              <div className={`${showEvents ? '@min-[720px]:col-span-7' : '@min-[720px]:col-span-12'} transition-all duration-300`}>
                <DaySchedule 
                  schedules={schedules} 
                  onSavePeriod={savePeriod} 
                  onReorderPeriods={reorderPeriods}
                  dateStr={dateStr}
                  maxPeriods={maxPeriods}
                />
              </div>
            )}
            {/* 상단 오른쪽: 오늘 할 일(일정) - showEvents에 따른 조건부 렌더링.
                둘 다 켜져 있으면 5:7로 나누고, 한쪽만 켜져 있으면 남은 쪽이 12열을 다 쓴다. */}
            {showEvents && (
            <div className={`${showClass ? '@min-[720px]:col-span-5' : '@min-[720px]:col-span-12'} flex flex-col gap-6 transition-all duration-300`}>
              <DayEvents
                events={eventList}
                onAddEvent={addEventItem}
                onToggleEvent={toggleEventItem}
                onDeleteEvent={deleteEventItem}
                onUpdateEvent={updateEventItem}
                onForwardIncomplete={forwardIncompleteEvents}
                onReorderEvents={reorderEvents}
              />
            </div>
            )}
          </div>
          )}

          {/* 하단 영역: 기록 (메모 페이지 스타일로 가로로 넓게 카드형 배치) */}
          <div className="w-full">
            <DayJournal
              journals={journals}
              onDeleteJournal={deleteJournalEntry}
              onReorderJournals={reorderJournals}
            />
          </div>
        </div>
      )}
    </div>
  );
}
