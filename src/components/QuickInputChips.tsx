// src/components/QuickInputChips.tsx
//
// 새 일정 빠른 입력 칩 (ROADMAP 11-1). 셈은 lib/quickInput, 값을 넣는 일은 일정 칸(EventDrawer)이 한다.
// 적는 대로 날짜·시각·라벨·반복을 알아보고 칩으로 보인다. 누르기 전에는 아무것도 바꾸지 않는다.
import React from 'react';
import { shortDateLabel } from '../lib/notices';
import type { QuickParse } from '../lib/quickInput';

const WEEKDAY = '일월화수목금토';

export interface QuickChip {
  key: string;
  icon: string;
  label: string;
  title: string;
  apply: () => void;
}

interface QuickInputChipsProps {
  chips: QuickChip[];
  /** 둘 이상이면 '모두 넣기' */
  onApplyAll?: () => void;
}

export default function QuickInputChips({ chips, onApplyAll }: QuickInputChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1" data-quick-chips>
      <span className="text-2xs font-black text-slate-400 mr-0.5">빠른 입력</span>
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.apply}
          title={c.title}
          data-quick-chip={c.key}
          className="px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 text-2xs font-bold hover:bg-indigo-100"
        >
          {c.icon} {c.label}
        </button>
      ))}
      {onApplyAll && chips.filter((c) => c.key !== 'recur').length > 1 && (
        <button
          type="button"
          onClick={onApplyAll}
          data-quick-chip="all"
          className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-2xs font-black hover:bg-indigo-700"
        >
          모두 넣기
        </button>
      )}
    </div>
  );
}

/** 칩 글자 */
export const quickLabels = {
  date: (date: string) => `${shortDateLabel(date)}에 넣기`,
  due: (date: string) => `기한 ${shortDateLabel(date)}`,
  time: (hhmm: string) => `${hhmm} 알림`,
  recur: (r: NonNullable<QuickParse['recur']>) =>
    `${r.biweekly ? '격주' : '매주'} ${r.days.map((d) => WEEKDAY[d]).join('·')} 반복 등록…`,
};
