import React, { useState, useEffect, useRef } from 'react';
import type { Memo, MemoAttachment } from '../../hooks/useMemos';
import { auth, db } from '../../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { uploadImage, uploadFile } from '../../utils/uploadHelper';
import { useAppStore } from '../../store/useAppStore';

const PRESET_LABELS = [' ', ' ', ' ', ' ', ' ', ' ', ' '];

interface MemoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    content: string;
    labels: string[];
    imageUrl?: string;
    attachments?: MemoAttachment[];
  }) => Promise<void>;
  editingMemo?: Memo | null;
  onDelete?: (firestoreId: string) => Promise<void>;
  defaultLabel?: string;
}

export default function MemoDrawer({ isOpen, onClose, onSave, editingMemo, onDelete, defaultLabel }: MemoDrawerProps) {
  const { openLabelModal, isLabelModalOpen } = useAppStore();
  const [content, setContent] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [customLabel, setCustomLabel] = useState('');
  const [attachments, setAttachments] = useState<MemoAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [presetLabels, setPresetLabels] = useState<string[]>(PRESET_LABELS);

  const handleSubmitRef = useRef<() => void>(() => {});

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
      
      let initialAttachments: MemoAttachment[] = [];
      if (editingMemo.attachments && Array.isArray(editingMemo.attachments)) {
        const parsedList: MemoAttachment[] = [];
        for (const item of editingMemo.attachments) {
          if (!item) continue;
          const raw = item as any;
          if (typeof raw === 'string') {
            const url = raw.trim();
            if (url) {
              const name = url.split('/').pop()?.split('?')[0] || ' ';
              parsedList.push({ name, url, type: '' });
            }
          } else {
            const url = raw.url || raw.downloadUrl || raw.fileUrl || '';
            if (url && typeof url === 'string') {
              const name = raw.name || url.split('/').pop()?.split('?')[0] || ' ';
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
            name: ' ',
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
    }
  }, [editingMemo, isOpen, defaultLabel]);

  useEffect(() => {
    handleSubmitRef.current = () => handleSubmit();
  }, [content, selectedLabels, attachments]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape' && !isLabelModalOpen) {
        onClose();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSubmitRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLabelModalOpen, onClose]);

  if (!isOpen) return null;

  const toggleLabel = (label: string) => {
    if (selectedLabels.includes(label)) {
      setSelectedLabels(selectedLabels.filter((l) => l !== label));
    } else {
      setSelectedLabels([...selectedLabels, label]);
    }
  };

  const handleAddCustomLabel = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customLabel.trim();
    if (trimmed && !selectedLabels.includes(trimmed)) {
      setSelectedLabels([...selectedLabels, trimmed]);
      setCustomLabel('');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const user = auth.currentUser;
    if (!user) {
      alert(' .');
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
      console.error(' :', error);
      alert(' .');
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
      return ' ';
    }
    if (type.includes('pdf') || (typeof name === 'string' && name.endsWith('.pdf'))) return ' ';
    if (typeof name === 'string' && name.match(/\.(doc|docx|hwp|hwpx|txt)$/i)) return ' ';
    if (typeof name === 'string' && name.match(/\.(xls|xlsx|csv)$/i)) return ' ';
    if (typeof name === 'string' && name.match(/\.(zip|7z|tar|gz|rar)$/i)) return ' ';
    return ' ';
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
      });
      onClose();
    } catch (error) {
      console.error(' :', error);
      alert(' .');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300"
        onClick={onClose}
      />

      <div className="relative w-full max-w-lg bg-white h-full shadow-2xl z-10 flex flex-col transform transition-transform duration-300 ease-in-out">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-800">
              {editingMemo ? ' ' : ' '}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
                Ctrl + Enter
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
                       
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-600">
                <span className="text-red-500">*</span>
            </label>
            <textarea
              autoFocus
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder=" ..."
              className="w-full h-44 p-4 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none text-slate-800 leading-relaxed placeholder-slate-400 text-sm"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-600">
                               
              </label>
              <button
                type="button"
                onClick={() => openLabelModal('memo')}
                className="text-xs text-primary hover:text-blue-700 font-bold flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-blue-50 transition-colors cursor-pointer"
                title=" "
              >
                <span> </span>
                <span> </span>
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
                    {isSelected ? '  ' : ''}
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2 pt-2">
              <input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder=" ..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomLabel(e);
                  }
                }}
                className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={handleAddCustomLabel}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-xs font-medium cursor-pointer"
              >
                + 
              </button>
            </div>

            {selectedLabels.filter((l) => !presetLabels.includes(l)).length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {selectedLabels
                  .filter((l) => !presetLabels.includes(l))
                  .map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-medium"
                    >
                      {label}
                      <button
                        type="button"
                        onClick={() => toggleLabel(label)}
                        className="hover:text-red-500 ml-0.5 cursor-pointer font-bold"
                      >
                                               
                      </button>
                    </span>
                  ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-600">
                  ({attachments.length} )
              </label>
              <span className="text-[11px] text-slate-400"> </span>
            </div>

            <label className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer border border-dashed border-slate-300 shadow-2xs">
              <span>{uploadingFiles ? ' ' : ' '}</span>
              <span>{uploadingFiles ? ' ...' : ' )'}</span>
              <input
                type="file"
                multiple
                onChange={handleFileUpload}
                className="hidden"
                disabled={uploadingFiles}
              />
            </label>

            {attachments.length > 0 && (
              <div className="space-y-2 pt-1">
                {attachments.map((att, idx) => {
                  const url = att?.url || '';
                  const type = att?.type || '';
                  const isImage =
                    (typeof type === 'string' && type.startsWith('image/')) ||
                    (typeof url === 'string' && url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i));

                  return (
                    <div
                      key={`${att.url}-${idx}`}
                      className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl gap-2 hover:bg-slate-100/80 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {isImage ? (
                          <img
                            src={att.url}
                            alt={att.name}
                            className="w-9 h-9 object-cover rounded-lg border border-slate-200 shrink-0"
                          />
                        ) : (
                          <span className="text-xl shrink-0">{getFileIcon(att)}</span>
                        )}
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
                            <span className="text-[10px] text-slate-400 block">
                              {formatFileSize(att.size)}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(idx)}
                        className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0"
                        title=" "
                      >
                                               
                      </button>
                    </div>
                  );
                })}
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
                  <span>저장중...</span>
                </>
              ) : (
                <span>{editingMemo ? '수정 (Ctrl+S)' : '저장 (Ctrl+S)'}</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}