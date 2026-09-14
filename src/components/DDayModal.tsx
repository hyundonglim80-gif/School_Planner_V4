import React, { useState } from 'react';
import { useDDay, calculateDDay } from '../hooks/useDDay';
import ModalShell, { ModalCloseButton } from './ModalShell';

interface DDayModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DDayModal({ isOpen, onClose }: DDayModalProps) {
  const { dDayList, addDDay, deleteDDay, selectedDDayId, selectDDay } = useDDay();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="md"
      title="⏳ 학사 D-Day 관리"
      footer={<ModalCloseButton onClose={onClose} />}
    >
      <div className="space-y-5">
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
    </ModalShell>
  );
}
