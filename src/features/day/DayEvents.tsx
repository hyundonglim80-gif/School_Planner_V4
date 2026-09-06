import React, { useState } from 'react';
import type { EventItem } from '../../hooks/useDayData';
import { useAppStore } from '../../store/useAppStore';
import { useLabels } from '../../hooks/useLabels';

interface DayEventsProps {
  events: EventItem[];
  onAddEvent: (content: string) => Promise<void>;
  onToggleEvent: (id: string) => Promise<void>;
  onDeleteEvent: (id: string) => Promise<void>;
  onForwardIncomplete?: () => Promise<number>;
}

export default function DayEvents({
  events,
  onAddEvent,
  onToggleEvent,
  onDeleteEvent,
  onForwardIncomplete,
}: DayEventsProps) {
  const [newText, setNewText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const { mode } = useAppStore();
  const { eventLabels, getLabelColor, getLabel } = useLabels();
  const [showLabelDropdown, setShowLabelDropdown] = useState(false);

  const completedCount = events.filter(e => e.completed).length;
  const progressPercent = events.length > 0 ? Math.round((completedCount / events.length) * 100) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim() || submitting) return;

    try {
      setSubmitting(true);
      await onAddEvent(newText.trim());
      setNewText('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLabelSelect = (labelName: string) => {
    setNewText((prev) => `[${labelName}] ${prev}`);
    setShowLabelDropdown(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 flex flex-col h-full">
      {/* 타이틀 및 진행도 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">📌</span>
          <h3 className="text-base font-extrabold text-slate-800">일정</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {events.length}
          </span>
          {events.length > 0 && (
            <span className="text-xs font-bold text-primary ml-1">
              ({completedCount}/{events.length} 완료)
            </span>
          )}
        </div>
      </div>

      {/* 진행 바 */}
      {events.length > 0 && (
        <div className="w-full h-1.5 bg-slate-100 rounded-full mb-4 overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300 rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* 새 할일 입력 폼 */}
      {mode === 'editor' && (
        <div className="relative mb-4">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowLabelDropdown(!showLabelDropdown)}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all flex items-center justify-center shrink-0"
              title="라벨 선택"
            >
              🏷️
            </button>
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="[라벨] 할 일 입력..."
              className="flex-1 px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder-slate-400 transition-all"
            />
            <button
              type="submit"
              disabled={!newText.trim() || submitting}
              className="px-4 py-2 bg-primary hover:bg-blue-600 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-xs hover:shadow-sm transition-all"
            >
              추가
            </button>
          </form>

          {/* 라벨 드롭다운 메뉴 */}
          {showLabelDropdown && (
            <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 shadow-xl rounded-xl p-2 z-50 flex flex-wrap gap-1.5 w-[280px]">
              {eventLabels.map(l => {
                const color = getLabelColor(l.name);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => handleLabelSelect(l.name)}
                    className="px-2 py-1 text-xs font-bold rounded-lg transition-all hover:opacity-80"
                    style={{ backgroundColor: color.bg, color: color.text, border: '1px solid ' + color.border }}
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 할 일 목록 */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[160px]">
        {events.length > 0 ? (
          events.map((event) => {
            const hasLabel = !!event.label;
            const labelColor = hasLabel ? getLabelColor(event.label!) : null;
            const labelDef = hasLabel ? getLabel(event.label!) : null;
            const isCompletable = labelDef ? !!labelDef.forward : true;

            return (
              <div
                key={event.id}
                className={`group flex items-center justify-between p-3 rounded-xl border transition-all ${
                  event.completed
                    ? 'bg-slate-50 border-slate-100 text-slate-400'
                    : 'bg-white border-slate-200/60 hover:border-slate-300 text-slate-800'
                }`}
              >
                <label className={`flex items-center gap-3 flex-1 min-w-0 ${isCompletable ? 'cursor-pointer' : ''}`}>
                  {isCompletable && (
                    <input
                      type="checkbox"
                      checked={!!event.completed}
                      onChange={() => onToggleEvent(event.id)}
                      className="w-4 h-4 rounded text-primary focus:ring-primary border-slate-300 cursor-pointer accent-primary shrink-0"
                    />
                  )}
                  
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {hasLabel && labelColor && (
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap"
                        style={{
                          backgroundColor: event.completed ? '#f1f5f9' : labelColor.bg,
                          color: event.completed ? '#94a3b8' : labelColor.text,
                          border: '1px solid ' + (event.completed ? '#e2e8f0' : labelColor.border)
                        }}
                      >
                        {event.label}
                      </span>
                    )}
                    <span className={`text-sm break-words leading-relaxed ${event.completed ? 'line-through' : ''}`}>
                      {event.content}
                    </span>
                  </div>
                </label>

                <button
                  onClick={() => onDeleteEvent(event.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 p-1 rounded-md hover:bg-slate-100 text-xs transition-all shrink-0 ml-2"
                  title="삭제"
                >
                  ✕
                </button>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center text-slate-400 text-xs">
            <span className="text-3xl mb-2">🎯</span>
            <p>오늘 예정된 할 일이 없습니다.</p>
            <p className="mt-1 text-slate-400">위 입력창에서 등록하거나, 라벨 아이콘을 클릭해보세요.</p>
          </div>
        )}
      </div>
    </div>
  );
}
