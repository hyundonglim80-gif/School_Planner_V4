import React, { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getWeekDays, parseDateStr, addDays, formatDateStr } from '../../lib/dateUtils';
import { useCalendarData } from '../../hooks/useCalendarData';
import WeekGrid from './WeekGrid';
import QuickAddModal from '../../components/QuickAddModal';
import { useState } from 'react';

export default function WeekScreen() {
  const { currentDate, setCurrentDate, setScope, selectedGroupId, mode, showWeekend } = useAppStore();
  const [quickAddDate, setQuickAddDate] = useState<string | null>(null);

  const curDateObj = useMemo(() => new Date(currentDate), [currentDate]);

  const weekDays = useMemo(() => {
    return getWeekDays(curDateObj);
  }, [curDateObj]);

  const dateStrings = useMemo(() => {
    return weekDays.map(d => d.dateStr);
  }, [weekDays]);

  const { dataMap, loading } = useCalendarData(dateStrings, selectedGroupId);

  const rangeLabel = useMemo(() => {
    if (weekDays.length === 0) return '';
    const first = weekDays[0].dateStr;
    const last = weekDays[weekDays.length - 1].dateStr;
    const [y, m, d1] = first.split('-');
    const [, , d2] = last.split('-');
    return `${y}년 ${Number(m)}월 주간 (${Number(m)}.${Number(d1)} ~ ${Number(d2)})`;
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
    <div className="animate-fade-in pb-12">{loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">주간 시간표 및 일정을 불러오는 중입니다...</p>
        </div>
      ) : (
        <WeekGrid
          isEditorMode={mode === "editor"}
          onQuickAdd={(date) => setQuickAddDate(date)}
          days={displayWeekDays}
          dataMap={dataMap}
          onSelectDate={handleSelectDate}
        />
      )}
          {quickAddDate && <QuickAddModal isOpen={true} onClose={() => setQuickAddDate(null)} dateStr={quickAddDate} />}
    </div>
  );
}
