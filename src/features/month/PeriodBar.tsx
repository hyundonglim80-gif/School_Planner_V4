// src/features/month/PeriodBar.tsx
//
// 월간 달력의 기간 일정 막대 (ROADMAP 13). 한 주 안에서 나란한 날의 조각을 한 막대로 그린다.
//
//   막대는 날짜 칸 밖(주 줄의 격자)에 있다. 그래서 칸을 누르는 것(그날 하루 화면)과 따로 논다.
//   막대 안은 날마다 한 조각씩 나눠 두어, 누르거나 끌면 **그날의 조각**을 고치거나 옮긴다(묶음이면 범위를 묻는다).
//   글은 그 위에 한 겹으로 얹는다(누르는 것은 아래 조각이 받는다).
import type React from 'react';
import type { WeekBar, BarCell } from '../../lib/periodBars';
import { periodIndexLabel, periodRangeLabel } from '../../lib/periodBars';
import { BODY_TEXT } from '../../lib/typeScale';

interface PeriodBarProps {
  bar: WeekBar;
  labelName: string;
  labelColor: { bg: string; text: string; border: string } | null;
  compact: boolean;
  isMultiSelectMode: boolean;
  selectedEventIds: string[];
  /** 그 날짜가 이 달인가 (앞뒤 달 날은 칸처럼 흐리게) */
  isCurrentMonth: (dateStr: string) => boolean;
  onOpen: (cell: BarCell) => void;
  onToggleSelect: (cell: BarCell) => void;
  onOpenLinks: (cell: BarCell) => void;
  /** 끌기 (조각마다) */
  dragProps: (cell: BarCell) => Record<string, unknown>;
  /** 놓을 자리 (막대 위에 놓아도 그날로) */
  dropProps: (dateStr: string) => Record<string, unknown>;
  dragEnabled: boolean;
  style?: React.CSSProperties;
}

/** 라벨이 없을 때의 막대 빛깔 (보통 일정 칩보다 한 단계 짙게 - 칸 바탕과 갈리게) */
const DEFAULT_COLOR = { bg: '#dbeafe', text: '#1e3a8a', border: '#bfdbfe' };
const DONE_BG = 'var(--color-slate-100)';

export default function PeriodBar({
  bar,
  labelName,
  labelColor,
  compact,
  isMultiSelectMode,
  selectedEventIds,
  isCurrentMonth,
  onOpen,
  onToggleSelect,
  onOpenLinks,
  dragProps,
  dropProps,
  dragEnabled,
  style,
}: PeriodBarProps) {
  const color = labelColor || DEFAULT_COLOR;
  const allDone = bar.cells.every((c) => !!c.ev.completed);
  const indexLabel = periodIndexLabel(bar.cells, bar.total);
  const range = periodRangeLabel(bar.cells);
  const radius = compact ? '3px' : '5px';

  return (
    <div
      data-period-bar={bar.key}
      className={`relative z-10 min-w-0 self-start ${compact ? 'h-[14px]' : ''}`}
      style={{
        ...style,
        // 기간의 첫날·끝날만 둥글고 안으로 들인다. 앞뒤 주(달)로 이어지면 칸 끝까지 닿아 이어 보인다.
        marginLeft: bar.startsPeriod ? (compact ? 2 : 4) : 0,
        marginRight: bar.endsPeriod ? (compact ? 2 : 4) : 0,
      }}
      title={`${labelName ? `[${labelName}] ` : ''}${bar.base} (${indexLabel}) · ${range}${bar.startsPeriod ? '' : ' · 앞에서 이어짐'}${bar.endsPeriod ? '' : ' · 뒤로 이어짐'}`}
    >
      {/* 날마다 한 조각: 누르기·끌기·고르기를 받는다 */}
      <div
        className="absolute inset-0 flex overflow-hidden border"
        style={{
          borderColor: allDone ? 'var(--color-slate-200)' : color.border,
          borderTopLeftRadius: bar.startsPeriod ? radius : 0,
          borderBottomLeftRadius: bar.startsPeriod ? radius : 0,
          borderTopRightRadius: bar.endsPeriod ? radius : 0,
          borderBottomRightRadius: bar.endsPeriod ? radius : 0,
          borderLeftWidth: bar.startsPeriod ? 1 : 0,
          borderRightWidth: bar.endsPeriod ? 1 : 0,
        }}
      >
        {bar.cells.map((cell) => {
          const selected = selectedEventIds.includes(cell.ev.id);
          const links = (cell.ev.linkedItems || []).length;
          return (
            <div
              key={cell.ev.id}
              data-period-cell={cell.dateStr}
              {...dragProps(cell)}
              {...dropProps(cell.dateStr)}
              onClick={(e) => {
                e.stopPropagation();
                if (isMultiSelectMode) onToggleSelect(cell);
                else onOpen(cell);
              }}
              className={`relative flex-1 min-w-0 cursor-pointer hover:brightness-95 ${selected ? 'ring-2 ring-inset ring-primary' : ''} ${
                isCurrentMonth(cell.dateStr) ? '' : 'opacity-40'
              }`}
              style={{ backgroundColor: cell.ev.completed ? DONE_BG : color.bg }}
              title={`${bar.base} (${cell.index}/${bar.total}) · ${Number(cell.dateStr.slice(5, 7))}.${Number(cell.dateStr.slice(8, 10))}${cell.ev.completed ? ' · 완료' : ''} - ${
                isMultiSelectMode ? '눌러서 고르기' : dragEnabled ? '누르면 그날 조각 고치기 · 끌어서 옮기기' : '누르면 그날 조각 고치기'
              }`}
            >
              {links > 0 && !compact && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenLinks(cell);
                  }}
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 z-20 bg-yellow-100 text-yellow-800 text-2xs leading-none px-1 py-0.5 rounded font-bold border border-yellow-300 hover:bg-yellow-200"
                  title={`링크된 항목 ${links}개`}
                >
                  🔗 {links}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {/* 글은 막대 전체에 한 줄로 (누르는 것은 아래 조각으로 지나간다) */}
      <div
        className={`relative pointer-events-none flex items-center gap-1 whitespace-nowrap overflow-hidden ${
          compact ? 'h-full px-1 text-2xs leading-none' : `px-1.5 py-0.5 ${BODY_TEXT.month} leading-tight`
        } font-bold`}
        style={{ color: allDone ? 'var(--color-slate-400)' : color.text }}
      >
        {!bar.startsPeriod && <span className="shrink-0 opacity-60">◂</span>}
        {labelName && !compact && (
          <span className="shrink-0 px-1 rounded bg-white/70 text-2xs font-bold" style={{ color: allDone ? 'var(--color-slate-400)' : color.text }}>
            {labelName}
          </span>
        )}
        <span className={`truncate ${allDone ? 'line-through' : ''}`}>{bar.base}</span>
        {!compact && <span className="shrink-0 text-2xs font-semibold opacity-70">{indexLabel}</span>}
        {!bar.endsPeriod && <span className="ml-auto shrink-0 opacity-60">▸</span>}
      </div>
    </div>
  );
}
