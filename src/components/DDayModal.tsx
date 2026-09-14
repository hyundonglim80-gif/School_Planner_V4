import React, { useState } from 'react';
import { useDDay, calculateDDay } from '../hooks/useDDay';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer, closeAllModals } from '../hooks/useModalLayer';

interface DDayModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DDayModal({ isOpen, onClose }: DDayModalProps) {
  useBodyScrollLock(isOpen);

  const vv = useVisualViewport(isOpen);

  const zIndex = useModalLayer(isOpen, onClose);
  const { dDayList, addDDay, deleteDDay, selectedDDayId, selectDDay } = useDDay();
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
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto p-4" style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }}>
      {/* 백드롭 */}
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={closeAllModals} />

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
        <div className="px-6 py-5 overflow-y-auto overscroll-contain flex-1 min-h-0 space-y-5" data-scroll-lock>
          {/* 새 D-Day 등록 폼 - 한 줄에 밀어넣지 않고 두 줄로 나눈다 (좁은 화면에서 깨졌다) */}
          <form onSubmit={handleSubmit} className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
            <div className="text-xs font-bold text-slate-700">새 D-Day 추가</div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="일정명 (예: 여름방학, 수능)"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="flex-1 min-w-0 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              />
              <button
                type="submit"
                disabled={!title.trim() || !date || submitting}
                className="px-4 py-2 bg-primary hover:bg-blue-600 text-white text-xs font-bold rounded-lg shadow-xs transition-colors disabled:opacity-40 shrink-0"
              >
                {submitting ? '추가 중...' : '+ 추가'}
              </button>
            </div>
          </form>

          {/* D-Day 목록 */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-500">
              등록된 D-Day ({dDayList.length})
              <span className="font-medium text-slate-400"> · 항목을 누르면 상단에 표시됩니다</span>
            </div>
            {dDayList.length > 0 ? (
              dDayList.map((item) => {
                const calc = calculateDDay(item.date);
                const isUpcoming = calc.daysDiff >= 0;
                const isSelected = item.id === selectedDDayId;

                return (
                  <div
                    key={item.id}
                    className={`p-2.5 bg-white border rounded-xl flex items-center gap-2 shadow-2xs transition-all ${
                      isSelected
                        ? 'border-primary ring-1 ring-primary/30'
                        : 'border-slate-200/80 hover:border-slate-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => selectDDay(isSelected ? null : item.id)}
                      className="flex items-center gap-2.5 text-left flex-1 min-w-0"
                      title={isSelected ? '상단 표시 해제' : '상단에 표시'}
                    >
                      <span
                        className={`px-2 py-1 rounded-lg text-xs font-black shrink-0 ${
                          isUpcoming
                            ? 'bg-rose-50 text-rose-600 border border-rose-100'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {calc.text}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-slate-800 truncate">
                          {isSelected && <span className="text-primary">★ </span>}
                          {item.title}
                        </span>
                        <span className="block text-[11px] text-slate-400">{item.date}</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => deleteDDay(item.id)}
                      className="px-2.5 py-1.5 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors shrink-0"
                      title="이 D-Day 삭제 (휴지통에서 복원 가능)"
                    >
                      삭제
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

        {/* 푸터 - 다른 팝업과 같이 닫기 버튼을 둔다 */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/60 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
