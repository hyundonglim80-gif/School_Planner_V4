// src/components/EntryDrawer.tsx
// 메모와 기록이 같은 오른쪽 배너(드로어)를 쓴다. 두 화면이 각자 입력 폼을 들고
// 있으면 단축키·첨부·라벨 동작이 조금씩 어긋나므로 한 곳에서만 만든다.
import React, { useState, useEffect, useRef } from 'react';
import { showToast } from '../utils/toast';
import { auth } from '../lib/firebase';
import { uploadImage, uploadFile } from '../utils/uploadHelper';
import { useAppStore } from '../store/useAppStore';
import { formatDateStr } from '../lib/dateUtils';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer, closeAllModals } from '../hooks/useModalLayer';
import { usePasteImageUpload } from '../hooks/usePasteImageUpload';
import ImageViewerModal, { type ViewerImage } from './ImageViewerModal';

export type EntryKind = 'memo' | 'journal';

export interface EntryAttachment {
  id?: string;
  name: string;
  url: string;
  type?: string;
  size?: number;
}

/** 드로어가 수정 대상으로 받는 값. 메모와 기록의 필드 이름 차이를 모두 받아들인다. */
export interface EntrySource {
  content?: string;
  text?: string;
  labels?: string[];
  labelIds?: string[];
  label?: string;
  imageUrl?: string;
  attachments?: unknown[];
  linkedItems?: any[];
}

/** 저장 버튼을 눌렀을 때 화면으로 돌려주는 값. */
export interface EntryDraft {
  content: string;
  labels: string[];
  attachments: EntryAttachment[];
  linkedItems: any[];
  imageUrl?: string;
}

interface EntryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  kind: EntryKind;
  /** 수정 대상. null이면 새로 작성하는 경우다. */
  entry: EntrySource | null;
  labelOptions: string[];
  onSave: (draft: EntryDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  /** 새로 작성할 때 미리 골라둘 라벨 */
  defaultLabel?: string;
}

const KIND_TEXT: Record<EntryKind, { noun: string; contentLabel: string; placeholder: string }> = {
  memo: {
    noun: '메모',
    contentLabel: '메모 내용',
    placeholder: '자유롭게 생각을 기록해보세요... (캡처한 이미지는 Ctrl+V로 첨부)',
  },
  journal: {
    noun: '기록',
    contentLabel: '기록 내용',
    placeholder: '오늘 있었던 일을 기록해보세요... (캡처한 이미지는 Ctrl+V로 첨부)',
  },
};

const isImageAttachment = (att: EntryAttachment) => {
  const type = att?.type || '';
  // 기록은 type에 'image'를, 메모는 'image/png' 같은 MIME 타입을 저장한다.
  if (type === 'image' || type.startsWith('image/')) return true;
  return /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(att?.url || '');
};

const normalizeAttachments = (raw: unknown[] | undefined, legacyImageUrl?: string): EntryAttachment[] => {
  const list: EntryAttachment[] = [];
  for (const item of raw || []) {
    if (!item) continue;
    if (typeof item === 'string') {
      const url = item.trim();
      if (!url) continue;
      list.push({ name: url.split('/').pop()?.split('?')[0] || '파일', url, type: '' });
      continue;
    }
    const obj = item as any;
    const url = obj.url || obj.downloadUrl || obj.fileUrl || '';
    if (!url || typeof url !== 'string') continue;
    list.push({
      id: typeof obj.id === 'string' ? obj.id : undefined,
      name: obj.name || url.split('/').pop()?.split('?')[0] || '파일',
      url,
      type: typeof obj.type === 'string' ? obj.type : undefined,
      size: typeof obj.size === 'number' ? obj.size : undefined,
    });
  }
  // 첨부 목록이 없던 구버전 항목은 imageUrl 한 장만 갖고 있다.
  if (list.length === 0 && legacyImageUrl) {
    list.push({ name: '이미지', url: legacyImageUrl, type: 'image' });
  }
  return list;
};

const sourceLabels = (entry: EntrySource): string[] => {
  if (entry.labels && entry.labels.length > 0) return entry.labels;
  if (entry.labelIds && entry.labelIds.length > 0) return entry.labelIds;
  return entry.label ? [entry.label] : [];
};

