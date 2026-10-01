// src/features/week/LastYearDay.tsx
//
// 작년 이맘때 (docs/ROADMAP.md 7) - 주간 요일 카드 아래에 작년 같은 요일의 일정·기록을 흐리게.
// 보기만 한다. 누르면 그날 하루 화면으로 가지 않게 막는다(카드를 누르면 올해 그날로 간다).
import React from 'react';
import { useLabels } from '../../hooks/useLabels';
import { useAppStore } from '../../store/useAppStore';
import { resolveEventLabel, eventDisplayContent } from '../../lib/eventLabels';
import { TABLE_ONLY_CONTENT } from '../../lib/entryTable';
import type { LastYearDay as LastYearDayData } from '../../hooks/useLastYearWeek';

interface Props {
  /** 작년 같은 요일 */
  lastDate: string;
  data?: LastYearDayData;
  loading: boolean;
  error: boolean;
}

/** 기록의 라벨 이름 (기록은 id로 저장한다 - 옛 기록은 이름일 수도) */
function journalLabelName(entry: any, journalLabels: Array<{ id: string; name: string }>): string {
  const keys = [...(entry.labelIds || []), ...(entry.label ? [entry.label] : [])];
  for (const key of keys) {
    const found = journalLabels.find((l) => l.id === key || l.name === key);
    if (found) return found.name;
  }
  return '';
}

export default function LastYearDay({ lastDate, data, loading, error }: Props) {
  const { eventLabels, getLabelColor, journalLabels, labelsLoaded } = useLabels();
  const showEvents = useAppStore((s) => s.showEvents);
  const [y, m, d] = lastDate.split('-').map(Number);
  const events = showEvents ? data?.events || [] : [];
  const journals = data?.journals || [];
  const empty = events.length === 0 && journals.length === 0;

  return (
    <div
      data-last-year={lastDate}
      onClick={(e) => e.stopPropagation()}
      className="mt-3 pt-2 border-t-2 border-dashed border-slate-200 opacity-60 hover:opacity-100 transition-opacity cursor-default"
    >
      <div className="text-2xs font-extrabold text-slate-400 mb-1.5" title={`${y}년 ${m}월 ${d}일 (작년 같은 주 같은 요일)`}>
        🕰️ 작년 {m}.{d}
      </div>
      {loading ? (
        <div className="text-2xs text-slate-300 pl-1">불러오는 중…</div>
      ) : error ? (
        <div className="text-2xs text-rose-400 pl-1">못 읽었습니다</div>
      ) : empty ? (
        <div className="text-2xs text-slate-300 pl-1">없음</div>
      ) : (
        <div className="space-y-1">
          {events.map((ev) => {
            const label = resolveEventLabel(ev, eventLabels, { keepUnknown: !labelsLoaded });
            const color = label ? getLabelColor(label.name) : null;
            const text = eventDisplayContent(ev, eventLabels);
            return (
              <div
                key={`ev-${ev.id}`}
                data-last-year-item="event"
                title={text}
                className="px-1.5 py-1 rounded-md border border-dashed border-slate-200 bg-white/60 text-xs leading-snug text-slate-600 break-words"
              >
                {color && (
                  <span
                    className="inline-block align-middle mr-1 text-2xs font-bold px-1 py-px rounded whitespace-nowrap"
                    style={{ backgroundColor: color.bg, color: color.text, border: '1px solid ' + color.border }}
                  >
                    {label!.name}
                  </span>
                )}
                <span className={`align-middle ${ev.completed ? 'line-through text-slate-400' : ''}`}>{text}</span>
              </div>
            );
          })}
          {journals.map((j) => {
            const labelName = journalLabelName(j, journalLabels);
            const body = j.content === TABLE_ONLY_CONTENT ? '' : (j.content || '').trim();
            const shown = body || ((j.tables || []).length > 0 ? '(표)' : '(첨부)');
            return (
              <div
                key={`jr-${j.id}`}
                data-last-year-item="journal"
                title={body || shown}
                className="px-1.5 py-1 rounded-md border border-dashed border-emerald-200 bg-emerald-50/40 text-xs leading-snug text-slate-600 break-words whitespace-pre-line line-clamp-3"
              >
                <span className="mr-1">📝</span>
                {labelName && <span className="mr-1 text-2xs font-bold text-emerald-700">[{labelName}]</span>}
                <span>{shown}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
