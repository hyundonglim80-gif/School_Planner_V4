import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { Trash2, X, CheckSquare, CalendarDays } from 'lucide-react';
import { doc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

export default function MultiEventActionBar() {
  const { isMultiSelectMode, selectedEventIds, setMultiSelectMode, clearEventSelection } = useAppStore();

  if (!isMultiSelectMode) return null;

  const handleDelete = async () => {
    if (selectedEventIds.length === 0) return;
    const confirmDelete = window.confirm(`선택한 ${selectedEventIds.length}개의 일정을 삭제하시겠습니까?`);
    if (!confirmDelete) return;

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    try {
      await Promise.all(
        selectedEventIds.map((id) => deleteDoc(doc(db, 'users', uid, 'events', id)))
      );
      clearEventSelection();
    } catch (e) {
      console.error(e);
      alert('일괄 삭제 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-slide-up">
      <div className="bg-slate-800 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-4 min-w-[320px] justify-between border border-slate-700/50">
        <div className="flex items-center gap-2">
          <div className="bg-primary text-white text-xs font-black w-6 h-6 rounded-full flex items-center justify-center">
            {selectedEventIds.length}
          </div>
          <span className="text-sm font-medium">선택됨</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleDelete}
            disabled={selectedEventIds.length === 0}
            className="p-2 text-slate-300 hover:text-red-400 hover:bg-slate-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="일괄 삭제"
          >
            <Trash2 size={18} />
          </button>
          {/* 향후 일괄 날짜 이동 기능 추가 가능 */}
          <button
            onClick={() => alert("일괄 이동 기능은 아직 준비 중입니다.")}
            disabled={selectedEventIds.length === 0}
            className="p-2 text-slate-300 hover:text-blue-400 hover:bg-slate-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="날짜 이동"
          >
            <CalendarDays size={18} />
          </button>
          
          <div className="w-[1px] h-6 bg-slate-600 mx-1"></div>
          
          <button
            onClick={clearEventSelection}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-xl transition-colors"
            title="취소"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
