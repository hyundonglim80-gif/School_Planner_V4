import React from 'react';

interface WeekHeaderProps {
  rangeLabel: string;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onThisWeek: () => void;
}

export default function WeekHeader({
  rangeLabel,
  onPrevWeek,
  onNextWeek,
  onThisWeek,
}: WeekHeaderProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-4 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={onPrevWeek}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-600 hover:bg-white hover:shadow-xs transition-all font-bold text-sm"
            title="이전 주"
          >
            ◀
          </button>
          <button
            onClick={onThisWeek}
            className="px-3 py-1 rounded-lg text-xs font-bold text-slate-600 hover:bg-white hover:shadow-xs transition-all"
          >
            이번 주
          </button>
          <button
            onClick={onNextWeek}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-600 hover:bg-white hover:shadow-xs transition-all font-bold text-sm"
            title="다음 주"
          >
            ▶
          </button>
        </div>

        <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
          {rangeLabel}
        </h2>
      </div>

      <div className="text-xs text-slate-400 font-medium">
        요일 카드를 클릭하면 해당 일자의 <strong className="text-primary font-bold">하루</strong> 화면으로 바로 이동합니다.
      </div>
    </div>
  );
}
