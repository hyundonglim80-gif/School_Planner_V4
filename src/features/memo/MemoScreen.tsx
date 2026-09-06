import React, { useState } from 'react';
import { useMemos } from '../../hooks/useMemos';
import type { Memo } from '../../hooks/useMemos';
import { useAppStore } from '../../store/useAppStore';
import MemoCard from './MemoCard';
import MemoFilter from './MemoFilter';
import MemoDrawer from './MemoDrawer';
import QuickLinks from './QuickLinks';

export default function MemoScreen() {
  const { selectedGroupId, mode } = useAppStore();
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
      {/* 상단 헤더 및 액션 바 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">메모 보관함</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-primary border border-blue-100">
              총 {memos.length}개 {completedCount > 0 && `(완료 ${completedCount})`}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            학교 업무, 수업 아이디어, 학생 상담 메모를 편리하게 관리하세요.
          </p>
        </div>

        {mode === 'editor' && (
          <button
            onClick={handleOpenCreate}
            className="bg-primary hover:bg-blue-600 active:scale-98 text-white px-5 py-2.5 rounded-xl font-bold shadow-sm hover:shadow-md transition-all flex items-center gap-2 text-sm"
          >
            <span className="text-base leading-none font-extrabold">+</span>
            <span>새 메모</span>
          </button>
        )}
      </div>

      {/* 라벨 필터 바 */}
      <QuickLinks />
      <MemoFilter currentFilter={currentFilter} onFilterChange={setCurrentFilter} />

      {/* 메모 목록 영역 */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">메모를 불러오는 중입니다...</p>
        </div>
      ) : filteredMemos.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredMemos.map(memo => (
            <MemoCard
              key={memo.firestoreId}
              memo={memo}
              onEdit={handleOpenEdit}
              onToggleComplete={toggleComplete}
              onDelete={deleteMemo}
            />
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
          {mode === 'editor' && (
            <button
              onClick={handleOpenCreate}
              className="mt-5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors inline-block"
            >
              지금 작성하기
            </button>
          )}
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
