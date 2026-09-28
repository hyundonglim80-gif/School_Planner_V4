import React, { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getWeekDays, parseDateStr, addDays, formatDateStr } from '../../lib/dateUtils';
import { useCalendarData } from '../../hooks/useCalendarData';
import { useMinWidth } from '../../hooks/useMinWidth';
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

  /**
   * 넓은 화면(xl, 1280px 이상)에서는 요일이 한 줄로 서서 아래가 텅 빈다.
   * 그 자리에 다음 주를 한 줄 더 보여 준다. 폭 기준은 WeekGrid가 한 줄로
   * 서는 경계(xl)와 같다 - 두세 줄로 접히는 폭에서는 이번 주만 둔다.
   */
  const showNextWeek = useMinWidth(1280);
  const nextWeekDays = useMemo(() => {
    return getWeekDays(parseDateStr(addDays(formatDateStr(curDateObj), 7)));
  }, [curDateObj]);

  // 두 주를 한 번에 읽는다 (구독 하나)
  const dateStrings = useMemo(() => {
    const days = showNextWeek ? [...weekDays, ...nextWeekDays] : weekDays;
    return days.map(d => d.dateStr);
  }, [weekDays, nextWeekDays, showNextWeek]);

  const { dataMap, loading, toggleEventItem, deleteEventItem } = useCalendarData(dateStrings, selectedGroupId);

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

  const displayNextWeekDays = useMemo(
    () => (showWeekend ? nextWeekDays : nextWeekDays.filter((d) => !d.isWeekend)),
    [nextWeekDays, showWeekend]
  );

  const nextWeekLabel = useMemo(() => {
    if (nextWeekDays.length === 0) return '';
    const [, m1, d1] = nextWeekDays[0].dateStr.split('-');
    const [, m2, d2] = nextWeekDays[nextWeekDays.length - 1].dateStr.split('-');
    return `${Number(m1)}.${Number(d1)} ~ ${Number(m2)}.${Number(d2)}`;
  }, [nextWeekDays]);

  return (
    <div className="animate-fade-in pb-12">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">데이터를 불러오는 중...</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <WeekGrid
            onQuickAdd={(date) => setQuickAddDate(date)}
            days={displayWeekDays}
            dataMap={dataMap}
            onSelectDate={handleSelectDate}
            onToggleEvent={toggleEventItem}
            onDeleteEvent={deleteEventItem}
          />
          {showNextWeek && (
            <section aria-label="다음 주">
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="text-xs font-extrabold text-slate-500">다음 주</span>
                <span className="text-xs text-slate-400">{nextWeekLabel}</span>
                <div className="flex-1 border-t border-dashed border-slate-200" />
              </div>
              <WeekGrid
                onQuickAdd={(date) => setQuickAddDate(date)}
                days={displayNextWeekDays}
                dataMap={dataMap}
                onSelectDate={handleSelectDate}
                onToggleEvent={toggleEventItem}
                onDeleteEvent={deleteEventItem}
              />
            </section>
          )}
        </div>
      )}
      
      {quickAddDate && <QuickAddModal isOpen={true} onClose={() => setQuickAddDate(null)} dateStr={quickAddDate} />}
    </div>
  );
}