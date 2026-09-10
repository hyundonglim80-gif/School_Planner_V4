import React, { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';

const DEFAULT_LABELS = ['긴급', '중요', '업무', '개인', '기타'];

interface MemoFilterProps {
  currentFilter: string;
  onFilterChange: (filter: string) => void;
}

export default function MemoFilter({ currentFilter, onFilterChange }: MemoFilterProps) {
  const [labels, setLabels] = useState<string[]>(DEFAULT_LABELS);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLabels(DEFAULT_LABELS);
      return;
    }

    const docRef = doc(db, 'users', user.uid, 'settings', 'labels');
    const unsub = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (Array.isArray(data.memoLabels) && data.memoLabels.length > 0) {
          setLabels(data.memoLabels.map((l: any) => (typeof l === 'string' ? l : l.name)));
          return;
        }
      }
      setLabels(DEFAULT_LABELS);
    }, (error) => {
      console.error('Failed to fetch memo labels:', error);
      setLabels(DEFAULT_LABELS);
    });

    return () => unsub();
  }, [auth.currentUser?.uid]); // 계정이 바뀔 때마다 올바르게 재구독

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