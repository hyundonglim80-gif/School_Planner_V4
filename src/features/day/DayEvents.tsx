import React, { useState, useRef } from 'react';
import type { EventItem, Attachment } from '../../hooks/useDayData';
import { useAppStore } from '../../store/useAppStore';
import { useLabels } from '../../hooks/useLabels';
import { uploadFile, uploadImage } from '../../utils/uploadHelper';
import { auth } from '../../lib/firebase';

interface DayEventsProps {
  events: EventItem[];
  onAddEvent: (content: string, options?: Partial<EventItem>) => Promise<void>;
  onToggleEvent: (id: string) => Promise<void>;
  onDeleteEvent: (id: string) => Promise<void>;
  onUpdateEvent?: (id: string, updates: Partial<EventItem>) => Promise<void>;
  onForwardIncomplete?: () => Promise<number>;
}

export default function DayEvents({
  events,
  onAddEvent,
  onToggleEvent,
  onDeleteEvent,
  onUpdateEvent,
  onForwardIncomplete,
}: DayEventsProps) {
  const [newText, setNewText] = useState('');
  const [newLabels, setNewLabels] = useState<string[]>([]);
  const [newAttachments, setNewAttachments] = useState<Attachment[]>([]);
  const [newLinkedItems, setNewLinkedItems] = useState<any[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const { openLinkerModal, currentDate } = useAppStore();
  const { eventLabels, getLabelColor, getLabel } = useLabels();

  // 수정(Edit) 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editLabel, setEditLabel] = useState<string | undefined>(undefined);
  const [editLabelDropdown, setEditLabelDropdown] = useState(false);

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const formattedDate = new Date(currentDate).toISOString().split('T')[0];

  // 라벨 정보 및 클린 텍스트 추출 헬퍼
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
    
    const labelDefs = names.map(name => eventLabels.find(l => l.name === name));
    const isCompletable = labelDefs.some(def => def && (def.forward || (def as any).isForward));
    
    let cleanContent = event.content;
    if (names.length === 1 && cleanContent.startsWith(`[${names[0]}]`)) {
      cleanContent = cleanContent.replace(new RegExp(`^\\[${names[0]}\\]\\s*`), '');
    }
    
    return { names, labelDefs, isCompletable, cleanContent };
  };

  // 완료 속성 라벨을 가진 항목들 판별
  const completableEvents = events.filter((e) => {
    const info = getEventLabelInfo(e);
    return info.isCompletable;
  });
  const completedCount = completableEvents.filter((e) => e.completed).length;
  const progressPercent = completableEvents.length > 0 ? Math.round((completedCount / completableEvents.length) * 100) : 0;

  const startEditing = (event: EventItem) => {
    const info = getEventLabelInfo(event);
    setEditingId(event.id);
    setEditText(info.cleanContent);
    setEditLabel(info.names.length > 0 ? info.names.join(',') : undefined);
    setEditLabelDropdown(false);
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
      alert('파일 업로드 실패: ' + err.message);
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

  const handleRemoveLink = (idx: number) => {
    setNewLinkedItems(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className={`bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 flex flex-col ${isCollapsed ? '' : 'h-full'}`}>
      {/* 타이틀 및 진행도 */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${isCollapsed ? '' : 'mb-4'}`}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-slate-400 hover:text-slate-700 text-xs px-1 py-0.5 rounded hover:bg-slate-100 transition-colors"
            title={isCollapsed ? '일정 펼치기' : '일정 접기'}
          >
            {isCollapsed ? '▶' : '▼'}
          </button>
          <span className="text-xl">📌</span>
          <h3 className="text-base font-extrabold text-slate-800">일정</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {events.length}
          </span>
          {completableEvents.length > 0 && (
            <span className="text-xs font-bold text-primary ml-1">
              ({completedCount}/{completableEvents.length} 완료)
            </span>
          )}
          <div className="flex items-center gap-1 ml-1">
            <button
              type="button"
              onClick={() => openLinkerModal('event', formattedDate)}
              className="px-2 py-0.5 bg-yellow-50 text-yellow-700 border border-yellow-300 rounded-md text-[10px] font-bold hover:bg-yellow-100 transition-colors"
              title="일정에 링크 연결"
            >
              +링크
            </button>
          </div>
        </div>

        {!isCollapsed && !isFormOpen && (
          <button
            onClick={() => setIsFormOpen(true)}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
          >
            +
          </button>
        )}
      </div>

      {!isCollapsed && (
        <>

      {/* 진행 바 (완료 속성 라벨 일정이 있을 때만 표시) */}
      {completableEvents.length > 0 && (
        <div className="w-full h-1.5 bg-slate-100 rounded-full mb-4 overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300 rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* 새 할일 입력 폼 */}
      {isFormOpen && (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4 flex flex-col gap-2">
        {/* 라벨 선택 버튼 나열 */}
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

        {/* 텍스트 입력 및 버튼들 */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 relative">
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="일정 내용 입력..."
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder-slate-400 transition-all"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-200/60 rounded-xl transition-colors"
            >
              닫기
            </button>
            <button
              type="submit"
              disabled={(!newText.trim() && newAttachments.length === 0) || submitting || uploadingFiles}
              className="px-4 py-1.5 bg-primary hover:bg-blue-600 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-xs hover:shadow-sm transition-all"
            >
              추가
            </button>
          </div>
        </form>
      </div>
      )}

      {/* 할 일 목록 */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[160px]">
        {events.length > 0 ? (
          events.map((event) => {
            const isEditing = editingId === event.id;
            const info = getEventLabelInfo(event);

            if (isEditing) {
              const editColor = editLabel ? getLabelColor(editLabel) : null;
              return (
                <div
                  key={event.id}
                  className="p-2.5 rounded-xl border border-primary/50 bg-blue-50/30 flex flex-col gap-2 shadow-xs transition-all"
                >
                  <div className="flex items-center gap-2">
                    {/* 편집 시 라벨 선택 드롭다운 토글 버튼 */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setEditLabelDropdown(!editLabelDropdown)}
                        className="px-2 py-1 text-xs font-bold rounded-md shadow-2xs flex items-center gap-1 border"
                        style={
                          editColor
                            ? { backgroundColor: editColor.bg, color: editColor.text, borderColor: editColor.border }
                            : { backgroundColor: '#f1f5f9', color: '#64748b', borderColor: '#cbd5e1' }
                        }
                      >
                        <span>{editLabel || '라벨 선택'}</span>
                        <span className="text-[10px]">▼</span>
                      </button>

                      {editLabelDropdown && (
                        <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 shadow-xl rounded-xl p-2 z-50 flex flex-wrap gap-1.5 w-[240px]">
                          <button
                            type="button"
                            onClick={() => { setEditLabel(undefined); setEditLabelDropdown(false); }}
                            className="px-2 py-1 text-xs rounded border border-slate-200 text-slate-500 hover:bg-slate-100"
                          >
                            라벨 없음
                          </button>
                          {eventLabels.map((l) => {
                            const c = getLabelColor(l.name);
                            return (
                              <button
                                key={l.id}
                                type="button"
                                onClick={() => { setEditLabel(l.name); setEditLabelDropdown(false); }}
                                className="px-2 py-1 text-xs font-bold rounded hover:opacity-80"
                                style={{ backgroundColor: c.bg, color: c.text, border: '1px solid ' + c.border }}
                              >
                                {l.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEditing(event.id);
                        if (e.key === 'Escape') setEditingId(null);
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
                className={`group flex items-center justify-between p-3 rounded-xl border transition-all ${
                  event.completed && info.isCompletable
                    ? 'bg-slate-50 border-slate-100 text-slate-400'
                    : 'bg-white border-slate-200/60 hover:border-slate-300 text-slate-800'
                }`}
              >
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  {/* 1. 라벨 배지 (왼쪽에 가장 먼저 표시!) */}
                  {info.names.length > 0 && (
                    <div className="flex gap-1 shrink-0">
                      {info.names.map(name => {
                        const color = getLabelColor(name);
                        return (
                          <span
                            key={name}
                            className="text-[11px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap shadow-2xs"
                            style={{
                              backgroundColor: (event.completed && info.isCompletable) ? '#f1f5f9' : color.bg,
                              color: (event.completed && info.isCompletable) ? '#94a3b8' : color.text,
                              border: '1px solid ' + ((event.completed && info.isCompletable) ? '#e2e8f0' : color.border)
                            }}
                          >
                            {name}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* 2. 체크박스 (완료 속성 라벨일 때만 표시, 그 외에는 완전 삭제!) */}
                  {info.isCompletable && (
                    <input
                      type="checkbox"
                      checked={!!event.completed}
                      onChange={() => onToggleEvent(event.id)}
                      className="w-4 h-4 rounded text-primary focus:ring-primary border-slate-300 cursor-pointer accent-primary shrink-0"
                      title="완료 체크"
                    />
                  )}

                  {/* 3. 일정 내용 및 첨부파일 */}
                  <div className="flex flex-col flex-1 min-w-0">
                    <span
                      onClick={() => info.isCompletable && onToggleEvent(event.id)}
                      onDoubleClick={() => startEditing(event)}
                      className={`text-sm break-words leading-relaxed ${info.isCompletable ? 'cursor-pointer' : ''} ${
                        event.completed && info.isCompletable ? 'line-through text-slate-400' : ''
                      }`}
                      title="더블클릭하여 수정"
                    >
                      {info.cleanContent}
                    </span>
                    
                    {/* 첨부파일 미리보기 (작게 표시) */}
                    {event.attachments && event.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {event.attachments.map((att, idx) => (
                          att.type === 'image' ? (
                            <a key={idx} href={att.url} target="_blank" rel="noreferrer" className="block w-8 h-8 rounded overflow-hidden border border-slate-200">
                              <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                            </a>
                          ) : (
                            <a key={idx} href={att.url} target="_blank" rel="noreferrer" className="block px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[9px] text-slate-500 truncate max-w-[80px]" title={att.name}>
                              📎 {att.name}
                            </a>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 우측 링크, 수정, 삭제 버튼 */}
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  {event.linkedItems && event.linkedItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => openLinkerModal('event', formattedDate, event.id)}
                      className="px-1.5 py-0.5 bg-yellow-50 text-yellow-800 border border-yellow-300 rounded text-[10px] font-bold"
                      title="연결된 링크 보기"
                    >
                      📑 {event.linkedItems.length}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openLinkerModal('event', formattedDate, event.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 p-1 rounded hover:bg-slate-100 text-xs transition-all"
                    title="링크 추가/수정"
                  >
                    🔗
                  </button>
                  <button
                    type="button"
                    onClick={() => startEditing(event)}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 p-1 rounded hover:bg-slate-100 text-xs transition-all"
                    title="일정 수정"
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteEvent(event.id)}
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
            <span className="text-3xl mb-2">🎯</span>
            <p>오늘 예정된 일정이 없습니다.</p>
            <p className="mt-1 text-slate-400">위 입력창에서 등록하거나, 라벨 아이콘을 클릭해보세요.</p>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
