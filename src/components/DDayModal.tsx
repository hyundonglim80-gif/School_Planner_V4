import React, { useState } from 'react';
import { useDDay, calculateDDay } from '../hooks/useDDay';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';

interface DDayModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DDayModal({ isOpen, onClose }: DDayModalProps) {
  useBodyScrollLock(isOpen);

  const vv = useVisualViewport(isOpen);
  const { dDayList, addDDay, deleteDDay } = useDDay();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date || submitting) return;

    try {
      setSubmitting(true);
      await addDDay(title.trim(), date);
      setTitle('');
      setDate('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4" style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height }}>
      {/* 백드롭 */}
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={onClose} />

      {/* 모달 창 */}
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl z-10 overflow-hidden flex flex-col max-h-full">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="text-xl">⏳</span>
            <h3 className="text-lg font-bold text-slate-800">학사 D-Day 관리</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 본문 */}
        <div className="p-6 overflow-y-auto overscroll-contain flex-1 min-h-0 space-y-5" data-scroll-lock>
          {/* 새 D-Day 등록 폼 */}
          <form onSubmit={handleSubmit} className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="text-xs font-bold text-slate-700">새 D-Day 추가</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="일정명 (예: 여름방학, 수능)"
                className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              />
              <button
                type="submit"
                disabled={!title.trim() || !date || submitting}
                className="px-3 py-1.5 bg-primary hover:bg-blue-600 text-white text-xs font-bold rounded-lg shadow-xs transition-colors disabled:opacity-40 shrink-0"
              >
                + 추가
              </button>
            </div>
          </form>

          {/* D-Day 목록 */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-500">등록된 D-Day ({dDayList.length})</div>
            {dDayList.length > 0 ? (
              dDayList.map((item) => {
                const calc = calculateDDay(item.date);
                const isUpcoming = calc.daysDiff >= 0;

                return (
                  <div
                    key={item.id}
                    className="p-3 bg-white border border-slate-200/80 rounded-xl flex items-center justify-between gap-3 shadow-2xs hover:border-slate-300 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`px-2.5 py-1 rounded-lg text-xs font-black ${
                          isUpcoming
                            ? 'bg-rose-50 text-rose-600 border border-rose-100'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {calc.text}
                      </span>
                      <div>
                        <div className="text-sm font-bold text-slate-800">{item.title}</div>
                        <div className="text-[16.5px] text-slate-400">{item.date}</div>
                      </div>
                    </div>

                    <button
                      onClick={() => deleteDDay(item.id)}
                      className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-slate-100 text-xs transition-colors"
                      title="삭제"
                    >
                      ✕
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8 text-slate-400 text-xs">
                등록된 D-Day 일정이 없습니다.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
