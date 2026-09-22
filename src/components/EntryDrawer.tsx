// src/components/EntryDrawer.tsx
// 메모와 기록이 같은 오른쪽 배너(드로어)를 쓴다. 두 화면이 각자 입력 폼을 들고
// 있으면 단축키·첨부·라벨 동작이 조금씩 어긋나므로 한 곳에서만 만든다.
import React, { useState, useEffect, useRef } from 'react';
import { showToast, showErrorToast } from '../utils/toast';
import { auth } from '../lib/firebase';
import { uploadToDrive, attachmentImageSrc, driveUrlToStore } from '../lib/driveApi';
import { useAppStore } from '../store/useAppStore';
import { formatDateStr } from '../lib/dateUtils';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer, closeAllModals } from '../hooks/useModalLayer';
import { useBackdropClose } from '../hooks/useBackdropClose';
import { usePasteImageUpload } from '../hooks/usePasteImageUpload';
import ImageViewerModal, { type ViewerImage } from './ImageViewerModal';
import AutoTextarea from './AutoTextarea';

export type EntryKind = 'memo' | 'journal';

export interface EntryAttachment {
  id?: string;
  name: string;
  url: string;
  type?: string;
  size?: number;
  /** 구글 드라이브 파일 id. 이미지 미리보기와 나중의 삭제에 쓴다. */
  driveId?: string;
}

