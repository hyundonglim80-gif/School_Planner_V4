import React, { useEffect, useState } from 'react';
import type { EventItem } from '../../hooks/useDayData';
import { useAppStore } from '../../store/useAppStore';
import { focusKey } from '../../lib/searchFocus';
import { useLabels } from '../../hooks/useLabels';
import { showToast } from '../../utils/toast';
import { formatDateStr } from '../../lib/dateUtils';
import { resolveEventLabelNames, eventDisplayContent } from '../../lib/eventLabels';
import { useGroupDelete } from '../../hooks/useGroupDelete';
import EventAlarmModal from '../../components/EventAlarmModal';
import EventItemActions from '../../components/EventItemActions';
import { openEntryPanel } from '../../components/EntryPanelHost';

interface DayEventsProps {
  events: EventItem[];
  onToggleEvent: (id: string) => Promise<void>;
  onDeleteEvent: (id: string) => Promise<void>;
  onUpdateEvent?: (id: string, updates: Partial<EventItem>) => Promise<void>;
  onForwardIncomplete?: () => Promise<number>;
  onReorderEvents?: (sourceIndex: number, targetIndex: number) => Promise<void>;
}

/**
 * 하루 화면의 일정 목록.
 *
 * 새로 쓰고 고치는 칸은 여기 없다. 메모·기록처럼 오른쪽 칸(EventDrawer)에서 한다.
 * 예전에는 목록 안에서 칸이 펼쳐졌는데, 주간·월간·년간의 팝업과 구성·저장 규칙이
 * 조금씩 달랐고, 칸이 목록을 밀어내 다른 일정을 보며 적기 어려웠다.
 */
