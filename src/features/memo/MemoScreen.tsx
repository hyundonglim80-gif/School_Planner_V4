import React, { useState } from 'react';
import { useMemos } from '../../hooks/useMemos';
import type { Memo, MemoAttachment } from '../../hooks/useMemos';
import { useAppStore } from '../../store/useAppStore';
import MemoCard from './MemoCard';
import MemoFilter from './MemoFilter';
import MemoDrawer from './MemoDrawer';
import QuickLinks from './QuickLinks';

export default function MemoScreen() {
  const { selectedGroupId } = useAppStore();
  const { memos, loading, addMemo, updateMemo, deleteMemo, toggleComplete, deleteCompletedMemos } = useMemos(selectedGroupId);
  const [currentFilter, setCurrentFilter] = useState('전체');
  const [hideCompleted, setHideCompleted] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingMemo, setEditingMemo] = useState<Memo | null>(null);

  const filteredMemos = currentFilter === '전체'
    ? memos
    : memos.filter(memo => memo.labels?.includes(currentFilter));

  const activeMemos = filteredMemos.filter(m => !m.completed);
  const completedMemos = filteredMemos.filter(m => m.completed);

  const handleOpenCreate = () => {
    setEditingMemo(null);
    setIsDrawerOpen(true);
  };

  const handleOpenEdit = (memo: Memo) => {
    setEditingMemo(memo);
    setIsDrawerOpen(true);
  };

  const handleSaveMemo = async (data: {
    content: string;
    labels: string[];
    imageUrl?: string;
    attachments?: MemoAttachment[];
  }) => {
    if (editingMemo) {
      await updateMemo(editingMemo.firestoreId, data);
    } else {
      await addMemo(data);
    }
  };

  const handleDeleteCompleted = async () => {
    if (completedMemos.length === 0) return;
    if (
      window.confirm(
        `완료된 메모 ${completedMemos.length}개를 모두 삭제하시겠습니까?\n(삭제된 메모는 휴지통으로 이동합니다)`
      )
    ) {
      await deleteCompletedMemos(completedMemos);
    }
  };

  return (
    <div className="animate-fade-in pb-12">
      {/* 상단 컨트롤 바 (필터 바 및 액션 버튼들) */}
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <MemoFilter currentFilter={currentFilter} onFilterChange={setCurrentFilter} />

        <div className="flex items-center gap-2 flex-wrap">
          {completedMemos.length > 0 && (
            <>
              {/* 완료 메모 숨기기 / 보기 버튼 */}
              <button
                type="button"
                onClick={() => setHideCompleted(!hideCompleted)}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title={hideCompleted ? '완료 메모 펼치기' : '완료 메모 숨기기'}
              >
                <span>{hideCompleted ? '👁️' : '🙈'}</span>
                <span>{hideCompleted ? '완료 메모 보기' : '완료 메모 숨기기'}</span>
                <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-full font-black">
                  {completedMemos.length}
                </span>
              </button>

              {/* 완료 메모 일괄 삭제 버튼 */}
              <button
                type="button"
                onClick={handleDeleteCompleted}
                className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-xl font-bold transition-all text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="완료된 메모 일괄 삭제"
              >
                <span>🗑️</span>
                <span>완료 메모 일괄 삭제</span>
              </button>
            </>
          )}

          {/* 새 메모 추가 버튼 */}
          <button
            type="button"
            onClick={handleOpenCreate}
            className="bg-primary hover:bg-blue-600 active:scale-98 text-white px-4 py-2 rounded-xl font-bold shadow-sm hover:shadow-md transition-all flex items-center gap-2 text-xs cursor-pointer"
          >
            <span className="text-sm leading-none font-extrabold">+</span>
            <span>새 메모</span>
          </button>
        </div>
      </div>

      {/* 메모 목록 영역 */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">메모를 불러오는 중입니다...</p>
        </div>
      ) : filteredMemos.length > 0 ? (
        <div className="space-y-8">
          {/* 1. 진행 중인 메모 (상단 영역) */}
          {activeMemos.length > 0 ? (
            <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4 [column-fill:_balance]">
              {activeMemos.map(memo => (
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
            <div className="text-center py-10 bg-slate-50/70 rounded-2xl border border-dashed border-slate-200 p-6">
              <p className="text-slate-500 font-bold text-sm">진행 중인 메모가 없습니다.</p>
              <p className="text-slate-400 text-xs mt-1">
                새 메모를 추가하거나 아래 완료된 메모 목록을 확인해 보세요.
              </p>
            </div>
          )}

          {/* 2. 완료된 메모 (하단 영역 - 상하 구분) */}
          {completedMemos.length > 0 && (
            <div className="pt-4 border-t border-dashed border-slate-200">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setHideCompleted(!hideCompleted)}
                  className="flex items-center gap-2 text-slate-600 hover:text-slate-900 font-extrabold text-sm transition-colors cursor-pointer select-none"
                >
                  <span className="text-xs">{hideCompleted ? '▶' : '▼'}</span>
                  <span>체크한 완료 메모</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">
                    {completedMemos.length}
                  </span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setHideCompleted(!hideCompleted)}
                    className="text-xs text-slate-500 hover:text-slate-800 font-semibold px-2 py-1 rounded hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    {hideCompleted ? '펼쳐보기' : '완료 메모 숨기기'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteCompleted}
                    className="text-xs text-rose-600 hover:text-rose-800 font-bold px-2 py-1 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                  >
                    일괄 삭제
                  </button>
                </div>
              </div>

              {/* 완료 메모 목록 (숨김 토글 상태 반영) */}
              {!hideCompleted && (
                <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4 [column-fill:_balance]">
                  {completedMemos.map(memo => (
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
              )}
            </div>
          )}
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
