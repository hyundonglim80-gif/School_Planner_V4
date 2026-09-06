import React, { useState } from 'react';
import type { JournalEntry } from '../../hooks/useDayData';
import { renderFormattedText } from '../../lib/textUtils';
import { useAppStore } from '../../store/useAppStore';

interface DayJournalProps {
  journals: JournalEntry[];
  onAddJournal: (content: string, label: string) => Promise<void>;
  onDeleteJournal: (id: string) => Promise<void>;
}

const JOURNAL_LABELS = ['학급경영', '학생상담', '학부모연락', '행정업무', '수업성찰', '기타'];

export default function DayJournal({
  journals,
  onAddJournal,
  onDeleteJournal,
}: DayJournalProps) {
  const [content, setContent] = useState('');
  const [selectedLabel, setSelectedLabel] = useState('학급경영');
  const [submitting, setSubmitting] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const { mode } = useAppStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || submitting) return;

    try {
      setSubmitting(true);
      await onAddJournal(content.trim(), selectedLabel);
      setContent('');
      setIsFormOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">📋</span>
          <h3 className="text-base font-extrabold text-slate-800">기록</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {journals.length}
          </span>
        </div>

        {mode === 'editor' && !isFormOpen && (
          <button
            onClick={() => setIsFormOpen(true)}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
          >
            + 일지 작성
          </button>
        )}
      </div>

      {/* 새 일지 작성 폼 */}
      {isFormOpen && (
        <form onSubmit={handleSubmit} className="mb-4 p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500 mr-1">분류:</span>
            {JOURNAL_LABELS.map((lbl) => (
              <button
                key={lbl}
                type="button"
                onClick={() => setSelectedLabel(lbl)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  selectedLabel === lbl
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {lbl}
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
              disabled={!content.trim() || submitting}
              className="px-4 py-1.5 bg-primary hover:bg-blue-600 text-white text-xs font-bold rounded-xl shadow-xs transition-colors disabled:opacity-40"
            >
              {submitting ? '등록 중...' : '등록'}
            </button>
          </div>
        </form>
      )}

      {/* 일지 목록 */}
      <div className="space-y-2.5">
        {journals.length > 0 ? (
          journals.map((entry) => (
            <div
              key={entry.id}
              className="group p-3.5 rounded-xl border border-slate-200/60 hover:border-slate-300 bg-white transition-all flex flex-col gap-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-100">
                    {entry.label || '일반'}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {new Date(entry.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <button
                  onClick={() => {
                    if (window.confirm('이 일지를 삭제하시겠습니까?')) {
                      onDeleteJournal(entry.id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 p-1 rounded-md text-xs transition-opacity"
                  title="삭제"
                >
                  ✕
                </button>
              </div>

              <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                {entry.content}
              </p>
            </div>
          ))
        ) : (
          <div className="py-8 text-center text-slate-400 text-xs">
            <p>기록된 학급 및 업무 일지가 없습니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
