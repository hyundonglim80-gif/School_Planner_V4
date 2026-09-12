import React, { useState, useEffect, useRef } from 'react';
import type { JournalEntry } from '../../hooks/useDayData';
import { renderFormattedText } from '../../lib/textUtils';
import { useAppStore } from '../../store/useAppStore';
import { useLabels } from '../../hooks/useLabels';
import { DEFAULT_JOURNAL_LABELS, type JournalLabel } from '../../components/LabelModal';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { uploadImage, uploadFile } from '../../utils/uploadHelper';
import { usePasteImageUpload } from '../../hooks/usePasteImageUpload';
import ImageViewerModal, { type ViewerImage } from '../../components/ImageViewerModal';
import type { Attachment } from '../../hooks/useDayData';
import { showToast } from '../../utils/toast';
import { formatDateStr } from '../../lib/dateUtils';

interface DayJournalProps {
  journals: JournalEntry[];
  onAddJournal: (content: string, label: string, labelIds?: string[], imageUrl?: string, options?: Partial<JournalEntry>) => Promise<void>;
  onDeleteJournal: (id: string) => Promise<void>;
  onUpdateJournal?: (id: string, updates: Partial<JournalEntry>) => Promise<void>;
  onReorderJournals?: (sourceIndex: number, targetIndex: number) => Promise<void>;
}

