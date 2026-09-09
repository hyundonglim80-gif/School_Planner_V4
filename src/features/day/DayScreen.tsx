//src/features/day/DayScreen.tsx

import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { formatDateStr, parseDateStr } from '../../lib/dateUtils';
import { useDayData } from '../../hooks/useDayData';
import DayEvents from './DayEvents';
import DaySchedule from './DaySchedule';
import DayJournal from './DayJournal';

export default function DayScreen() {
  const { currentDate, setCurrentDate, selectedGroupId, showClass } = useAppStore();

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
      {/* 날짜 네비게이션 헤더 */}{loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">데이터를 불러오는 중입니다...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 좌측 영역: 오늘 할 일(일정) & 기록 (수업 숨기면 12열, 아니면 5열) */}
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
            <DayJournal
              journals={journals}
              onAddJournal={addJournalEntry}
              onDeleteJournal={deleteJournalEntry}
              onUpdateJournal={updateJournalEntry}
              onReorderJournals={reorderJournals}
            />
          </div>

          {/* 우측 영역: 수업 및 시간표 (7열) - showClass에 따른 조건부 렌더링 */}
          {showClass && (
            <div className="lg:col-span-7 transition-all duration-300">
              <DaySchedule 
                schedules={schedules} 
                onSavePeriod={savePeriod} 
                onReorderPeriods={reorderPeriods}
                dateStr={dateStr}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
