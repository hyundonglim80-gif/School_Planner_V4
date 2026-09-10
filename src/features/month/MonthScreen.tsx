import React, { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getMonthCalendarDays, parseDateStr } from '../../lib/dateUtils';
import { useCalendarData } from '../../hooks/useCalendarData';
import MonthGrid from './MonthGrid';
import QuickAddModal from '../../components/QuickAddModal';
import { useState } from 'react';

export default function MonthScreen() {
  const { currentDate, setCurrentDate, setScope, selectedGroupId, showWeekend } = useAppStore();
  const [quickAddDate, setQuickAddDate] = useState<string | null>(null);

  const curDateObj = useMemo(() => new Date(currentDate), [currentDate]);
  const year = curDateObj.getFullYear();
  const month = curDateObj.getMonth() + 1;

  const calendarDays = useMemo(() => {
    return getMonthCalendarDays(year, month);
  }, [year, month]);

  const dateStrings = useMemo(() => {
    return calendarDays.map(d => d.dateStr);
  }, [calendarDays]);

  const { dataMap, loading, toggleEventItem } = useCalendarData(dateStrings, selectedGroupId);

  const handlePrevMonth = () => {
    const prev = new Date(year, month - 2, 1);
    setCurrentDate(prev);
  };

  const handleNextMonth = () => {
    const next = new Date(year, month, 1);
    setCurrentDate(next);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const handleSelectDate = (dateStr: string) => {
    setCurrentDate(parseDateStr(dateStr));
    setScope('day');
  };

  return (
    <div className="animate-fade-in pb-12">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">데이터를 불러오는 중...</p>
        </div>
      ) : (
        <MonthGrid
          onQuickAdd={(date) => setQuickAddDate(date)}
          days={calendarDays}
          dataMap={dataMap}
          onSelectDate={handleSelectDate}
          showWeekend={showWeekend}
          onToggleEvent={toggleEventItem}
        />
      )}
      
      {quickAddDate && <QuickAddModal isOpen={true} onClose={() => setQuickAddDate(null)} dateStr={quickAddDate} />}
    </div>
  );
}