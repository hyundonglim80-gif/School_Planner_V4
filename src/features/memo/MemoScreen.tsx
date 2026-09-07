import React, { useState } from 'react';
import { useMemos } from '../../hooks/useMemos';
import type { Memo } from '../../hooks/useMemos';
import { useAppStore } from '../../store/useAppStore';
import MemoCard from './MemoCard';
import MemoFilter from './MemoFilter';
import MemoDrawer from './MemoDrawer';
import QuickLinks from './QuickLinks';

export default function MemoScreen() {
  const { selectedGroupId } = useAppStore();
  const { memos, loading, addMemo, updateMemo, deleteMemo, toggleComplete } = useMemos(selectedGroupId);
  const [currentFilter, setCurrentFilter] = useState('전체');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingMemo, setEditingMemo] = useState<Memo | null>(null);

  const filteredMemos = currentFilter === '전체'
    ? memos
    : memos.filter(memo => memo.labels?.includes(currentFilter));

  const completedCount = memos.filter(m => m.completed).length;

  const handleOpenCreate = () => {
    setEditingMemo(null);
    setIsDrawerOpen(true);
  };

  const handleOpenEdit = (memo: Memo) => {
    setEditingMemo(memo);
    setIsDrawerOpen(true);
  };

  const handleSaveMemo = async (data: { content: string; labels: string[]; imageUrl?: string }) => {
    if (editingMemo) {
      await updateMemo(editingMemo.firestoreId, data);
    } else {
      await addMemo(data);
    }
  };

  return (
    <div className="animate-fade-in pb-12">
      {/* 라벨 필터 바 */}
      <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
        <MemoFilter currentFilter={currentFilter} onFilterChange={setCurrentFilter} />
        <button
          onClick={handleOpenCreate}
          className="bg-primary hover:bg-blue-600 active:scale-98 text-white px-4 py-2 rounded-xl font-bold shadow-sm hover:shadow-md transition-all flex items-center gap-2 text-xs"
        >
          <span className="text-sm leading-none font-extrabold">+</span>
          <span>새 메모</span>
        </button>
      </div>

      {/* 메모 목록 영역 */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">메모를 불러오는 중입니다...</p>
        </div>
      ) : filteredMemos.length > 0 ? (
        <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4 [column-fill:_balance]">
          {filteredMemos.map(memo => (
            <div key={memo.firestoreId} className="break-inside-avoid mb-4 inline-block w-full">
              <MemoCard
                memo={memo}
                onEdit={handleOpenEdit}
                onToggleComplete={toggleComplete}
                onDelete={deleteMemo}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-300 p-8 shadow-xs">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-50 flex items-center justify-center text-2xl">
            📝
          </div>
          <p className="text-slate-600 font-bold text-base">
            {currentFilter === '전체' ? '등록된 메모가 없습니다.' : currentFilter + ' 라벨의 메모가 없습니다.'}
          </p>
          <p className="text-slate-400 text-xs mt-1.5">
            우측 상단의 '+ 새 메모' 버튼을 눌러 첫 메모를 작성해 보세요.
          </p>
          <button
            onClick={handleOpenCreate}
            className="mt-5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors inline-block"
          >
            지금 작성하기
          </button>
        </div>
      )}

      {/* 우측 슬라이드 패널 (Drawer) */}
      <MemoDrawer
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setEditingMemo(null);
        }}
        onSave={handleSaveMemo}
        editingMemo={editingMemo}
      />
    </div>
  );
}
