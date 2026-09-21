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
          {(showEvents || showClass) && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* 상단 좌측 영역: 오늘 할 일(일정) - showEvents에 따른 조건부 렌더링.
                둘 다 켜져 있으면 5:7로 나누고, 한쪽만 켜져 있으면 남은 쪽이 12열을 다 쓴다. */}
            {showEvents && (
            <div className={`${showClass ? 'lg:col-span-5' : 'lg:col-span-12'} flex flex-col gap-6 transition-all duration-300`}>
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

            {/* 상단 우측 영역: 수업 및 시간표 - showClass에 따른 조건부 렌더링 */}
            {showClass && (
              <div className={`${showEvents ? 'lg:col-span-7' : 'lg:col-span-12'} transition-all duration-300`}>
                <DaySchedule 
                  schedules={schedules} 
                  onSavePeriod={savePeriod} 
                  onReorderPeriods={reorderPeriods}
                  dateStr={dateStr}
                  maxPeriods={maxPeriods}
                />
              </div>
            )}
          </div>
          )}

          {/* 하단 영역: 기록 (메모 페이지 스타일로 가로로 넓게 카드형 배치) */}
          <div className="w-full">
            <DayJournal
              journals={journals}
              onAddJournal={addJournalEntry}
              onDeleteJournal={deleteJournalEntry}
              onUpdateJournal={updateJournalEntry}
              onReorderJournals={reorderJournals}
            />
          </div>
        </div>
      )}
    </div>
  );
}