/** 드로어가 수정 대상으로 받는 값. 메모와 기록의 필드 이름 차이를 모두 받아들인다. */
export interface EntrySource {
  /** 수정 대상을 가리키는 값. 기록은 id, 메모는 firestoreId를 쓴다. */
  id?: string;
  firestoreId?: string;
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
    // ⚠️ 없는 값은 키를 아예 빼야 한다. undefined를 담아 두면 그대로 저장으로
    //    흘러가는데, Firestore는 배열 안에 든 undefined를 거부한다. 게다가 그
    //    오류는 어느 밭인지도 안 알려 준다("found in document …"). 실제로 크기가
    //    안 적힌 옛 첨부가 붙은 메모는 저장할 때마다 실패했다.
    list.push({
      name: obj.name || url.split('/').pop()?.split('?')[0] || '파일',
      url,
      ...(typeof obj.id === 'string' ? { id: obj.id } : {}),
      ...(typeof obj.type === 'string' ? { type: obj.type } : {}),
      ...(typeof obj.size === 'number' ? { size: obj.size } : {}),
      ...(typeof obj.driveId === 'string' ? { driveId: obj.driveId } : {}),
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
  const backdrop = useBackdropClose();

  const [content, setContent] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  /** 미리 골라 둘 라벨. 배너를 여는 그 순간의 값만 쓴다. */
  const defaultLabelRef = useRef(defaultLabel);
  defaultLabelRef.current = defaultLabel;
  const [attachments, setAttachments] = useState<EntryAttachment[]>([]);
  const [linkedItems, setLinkedItems] = useState<any[]>([]);

  const [saving, setSaving] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  // saving 상태는 다음 그림에서야 반영되므로, 연달아 들어온 저장을 막는 데는 쓸 수 없다.
  const savingRef = useRef(false);

  const handleSubmitRef = useRef<() => void>(() => {});

  // ⚠️ 이 효과는 '수정 대상이 바뀔 때'만 돌아야 한다. entry 객체 자체를 의존성으로
  // 잡으면 안 된다. 기록 화면은 라벨을 이름으로 풀어 넘기느라 그릴 때마다 새 객체를
  // 만드는데, 그러면 화면이 한 번 다시 그려질 때마다 이 효과가 돌아 폼이 통째로
  // 되돌아간다. 링크 추가 팝업을 열고 닫는 것만으로도 다시 그려지므로, '연결 저장'을
  // 눌러 담은 링크와 쓰던 글이 창이 닫히는 순간 사라졌다. 대상을 가리키는 값으로만 본다.
  const entryKey = entry ? String(entry.id ?? entry.firestoreId ?? '') : null;
  const entryRef = useRef<EntrySource | null>(entry);
  entryRef.current = entry;

  useEffect(() => {
    const source = entryRef.current;
    if (source) {
      setContent(source.content || source.text || '');
      setSelectedLabels(sourceLabels(source));
      setLinkedItems(source.linkedItems || []);
      setAttachments(normalizeAttachments(source.attachments, source.imageUrl));
    } else {
      setContent('');
      // 미리 골라 둘 라벨은 '열 때'의 값으로 정한다. 라벨은 구독으로 들어와서
      // 열고 나서 바뀔 수 있는데, 그 변화를 좇아 여기가 다시 돌면 적고 있던
      // 내용까지 함께 지워진다. 그래서 ref로 읽고 deps에서는 뺀다.
      const preset = defaultLabelRef.current;
      setSelectedLabels(preset && preset !== '전체' ? [preset] : []);
      setAttachments([]);
      setLinkedItems([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryKey, isOpen]);

  useEffect(() => {
    handleSubmitRef.current = () => handleSubmit();
  }, [content, selectedLabels, attachments, linkedItems]);

  // 💡 Esc로 닫는 동작은 useModalLayer의 전역 규칙(열린 팝업 전부 닫기)에 맡긴다.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
        e.preventDefault();
        // 키를 누른 채로 두면 브라우저가 keydown을 되풀이해 보낸다.
        // 되풀이분까지 저장하면 같은 메모가 여러 개 만들어진다.
        if (e.repeat) return;
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
    .map((att) => ({ url: attachmentImageSrc(att), name: att.name }));

  // 첨부는 두 화면이 서로 다른 모양으로 저장해 왔다. 기록은 type에 'image'/'file'과
  // id를, 메모는 MIME 타입을 쓴다. 저장된 형태를 바꾸지 않도록 여기서 맞춰준다.
  const makeAttachment = (
    name: string,
    url: string,
    mimeType: string,
    size?: number,
    seq = 0,
    driveId?: string
  ): EntryAttachment => {
    const isImage = mimeType.startsWith('image/');
    // size도 driveId와 같이 있을 때만 담는다 (undefined를 담으면 저장이 통째로 막힌다)
    const optional = {
      ...(typeof size === 'number' ? { size } : {}),
      ...(driveId ? { driveId } : {}),
    };
    if (kind === 'journal') {
      return {
        id: `file_${Date.now()}_${seq}`,
        name,
        url,
        type: isImage ? 'image' : 'file',
        ...optional,
      };
    }
    return {
      name,
      url,
      type: mimeType || 'application/octet-stream',
      ...optional,
    };
  };

  // 캡처 이미지를 Ctrl+V로 붙여넣으면 하단 첨부 목록에 이미지로 추가된다.
  // ⚠️ 훅은 반드시 아래 early return 위에서 호출해야 한다 (Rules of Hooks).
  const { handlePaste, pasting } = usePasteImageUpload((images) => {
    setAttachments((prev) => [
      ...prev,
      ...images.map((img, i) =>
        makeAttachment(img.name, img.url, img.mimeType || 'image/png', img.size, i, img.driveId)
      ),
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
      showToast('로그인이 필요합니다.');
      return;
    }

    try {
      setUploadingFiles(true);
      const uploaded: EntryAttachment[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // 이미지도 압축하지 않고 원본 그대로 올린다. 화면 캡처는 글자가 많아
        // 다시 인코딩하면 읽기 어려워진다.
        const drive = await uploadToDrive(file, file.name);
        uploaded.push(
          makeAttachment(file.name, driveUrlToStore(file.type, drive), file.type, file.size, i, drive.id)
        );
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (error) {
      console.error('파일 업로드 에러:', error);
      showErrorToast('파일 업로드에 실패했습니다.');
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
    // 앞선 저장이 아직 끝나지 않았다면 그냥 흘려보낸다.
    // 안 그러면 새 항목을 만드는 중에 또 만들어 같은 내용이 두 개가 된다.
    if (savingRef.current) return;
    savingRef.current = true;

    try {
      setSaving(true);
      await onSave({
        content: content.trim(),
        labels: selectedLabels,
        attachments,
        linkedItems,
        imageUrl: attachments.find(isImageAttachment)?.url,
      });
      // 저장해도 배너는 닫지 않는다. 닫기 버튼이나 배경 클릭으로만 닫힌다.
      showToast(`✅ ${text.noun}을(를) 저장했습니다.`);
    } catch (error) {
      showErrorToast(`${text.noun} 저장에 실패했습니다.`, error);
    } finally {
      savingRef.current = false;
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
        {...backdrop}
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
            title="닫기"
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
            <AutoTextarea
              autoFocus
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onPaste={handlePaste}
              placeholder={text.placeholder}
              className="w-full min-h-[84px] p-4 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-slate-800 leading-relaxed placeholder-slate-400 text-sm"
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
                            const i = viewerImages.findIndex((v) => v.url === attachmentImageSrc(att));
                            setViewerIndex(i >= 0 ? i : 0);
                            setViewerOpen(true);
                          }}
                          className="block w-full cursor-pointer"
                          title="클릭하여 크게 보기"
                        >
                          <img
                            src={attachmentImageSrc(att)}
                            alt={att.name}
                            className="w-full max-h-64 object-contain bg-white"
                            loading="lazy"
                          />
                        </button>
                        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-t border-slate-200">
                          <span className="text-xs text-slate-500 truncate" title={att.name}>
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
                            <span className="text-xs text-slate-400 block">
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
                await onDelete();
                onClose();
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
              닫기
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
                <span>저장</span>
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
