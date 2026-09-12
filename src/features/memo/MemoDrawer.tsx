import React, { useState, useEffect, useRef } from 'react';
import type { Memo, MemoAttachment } from '../../hooks/useMemos';
import { auth, db } from '../../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { uploadImage, uploadFile } from '../../utils/uploadHelper';
import { useAppStore } from '../../store/useAppStore';
import { formatDateStr } from '../../lib/dateUtils';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useVisualViewport } from '../../hooks/useVisualViewport';
import { useModalLayer, closeAllModals } from '../../hooks/useModalLayer';
import { usePasteImageUpload } from '../../hooks/usePasteImageUpload';

const PRESET_LABELS = ['긴급', '중요', '업무', '아이디어', '수업', '개인', '기타'];

interface MemoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    content: string;
    labels: string[];
    imageUrl?: string;
    attachments?: MemoAttachment[];
    linkedItems?: any[];
  }) => Promise<void>;
  editingMemo?: Memo | null;
  onDelete?: (firestoreId: string) => Promise<void>;
  defaultLabel?: string;
}

export default function MemoDrawer({ isOpen, onClose, onSave, editingMemo, onDelete, defaultLabel }: MemoDrawerProps) {
  const { openLabelModal, isLabelModalOpen, openLinkerModal, currentDate } = useAppStore();
  const formattedDate = formatDateStr(new Date(currentDate));
  useBodyScrollLock(isOpen);
  const vv = useVisualViewport(isOpen);

  const zIndex = useModalLayer(isOpen, onClose);

  const [content, setContent] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<MemoAttachment[]>([]);
  const [linkedItems, setLinkedItems] = useState<any[]>([]);
  
  const [saving, setSaving] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [presetLabels, setPresetLabels] = useState<string[]>(PRESET_LABELS);

  const handleSubmitRef = useRef<() => void>(() => {});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustTextareaHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(120, el.scrollHeight)}px`;
  };

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        adjustTextareaHeight();
      });
    }
  }, [content, isOpen]);

  useEffect(() => {
    const fetchMemoLabels = async () => {
      const user = auth.currentUser;
      if (!user) {
        setPresetLabels(PRESET_LABELS);
        return;
      }
      
      try {
        const docRef = doc(db, 'users', user.uid, 'settings', 'labels');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          if (Array.isArray(data.memoLabels) && data.memoLabels.length > 0) {
            const labelNames = data.memoLabels.map((l: any) => (typeof l === 'string' ? l : l.name));
            setPresetLabels(labelNames);
            return;
          }
        }
        setPresetLabels(PRESET_LABELS);
      } catch (e) {
        console.error('Failed to fetch memo labels:', e);
        setPresetLabels(PRESET_LABELS);
      }
    };
    fetchMemoLabels();
  }, [isOpen, isLabelModalOpen, auth.currentUser?.uid]);

  useEffect(() => {
    if (editingMemo) {
      setContent(editingMemo.content || editingMemo.text || '');
      setSelectedLabels(editingMemo.labels || []);
      setLinkedItems(editingMemo.linkedItems || []);
      
      let initialAttachments: MemoAttachment[] = [];
      if (editingMemo.attachments && Array.isArray(editingMemo.attachments)) {
        const parsedList: MemoAttachment[] = [];
        for (const item of editingMemo.attachments) {
          if (!item) continue;
          const raw = item as any;
          if (typeof raw === 'string') {
            const url = raw.trim();
            if (url) {
              const name = url.split('/').pop()?.split('?')[0] || '파일';
              parsedList.push({ name, url, type: '' });
            }
          } else {
            const url = raw.url || raw.downloadUrl || raw.fileUrl || '';
            if (url && typeof url === 'string') {
              const name = raw.name || url.split('/').pop()?.split('?')[0] || '파일';
              parsedList.push({
                name,
                url,
                type: typeof raw.type === 'string' ? raw.type : undefined,
                size: typeof raw.size === 'number' ? raw.size : undefined,
              });
            }
          }
        }
        initialAttachments = parsedList;
      } else if (editingMemo.imageUrl) {
        initialAttachments = [
          {
            name: '이미지',
            url: editingMemo.imageUrl,
            type: 'image/jpeg',
          },
        ];
      }
      setAttachments(initialAttachments);
    } else {
      setContent('');
      setSelectedLabels(defaultLabel && defaultLabel !== '전체' ? [defaultLabel] : []);
      setAttachments([]);
      setLinkedItems([]);
    }
  }, [editingMemo, isOpen, defaultLabel]);

  useEffect(() => {
    handleSubmitRef.current = () => handleSubmit();
  }, [content, selectedLabels, attachments, linkedItems]);

  // 💡 Esc로 닫는 동작은 useModalLayer의 전역 규칙(열린 팝업 전부 닫기)에 맡긴다.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSubmitRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // 캡처 이미지를 Ctrl+V 로 붙여넣으면 하단 첨부 목록에 이미지로 추가된다.
  // ⚠️ 훅은 반드시 아래 early return 위에서 호출해야 한다 (Rules of Hooks).
  const { handlePaste, pasting } = usePasteImageUpload((images) => {
    setAttachments((prev) => [
      ...prev,
      ...images.map((img) => ({
        name: img.name,
        url: img.url,
        type: img.mimeType,
        size: img.size,
      })),
    ]);
  });

  if (!isOpen) return null;

  const toggleLabel = (label: string) => {
    if (selectedLabels.includes(label)) {
      setSelectedLabels(selectedLabels.filter((l) => l !== label));
    } else {
      setSelectedLabels([...selectedLabels, label]);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const user = auth.currentUser;
    if (!user) {
      alert('로그인이 필요합니다.');
      return;
    }

    try {
      setUploadingFiles(true);
      const newAttachments: MemoAttachment[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let url = '';
        if (file.type.startsWith('image/')) {
          url = await uploadImage(file, user.uid);
        } else {
          url = await uploadFile(file, user.uid);
        }
        newAttachments.push({
          name: file.name,
          url,
          type: file.type || 'application/octet-stream',
          size: file.size,
        });
      }
      setAttachments((prev) => [...prev, ...newAttachments]);
    } catch (error) {
      console.error('파일 업로드 에러:', error);
      alert('파일 업로드에 실패했습니다.');
    } finally {
      setUploadingFiles(false);
      e.target.value = '';
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (att: MemoAttachment) => {
    const url = att?.url || '';
    const name = att?.name || '';
    const type = att?.type || '';

    if (type.startsWith('image/') || (typeof url === 'string' && url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i))) {
      return '🖼️';
    }
    if (type.includes('pdf') || (typeof name === 'string' && name.endsWith('.pdf'))) return '📄';
    if (typeof name === 'string' && name.match(/\.(doc|docx|hwp|hwpx|txt)$/i)) return '📝';
    if (typeof name === 'string' && name.match(/\.(xls|xlsx|csv)$/i)) return '📊';
    if (typeof name === 'string' && name.match(/\.(zip|7z|tar|gz|rar)$/i)) return '🗜️';
    return '📁';
  };

  const openLinker = () => {
    openLinkerModal('manual', formattedDate, undefined, undefined, (links) => {
      setLinkedItems(prev => [...prev, ...links]);
    });
  };

  const handleRemoveLink = (index: number) => {
    setLinkedItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!content.trim()) return;

    try {
      setSaving(true);
      const firstImage = attachments.find(
        (a) =>
          (a?.type && typeof a.type === 'string' && a.type.startsWith('image/')) ||
          (a?.url && typeof a.url === 'string' && a.url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i))
      )?.url;

      await onSave({
        content: content.trim(),
        labels: selectedLabels,
        imageUrl: firstImage || undefined,
        attachments,
        linkedItems,
      });
      onClose();
    } catch (error) {
      console.error('메모 저장 에러:', error);
      alert('메모 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 flex justify-end"
      style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }}
    >
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300"
        onClick={closeAllModals}
      />

      <div className="relative w-full max-w-lg bg-white h-full shadow-2xl z-10 flex flex-col transform transition-transform duration-300 ease-in-out">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-800">
              {editingMemo ? '메모 수정' : '새 메모'}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              빠른 저장 단축키: Ctrl + Enter
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-6" data-scroll-lock>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-600">
              메모 내용 <span className="text-red-500">*</span>
            </label>
            <textarea
              ref={textareaRef}
              autoFocus
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              onPaste={handlePaste}
              placeholder="자유롭게 생각을 기록해보세요... (캡처한 이미지는 Ctrl+V로 첨부)"
              className="w-full min-h-[120px] p-4 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none text-slate-800 leading-relaxed placeholder-slate-400 text-sm overflow-hidden"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-600">
                라벨 태그 (다중 선택 가능)
              </label>
              <button
                type="button"
                onClick={() => openLabelModal('memo')}
                className="text-xs text-primary hover:text-blue-700 font-bold flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-blue-50 transition-colors cursor-pointer"
                title="더보기 - 통합 라벨 관리 열기"
              >
                <span>⚙️</span>
                <span>라벨 수정</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {presetLabels.map((label) => {
                const isSelected = selectedLabels.includes(label);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleLabel(label)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {isSelected ? '✓ ' : ''}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-600">
                첨부 및 링크 ({attachments.length + linkedItems.length}개)
              </label>
              {pasting && (
                <span className="text-xs font-bold text-primary">⏳ 붙여넣은 이미지 업로드 중...</span>
              )}
            </div>
            
            <div className="flex gap-2">
              <label className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer border border-dashed border-slate-300 shadow-2xs">
                <span>{uploadingFiles ? '⏳' : '📎'}</span>
                <span>{uploadingFiles ? '업로드 중...' : '파일 첨부'}</span>
                <input
                  type="file"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={uploadingFiles}
                />
              </label>
              <button
                type="button"
                onClick={openLinker}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-50 hover:bg-yellow-50 text-slate-700 hover:text-yellow-800 rounded-xl text-xs font-bold transition-colors cursor-pointer border border-dashed border-slate-300 hover:border-yellow-300 shadow-2xs"
              >
                <span>🔗</span>
                <span>링크 추가</span>
              </button>
            </div>

            {attachments.length > 0 && (
              <div className="space-y-2 pt-1">
                {attachments.map((att, idx) => {
                  const url = att?.url || '';
                  const type = att?.type || '';
                  const isImage =
                    (typeof type === 'string' && type.startsWith('image/')) ||
                    (typeof url === 'string' && url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i));

                  // 이미지는 내용을 바로 알아볼 수 있도록 큰 미리보기로 보여준다.
                  if (isImage) {
                    return (
                      <div
                        key={`${att.url}-${idx}`}
                        className="relative bg-slate-50 border border-slate-200 rounded-xl overflow-hidden"
                      >
                        <a href={att.url} target="_blank" rel="noopener noreferrer" title="클릭하여 원본 보기">
                          <img
                            src={att.url}
                            alt={att.name}
                            className="w-full max-h-64 object-contain bg-white"
                            loading="lazy"
                          />
                        </a>
                        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-t border-slate-200">
                          <span className="text-[15px] text-slate-500 truncate" title={att.name}>
                            🖼️ {att.name}
                            {att.size ? ` · ${formatFileSize(att.size)}` : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveAttachment(idx)}
                            className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0"
                            title="이미지 삭제"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={`${att.url}-${idx}`}
                      className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl gap-2 hover:bg-slate-100/80 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="text-xl shrink-0">{getFileIcon(att)}</span>
                        <div className="min-w-0 flex-1">
                          <a
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-bold text-slate-800 hover:text-primary truncate block hover:underline"
                            title={att.name}
                          >
                            {att.name}
                          </a>
                          {att.size && (
                            <span className="text-[15px] text-slate-400 block">
                              {formatFileSize(att.size)}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(idx)}
                        className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0"
                        title="파일 삭제"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {linkedItems.length > 0 && (
              <div className="space-y-2 pt-1">
                {linkedItems.map((link, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 bg-yellow-50 border border-yellow-200 rounded-xl gap-2 hover:bg-yellow-100 transition-colors w-full">
                     <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="text-base shrink-0">🔗</span>
                        <span className="text-xs font-bold text-yellow-800 truncate block">{link.title || link.text || '연결된 항목'}</span>
                     </div>
                     <button type="button" onClick={() => handleRemoveLink(idx)} className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0">
                       ✕
                     </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50/50">
          {editingMemo && onDelete ? (
             <button
               type="button"
               onClick={async () => {
                 if (window.confirm('정말 삭제하시겠습니까?')) {
                   await onDelete(editingMemo.firestoreId);
                   onClose();
                 }
               }}
               className="px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-100 rounded-xl transition-colors cursor-pointer"
             >
               삭제
             </button>
          ) : <div></div>}
          
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || uploadingFiles}
              className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={saving || uploadingFiles || !content.trim()}
              className="px-5 py-2 text-sm font-bold text-white bg-primary hover:bg-blue-600 rounded-xl shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>저장 중...</span>
                </>
              ) : (
                <span>{editingMemo ? '수정 완료 (Ctrl+S)' : '저장하기 (Ctrl+S)'}</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}