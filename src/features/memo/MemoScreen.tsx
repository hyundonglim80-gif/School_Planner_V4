//src/features/memo/MemoScreen.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useMemos } from '../../hooks/useMemos';
import type { Memo, MemoAttachment } from '../../hooks/useMemos';
import { useAppStore } from '../../store/useAppStore';
import { useLabels } from '../../hooks/useLabels';
import MemoCard from './MemoCard';
import MemoDrawer from './MemoDrawer';

export default function MemoScreen() {
  const { selectedGroupId } = useAppStore();
  const { memos, loading, addMemo, updateMemo, deleteMemo, toggleComplete, deleteCompletedMemos } = useMemos(selectedGroupId);
  const { getLabelColor, memoLabels } = useLabels(); 

  const [currentFilter, setCurrentFilter] = useState('전체');
  const [hideCompleted, setHideCompleted] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingMemo, setEditingMemo] = useState<Memo | null>(null);

  // 창 크기에 따른 단(column) 개수 관리
  const [columnsCount, setColumnsCount] = useState(4);

  useEffect(() => {
    const updateCols = () => {
      if (window.innerWidth >= 1024) setColumnsCount(4);      // lg
      else if (window.innerWidth >= 768) setColumnsCount(3);  // md
      else if (window.innerWidth >= 640) setColumnsCount(2);  // sm
      else setColumnsCount(1);
    };
    updateCols();
    window.addEventListener('resize', updateCols);
    return () => window.removeEventListener('resize', updateCols);
  }, []);

  const filteredMemos = currentFilter === '전체'
    ? memos
    : memos.filter(memo => memo.labels?.includes(currentFilter));
  
  const activeMemos = filteredMemos.filter(m => !m.completed);
  const completedMemos = filteredMemos.filter(m => m.completed);

  // 가로로 먼저 분배 후, 세로로 바짝 붙이는 Masonry 배열 생성기
  const distributeMemos = (items: Memo[]) => {
    const columns = Array.from({ length: columnsCount }, () => [] as Memo[]);
    items.forEach((item, index) => {
      columns[index % columnsCount].push(item);
    });
    return columns;
  };

  const activeColumns = distributeMemos(activeMemos);
  const completedColumns = distributeMemos(completedMemos);

  const handleOpenCreate = useCallback(() => {
    setEditingMemo(null);
    setIsDrawerOpen(true);
  }, []);

  // Ctrl+N 단축키 강제 캡처
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        e.stopPropagation(); // 브라우저 기본 동작 완벽 차단
        handleOpenCreate();
      }
    };
    // 캡처링 단계(capture: true)에서 이벤트를 가장 먼저 가로챔
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [handleOpenCreate]);

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
        `완료된 ${completedMemos.length}개의 메모를 정말 삭제하시겠습니까?\n(휴지통으로 이동되며 복구 가능합니다.)`
      )
    ) {
      await deleteCompletedMemos(completedMemos);
    }
  };

  return (
    <div className="animate-fade-in pb-12">
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide max-w-full">
          <button
            onClick={() => setCurrentFilter('전체')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${
              currentFilter === '전체' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            전체 보기
          </button>
          {memoLabels.map((labelName) => {
            const isSelected = currentFilter === labelName;
            const color = getLabelColor(labelName);
            return (
              <button
                key={labelName}
                onClick={() => setCurrentFilter(labelName)}
                className="px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border"
                style={
                  isSelected
                    ? { backgroundColor: color.bg, color: color.text, borderColor: color.border, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }
                    : { backgroundColor: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0' }
                }
              >
                {labelName}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {completedMemos.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setHideCompleted(!hideCompleted)}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title={hideCompleted ? '완료된 메모 보기' : '완료된 메모 숨기기'}
              >
                <span>{hideCompleted ? '👁️' : '🙈'}</span>
                <span>{hideCompleted ? '완료 보기' : '완료 숨기기'}</span>
                <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-full font-black">
                  {completedMemos.length}
                </span>
              </button>
              <button
                type="button"
                onClick={handleDeleteCompleted}
                className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-xl font-bold transition-all text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="완료된 메모 전체 삭제"
              >
                <span>🗑️</span>
                <span>완료 삭제</span>
              </button>
            </>
          )}
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

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">불러오는 중...</p>
        </div>
      ) : filteredMemos.length > 0 ? (
        <div className="space-y-8">
          {/* 1. 진행 중인 메모 */}
          {activeMemos.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-start">
              {activeColumns.map((col, colIndex) => (
                <div key={colIndex} className="flex flex-col gap-4">
                  {col.map(memo => (
                    <div key={memo.firestoreId} className="w-full">
                      <MemoCard
                        memo={memo}
                        onEdit={handleOpenEdit}
                        onToggleComplete={toggleComplete}
                        onDelete={deleteMemo}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 bg-slate-50/70 rounded-2xl border border-dashed border-slate-200 p-6">
              <p className="text-slate-500 font-bold text-sm">진행 중인 메모가 없습니다.</p>
              <p className="text-slate-400 text-xs mt-1">
                우측 상단의 + 버튼을 눌러 새 메모를 추가해보세요.
              </p>
            </div>
          )}

          {/* 2. 완료된 메모 */}
          {completedMemos.length > 0 && (
            <div className="pt-4 border-t border-dashed border-slate-200">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setHideCompleted(!hideCompleted)}
                  className="flex items-center gap-2 text-slate-600 hover:text-slate-900 font-extrabold text-sm transition-colors cursor-pointer select-none"
                  title={hideCompleted ? '완료된 메모 보기' : '완료된 메모 숨기기'}
                >
                  <span className="text-xs">{hideCompleted ? '▶' : '▼'}</span>
                  <span>완료된 메모</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">
                    {completedMemos.length}
                  </span>
                </button>
              </div>

              {!hideCompleted && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-start">
                  {completedColumns.map((col, colIndex) => (
                    <div key={colIndex} className="flex flex-col gap-4">
                      {col.map(memo => (
                        <div key={memo.firestoreId} className="w-full">
                          <MemoCard
                            memo={memo}
                            onEdit={handleOpenEdit}
                            onToggleComplete={toggleComplete}
                            onDelete={deleteMemo}
                          />
                        </div>
                      ))}
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
            {currentFilter === '전체' ? '등록된 메모가 없습니다.' : `'${currentFilter}' 라벨의 메모가 없습니다.`}
          </p>
          <p className="text-slate-400 text-xs mt-1.5">
            우측 상단의 '+' 버튼을 눌러 새 메모를 추가해보세요.
          </p>
          <button
            onClick={handleOpenCreate}
            className="mt-5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors inline-block"
          >
            + 새 메모 작성
          </button>
        </div>
      )}

      {/* 서랍(Drawer) 컴포넌트 */}
      <MemoDrawer
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setEditingMemo(null);
        }}
        onSave={handleSaveMemo}
        onDelete={deleteMemo}
        editingMemo={editingMemo}
        defaultLabel={currentFilter}
      />
    </div>
  );
}