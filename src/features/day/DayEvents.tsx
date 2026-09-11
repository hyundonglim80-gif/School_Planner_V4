import React, { useState, useRef } from 'react';
import type { EventItem, Attachment } from '../../hooks/useDayData';
import { useAppStore } from '../../store/useAppStore';
import { useLabels } from '../../hooks/useLabels';
import { uploadFile, uploadImage } from '../../utils/uploadHelper';
import { auth } from '../../lib/firebase';
import { showToast } from '../../utils/toast';
import { formatDateStr } from '../../lib/dateUtils';
import DetailEditModal from '../../components/DetailEditModal';

interface DayEventsProps {
  events: EventItem[];
  onAddEvent: (content: string, options?: Partial<EventItem>) => Promise<void>;
  onToggleEvent: (id: string) => Promise<void>;
  onDeleteEvent: (id: string) => Promise<void>;
  onUpdateEvent?: (id: string, updates: Partial<EventItem>) => Promise<void>;
  onForwardIncomplete?: () => Promise<number>;
  onReorderEvents?: (sourceIndex: number, targetIndex: number) => Promise<void>;
}

export default function DayEvents({
  events,
  onAddEvent,
  onToggleEvent,
  onDeleteEvent,
  onUpdateEvent,
  onForwardIncomplete,
  onReorderEvents,
}: DayEventsProps) {
  const [newText, setNewText] = useState('');
  const [newLabels, setNewLabels] = useState<string[]>([]);
  const [newAttachments, setNewAttachments] = useState<Attachment[]>([]);
  const [newLinkedItems, setNewLinkedItems] = useState<any[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);

  const { openLinkerModal, openLinkViewerModal, currentDate, isMultiSelectMode, selectedEventIds, toggleEventSelection, googleAccessToken } = useAppStore();
  const { eventLabels, getLabelColor, getLabel } = useLabels();
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editLabel, setEditLabel] = useState<string | undefined>(undefined);

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<{ dateStr: string; itemId: string; initialData: any } | null>(null);
  const formattedDate = formatDateStr(new Date(currentDate));

  const getEventLabelInfo = (event: EventItem) => {
    let names: string[] = [];
    if (event.label) {
      names = event.label.split(',').map(l => l.trim()).filter(Boolean);
    } else if (event.labelIds && event.labelIds.length > 0) {
      const found = eventLabels.filter(l => event.labelIds!.includes(l.id));
      names = found.map(f => f.name);
    } else {
      const match = event.content.match(/^\[(.*?)\]\s*(.*)$/);
      if (match) {
        names = [match[1].trim()];
      }
    }

    // 💡 통합 라벨 관리에 존재하는(삭제되지 않은) 라벨만 필터링
    const validNames = names.filter(name => eventLabels.some(l => l.name === name));

    const labelDefs = validNames.map(name => eventLabels.find(l => l.name === name));

    let cleanContent = event.content;
    if (names.length === 1 && cleanContent.startsWith(`[${names[0]}]`)) {
      cleanContent = cleanContent.replace(new RegExp(`^\\[${names[0]}\\]\\s*`), '');
    }

    return { names: validNames, labelDefs, cleanContent }; // validNames 반환
  };

  // 라벨이 붙어 있어 라벨 칩 클릭으로 완료 처리할 수 있는 일정들
  const completableEvents = events.filter((e) => getEventLabelInfo(e).names.length > 0);
  const completedCount = completableEvents.filter((e) => e.completed).length;

  const startEditing = (event: EventItem) => {
    const info = getEventLabelInfo(event);
    setEditingId(event.id);
    setEditText(info.cleanContent);
    setEditLabel(info.names.length > 0 ? info.names.join(',') : undefined);
  };

  const saveEditing = async (id: string) => {
    if (!editText.trim()) {
      await onDeleteEvent(id);
      setEditingId(null);
      return;
    }
    if (onUpdateEvent) {
      await onUpdateEvent(id, {
        content: editText.trim(),
        label: editLabel || undefined,
      });
    }
    setEditingId(null);
  };

  const handleEditLabelToggle = (labelName: string) => {
    setEditLabel(prev => {
      const currentLabels = prev ? prev.split(',').filter(Boolean) : [];
      if (currentLabels.includes(labelName)) {
        const next = currentLabels.filter(l => l !== labelName);
        return next.length > 0 ? next.join(',') : undefined;
      } else {
        return [...currentLabels, labelName].join(',');
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim() && newAttachments.length === 0) return;
    try {
      setSubmitting(true);
      const labelStr = newLabels.length > 0 ? newLabels.join(',') : undefined;
      await onAddEvent(newText.trim(), {
        label: labelStr,
        attachments: newAttachments,
        linkedItems: newLinkedItems
      });
      setNewText('');
      setNewLabels([]);
      setNewAttachments([]);
      setNewLinkedItems([]);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLabelToggle = (labelName: string) => {
    setNewLabels(prev => 
      prev.includes(labelName) ? prev.filter(l => l !== labelName) : [...prev, labelName]
    );
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const user = auth.currentUser;
    if (!user) return alert('로그인이 필요합니다.');
    
    setUploadingFiles(true);
    try {
      const uploaded: Attachment[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isImage = file.type.startsWith('image/');
        const url = isImage 
          ? await uploadImage(file, user.uid)
          : await uploadFile(file, user.uid);
        
        uploaded.push({
          name: file.name,
          url,
          type: isImage ? 'image' : 'document'
        });
      }
      setNewAttachments(prev => [...prev, ...uploaded]);
    } catch (err: any) {
      alert('파일 업로드 에러: ' + err.message);
    } finally {
      setUploadingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (idx: number) => {
    setNewAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const openLinker = () => {
    openLinkerModal('manual', formattedDate, undefined, undefined, (links) => {
      setNewLinkedItems(prev => [...prev, ...links]);
    });
  };

  return (
    <>
    <div className={`bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 flex flex-col ${isCollapsed ? '' : 'h-full'}`}>
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${isCollapsed ? '' : 'mb-4'}`}>
        <div className="flex items-center gap-2">
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
          {completableEvents.length > 0 && (
            <span className="text-xs font-bold text-primary ml-1">
              ({completedCount}/{completableEvents.length} 완료)
            </span>
          )}
        </div>
        
        {!isCollapsed && !isFormOpen && (
          <button
            onClick={() => setIsFormOpen(true)}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
          >
            + 새 일정
          </button>
        )}
      </div>

      {!isCollapsed && (
        <>
      {isFormOpen && (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4 flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {eventLabels.map(l => {
            const color = getLabelColor(l.name);
            const isSelected = newLabels.includes(l.name);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => handleLabelToggle(l.name)}
                className={`px-2 py-1 text-xs font-bold rounded-lg transition-all border ${isSelected ? 'ring-2 ring-primary ring-offset-1 shadow-xs' : 'opacity-70 hover:opacity-100'}`}
                style={{
                  backgroundColor: color.bg,
                  color: color.text,
                  borderColor: color.border
                }}
              >
                {l.name}
              </button>
            );
          })}
        </div>
        
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 relative">
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSubmit(e as any);
              }
            }}
            placeholder="새로운 일정을 추가하세요..."
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder-slate-400 transition-all"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-200/60 rounded-xl transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={(!newText.trim() && newAttachments.length === 0) || submitting || uploadingFiles}
              className="px-4 py-1.5 bg-primary hover:bg-blue-600 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-xs hover:shadow-sm transition-all"
            >
              저장
            </button>
          </div>
        </form>
      </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[160px]">
        {events.length > 0 ? (
          events.map((event, idx) => {
            const isEditing = editingId === event.id;
            const info = getEventLabelInfo(event);

            if (isEditing) {
              const currentEditLabels = editLabel ? editLabel.split(',').filter(Boolean) : [];
              return (
                <div
                  key={event.id}
                  className="p-3.5 rounded-xl border border-primary/50 bg-blue-50/30 flex flex-col gap-3 shadow-xs transition-all"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-500 mr-1">라벨:</span>
                    {eventLabels.map((l) => {
                      const isSelected = currentEditLabels.includes(l.name);
                      const c = getLabelColor(l.name);
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => handleEditLabelToggle(l.name)}
                          className={`px-2.5 py-1 text-[16.5px] font-bold rounded-lg transition-all border ${isSelected ? 'ring-2 ring-primary ring-offset-1 shadow-xs' : 'opacity-70 hover:opacity-100 bg-white text-slate-600 border-slate-200'}`}
                          style={isSelected ? { backgroundColor: c.bg, color: c.text, borderColor: c.border } : {}}
                        >
                          {l.name}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEditing(event.id);
                        if (e.key === 'Escape') setEditingId(null);
                        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                          e.preventDefault();
                          saveEditing(event.id);
                        }
                      }}
                      className="flex-1 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => saveEditing(event.id)}
                      className="px-2.5 py-1.5 bg-primary text-white text-xs font-bold rounded-lg hover:bg-blue-600 transition-colors shrink-0"
                    >
                      저장
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="px-2 py-1.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-200 transition-colors shrink-0"
                    >
                      취소
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={event.id}
                onClick={() => {
                  if (isMultiSelectMode) toggleEventSelection(event.id, formattedDate);
                }}
                className={`group flex items-start justify-between p-3 rounded-xl border transition-all ${
                  isMultiSelectMode ? 'cursor-pointer hover:bg-slate-50' : ''
                } ${
                  selectedEventIds.includes(event.id)
                    ? 'border-primary ring-1 ring-primary bg-primary/5'
                    : event.completed
                    ? 'bg-slate-50 border-slate-100 text-slate-400'
                    : 'bg-white border-slate-200/60 hover:border-slate-300 text-slate-800'
                }`}
              >
                <div className="flex-1 min-w-0 pointer-events-auto flex items-start">
                  {!isMultiSelectMode && (
                    <div className="flex flex-col items-center gap-0.5 shrink-0 px-0.5 mr-1.5 mt-0.5">
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
                  )}

                  <div className="leading-relaxed text-sm break-words flex-1">
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
                          className={`inline-block align-middle mr-1.5 text-[16.5px] font-bold px-2 py-0.5 rounded-md shadow-2xs whitespace-nowrap ${isMultiSelectMode ? '' : 'cursor-pointer'}`}
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

                    {/* 본문 텍스트: 클릭 시 상세 확인 팝업, 더블클릭 시 빠른 인라인 수정 */}
                    <span
                      onClick={(e) => {
                        if (isMultiSelectMode) return;
                        setDetailItem({ dateStr: formattedDate, itemId: event.id, initialData: event });
                      }}
                      onDoubleClick={() => !isMultiSelectMode && startEditing(event)}
                      className={`inline align-middle ${!isMultiSelectMode ? 'cursor-pointer' : ''} ${
                        event.completed ? 'line-through text-slate-400' : ''
                      }`}
                      title={isMultiSelectMode ? '' : '클릭하여 상세 보기 (더블클릭하여 빠른 수정)'}
                    >
                      {info.cleanContent}
                    </span>

                    {/* 연결된 링크 */}
                    {event.linkedItems && event.linkedItems.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openLinkViewerModal('event', formattedDate, event.id); }}
                        className="inline-flex align-middle ml-1 bg-yellow-100 text-yellow-800 text-[15px] px-1.5 py-0.5 rounded font-bold border border-yellow-300 hover:bg-yellow-200 transition-colors cursor-pointer items-center gap-1"
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
                            <a key={idx} href={att.url} target="_blank" rel="noreferrer" className="block w-8 h-8 rounded overflow-hidden border border-slate-200">
                              <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                            </a>
                          ) : (
                            <a key={idx} href={att.url} target="_blank" rel="noreferrer" className="block px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[13.5px] text-slate-500 truncate max-w-[80px]" title={att.name}>
                              📎 {att.name}
                            </a>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 ml-2 mt-0.5">
                  <button
                    type="button"
                    onClick={() => openLinkerModal('event', formattedDate, event.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 p-1 rounded hover:bg-slate-100 text-xs transition-all"
                    title="링크 연결"
                  >
                    🔗
                  </button>
                  <button
                    type="button"
                    onClick={() => startEditing(event)}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 p-1 rounded hover:bg-slate-100 text-xs transition-all"
                    title="수정"
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await onDeleteEvent(event.id);
                      showToast('휴지통으로 이동되었습니다.');
                    }}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 p-1 rounded hover:bg-slate-100 text-xs transition-all"
                    title="삭제"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center text-slate-400 text-xs">
            <span className="text-3xl mb-2">📋</span>
            <p>오늘의 일정이 없습니다.</p>
            <p className="mt-1 text-slate-400">+ 새 일정 버튼을 눌러 추가해보세요.</p>
          </div>
        )}
      </div>
        </>
      )}
    </div>

    {detailItem && (
      <DetailEditModal
        isOpen={true}
        onClose={() => setDetailItem(null)}
        type="event"
        dateStr={detailItem.dateStr}
        itemId={detailItem.itemId}
        initialData={detailItem.initialData}
      />
    )}
    </>
  );
}