export default function DayJournal({
  journals,
  onAddJournal,
  onDeleteJournal,
  onUpdateJournal,
  onReorderJournals,
}: DayJournalProps) {
  const [content, setContent] = useState('');
  const [newLabels, setNewLabels] = useState<string[]>(['학급활동']);
  const [newAttachments, setNewAttachments] = useState<Attachment[]>([]);
  const [newLinkedItems, setNewLinkedItems] = useState<any[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  
  const itemFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const { openLinkerModal, openLinkViewerModal, openLabelModal, isLabelModalOpen, currentDate } = useAppStore();
  const formattedDate = formatDateStr(new Date(currentDate));
  const { journalLabels: hookJournalLabels } = useLabels();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editLabel, setEditLabel] = useState('기본');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [journalLabels, setJournalLabels] = useState<JournalLabel[]>(DEFAULT_JOURNAL_LABELS);

  // useLabels의 실시간 구독 값과 동기화
  useEffect(() => {
    if (hookJournalLabels && hookJournalLabels.length > 0) {
      setJournalLabels(hookJournalLabels);
    }
  }, [hookJournalLabels]);
  
  // 항목별 접기/펼치기 상태
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({});
  const toggleCollapse = (id: string) => {
    setCollapsedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // 필터 상태 추가
  const [currentFilter, setCurrentFilter] = useState('전체');

  useEffect(() => {
    const fetchLabels = async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const docRef = doc(db, 'users', user.uid, 'settings', 'labels');
        const snap = await getDoc(docRef);
        if (snap.exists() && snap.data().journalLabels) {
          const rawJournals = snap.data().journalLabels;
          setJournalLabels(rawJournals.map((l: any, i: number) => ({
            id: l.id || `j_${i}_${l.name || ''}`,
            name: l.name || '',
            color: l.color || 'green',
          })));
        }
      } catch (err) {
        console.error('Failed to fetch journal labels', err);
      }
    };
    fetchLabels();
  }, [isLabelModalOpen]);

  // 💡 라벨이 삭제된 경우 빈 문자열('')을 반환하도록 수정
  const getLabelName = (entry: JournalEntry) => {
    if (entry.labelIds && entry.labelIds.length > 0) {
      // 💡 ID뿐만 아니라 Name으로도 매칭되도록 유연하게 수정
      const firstLabel = entry.labelIds[0];
      const found = journalLabels.find(l => l.id === firstLabel || l.name === firstLabel);
      if (found) return found.name;
      return ''; // 삭제된 라벨 숨김
    }
    if (entry.label && entry.label.startsWith('j_')) {
      const found = journalLabels.find(l => l.id === entry.label);
      if (found) return found.name;
      return ''; // 삭제된 라벨 숨김
    }
    const found = journalLabels.find(l => l.name === entry.label);
    if (found) return found.name;
    return ''; // 삭제된 라벨 숨김
  };

  const getLabelColorClass = (entry: JournalEntry) => {
    let color = 'gray';
    if (entry.labelIds && entry.labelIds.length > 0) {
      // 💡 ID뿐만 아니라 Name으로도 매칭되도록 유연하게 수정
      const firstLabel = entry.labelIds[0];
      const found = journalLabels.find(l => l.id === firstLabel || l.name === firstLabel);
      if (found) color = found.color;
    } else if (entry.label && entry.label.startsWith('j_')) {
      const found = journalLabels.find(l => l.id === entry.label);
      if (found) color = found.color;
    } else {
      const found = journalLabels.find(l => l.name === entry.label);
      if (found) color = found.color;
    }

    const map: Record<string, string> = {
      blue: 'bg-blue-50 text-blue-700 border-blue-200',
      green: 'bg-green-50 text-green-700 border-green-200',
      red: 'bg-red-50 text-red-700 border-red-200',
      orange: 'bg-orange-50 text-orange-700 border-orange-200',
      yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
      indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      purple: 'bg-purple-50 text-purple-700 border-purple-200',
      gray: 'bg-slate-50 text-slate-700 border-slate-200',
    };
    return map[color] || map.gray;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() && newAttachments.length === 0) return;

    try {
      setSubmitting(true);
      const mainLabel = newLabels.length > 0 ? newLabels[0] : '일반';
      await onAddJournal(content.trim(), mainLabel, newLabels, undefined, {
        attachments: newAttachments,
        linkedItems: newLinkedItems
      });
      setContent('');
      setNewAttachments([]);
      setNewLinkedItems([]);
      setIsFormOpen(false);
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

    setIsFormOpen(true);
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
          id: `file_${Date.now()}_${i}`,
          name: file.name,
          url,
          type: isImage ? 'image' : 'file',
          size: file.size
        });
      }
      
      if (uploadTargetId) {
        const targetEntry = journals.find(j => j.id === uploadTargetId);
        if (targetEntry && onUpdateJournal) {
          await onUpdateJournal(uploadTargetId, {
            attachments: [...(targetEntry.attachments || []), ...uploaded]
          });
        }
        setUploadTargetId(null);
      } else {
        setNewAttachments(prev => [...prev, ...uploaded]);
      }
    } catch (err: any) {
      alert('오류 발생: ' + err.message);
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

  const startEditing = (entry: JournalEntry) => {
    setEditingId(entry.id);
    setEditContent(entry.content);
    setEditLabel(entry.label || '일반');
    setEditImageUrl(entry.imageUrl || '');
  };

  const [viewerImages, setViewerImages] = useState<ViewerImage[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);

  const isImageAttachment = (att: Attachment) =>
    att.type === 'image' || /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(att.url || '');

  // 기록에 붙은 이미지(구버전 imageUrl 포함)를 뷰어용 목록으로 모은다.
  const getEntryImages = (entry: JournalEntry): ViewerImage[] => {
    const list: ViewerImage[] = [];
    if (entry.imageUrl) list.push({ url: entry.imageUrl, name: '첨부 이미지' });
    (entry.attachments || []).forEach((att) => {
      if (isImageAttachment(att)) list.push({ url: att.url, name: att.name });
    });
    return list;
  };

  const getEntryFiles = (entry: JournalEntry): Attachment[] =>
    (entry.attachments || []).filter((att) => !isImageAttachment(att));

  // 클릭한 썸네일부터 보여준다.
  const openEntryViewer = (entry: JournalEntry, clickedUrl?: string) => {
    const images = getEntryImages(entry);
    if (images.length === 0) return;
    const idx = clickedUrl ? images.findIndex((img) => img.url === clickedUrl) : 0;
    setViewerIndex(idx >= 0 ? idx : 0);
    setViewerImages(images);
  };

  // 새 기록 작성 중 Ctrl+V: 하단 첨부 목록에 이미지로 추가
  const { handlePaste: handleNewPaste, pasting: pastingNew } = usePasteImageUpload((images) => {
    setIsFormOpen(true);
    setNewAttachments(prev => [
      ...prev,
      ...images.map((img, i) => ({
        id: `paste_${Date.now()}_${i}`,
        name: img.name,
        url: img.url,
        type: 'image',
        size: img.size,
      })),
    ]);
  });

  // 기존 기록 수정 중 Ctrl+V: 이미 저장된 기록이므로 첨부를 바로 반영한다.
  const { handlePaste: handleEditPaste, pasting: pastingEdit } = usePasteImageUpload(async (images) => {
    if (!editingId || !onUpdateJournal) return;
    const targetEntry = journals.find(j => j.id === editingId);
    if (!targetEntry) return;
    await onUpdateJournal(editingId, {
      attachments: [
        ...(targetEntry.attachments || []),
        ...images.map((img, i) => ({
          id: `paste_${Date.now()}_${i}`,
          name: img.name,
          url: img.url,
          type: 'image',
          size: img.size,
        })),
      ],
    });
  });

  const saveEditing = async (id: string) => {
    if (uploadingFiles) return;
    if (!editContent.trim() && !editImageUrl) {
      await onDeleteJournal(id);
      setEditingId(null);
      return;
    }
    if (onUpdateJournal) {
      await onUpdateJournal(id, {
        content: editContent.trim(),
        label: editLabel,
        imageUrl: editImageUrl,
      });
    }
    setEditingId(null);
  };

  const handleEditImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const user = auth.currentUser;
    if (!user) {
      alert('로그인이 필요합니다.');
      return;
    }

    try {
      setUploadingFiles(true);
      const url = await uploadImage(file, user.uid);
      setEditImageUrl(url);
    } catch (error) {
      alert('이미지 업로드에 실패했습니다.');
    } finally {
      setUploadingFiles(false);
    }
  };

  const [columnsCount, setColumnsCount] = useState(4);

  useEffect(() => {
    const updateCols = () => {
      if (window.innerWidth >= 1024) setColumnsCount(4);
      else if (window.innerWidth >= 768) setColumnsCount(3);
      else if (window.innerWidth >= 640) setColumnsCount(2);
      else setColumnsCount(1);
    };
    updateCols();
    window.addEventListener('resize', updateCols);
    return () => window.removeEventListener('resize', updateCols);
  }, []);

  const [isCollapsed, setIsCollapsed] = useState(false);

  // 필터 적용된 리스트
  const filteredJournals = currentFilter === '전체'
    ? journals
    : journals.filter((entry) => getLabelName(entry) === currentFilter);

  const distributeJournals = (items: JournalEntry[]) => {
    const columns = Array.from({ length: columnsCount }, () => [] as { entry: JournalEntry; idx: number }[]);
    items.forEach((item, index) => {
      columns[index % columnsCount].push({ entry: item, idx: index });
    });
    return columns;
  };

  const journalColumns = distributeJournals(filteredJournals);

  return (
    <div className="flex flex-col gap-4">
      {/* 상단 헤더 및 기록 입력 폼 */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5">
        <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${isCollapsed ? '' : 'mb-4'}`}>
          
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="text-slate-400 hover:text-slate-700 text-xs px-1 py-0.5 rounded hover:bg-slate-100 transition-colors"
                title={isCollapsed ? '펼치기' : '접기'}
              >
                {isCollapsed ? '▶' : '▼'}
              </button>
              <span className="text-xl">📔</span>
              <h3 className="text-base font-extrabold text-slate-800">기록</h3>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {journals.length}
              </span>
            </div>

            {/* 라벨 필터 바 (좌측 타이틀 옆으로 이동) */}
            {!isCollapsed && journals.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setCurrentFilter('전체')}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all shadow-sm ${
                    currentFilter === '전체'
                      ? 'bg-slate-800 text-white'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  전체
                </button>
                {journalLabels.map((lbl) => (
                  <button
                    key={lbl.id}
                    onClick={() => setCurrentFilter(lbl.name)}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition-all shadow-sm ${
                      currentFilter === lbl.name
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {lbl.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 우측 상단 버튼 */}
          {!isCollapsed && !isFormOpen && (
            <div className="flex items-center shrink-0">
              <button
                onClick={() => setIsFormOpen(true)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
              >
                + 추가
              </button>
            </div>
          )}
        </div>

        {!isCollapsed && isFormOpen && (
          <form onSubmit={handleSubmit} className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-3">
            {/* 라벨 선택 UI */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-500">라벨:</span>
                <button
                  type="button"
                  onClick={() => openLabelModal('journal')}
                  className="text-xs text-primary hover:text-blue-700 font-bold flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer"
                  title="더보기 - 통합 라벨 관리 열기"
                >
                  <span>⚙️</span>
                  <span>라벨 수정</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {journalLabels.map((lbl) => {
                  const isSelected = newLabels.includes(lbl.name);
                  return (
                    <button
                      key={lbl.id}
                      type="button"
                      onClick={() => handleLabelToggle(lbl.name)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {lbl.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 본문 입력 */}
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                  e.preventDefault();
                  handleSubmit(e as any);
                }
              }}
              onPaste={handleNewPaste}
              placeholder="기록 내용... (캡처한 이미지는 Ctrl+V로 첨부)"
              rows={3}
              className="w-full p-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary resize-none placeholder-slate-400 leading-relaxed"
              autoFocus
            />
            {pastingNew && (
              <span className="text-xs font-bold text-primary">⏳ 붙여넣은 이미지 업로드 중...</span>
            )}

            {/* 하단 옵션 */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-end items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-200/60 rounded-xl transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={(!content.trim() && newAttachments.length === 0) || submitting || uploadingFiles}
                  className="px-4 py-1.5 bg-primary hover:bg-blue-600 text-white text-xs font-bold rounded-xl shadow-xs transition-colors disabled:opacity-40"
                >
                  등록
                </button>
              </div>

              {/* 첨부파일 미리보기 */}
              {newAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {newAttachments.map((att, idx) => (
                    <div key={idx} className="relative group rounded-lg overflow-hidden border border-slate-200 bg-white">
                      {att.type === 'image' ? (
                        <img src={att.url} alt={att.name} className="h-16 w-16 object-cover" />
                      ) : (
                        <div className="h-16 w-16 flex items-center justify-center bg-slate-100 text-[15px] text-slate-500 p-1 text-center truncate" title={att.name}>
                          {att.name}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(idx)}
                        className="absolute top-0.5 right-0.5 bg-black/50 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {newLinkedItems.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {newLinkedItems.map((link, idx) => (
                    <div key={idx} className="flex items-center gap-1 bg-white border border-slate-200 pl-2 pr-1 py-1 rounded-md shadow-2xs">
                      <span className="text-[15px] font-bold text-slate-600 truncate max-w-[120px]">{link.text}</span>
                      <button type="button" onClick={() => handleRemoveLink(idx)} className="text-slate-400 hover:text-red-500 p-0.5">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </form>
        )}
      </div>

      {/* 기록 카드 리스트 (메모 페이지와 동일한 가로 우선 다단 레이아웃) */}
      {!isCollapsed && (
        filteredJournals.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-start">
            {journalColumns.map((col, colIndex) => (
              <div key={colIndex} className="flex flex-col gap-4">
                {col.map(({ entry }) => {
                  const isEditing = editingId === entry.id;
                  const linkCount = (entry.linkedItems || []).length;
                  const isCollapsedItem = !!collapsedIds[entry.id];
                  const origIdx = journals.findIndex(j => j.id === entry.id);

                  if (isEditing) {
                    return (
                      <div key={entry.id} className="w-full p-4 rounded-2xl border border-primary/50 bg-blue-50/30 flex flex-col gap-3 shadow-md">
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-semibold text-slate-500">라벨:</span>
                            <button
                              type="button"
                              onClick={() => openLabelModal('journal')}
                              className="text-xs text-primary hover:text-blue-700 font-bold flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer"
                              title="더보기 - 통합 라벨 관리 열기"
                            >
                              <span>⚙️</span>
                              <span>라벨 수정</span>
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {journalLabels.map((lbl) => (
                              <button
                                key={lbl.id}
                                type="button"
                                onClick={() => setEditLabel(lbl.name)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                  editLabel === lbl.name
                                    ? 'bg-blue-600 text-white shadow-xs'
                                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                                }`}
                              >
                                {lbl.name}
                              </button>
                            ))}
                          </div>
                        </div>
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setEditingId(null);
                            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                              e.preventDefault();
                              saveEditing(entry.id);
                            }
                          }}
                          onPaste={handleEditPaste}
                          placeholder="캡처한 이미지는 Ctrl+V로 첨부할 수 있습니다."
                          rows={3}
                          className="w-full p-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary resize-none leading-relaxed"
                          autoFocus
                        />
                        {pastingEdit && (
                          <span className="text-xs font-bold text-primary">⏳ 붙여넣은 이미지 업로드 중...</span>
                        )}

                        {editImageUrl && (
                          <div className="relative inline-block mb-2">
                            <img src={editImageUrl} alt="첨부 이미지" className="h-24 w-auto rounded-lg border border-slate-200 object-cover" />
                            <button type="button" onClick={() => setEditImageUrl('')} className="absolute -top-2 -right-2 bg-white rounded-full p-0.5 shadow-sm border border-slate-200 text-slate-500 hover:text-red-500 hover:bg-red-50 text-xs">×</button>
                          </div>
                        )}

                        {/* 첨부(붙여넣은 이미지 포함) 미리보기 - 수정 중에도 바로 확인/삭제 가능 */}
                        {entry.attachments && entry.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {entry.attachments.map((att, attIdx) => (
                              <div key={`${att.url}-${attIdx}`} className="relative">
                                {isImageAttachment(att) ? (
                                  <button
                                    type="button"
                                    onClick={() => openEntryViewer(entry, att.url)}
                                    className="block cursor-pointer"
                                    title="클릭하여 크게 보기"
                                  >
                                    <img src={att.url} alt={att.name} className="h-24 w-auto rounded-lg border border-slate-200 object-cover" loading="lazy" />
                                  </button>
                                ) : (
                                  <span className="inline-block px-2 py-1 bg-slate-100 border border-slate-200 rounded-lg text-[15px] text-slate-600 truncate max-w-[150px]" title={att.name}>
                                    📎 {att.name}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onUpdateJournal && onUpdateJournal(entry.id, {
                                    attachments: (entry.attachments || []).filter((_, i) => i !== attIdx),
                                  })}
                                  className="absolute -top-2 -right-2 bg-white rounded-full p-0.5 shadow-sm border border-slate-200 text-slate-500 hover:text-red-500 hover:bg-red-50 text-xs w-5 h-5 flex items-center justify-center"
                                  title="첨부 삭제"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex justify-between items-center">
                          <label className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-200/50 hover:bg-slate-200 text-slate-600 rounded-xl text-[16.5px] font-bold transition-colors cursor-pointer">
                            <span>📷</span>
                            <span>{uploadingFiles ? '업로드 중...' : '이미지 추가'}</span>
                            <input type="file" accept="image/*" onChange={handleEditImageUpload} className="hidden" disabled={uploadingFiles} />
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-200/60 rounded-xl transition-colors"
                            >
                              취소
                            </button>
                            <button
                              type="button"
                              onClick={() => saveEditing(entry.id)}
                              disabled={uploadingFiles}
                              className="px-4 py-1.5 bg-primary hover:bg-blue-600 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
                            >
                              저장
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={entry.id}
                      className="w-full group p-4 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-slate-300 bg-white transition-all flex flex-col gap-2"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* 항목 접기/펼치기 삼각형 토글 버튼 */}
                          <button
                            type="button"
                            onClick={() => toggleCollapse(entry.id)}
                            className="text-slate-400 hover:text-primary transition-colors p-0.5 text-[15px] cursor-pointer"
                          >
                            {isCollapsedItem ? '▶' : '▼'}
                          </button>

                          {/* 순서 변경 아이콘 */}
                          <div className="flex flex-col items-center gap-0.5 shrink-0 px-0.5">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); if (origIdx > 0 && onReorderJournals) onReorderJournals(origIdx, origIdx - 1); }}
                              disabled={origIdx <= 0}
                              className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-[15px] cursor-pointer"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); if (origIdx < journals.length - 1 && onReorderJournals) onReorderJournals(origIdx, origIdx + 1); }}
                              disabled={origIdx >= journals.length - 1}
                              className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-[15px] cursor-pointer"
                            >
                              ▼
                            </button>
                          </div>

                          {/* 💡 라벨이 삭제되지 않고 남아있을 때만 뱃지 표시 */}
                          {getLabelName(entry) && (
                            <span className={`px-2 py-0.5 rounded-md text-[16.5px] font-bold border ${getLabelColorClass(entry)}`}>
                              {getLabelName(entry)}
                            </span>
                          )}

                          <span className="text-[16.5px] text-slate-400">
                            {new Date(entry.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          
                          {linkCount > 0 && (
                            <button 
                              type="button"
                              onClick={() => openLinkViewerModal('journal', formattedDate, entry.id)}
                              className="bg-yellow-100 text-yellow-800 text-[15px] px-1.5 py-0.5 rounded font-bold border border-yellow-300 hover:bg-yellow-200 cursor-pointer"
                            >
                                🔗 {linkCount}
                            </button>
                          )}
                          {/* 접힌 상태에서는 썸네일이 안 보이므로 이때만 이미지 아이콘을 노출한다.
                              (펼친 상태에서는 썸네일 자체가 표시 역할을 하므로 중복) */}
                          {isCollapsedItem && getEntryImages(entry).length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openEntryViewer(entry); }}
                              className="bg-indigo-50 text-indigo-700 text-[15px] px-1.5 py-0.5 rounded font-bold border border-indigo-200 hover:bg-indigo-100 transition-colors cursor-pointer"
                              title="첨부 이미지 보기"
                            >
                              🖼️ {getEntryImages(entry).length}
                            </button>
                          )}
                          {getEntryFiles(entry).length > 0 && (
                            <span className="bg-slate-100 text-slate-600 text-[15px] px-1.5 py-0.5 rounded font-bold border border-slate-200">
                                📎 {getEntryFiles(entry).length}
                            </span>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => {
                              setUploadTargetId(entry.id);
                              itemFileInputRef.current?.click();
                            }}
                            className="text-slate-400 hover:text-emerald-600 p-1 rounded-md text-xs font-bold cursor-pointer"
                            title="파일 추가"
                          >
                            📎
                          </button>
                          <button
                            type="button"
                            onClick={() => startEditing(entry)}
                            className="text-slate-400 hover:text-blue-600 p-1 rounded-md text-xs font-bold cursor-pointer"
                            title="기록 수정"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            onClick={() => openLinkerModal('journal', formattedDate, entry.id)}
                            className="text-slate-400 hover:text-yellow-600 p-1 rounded-md text-xs font-bold cursor-pointer"
                            title="링크 연결"
                          >
                            🔗
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await onDeleteJournal(entry.id);
                              showToast('기록이 삭제되었습니다 (휴지통 보관)');
                            }}
                            className="text-slate-400 hover:text-red-500 p-1 rounded-md text-xs transition-colors cursor-pointer"
                            title="기록 삭제"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>

                      {/* 항목이 접히지 않았을 때만 본문 및 첨부파일 표시 */}
                      {!isCollapsedItem && (
                        <div 
                          onDoubleClick={() => startEditing(entry)} 
                          className="flex flex-col gap-3 mt-1 cursor-pointer" 
                          title="더블클릭하여 수정"
                        >
                          <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                            {entry.content}
                          </p>
                          {entry.imageUrl && (
                            <div
                              className="mt-1 rounded-lg overflow-hidden border border-slate-200/60 bg-slate-50 inline-block max-w-fit cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); openEntryViewer(entry, entry.imageUrl!); }}
                              title="클릭하여 크게 보기"
                            >
                              <img src={entry.imageUrl} alt="첨부 이미지" className="max-w-full h-auto object-cover max-h-48" loading="lazy" />
                            </div>
                          )}
                          {entry.attachments && entry.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-1">
                              {entry.attachments.map((att, attIdx) => (
                                isImageAttachment(att) ? (
                                  <button
                                    key={attIdx}
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); openEntryViewer(entry, att.url); }}
                                    className="block w-16 h-16 rounded-lg overflow-hidden border border-slate-200 hover:shadow-sm transition-shadow cursor-pointer"
                                    title="클릭하여 크게 보기"
                                  >
                                    <img src={att.url} alt={att.name} className="w-full h-full object-cover" loading="lazy" />
                                  </button>
                                ) : (
                                  <a key={attIdx} href={att.url} target="_blank" rel="noreferrer" className="block px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 truncate max-w-[150px] hover:bg-slate-100 transition-colors" title={att.name}>
                                    📎 {att.name}
                                  </a>
                                )
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="w-full text-center py-10 bg-white/60 rounded-2xl border border-dashed border-slate-300 p-6 shadow-xs">
            <p className="text-slate-500 font-bold text-sm">
              {currentFilter === '전체' ? '등록된 기록이 없습니다.' : `'${currentFilter}' 라벨에 해당하는 기록이 없습니다.`}
            </p>
          </div>
        )
      )}

      {/* 개별 항목 파일 업로드용 숨김 input */}
      <input
        type="file"
        multiple
        className="hidden"
        ref={itemFileInputRef}
        onChange={handleFileChange}
      />

      <ImageViewerModal
        isOpen={!!viewerImages}
        onClose={() => setViewerImages(null)}
        images={viewerImages || []}
        startIndex={viewerIndex}
      />
    </div>
  );
}