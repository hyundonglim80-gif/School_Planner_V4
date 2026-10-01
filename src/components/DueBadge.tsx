// src/components/DueBadge.tsx
//
// 일정 기한 표시 (ROADMAP 11-2): D-3 · D-day · 기한 2일 지남. 끝낸 일정·기한 없는 일정에는 없다. 셈은 lib/eventDue.
import React from 'react';
import { DUE_TONE_CLASS, dueBadge } from '../lib/eventDue';

interface DueBadgeProps {
  due: string;
  today: string;
  completed?: boolean;
  small?: boolean;
}

export default function DueBadge({ due, today, completed, small }: DueBadgeProps) {
  const badge = dueBadge(due, today, completed);
  if (!badge) return null;
  return (
    <span
      title={`기한 ${due}`}
      data-due-badge={badge.text}
      className={`inline-flex items-center align-middle mr-1.5 font-black rounded-md border whitespace-nowrap ${
        small ? 'text-2xs px-1 py-0.5' : 'text-xs px-1.5 py-0.5'
      } ${DUE_TONE_CLASS[badge.tone]}`}
    >
      ⏳ {badge.text}
    </span>
  );
}
