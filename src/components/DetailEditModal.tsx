import React, { useState, useEffect } from 'react';
import { useDayData } from '../hooks/useDayData';
import { useAppStore } from '../store/useAppStore';
import { useLabels } from '../hooks/useLabels';
import { auth } from '../lib/firebase';
import { uploadImage } from '../utils/uploadHelper';

export type DetailEditType = 'schedule' | 'event';

export interface DetailEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: DetailEditType;
  dateStr: string;
  itemId: string | number; // period(number) or event id(string)
  initialData: any; // PeriodSchedule or EventItem
}

export default function DetailEditModal({
  isOpen,
  onClose,
  type,
  dateStr,
  itemId,
  initialData,
}: DetailEditModalProps) {
  const { selectedGroupId, openLinkerModal, openEvaluationModal } = useAppStore();
  const { updateEventItem, deleteEventItem, savePeriod } = useDayData(isOpen ? dateStr : '', selectedGroupId);
  const { eventLabels } = useLabels();

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit states
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [supplies, setSupplies] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    if (isOpen && initialData) {
      if (type === 'schedule') {
        setSubject(initialData.subject || '');
        setContent(initialData.memo || initialData.content || '');
        setSupplies(initialData.supplies || '');
        setImageUrl(initialData.imageUrl || '');
      } else {
        // Event
        setContent(initialData.content || '');
        const initLabel = initialData.label || '';
        setLabels(initLabel.split(',').map((l: string) => l.trim()).filter(Boolean));
        setImageUrl(initialData.imageUrl || '');
      }
      setIsEditing(false); // Default to viewer mode for the modal
    }
  }, [isOpen, initialData, type]);

  if (!isOpen) return null;

  const toggleLabel = (labelName: string) => {
    setLabels(prev =>
      prev.includes(labelName)
        ? prev.filter(l => l !== labelName)
        : [...prev, labelName]
    );
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingImage(true);
      const url = await uploadImage(file, auth.currentUser?.uid || 'anonymous');
      setImageUrl(url);
    } catch (err) {
      console.error('Image upload failed', err);
      alert('이미지 업로드에 실패했습니다.');
    } finally {
      setUploadingImage(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      if (type === 'schedule') {
        await savePeriod(Number(itemId), {
          ...initialData,
          subject,
          memo: content,
          content,
          supplies,
          imageUrl,
        });
      } else {
        await updateEventItem(String(itemId), {
          content,
          label: labels.join(','),
          imageUrl,
        });
      }
      setIsEditing(false);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (type !== 'event') return;
    if (window.confirm('이 일정을 삭제하시겠습니까?')) {
      try {
        setSaving(true);
        await deleteEventItem(String(itemId));
        onClose();
      } finally {
        setSaving(false);
      }
    }
  };

  const title = type === 'schedule' ? `${itemId}교시 상세 정보` : '일정 상세 정보';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h2 className="text-lg font-black text-slate-800">{title}</h2>
          <div className="flex items-center gap-2">
            {!isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="px-3 py-1.5 text-xs font-bold text-white bg-primary rounded-lg hover:bg-blue-600 transition-colors"
              >
                ✏️ 수정
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 font-bold transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 flex-1 overflow-y-auto max-h-[70vh]">
          {/* Action Buttons */}
          {!isEditing && (
            <div className="flex flex-wrap gap-2 mb-5 pb-5 border-b border-slate-100">
              {type === 'schedule' && (
                <>
                  <button
                    type="button"
                    onClick={() => { openEvaluationModal(dateStr, 'schedule', Number(itemId), subject); onClose(); }}
                    className="px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                  >
                    📊 조사표 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => { openLinkerModal('schedule', dateStr, undefined, Number(itemId)); onClose(); }}
                    className="px-3 py-1.5 bg-yellow-50 text-yellow-600 hover:bg-yellow-100 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                  >
                    🔗 링크 추가
                  </button>
                </>
              )}
              {type === 'event' && (
                <button
                  type="button"
                  onClick={() => { openLinkerModal('event', dateStr, String(itemId)); onClose(); }}
                  className="px-3 py-1.5 bg-yellow-50 text-yellow-600 hover:bg-yellow-100 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                >
                  🔗 링크 추가
                </button>
              )}
            </div>
          )}

          {isEditing ? (
            <div className="flex flex-col gap-4">
              {type === 'schedule' && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">과목명</label>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">비고 / 준비물</label>
                    <input
                      type="text"
                      value={supplies}
                      onChange={(e) => setSupplies(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                </>
              )}
              {type === 'event' && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2">라벨 (다중 선택 가능)</label>
                  <div className="flex flex-wrap gap-2">
                    {eventLabels.map(l => {
                      const isSelected = labels.includes(l.name);
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => toggleLabel(l.name)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                            isSelected 
                              ? 'bg-primary text-white border-primary shadow-xs' 
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {l.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">
                  {type === 'schedule' ? '수업 메모' : '일정 내용'}
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                />
              </div>
              
              {/* Image Upload */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2">첨부 이미지</label>
                {imageUrl && (
                  <div className="relative inline-block mb-3">
                    <img src={imageUrl} alt="첨부" className="h-32 w-auto rounded-xl border border-slate-200 object-cover" />
                    <button 
                      type="button" 
                      onClick={() => setImageUrl('')} 
                      className="absolute -top-2 -right-2 bg-white rounded-full p-1 shadow-sm border border-slate-200 text-slate-500 hover:text-red-500 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                )}
                <div>
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition-colors">
                    <span>📷 {uploadingImage ? '업로드 중...' : '이미지 첨부'}</span>
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" disabled={uploadingImage} />
                  </label>
                </div>
              </div>

            </div>
          ) : (
            <div className="flex flex-col gap-5 text-sm text-slate-700">
              {type === 'schedule' && (
                <>
                  <div>
                    <span className="text-xs font-bold text-slate-400 block mb-1">과목명</span>
                    <p className="font-bold text-base">{subject || '미등록'}</p>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 block mb-1">비고 / 준비물</span>
                    <p className="font-semibold text-amber-600">{supplies || '없음'}</p>
                  </div>
                </>
              )}
              {type === 'event' && labels.length > 0 && (
                <div>
                  <span className="text-xs font-bold text-slate-400 block mb-1">라벨</span>
                  <div className="flex flex-wrap gap-1.5">
                    {labels.map(l => (
                      <span key={l} className="inline-block px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg font-bold text-xs">
                        {l}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <span className="text-xs font-bold text-slate-400 block mb-1">
                  {type === 'schedule' ? '수업 메모' : '일정 내용'}
                </span>
                <p className="whitespace-pre-wrap leading-relaxed">{content || '내용 없음'}</p>
              </div>
              
              {imageUrl && (
                <div>
                  <span className="text-xs font-bold text-slate-400 block mb-1">첨부 이미지</span>
                  <img src={imageUrl} alt="첨부" className="max-h-48 rounded-xl border border-slate-200 object-contain" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {isEditing && (
          <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50">
            {type === 'event' ? (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="px-4 py-2 text-xs font-bold text-red-500 hover:bg-red-50 rounded-xl transition-colors"
              >
                삭제
              </button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setIsEditing(false)}
                disabled={saving}
                className="px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-xs font-bold text-white bg-primary hover:bg-blue-600 rounded-xl shadow-xs transition-colors"
              >
                {saving ? '저장 중...' : '저장 완료'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
