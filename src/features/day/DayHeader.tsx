import React from 'react';
import { formatDisplayDate, addDays, formatDateStr, isToday } from '../../lib/dateUtils';

interface DayHeaderProps {
  dateStr: string;
  onDateChange: (newDateStr: string) => void;
}

export default function DayHeader({ dateStr, onDateChange }: DayHeaderProps) {
  const display = formatDisplayDate(dateStr);
  const todayActive = isToday(dateStr);

  const handlePrevDay = () => onDateChange(addDays(dateStr, -1));
  const handleNextDay = () => onDateChange(addDays(dateStr, 1));
  const handleToday = () => onDateChange(formatDateStr(new Date()));

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-4 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
      {/* 날짜 탐색 버튼 및 메인 타이틀 */}
      <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={handlePrevDay}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-600 hover:bg-white hover:shadow-xs transition-all font-bold text-sm"
            title="이전 날"
          >
            ◀
          </button>
          <button
            onClick={handleToday}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              todayActive
                ? 'bg-primary text-white shadow-xs'
                : 'text-slate-600 hover:bg-white hover:shadow-xs'
            }`}
          >
            오늘
          </button>
          <button
            onClick={handleNextDay}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-600 hover:bg-white hover:shadow-xs transition-all font-bold text-sm"
            title="다음 날"
          >
            ▶
          </button>
        </div>

        <div className="flex items-center gap-2">
          <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
            {display.fullString}
          </h2>
          {display.isSunday && (
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-50 text-red-600 border border-red-100">
              일요일
            </span>
          )}
          {display.isSaturday && (
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-600 border border-blue-100">
              토요일
            </span>
          )}
        </div>
      </div>

      {/* 날짜 선택 인풋 피커 */}
      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
        <label className="text-xs text-slate-400 font-semibold">날짜 선택:</label>
        <input
          type="date"
          value={dateStr}
          onChange={(e) => {
            if (e.target.value) onDateChange(e.target.value);
          }}
          className="px-3 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer transition-all"
        />
      </div>
    </div>
  );
}
