import React, { useState, useEffect } from 'react';

const DEFAULT_LABELS = ['긴급', '중요', '학급운영', '학부모상담', '수업준비', '행정업무', '개인'];

interface MemoFilterProps {
  currentFilter: string;
  onFilterChange: (filter: string) => void;
}

export default function MemoFilter({ currentFilter, onFilterChange }: MemoFilterProps) {
  const [labels, setLabels] = useState<string[]>(DEFAULT_LABELS);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('workCalendar_memoLabels');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setLabels(parsed.map((l: any) => typeof l === 'string' ? l : l.name));
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  return (
    <div className="flex flex-wrap gap-2 mb-6">
      <button 
        onClick={() => onFilterChange('전체')} 
        className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
          currentFilter === '전체' 
            ? 'bg-slate-800 text-white shadow-md' 
            : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
        }`} 
      >
        전체 보기
      </button>
      {labels.map(label => (
        <button 
          key={label}
          onClick={() => onFilterChange(label)}
          className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
            currentFilter === label 
              ? 'bg-blue-600 text-white shadow-md' 
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
