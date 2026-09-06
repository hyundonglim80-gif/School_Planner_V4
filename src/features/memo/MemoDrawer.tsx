import React, { useState, useEffect } from 'react';
import type { Memo } from '../../hooks/useMemos';
import { auth } from '../../lib/firebase';
import { uploadImage } from '../../utils/uploadHelper';

const PRESET_LABELS = ['긴급', '중요', '학급운영', '학부모상담', '수업준비', '행정업무', '개인'];

interface MemoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { content: string; labels: string[]; imageUrl?: string }) => Promise<void>;
  editingMemo?: Memo | null;
}

export default function MemoDrawer({ isOpen, onClose, onSave, editingMemo }: MemoDrawerProps) {
  const [content, setContent] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [customLabel, setCustomLabel] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [presetLabels, setPresetLabels] = useState<string[]>(PRESET_LABELS);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('workCalendar_memoLabels');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPresetLabels(parsed.map((l: any) => typeof l === 'string' ? l : l.name));
        }
      }
    } catch (e) {}
  }, [isOpen]);

  useEffect(() => {
    if (editingMemo) {
      setContent(editingMemo.content || editingMemo.text || '');
      setSelectedLabels(editingMemo.labels || []);
      setImageUrl(editingMemo.imageUrl || '');
    } else {
      setContent('');
      setSelectedLabels([]);
      setImageUrl('');
    }
  }, [editingMemo, isOpen]);

  // ESC 키로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleLabel = (label: string) => {
    if (selectedLabels.includes(label)) {
      setSelectedLabels(selectedLabels.filter(l => l !== label));
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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const user = auth.currentUser;
    if (!user) {
      alert('로그인이 필요합니다.');
      return;
    }

    try {
      setUploadingImage(true);
      const url = await uploadImage(file, user.uid);
      setImageUrl(url);
    } catch (error) {
      alert('이미지 업로드에 실패했습니다.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!content.trim()) return;

    try {
      setSaving(true);
      await onSave({
        content: content.trim(),
        labels: selectedLabels,
        imageUrl: imageUrl.trim() || undefined,
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
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
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

          {/* 라벨 선택 태그 */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-600">
              라벨 선택 (다중 선택 가능)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_LABELS.map((label) => {
                const isSelected = selectedLabels.includes(label);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleLabel(label)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {isSelected ? '✓ ' : ''}{label}
                  </button>
                );
              })}
            </div>

            {/* 사용자 정의 라벨 추가 */}
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
                className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-xs font-medium"
              >
                + 추가
              </button>
            </div>

            {/* 선택된 추가 라벨들 */}
            {selectedLabels.filter(l => !PRESET_LABELS.includes(l)).length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {selectedLabels
                  .filter(l => !PRESET_LABELS.includes(l))
                  .map(label => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-medium"
                    >
                      {label}
                      <button
                        type="button"
                        onClick={() => toggleLabel(label)}
                        className="hover:text-red-500 ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
              </div>
            )}
          </div>

          {/* 이미지 URL 첨부 */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-600">
              첨부 이미지
            </label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-colors cursor-pointer border border-slate-200">
                <span>📷</span>
                <span>{uploadingImage ? '업로드 중...' : '이미지 선택'}</span>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" disabled={uploadingImage} />
              </label>
              {imageUrl && (
                <button type="button" onClick={() => setImageUrl('')} className="px-3 py-2 text-xs font-bold text-red-500 bg-red-50 hover:bg-red-100 rounded-lg transition-colors border border-red-200">
                  삭제
                </button>
              )}
            </div>
            {imageUrl && (
              <div className="mt-2 rounded-lg overflow-hidden border border-slate-200 max-h-40">
                <img
                  src={imageUrl}
                  alt="미리보기"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* 하단 버튼 바 */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={saving || uploadingImage || !content.trim()}
            className="px-5 py-2 text-sm font-bold text-white bg-primary hover:bg-blue-600 rounded-xl shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
