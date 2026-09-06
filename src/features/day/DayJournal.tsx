import React, { useState, useEffect } from 'react';
import type { JournalEntry } from '../../hooks/useDayData';
import { renderFormattedText } from '../../lib/textUtils';
import { useAppStore } from '../../store/useAppStore';
import { DEFAULT_JOURNAL_LABELS, type JournalLabel } from '../../components/LabelModal';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { uploadImage } from '../../utils/uploadHelper';

interface DayJournalProps {
  journals: JournalEntry[];
  onAddJournal: (content: string, label: string, labelIds?: string[], imageUrl?: string) => Promise<void>;
  onDeleteJournal: (id: string) => Promise<void>;
  onUpdateJournal?: (id: string, updates: Partial<JournalEntry>) => Promise<void>;
}

export default function DayJournal({
  journals,
  onAddJournal,
  onDeleteJournal,
  onUpdateJournal,
}: DayJournalProps) {
  const [content, setContent] = useState('');
  const [selectedLabel, setSelectedLabel] = useState('학급활동');
  const [submitting, setSubmitting] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const { openLinkerModal, currentDate } = useAppStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editLabel, setEditLabel] = useState('학급활동');
  const [editImageUrl, setEditImageUrl] = useState('');

  const [journalLabels, setJournalLabels] = useState<JournalLabel[]>(DEFAULT_JOURNAL_LABELS);

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
  }, []);

  const getLabelName = (entry: JournalEntry) => {
    if (entry.labelIds && entry.labelIds.length > 0) {
      const found = journalLabels.find(l => l.id === entry.labelIds![0]);
      if (found) return found.name;
    }
    if (entry.label && entry.label.startsWith('j_')) {
      const found = journalLabels.find(l => l.id === entry.label);
      if (found) return found.name;
    }
    return entry.label || '일반';
  };

  const getLabelColorClass = (entry: JournalEntry) => {
    let color = 'gray';
    if (entry.labelIds && entry.labelIds.length > 0) {
      const found = journalLabels.find(l => l.id === entry.labelIds![0]);
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
    if (!content.trim() || submitting || uploadingImage) return;

    try {
      setSubmitting(true);
      await onAddJournal(content.trim(), selectedLabel, [], imageUrl);
      setContent('');
      setImageUrl('');
      setIsFormOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const startEditing = (entry: JournalEntry) => {
    setEditingId(entry.id);
    setEditContent(entry.content);
    setEditLabel(entry.label || '일반');
    setEditImageUrl(entry.imageUrl || '');
  };

  const saveEditing = async (id: string) => {
    if (!editContent.trim() || uploadingImage) return;
    if (onUpdateJournal) {
      await onUpdateJournal(id, {
        content: editContent.trim(),
        label: editLabel,
        imageUrl: editImageUrl,
      });
    }
    setEditingId(null);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, isEditMode: boolean = false) => {
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
      if (isEditMode) {
        setEditImageUrl(url);
      } else {
        setImageUrl(url);
      }
    } catch (error) {
      alert('이미지 업로드에 실패했습니다.');
    } finally {
      setUploadingImage(false);
    }
  };

  const [isCollapsed, setIsCollapsed] = useState(false);
  const formattedDate = new Date(currentDate).toISOString().split('T')[0];

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5">
      <div className={`flex items-center justify-between ${isCollapsed ? '' : 'mb-4'}`}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-slate-400 hover:text-slate-700 text-xs px-1 py-0.5 rounded hover:bg-slate-100 transition-colors"
            title={isCollapsed ? '기록 펼치기' : '기록 접기'}
          >
            {isCollapsed ? '▶' : '▼'}
          </button>
          <span className="text-xl">📋</span>
          <h3 className="text-base font-extrabold text-slate-800">기록</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {journals.length}
          </span>
          <div className="flex items-center gap-1 ml-1">
            <button
              type="button"
              onClick={() => openLinkerModal('journal', formattedDate)}
              className="px-2 py-0.5 bg-yellow-50 text-yellow-700 border border-yellow-300 rounded-md text-[10px] font-bold hover:bg-yellow-100 transition-colors"
              title="기록에 링크 연결"
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
            + 일지 작성
          </button>
        )}
      </div>

      {!isCollapsed && (
        <>
          {isFormOpen && (
            <form onSubmit={handleSubmit} className="mb-4 p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-500 mr-1">분류:</span>
                {journalLabels.map((lbl) => (
                  <button
                    key={lbl.id}
                    type="button"
                    onClick={() => setSelectedLabel(lbl.name)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                      selectedLabel === lbl.name
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {lbl.name}
                  </button>
                ))}
              </div>

              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="오늘의 학급 상황, 학생 지도 및 업무 메모를 기록하세요..."
                rows={3}
                className="w-full p-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary resize-none placeholder-slate-400 leading-relaxed"
                autoFocus
              />

              {imageUrl && (
                <div className="relative inline-block mt-2">
                  <img src={imageUrl} alt="첨부 이미지" className="h-24 w-auto rounded-lg border border-slate-200 object-cover" />
                  <button type="button" onClick={() => setImageUrl('')} className="absolute -top-2 -right-2 bg-white rounded-full p-0.5 shadow-sm border border-slate-200 text-slate-500 hover:text-red-500 hover:bg-red-50 text-xs">✕</button>
                </div>
              )}

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-200/50 hover:bg-slate-200 text-slate-600 rounded-xl text-[11px] font-bold transition-colors cursor-pointer">
                  <span>📷</span>
                  <span>{uploadingImage ? '업로드 중...' : '이미지 첨부'}</span>
                  <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, false)} className="hidden" disabled={uploadingImage} />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(false)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-200/60 rounded-xl transition-colors"
                  >
                    닫기
                  </button>
                  <button
                    type="submit"
                    disabled={!content.trim() || submitting || uploadingImage}
                    className="px-4 py-1.5 bg-primary hover:bg-blue-600 text-white text-xs font-bold rounded-xl shadow-xs transition-colors disabled:opacity-40"
                  >
                    {submitting ? '등록 중...' : '등록'}
                  </button>
                </div>
              </div>
            </form>
          )}

          <div className="space-y-2.5">
            {journals.length > 0 ? (
              journals.map((entry) => {
                const isEditing = editingId === entry.id;
                const linkCount = (entry.linkedItems || []).length;

                if (isEditing) {
                  return (
                    <div key={entry.id} className="p-3.5 rounded-xl border border-primary/50 bg-blue-50/30 flex flex-col gap-3 shadow-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-500 mr-1">분류:</span>
                        {journalLabels.map((lbl) => (
                          <button
                            key={lbl.id}
                            type="button"
                            onClick={() => setEditLabel(lbl.name)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                              editLabel === lbl.name
                                ? 'bg-blue-600 text-white shadow-xs'
                                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {lbl.name}
                          </button>
                        ))}
                      </div>

                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={3}
                        className="w-full p-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary resize-none leading-relaxed"
                        autoFocus
                      />
                      
                      {editImageUrl && (
                        <div className="relative inline-block mb-2">
                          <img src={editImageUrl} alt="첨부 이미지" className="h-24 w-auto rounded-lg border border-slate-200 object-cover" />
                          <button type="button" onClick={() => setEditImageUrl('')} className="absolute -top-2 -right-2 bg-white rounded-full p-0.5 shadow-sm border border-slate-200 text-slate-500 hover:text-red-500 hover:bg-red-50 text-xs">✕</button>
                        </div>
                      )}

                      <div className="flex justify-between items-center">
                        <label className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-200/50 hover:bg-slate-200 text-slate-600 rounded-xl text-[11px] font-bold transition-colors cursor-pointer">
                          <span>📷</span>
                          <span>{uploadingImage ? '업로드 중...' : '이미지 변경'}</span>
                          <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, true)} className="hidden" disabled={uploadingImage} />
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
                            disabled={uploadingImage}
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
                    className="group p-3.5 rounded-xl border border-slate-200/60 hover:border-slate-300 bg-white transition-all flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${getLabelColorClass(entry)}`}>
                          {getLabelName(entry)}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {new Date(entry.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        
                        {linkCount > 0 && (
                          <button 
                            onClick={() => openLinkerModal('journal', formattedDate, entry.id)}
                            className="bg-yellow-100 text-yellow-800 text-[10px] px-1.5 py-0.5 rounded font-bold border border-yellow-300 ml-1 hover:bg-yellow-200"
                          >
                            📑 {linkCount}
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => startEditing(entry)}
                          className="text-slate-400 hover:text-blue-600 p-1 rounded-md text-xs font-bold"
                          title="기록 수정"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => openLinkerModal('journal', formattedDate, entry.id)}
                          className="text-slate-400 hover:text-yellow-600 p-1 rounded-md text-xs font-bold"
                          title="링크 추가"
                        >
                          🔗
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm('이 일지를 삭제하시겠습니까?')) {
                              onDeleteJournal(entry.id);
                            }
                          }}
                          className="text-slate-400 hover:text-red-500 p-1 rounded-md text-xs"
                          title="삭제"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <p
                        onDoubleClick={() => startEditing(entry)}
                        className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed cursor-text"
                        title="더블클릭하여 수정"
                      >
                        {entry.content}
                      </p>
                      {entry.imageUrl && (
                        <div className="mt-2 rounded-lg overflow-hidden border border-slate-200/60 bg-slate-50 inline-block">
                          <img src={entry.imageUrl} alt="첨부 이미지" className="max-w-full h-auto object-cover max-h-48" loading="lazy" />
                        </div>
                      )}
                    </div>
              </div>
            );
          })
        ) : (
          <div className="py-8 text-center text-slate-400 text-xs">
            <p>기록된 학급 및 업무 일지가 없습니다.</p>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
