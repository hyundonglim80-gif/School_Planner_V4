import React from 'react';
import { useLabels } from '../../hooks/useLabels';

interface MemoFilterProps {
  currentFilter: string;
  onFilterChange: (filter: string) => void;
}

export default function MemoFilter({ currentFilter, onFilterChange }: MemoFilterProps) {
  // 라벨은 useLabels 한 곳에서만 읽는다. 여기서 직접 Firestore를 읽으면
  // V3가 localStorage에만 남긴 라벨과 오프라인 캐시 보정을 놓쳐,
  // 사용자 메모 라벨이 기본값으로 되돌아간다.
  const { memoLabels: labels } = useLabels();

  return (
    <div className="flex flex-wrap gap-2">
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