export default function DayEvents({
  events,
  onToggleEvent,
  onDeleteEvent,
  onUpdateEvent,
  onReorderEvents,
}: DayEventsProps) {
  const { openLinkViewerModal, openLabelModal, currentDate, selectedGroupId, isMultiSelectMode, selectedEventIds, toggleEventSelection, closeEntryPanel } = useAppStore();
  const { eventLabels, getLabelColor, labelsLoaded } = useLabels();
  const formattedDate = formatDateStr(new Date(currentDate));

  // 오른쪽 칸에서 고치고 있는 일정. 목록에서 어느 것인지 짚어 준다.
  const panel = useAppStore((s) => s.entryPanel);
  const editingId =
    panel?.kind === 'event' && panel.dateStr === formattedDate && (panel.groupId || null) === (selectedGroupId || null)
      ? panel.entryId
      : undefined;

  const [isCollapsed, setIsCollapsed] = useState(false);

  // 검색에서 이 칸의 항목으로 '이동'해 오면 접혀 있던 칸을 펼친다.
  // 접힌 채로는 항목이 그려지지 않아 찾아 줄 수가 없다.
  const focusSection = useAppStore((s) => s.focusTarget?.section);
  useEffect(() => {
    if (focusSection === 'event') {
      setIsCollapsed(false);
    }
  }, [focusSection]);
  const [alarmTarget, setAlarmTarget] = useState<EventItem | null>(null);

  // 기간·반복으로 묶인 일정은 지우기 전에 어디까지 지울지 묻는다.
  const { requestDelete, groupDeleteModal } = useGroupDelete({
    fId: selectedGroupId,
    deleteOne: async (_dateStr, id) => {
      await onDeleteEvent(id);
      // 오른쪽 칸에서 고치던 일정이면 칸도 닫는다 (없는 일정을 붙들고 있지 않게)
      if (String(editingId) === String(id)) closeEntryPanel();
      showToast('🗑️ 일정을 삭제했습니다. 휴지통에서 복원할 수 있습니다.');
    },
  });

  const formatAlarmBadge = (time?: string) => {
    if (!time) return null;
    const d = new Date(time);
    if (isNaN(d.getTime())) return null;
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${h}:${min}`;
  };

  // 라벨 해석은 lib/eventLabels 한 곳에서만 한다. 화면마다 다르게 풀면 라벨 이름을
  // 바꿀 때 칩이 보이는 화면과 안 보이는 화면이 갈린다.
  const getEventLabelInfo = (event: EventItem) => {
    const names = resolveEventLabelNames(event, eventLabels, { keepUnknown: !labelsLoaded });
    return {
      names,
      labelDefs: names.map((name) => eventLabels.find((l) => l.name === name)),
      cleanContent: eventDisplayContent(event),
    };
  };

  const openCreate = () => openEntryPanel({ kind: 'event', groupId: selectedGroupId, dateStr: formattedDate });
  const startEditing = (event: EventItem) =>
    openEntryPanel({ kind: 'event', groupId: selectedGroupId, dateStr: formattedDate, entryId: String(event.id), initial: event });

  const deleteEditing = (id: string) => {
    requestDelete(formattedDate, id, events.find((e) => String(e.id) === String(id)));
  };

  return (
    <>
    <div className={`bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 flex flex-col ${isCollapsed ? '' : 'h-full'}`}>
      {/* 머리줄: ▼ 📅 일정 8 [+ 추가] ……… ⚙️  (기록 칸과 같은 배치) */}
      <div className={`flex items-center justify-between gap-2 ${isCollapsed ? '' : 'mb-4'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-slate-400 hover:text-slate-700 text-xs px-1 py-0.5 rounded hover:bg-slate-100 transition-colors"
            title={isCollapsed ? '펼치기' : '접기'}
          >
            {isCollapsed ? '▶' : '▼'}
          </button>
          <span className="text-xl">📅</span>
          <h3 className="text-base font-extrabold text-slate-800">일정</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {events.length}
          </span>
          {!isCollapsed && (
            <button
              onClick={openCreate}
              aria-label="일정 추가"
              title="일정 추가 (오른쪽 칸)"
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors shrink-0"
            >
              + 추가
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => openLabelModal('event')}
          className="w-7 h-7 flex items-center justify-center rounded-md text-sm text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
          title="일정 라벨 설정"
          aria-label="일정 라벨 설정"
        >
          ⚙️
        </button>
      </div>

      {!isCollapsed && (
        <>
      {/* 2열 카드 (휴대폰·PC 같다). 카드마다 위 줄에 순서(▲▼)·수정/삭제, 아래에 내용. */}
      <div className={`flex-1 overflow-y-auto pr-1 min-h-[110px] ${events.length > 0 ? 'grid grid-cols-2 gap-2 content-start' : ''}`}>
        {events.length > 0 ? (
          events.map((event, idx) => {
            const isEditing = editingId !== undefined && String(editingId) === String(event.id);
            const info = getEventLabelInfo(event);

            return (
              <div
                key={event.id}
                data-focus-key={focusKey.event(formattedDate, event.id)}
                onClick={() => {
                  if (isMultiSelectMode) toggleEventSelection(event.id, formattedDate);
                  else startEditing(event);
                }}
                title={isMultiSelectMode ? '' : '클릭하여 오른쪽 칸에서 수정'}
                className={`group flex flex-col gap-1.5 p-2.5 rounded-xl border shadow-2xs transition-all cursor-pointer min-w-0 ${
                  isMultiSelectMode ? 'hover:bg-slate-50' : ''
                } ${
                  selectedEventIds.includes(event.id) || isEditing
                    ? 'border-primary ring-1 ring-primary bg-primary/5'
                    : event.completed
                    ? 'bg-slate-50 border-slate-100 text-slate-400'
                    : 'bg-white border-slate-200/60 hover:border-slate-300 text-slate-800'
                }`}
              >
                {/* 위 줄: 순서 바꾸기 · 수정/삭제 */}
                {!isMultiSelectMode && (
                  <div className="flex items-center justify-between -mt-0.5">
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); if (idx > 0 && onReorderEvents) onReorderEvents(idx, idx - 1); }}
                        disabled={idx === 0}
                        className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-xs"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); if (idx < events.length - 1 && onReorderEvents) onReorderEvents(idx, idx + 1); }}
                        disabled={idx === events.length - 1}
                        className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-xs"
                      >
                        ▼
                      </button>
                    </div>
                    <EventItemActions
                      onEdit={() => startEditing(event)}
                      onDelete={() => deleteEditing(event.id)}
                    />
                  </div>
                )}

                <div className="min-w-0 pointer-events-auto">
                  <div className="leading-relaxed text-sm break-words">
                    {isMultiSelectMode && (
                      <input
                        type="checkbox"
                        checked={selectedEventIds.includes(event.id)}
                        readOnly
                        className="inline-block align-middle mr-1.5 pointer-events-none w-4 h-4 rounded text-primary border-slate-300"
                      />
                    )}

                    {/* 라벨 칩 (유효한 라벨만 렌더링): 클릭 시 완료 처리 (이월 속성 라벨이면 이월도 정지) */}
                    {info.names.length > 0 && info.names.map((name, i) => {
                      const color = getLabelColor(name);
                      const def = info.labelDefs[i];
                      const isForward = !!(def && (def.forward || (def as any).isForward));
                      return (
                        <span
                          key={name}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isMultiSelectMode) onToggleEvent(event.id);
                          }}
                          title={isMultiSelectMode ? '' : (isForward ? '클릭하여 완료 처리 (이월 정지)' : '클릭하여 완료 처리')}
                          className={`inline-block align-middle mr-1.5 text-xs font-bold px-2 py-0.5 rounded-md shadow-2xs whitespace-nowrap ${isMultiSelectMode ? '' : 'cursor-pointer'}`}
                          style={{
                            backgroundColor: event.completed ? '#f1f5f9' : color.bg,
                            color: event.completed ? '#94a3b8' : color.text,
                            border: '1px solid ' + (event.completed ? '#e2e8f0' : color.border)
                          }}
                        >
                          {name}
                        </span>
                      );
                    })}

                    {/* 일정 알림(⏰): 알림이 설정된 일정에만 표시 (없는 일정까지 아이콘이 보이면
                        전부 알림이 걸린 것처럼 헷갈리므로, 알림 추가는 오른쪽 일정 칸의 버튼으로) */}
                    {!isMultiSelectMode && event.time && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setAlarmTarget(event); }}
                        title="클릭하여 알림 시간 변경"
                        className={`inline-flex items-center align-middle mr-1.5 text-xs font-bold px-1.5 py-0.5 rounded-md border transition-colors cursor-pointer ${
                          event.alarmTriggered
                            ? 'text-slate-400 bg-slate-100 border-slate-200'
                            : 'text-primary bg-blue-50 border-blue-200'
                        }`}
                      >
                        ⏰ {formatAlarmBadge(event.time)}
                      </button>
                    )}

                    {/* 본문 텍스트: 항목을 클릭하면 오른쪽 칸에서 고친다 */}
                    <span
                      className={`inline align-middle ${
                        event.completed ? 'line-through text-slate-400' : ''
                      }`}
                    >
                      {info.cleanContent}
                    </span>

                    {/* 연결된 링크 */}
                    {event.linkedItems && event.linkedItems.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openLinkViewerModal('event', formattedDate, event.id); }}
                        className="inline-flex align-middle ml-1 bg-yellow-100 text-yellow-800 text-xs px-1.5 py-0.5 rounded font-bold border border-yellow-300 hover:bg-yellow-200 transition-colors cursor-pointer items-center gap-1"
                        title={`링크된 항목 ${event.linkedItems.length}개`}
                      >
                        🔗 {event.linkedItems.length}
                      </button>
                    )}

                    {/* 첨부파일 블록 */}
                    {event.attachments && event.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5 block">
                        {event.attachments.map((att, idx) => (
                          att.type === 'image' ? (
                            <a key={idx} href={att.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="block w-8 h-8 rounded overflow-hidden border border-slate-200">
                              <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                            </a>
                          ) : (
                            <a key={idx} href={att.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="block px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 truncate max-w-[150px] hover:bg-slate-100 transition-colors" title={att.name}>
                              📎 {att.name}
                            </a>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center text-slate-400 text-xs">
            <span className="text-3xl mb-2">📋</span>
            <p>오늘의 일정이 없습니다.</p>
            <p className="mt-1 text-slate-400">+ 추가 버튼을 눌러 일정을 넣어 보세요.</p>
          </div>
        )}
      </div>
        </>
      )}
    </div>

    {alarmTarget && (
      <EventAlarmModal
        isOpen={true}
        onClose={() => setAlarmTarget(null)}
        dateStr={formattedDate}
        initialTime={alarmTarget.time}
        onSave={async (time) => {
          if (onUpdateEvent) await onUpdateEvent(alarmTarget.id, { time, alarmTriggered: false });
        }}
        onTurnOff={async () => {
          if (onUpdateEvent) await onUpdateEvent(alarmTarget.id, { time: '', alarmTriggered: false });
        }}
      />
    )}

    {/* 기간·반복으로 묶인 일정을 지울 때: 이 날만 / 이 날부터 / 전부 */}
    {groupDeleteModal}

    </>
  );
}