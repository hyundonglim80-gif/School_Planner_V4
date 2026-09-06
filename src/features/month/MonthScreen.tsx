import React, { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getMonthCalendarDays, parseDateStr } from '../../lib/dateUtils';
import { useCalendarData } from '../../hooks/useCalendarData';
import MonthGrid from './MonthGrid';
import QuickAddModal from '../../components/QuickAddModal';
import { useState } from 'react';

export default function MonthScreen() {
  const { currentDate, setCurrentDate, setScope, selectedGroupId, mode, showWeekend } = useAppStore();
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

  const { dataMap, loading } = useCalendarData(dateStrings, selectedGroupId);

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
    <div className="animate-fade-in pb-12">{loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">월간 일정을 불러오는 중입니다...</p>
        </div>
      ) : (
        <MonthGrid
        isEditorMode={mode === "editor"}
        onQuickAdd={(date) => setQuickAddDate(date)}
          days={calendarDays}
          dataMap={dataMap}
          onSelectDate={handleSelectDate}
        />
      )}
          {quickAddDate && <QuickAddModal isOpen={true} onClose={() => setQuickAddDate(null)} dateStr={quickAddDate} />}
    </div>
  );
}
