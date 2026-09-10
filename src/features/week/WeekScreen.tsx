import React, { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getWeekDays, parseDateStr, addDays, formatDateStr } from '../../lib/dateUtils';
import { useCalendarData } from '../../hooks/useCalendarData';
import WeekGrid from './WeekGrid';
import QuickAddModal from '../../components/QuickAddModal';
import { useState } from 'react';

export default function WeekScreen() {
  const { currentDate, setCurrentDate, setScope, selectedGroupId, showWeekend } = useAppStore();
  const [quickAddDate, setQuickAddDate] = useState<string | null>(null);

  const curDateObj = useMemo(() => new Date(currentDate), [currentDate]);
  const weekDays = useMemo(() => {
    return getWeekDays(curDateObj);
  }, [curDateObj]);

  const dateStrings = useMemo(() => {
    return weekDays.map(d => d.dateStr);
  }, [weekDays]);

  const { dataMap, loading, toggleEventItem } = useCalendarData(dateStrings, selectedGroupId);

  const rangeLabel = useMemo(() => {
    if (weekDays.length === 0) return '';
    const first = weekDays[0].dateStr;
    const last = weekDays[weekDays.length - 1].dateStr;
    const [y, m, d1] = first.split('-');
    const [, , d2] = last.split('-');
    return `${y}년 ${Number(m)}월 (${Number(m)}.${Number(d1)} ~ ${Number(d2)})`;
  }, [weekDays]);

  const handlePrevWeek = () => {
    const curStr = formatDateStr(curDateObj);
    setCurrentDate(parseDateStr(addDays(curStr, -7)));
  };

  const handleNextWeek = () => {
    const curStr = formatDateStr(curDateObj);
    setCurrentDate(parseDateStr(addDays(curStr, 7)));
  };

  const handleThisWeek = () => {
    setCurrentDate(new Date());
  };

  const handleSelectDate = (dateStr: string) => {
    setCurrentDate(parseDateStr(dateStr));
    setScope('day');
  };

  const displayWeekDays = useMemo(() => {
    if (!showWeekend) {
      return weekDays.filter(d => !d.isWeekend);
    }
    return weekDays;
  }, [weekDays, showWeekend]);

  return (
    <div className="animate-fade-in pb-12">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">데이터를 불러오는 중...</p>
        </div>
      ) : (
        <WeekGrid
          onQuickAdd={(date) => setQuickAddDate(date)}
          days={displayWeekDays}
          dataMap={dataMap}
          onSelectDate={handleSelectDate}
          onToggleEvent={toggleEventItem}
        />
      )}
      
      {quickAddDate && <QuickAddModal isOpen={true} onClose={() => setQuickAddDate(null)} dateStr={quickAddDate} />}
    </div>
  );
}