import React, { useState, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import {
  getAcademicYear,
  getAcademicMonths,
  getMonthCalendarDays,
  parseDateStr,
} from '../../lib/dateUtils';

const ALL_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export default function YearScreen() {
  const { currentDate, setCurrentDate, setScope, semesterFilter, showWeekend } = useAppStore();

  const curDateObj = useMemo(() => new Date(currentDate), [currentDate]);
  const defaultAcademicYear = useMemo(() => getAcademicYear(curDateObj), [curDateObj]);

  const months = useMemo(() => {
    const list = getAcademicMonths(defaultAcademicYear);
    if (semesterFilter === 'all') return list;
    return list.filter((m) => m.semester === semesterFilter);
  }, [defaultAcademicYear, semesterFilter]);

  const currentWeekdays = useMemo(() => {
    return showWeekend ? ALL_WEEKDAYS : ALL_WEEKDAYS.slice(1, 6);
  }, [showWeekend]);

  const handleDateClick = (dateStr: string) => {
    setCurrentDate(new Date(dateStr));
    setScope('day');
  };

  return (
    <div className="animate-fade-in pb-12">
      {/* 12개월 미니 캘린더 그리드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {months.map((mInfo) => {
          const days = getMonthCalendarDays(mInfo.year, mInfo.month);
          const displayDays = showWeekend ? days : days.filter(d => !d.isSunday && !d.isSaturday);

          return (
            <div
              key={`${mInfo.year}-${mInfo.month}`}
              className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 overflow-hidden flex flex-col"
            >
              {/* 월 헤더 */}
              <div className="text-center font-black text-slate-800 text-lg mb-3 flex items-center justify-center gap-2">
                <span>{mInfo.month}월</span>
                <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-lg">
                  {mInfo.semester}학기
                </span>
              </div>

              {/* 요일 헤더 */}
              <div className={`grid ${showWeekend ? 'grid-cols-7' : 'grid-cols-5'} gap-1 mb-2`}>
                {currentWeekdays.map((wd, i) => (
                  <div
                    key={wd}
                    className={`text-center text-[10px] font-bold pb-1 border-b ${
                      wd === '일' ? 'text-red-500 border-red-100' :
                      wd === '토' ? 'text-blue-500 border-blue-100' :
                      'text-slate-400 border-slate-100'
                    }`}
                  >
                    {wd}
                  </div>
                ))}
              </div>

              {/* 날짜 그리드 */}
              <div className={`grid ${showWeekend ? 'grid-cols-7' : 'grid-cols-5'} gap-1`}>
                {displayDays.map((d, i) => {
                  if (!d) {
                    return <div key={`empty-${i}`} className="h-8" />;
                  }

                  const isToday = d.dateStr === new Date().toISOString().split('T')[0];
                  const isSelected = d.dateStr === currentDate.split('T')[0];

                  return (
                    <button
                      key={d.dateStr}
                      onClick={() => handleDateClick(d.dateStr)}
                      className={`
                        h-8 flex items-center justify-center text-xs font-semibold rounded-lg transition-all
                        ${isToday ? 'bg-primary text-white shadow-md ring-2 ring-primary/30 font-black' : ''}
                        ${!isToday && isSelected ? 'bg-slate-800 text-white shadow-sm' : ''}
                        ${!isToday && !isSelected ? 'text-slate-600 hover:bg-slate-100' : ''}
                        ${!isToday && !isSelected && (d.isSunday || d.isSaturday) ? 'text-red-500 bg-red-50/30' : ''}
                      `}
                    >
                      {d.day}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
