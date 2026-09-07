import React, { useState, useEffect } from 'react';
import type { Memo, MemoAttachment } from '../../hooks/useMemos';
import { auth, db } from '../../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { uploadImage, uploadFile } from '../../utils/uploadHelper';
import { useAppStore } from '../../store/useAppStore';

const PRESET_LABELS = ['긴급', '중요', '학급운영', '학부모상담', '수업준비', '행정업무', '개인'];

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
}

export default function MemoDrawer({ isOpen, onClose, onSave, editingMemo }: MemoDrawerProps) {
  const { openLabelModal, isLabelModalOpen } = useAppStore();
  const [content, setContent] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [customLabel, setCustomLabel] = useState('');
  const [attachments, setAttachments] = useState<MemoAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [presetLabels, setPresetLabels] = useState<string[]>(PRESET_LABELS);

  // 라벨 목록 불러오기 (Firestore 및 localStorage 연동, 모달 닫힐 때도 최신화)
  useEffect(() => {
    const fetchMemoLabels = async () => {
      // 1. localStorage 우선 조회
      try {
        const saved = localStorage.getItem('workCalendar_memoLabels');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setPresetLabels(parsed.map((l: any) => (typeof l === 'string' ? l : l.name)));
          }
        }
      } catch (e) {}

      // 2. Firestore 최신 라벨 데이터 동기화
      const user = auth.currentUser;
      if (!user) return;

      try {
        const docRef = doc(db, 'users', user.uid, 'settings', 'labels');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          if (Array.isArray(data.memoLabels) && data.memoLabels.length > 0) {
            const labelNames = data.memoLabels.map((l: any) => (typeof l === 'string' ? l : l.name));
            setPresetLabels(labelNames);
          }
        }
      } catch (e) {
        console.error('Failed to fetch memo labels:', e);
      }
    };

    fetchMemoLabels();
  }, [isOpen, isLabelModalOpen]);

  useEffect(() => {
    if (editingMemo) {
      setContent(editingMemo.content || editingMemo.text || '');
      setSelectedLabels(editingMemo.labels || []);

      // 기존 첨부파일 또는 imageUrl 안전 초기화
      let initialAttachments: MemoAttachment[] = [];
      if (editingMemo.attachments && Array.isArray(editingMemo.attachments)) {
        const parsedList: MemoAttachment[] = [];
        for (const item of editingMemo.attachments) {
          if (!item) continue;
          const raw = item as any;
          if (typeof raw === 'string') {
            const url = raw.trim();
            if (url) {
              const name = url.split('/').pop()?.split('?')[0] || '첨부 파일';
              parsedList.push({ name, url, type: '' });
            }
          } else {
            const url = raw.url || raw.downloadUrl || raw.fileUrl || '';
            if (url && typeof url === 'string') {
              const name = raw.name || url.split('/').pop()?.split('?')[0] || '첨부 파일';
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
            name: '첨부 이미지',
            url: editingMemo.imageUrl,
            type: 'image/jpeg',
          },
        ];
      }
      setAttachments(initialAttachments);
    } else {
      setContent('');
      setSelectedLabels([]);
      setAttachments([]);
    }
  }, [editingMemo, isOpen]);

  // ESC 키로 닫기 (라벨 모달이 열려있지 않을 때만)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isLabelModalOpen) {
        onClose();
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

  // 모든 형태의 파일 업로드 (다중 선택 및 중복/누적 첨부 지원)
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

      // 기존 첨부파일 목록에 추가 (누적/중복 첨부)
      setAttachments((prev) => [...prev, ...newAttachments]);
    } catch (error) {
      console.error('파일 업로드 오류:', error);
      alert('파일 업로드 중 오류가 발생했습니다.');
    } finally {
      setUploadingFiles(false);
      // 같은 파일을 다시 선택할 수 있도록 input value 초기화
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
    if (type.includes('pdf') || (typeof name === 'string' && name.endsWith('.pdf'))) return '📕';
    if (typeof name === 'string' && name.match(/\.(doc|docx|hwp|hwpx|txt)$/i)) return '📄';
    if (typeof name === 'string' && name.match(/\.(xls|xlsx|csv)$/i)) return '📊';
    if (typeof name === 'string' && name.match(/\.(zip|7z|tar|gz|rar)$/i)) return '📦';
    return '📎';
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!content.trim()) return;

    try {
      setSaving(true);

      // 첫 번째 이미지를 imageUrl로 함께 지정하여 구버전과의 호환성 보장
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
      console.error('메모 저장 실패:', error);
      alert('메모 저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 배경 오버레이 */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300"
        onClick={onClose}
      />

      {/* 우측 슬라이드 패널 (Drawer) */}
      <div className="relative w-full max-w-lg bg-white h-full shadow-2xl z-10 flex flex-col transform transition-transform duration-300 ease-in-out">
        {/* 상단 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-800">
              {editingMemo ? '메모 수정' : '새 메모 작성'}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              단축키 Ctrl + Enter로 빠르게 저장할 수 있습니다.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* 본문 입력 영역 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 메모 내용 Textarea */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-600">
              메모 내용 <span className="text-red-500">*</span>
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
              placeholder="메모할 내용을 입력하세요..."
              className="w-full h-44 p-4 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none text-slate-800 leading-relaxed placeholder-slate-400 text-sm"
            />
          </div>

          {/* 1. 라벨 선택 태그 & 라벨 설정 버튼 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-600">
                라벨 선택 (다중 선택 가능)
              </label>
              {/* 더보기-라벨 설정으로 연결되는 버튼 */}
              <button
                type="button"
                onClick={() => openLabelModal('memo')}
                className="text-xs text-primary hover:text-blue-700 font-bold flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-blue-50 transition-colors cursor-pointer"
                title="더보기 메뉴의 통합 라벨 설정(메모 탭)으로 이동"
              >
                <span>⚙️</span>
                <span>라벨 설정</span>
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

            {/* 사용자 정의 라벨 즉시 추가 */}
            <div className="flex gap-2 pt-2">
              <input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="새 라벨 직접 입력..."
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
                + 추가
              </button>
            </div>

            {/* 선택된 추가 라벨들 */}
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
                        ×
                      </button>
                    </span>
                  ))}
              </div>
            )}
          </div>

          {/* 2. 첨부 파일 (모든 형태의 파일 지원, 다중/중복 첨부 가능) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-600">
                첨부 파일 ({attachments.length}개)
              </label>
              <span className="text-[11px] text-slate-400">모든 파일 형식 및 다중 선택 가능</span>
            </div>

            {/* 파일 첨부 버튼 */}
            <label className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer border border-dashed border-slate-300 shadow-2xs">
              <span>{uploadingFiles ? '⏳' : '📎'}</span>
              <span>{uploadingFiles ? '파일 업로드 중...' : '파일 첨부하기 (다중/추가 선택)'}</span>
              <input
                type="file"
                multiple
                onChange={handleFileUpload}
                className="hidden"
                disabled={uploadingFiles}
              />
            </label>

            {/* 첨부된 파일 목록 (중복/다중 첨부 렌더링) */}
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
                        title="파일 삭제"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 하단 버튼 바 */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3 bg-slate-50/50">
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
              <span>{editingMemo ? '수정 완료' : '메모 등록'}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
