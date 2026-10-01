// src/features/week/LastYearDay.tsx
//
// 작년 이맘때 (docs/ROADMAP.md 7) - 주간 요일 카드 아래에 작년 같은 요일의 일정·기록을 흐리게.
// 항목을 누르면 고르고(체크), 주간 화면 위 '올해로 가져오기'가 올해 이 요일로 복사한다(7-2).
// 이 칸을 눌러도 하루 화면으로 가지 않게 막는다(카드를 누르면 올해 그날로 간다).
import React from 'react';
import { useLabels } from '../../hooks/useLabels';
import { useAppStore } from '../../store/useAppStore';
import { resolveEventLabel, eventDisplayContent } from '../../lib/eventLabels';
import { eventContentOf } from '../../lib/eventText';
import { TABLE_ONLY_CONTENT } from '../../lib/entryTable';
import { isImportableJournal, pickKey, type ImportPick } from '../../lib/lastYearImport';
import type { LastYearDay as LastYearDayData } from '../../hooks/useLastYearWeek';

interface Props {
  /** 작년 같은 요일 */
  lastDate: string;
  /** 올해 이 요일 (가져갈 날짜) */
  toDate: string;
  data?: LastYearDayData;
  loading: boolean;
  error: boolean;
  /** 올해 그날 이미 있는 일정 글 - 같은 글은 '올해 있음'으로 두고 고르지 않는다 */
  existingEventTexts: string[];
  picked: Record<string, ImportPick>;
  onTogglePick: (pick: ImportPick) => void;
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

/** 항목 한 줄의 모양. 고른 것은 진하게, 나머지는 흐리게(마우스를 올리면 진하게). */
const rowClass = (picked: boolean, tone: 'event' | 'journal') =>
  `flex items-start gap-1.5 px-1.5 py-1 rounded-md border text-xs leading-snug text-slate-600 break-words transition-opacity ${
    picked
      ? 'opacity-100 border-amber-300 bg-amber-50 ring-1 ring-amber-200'
      : `opacity-60 hover:opacity-100 border-dashed ${tone === 'event' ? 'border-slate-200 bg-white/60' : 'border-emerald-200 bg-emerald-50/40'}`
  }`;

export default function LastYearDay({ lastDate, toDate, data, loading, error, existingEventTexts, picked, onTogglePick }: Props) {
  const { eventLabels, getLabelColor, journalLabels, labelsLoaded } = useLabels();
  const showEvents = useAppStore((s) => s.showEvents);
  const [y, m, d] = lastDate.split('-').map(Number);
  const events = showEvents ? data?.events || [] : [];
  const journals = data?.journals || [];
  const empty = events.length === 0 && journals.length === 0;
  const existing = new Set(existingEventTexts);

  return (
    <div
      data-last-year={lastDate}
      onClick={(e) => e.stopPropagation()}
      className="mt-3 pt-2 border-t-2 border-dashed border-slate-200 cursor-default"
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
            const already = existing.has(eventContentOf(ev));
            const key = pickKey('event', lastDate, ev.id);
            const body = (
              <span className="min-w-0">
                {color && (
                  <span
                    className="inline-block align-middle mr-1 text-2xs font-bold px-1 py-px rounded whitespace-nowrap"
                    style={{ backgroundColor: color.bg, color: color.text, border: '1px solid ' + color.border }}
                  >
                    {label!.name}
                  </span>
                )}
                <span className={`align-middle ${ev.completed ? 'line-through text-slate-400' : ''}`}>{text}</span>
              </span>
            );
            if (already) {
              return (
                <div key={key} data-last-year-item="event" data-already title={`${text} - 올해 이 날에 같은 일정이 있습니다`} className={rowClass(false, 'event')}>
                  {body}
                  <span className="ml-auto shrink-0 text-2xs font-bold text-slate-400 whitespace-nowrap">올해 있음</span>
                </div>
              );
            }
            return (
              <label key={key} data-last-year-item="event" title={`${text} - 골라서 올해로 가져오기`} className={`${rowClass(!!picked[key], 'event')} cursor-pointer`}>
                <input
                  type="checkbox"
                  checked={!!picked[key]}
                  onChange={() => onTogglePick({ kind: 'event', fromDate: lastDate, toDate, item: ev })}
                  aria-label={`작년 일정 고르기: ${text}`}
                  className="mt-0.5 shrink-0 accent-amber-500"
                />
                {body}
              </label>
            );
          })}
          {journals.map((j) => {
            const labelName = journalLabelName(j, journalLabels);
            const text = j.content === TABLE_ONLY_CONTENT ? '' : (j.content || '').trim();
            const hasTables = (j.tables || []).length > 0;
            const shown = text || (hasTables ? '(표)' : '(첨부)');
            const key = pickKey('journal', lastDate, j.id);
            // 알림장·출석부가 만든 기록과 첨부만 있는 기록은 가져오지 않는다 (lib/lastYearImport)
            const importable = isImportableJournal(j) && (!!text || hasTables);
            const body = (
              <span className="min-w-0 whitespace-pre-line line-clamp-3">
                <span className="mr-1">📝</span>
                {labelName && <span className="mr-1 text-2xs font-bold text-emerald-700">[{labelName}]</span>}
                <span>{shown}</span>
              </span>
            );
            if (!importable) {
              return (
                <div
                  key={key}
                  data-last-year-item="journal"
                  title={`${text || shown} - ${isImportableJournal(j) ? '첨부만 있는 기록은' : '알림장·출석부가 만든 기록은'} 가져오지 않습니다`}
                  className={rowClass(false, 'journal')}
                >
                  {body}
                </div>
              );
            }
            return (
              <label key={key} data-last-year-item="journal" title={`${text || shown} - 골라서 올해로 가져오기`} className={`${rowClass(!!picked[key], 'journal')} cursor-pointer`}>
                <input
                  type="checkbox"
                  checked={!!picked[key]}
                  onChange={() => onTogglePick({ kind: 'journal', fromDate: lastDate, toDate, item: j })}
                  aria-label={`작년 기록 고르기: ${shown.split('\n')[0]}`}
                  className="mt-0.5 shrink-0 accent-amber-500"
                />
                {body}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