export default function EntryDrawer({
  isOpen,
  onClose,
  kind,
  entry,
  labelOptions,
  onSave,
  onDelete,
  defaultLabel,
}: EntryDrawerProps) {
  const { openLabelModal, openLinkerModal, currentDate } = useAppStore();
  const formattedDate = formatDateStr(new Date(currentDate));
  const text = KIND_TEXT[kind];

  useBodyScrollLock(isOpen);
  const vv = useVisualViewport(isOpen);
  const zIndex = useModalLayer(isOpen, onClose);

  const [content, setContent] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<EntryAttachment[]>([]);
  const [linkedItems, setLinkedItems] = useState<any[]>([]);

  const [saving, setSaving] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);

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
    if (entry) {
      setContent(entry.content || entry.text || '');
      setSelectedLabels(sourceLabels(entry));
      setLinkedItems(entry.linkedItems || []);
      setAttachments(normalizeAttachments(entry.attachments, entry.imageUrl));
    } else {
      setContent('');
      setSelectedLabels(defaultLabel && defaultLabel !== '전체' ? [defaultLabel] : []);
      setAttachments([]);
      setLinkedItems([]);
    }
  }, [entry, isOpen, defaultLabel]);

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

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const viewerImages: ViewerImage[] = attachments
    .filter(isImageAttachment)
    .map((att) => ({ url: att.url, name: att.name }));

  // 첨부는 두 화면이 서로 다른 모양으로 저장해 왔다. 기록은 type에 'image'/'file'과
  // id를, 메모는 MIME 타입을 쓴다. 저장된 형태를 바꾸지 않도록 여기서 맞춰준다.
  const makeAttachment = (name: string, url: string, mimeType: string, size?: number, seq = 0): EntryAttachment => {
    const isImage = mimeType.startsWith('image/');
    if (kind === 'journal') {
      return { id: `file_${Date.now()}_${seq}`, name, url, type: isImage ? 'image' : 'file', size };
    }
    return { name, url, type: mimeType || 'application/octet-stream', size };
  };

  // 캡처 이미지를 Ctrl+V로 붙여넣으면 하단 첨부 목록에 이미지로 추가된다.
  // ⚠️ 훅은 반드시 아래 early return 위에서 호출해야 한다 (Rules of Hooks).
  const { handlePaste, pasting } = usePasteImageUpload((images) => {
    setAttachments((prev) => [
      ...prev,
      ...images.map((img, i) => makeAttachment(img.name, img.url, img.mimeType || 'image/png', img.size, i)),
    ]);
  });

  if (!isOpen) return null;

  const toggleLabel = (label: string) => {
    setSelectedLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
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
      const uploaded: EntryAttachment[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const url = file.type.startsWith('image/')
          ? await uploadImage(file, user.uid)
          : await uploadFile(file, user.uid);
        uploaded.push(makeAttachment(file.name, url, file.type, file.size, i));
      }
      setAttachments((prev) => [...prev, ...uploaded]);
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

  const getFileIcon = (att: EntryAttachment) => {
    const name = att?.name || '';
    const type = att?.type || '';
    if (isImageAttachment(att)) return '🖼️';
    if (type.includes('pdf') || name.endsWith('.pdf')) return '📄';
    if (name.match(/\.(doc|docx|hwp|hwpx|txt)$/i)) return '📝';
    if (name.match(/\.(xls|xlsx|csv)$/i)) return '📊';
    if (name.match(/\.(zip|7z|tar|gz|rar)$/i)) return '🗜️';
    return '📁';
  };

  const openLinker = () => {
    openLinkerModal('manual', formattedDate, undefined, undefined, (links) => {
      setLinkedItems((prev) => [...prev, ...links]);
    });
  };

  const handleRemoveLink = (index: number) => {
    setLinkedItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!content.trim() && attachments.length === 0) return;

    try {
      setSaving(true);
      await onSave({
        content: content.trim(),
        labels: selectedLabels,
        attachments,
        linkedItems,
        imageUrl: attachments.find(isImageAttachment)?.url,
      });
      showToast(`✅ ${text.noun}이(가) 저장되었습니다.`);
      onClose();
    } catch (error) {
      console.error(`${text.noun} 저장 에러:`, error);
      alert(`${text.noun} 저장에 실패했습니다.`);
    } finally {
      setSaving(false);
    }
  };

  const isEditing = !!entry;

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
              {isEditing ? `${text.noun} 수정` : `새 ${text.noun}`}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">빠른 저장 단축키: Ctrl + S</p>
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
              {text.contentLabel} <span className="text-red-500">*</span>
            </label>
            <textarea
              ref={textareaRef}
              autoFocus
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onPaste={handlePaste}
              placeholder={text.placeholder}
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
                onClick={() => openLabelModal(kind)}
                className="text-xs text-primary hover:text-blue-700 font-bold flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-blue-50 transition-colors cursor-pointer"
                title="더보기 - 통합 라벨 관리 열기"
              >
                <span>⚙️</span>
                <span>라벨 수정</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {labelOptions.map((label) => {
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
                  // 이미지는 내용을 바로 알아볼 수 있도록 큰 미리보기로 보여준다.
                  if (isImageAttachment(att)) {
                    return (
                      <div
                        key={`${att.url}-${idx}`}
                        className="relative bg-slate-50 border border-slate-200 rounded-xl overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const i = viewerImages.findIndex((v) => v.url === att.url);
                            setViewerIndex(i >= 0 ? i : 0);
                            setViewerOpen(true);
                          }}
                          className="block w-full cursor-pointer"
                          title="클릭하여 크게 보기"
                        >
                          <img
                            src={att.url}
                            alt={att.name}
                            className="w-full max-h-64 object-contain bg-white"
                            loading="lazy"
                          />
                        </button>
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
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2.5 bg-yellow-50 border border-yellow-200 rounded-xl gap-2 hover:bg-yellow-100 transition-colors w-full"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="text-base shrink-0">🔗</span>
                      <span className="text-xs font-bold text-yellow-800 truncate block">
                        {link.title || link.text || '연결된 항목'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveLink(idx)}
                      className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50/50">
          {isEditing && onDelete ? (
            <button
              type="button"
              onClick={async () => {
                if (window.confirm('정말 삭제하시겠습니까?')) {
                  await onDelete();
                  onClose();
                }
              }}
              className="px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-100 rounded-xl transition-colors cursor-pointer"
            >
              삭제
            </button>
          ) : (
            <div></div>
          )}

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
              disabled={saving || uploadingFiles || (!content.trim() && attachments.length === 0)}
              className="px-5 py-2 text-sm font-bold text-white bg-primary hover:bg-blue-600 rounded-xl shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>저장 중...</span>
                </>
              ) : (
                <span>{isEditing ? '수정 완료 (Ctrl+S)' : '저장하기 (Ctrl+S)'}</span>
              )}
            </button>
          </div>
        </div>
      </div>

      <ImageViewerModal
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
        images={viewerImages}
        startIndex={viewerIndex}
      />
    </div>
  );
}
