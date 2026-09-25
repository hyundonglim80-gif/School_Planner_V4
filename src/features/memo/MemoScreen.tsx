import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useMemos, isUnlabeledMemo } from '../../hooks/useMemos';
import type { Memo } from '../../hooks/useMemos';
import { useAppStore } from '../../store/useAppStore';
import { useLabels } from '../../hooks/useLabels';
import MemoCard from './MemoCard';
import MemoMasonry from './MemoMasonry';
import EntryDrawer, { type EntryDraft } from '../../components/EntryDrawer';
import { showToast, showErrorToast } from '../../utils/toast';
import { useIsMobile } from '../../hooks/useIsMobile';

/** 라벨이 아닌 '즐겨찾기' 거르개. 라벨 이름과 겹치지 않게 별표를 붙여 둔다. */
const FAVORITE_FILTER = '⭐ 즐겨찾기';

/** 라벨 없는 메모에 붙여 주는 라벨 */
const FALLBACK_LABEL = '메모';

/** 카드 한 장이 이보다 좁아지면 열을 줄인다. 단, 휴대폰에서도 두 열은 지킨다. */
const MIN_CARD_WIDTH = 170;
const MIN_COLUMNS = 2;
const MAX_COLUMNS = 4;

/**
 * 메모 목록 칸의 실제 폭에 맞춰 열 수를 정한다.
 * 화면 폭이 아니라 칸 폭을 재는 까닭: 왼쪽에 라벨 거르개가 붙어 있어서
 * 같은 화면 폭이라도 목록이 차지하는 폭이 다르다.
 */
function useColumnCount(ref: React.RefObject<HTMLElement | null>) {
  const [count, setCount] = useState(MIN_COLUMNS);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const fit = Math.floor((width + 16) / (MIN_CARD_WIDTH + 16));
      setCount(Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, fit)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return count;
}

export default function MemoScreen() {
  const { selectedGroupId, openLabelModal } = useAppStore();
  const { memos, loading, addMemo, updateMemo, deleteMemo, toggleComplete, toggleFavorite, deleteCompletedMemos, labelUnlabeledMemos } = useMemos(selectedGroupId);
  const { getLabelColor, memoLabels } = useLabels();

  const [currentFilter, setCurrentFilter] = useState('전체');
  const [activeOpen, setActiveOpen] = useState(true);
  const [completedOpen, setCompletedOpen] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingMemo, setEditingMemo] = useState<Memo | null>(null);
  // 방금 만든 메모. setEditingMemo는 다음 그림에서야 반영되므로,
  // 연달아 저장이 들어와도 새로 만들지 않도록 여기에도 담아 둔다.
  const justCreatedRef = useRef<Memo | null>(null);

  const listRef = useRef<HTMLElement>(null);
  const columnsCount = useColumnCount(listRef);
  const isMobile = useIsMobile();

  // 검색에서 메모로 '이동'해 오면, 걸러 둔 라벨이나 접어 둔 구역 때문에 그 메모가
  // 가려지지 않도록 전체를 펼쳐 보인다.
  const focusSection = useAppStore((s) => s.focusTarget?.section);
  useEffect(() => {
    if (focusSection === 'memo') {
      setCurrentFilter('전체');
      setActiveOpen(true);
      setCompletedOpen(true);
    }
  }, [focusSection]);

  const isLabelFilter = currentFilter !== '전체' && currentFilter !== FAVORITE_FILTER;
  const chooseFilter = (filter: string) => setCurrentFilter(filter);

  const matching =
    currentFilter === '전체'
      ? memos
      : currentFilter === FAVORITE_FILTER
      ? memos.filter((memo) => memo.favorite)
      : memos.filter((memo) => memo.labels?.includes(currentFilter));

  // 즐겨찾기를 맨 위로 올린다. 정렬은 안정적이므로 그 안에서는
  // 원래 차례(나중에 만든 것이 앞)가 그대로 남는다.
  const filteredMemos = [...matching].sort(
    (a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)
  );

  const activeMemos = filteredMemos.filter(m => !m.completed);
  const completedMemos = filteredMemos.filter(m => m.completed);

  // 거르개 옆의 개수는 V3처럼 '진행 중'인 메모만 센다.
  const allActive = memos.filter(m => !m.completed);
  const countOf = (filter: string) =>
    filter === '전체'
      ? allActive.length
      : filter === FAVORITE_FILTER
      ? allActive.filter(m => m.favorite).length
      : allActive.filter(m => m.labels?.includes(filter)).length;

  const handleOpenCreate = useCallback(() => {
    setEditingMemo(null);
    justCreatedRef.current = null;
    setIsDrawerOpen(true);
  }, []);

  const handleOpenEdit = (memo: Memo) => {
    setEditingMemo(memo);
    justCreatedRef.current = null;
    setIsDrawerOpen(true);
  };

  const handleSaveMemo = async (draft: EntryDraft) => {
    // 저장해도 배너는 열려 있으므로, 방금 만든 메모가 있으면 그것을 고친다.
    // 안 그러면 한 번 더 저장할 때 같은 내용이 새로 하나 더 생긴다.
    const target = editingMemo || justCreatedRef.current;
    if (target) {
      await updateMemo(target.firestoreId, draft);
      return;
    }
    const ref = await addMemo(draft);
    if (ref?.id) {
      const created: Memo = {
        firestoreId: ref.id,
        content: draft.content,
        createdAt: Date.now(),
        labels: draft.labels,
        imageUrl: draft.imageUrl,
        attachments: draft.attachments,
        linkedItems: draft.linkedItems,
      };
      justCreatedRef.current = created;
      setEditingMemo(created);
    }
  };

  // 라벨이 없는 메모는 어느 라벨로 걸러도 보이지 않는다. 한 번에 '메모' 라벨을 붙인다.
  const unlabeledCount = memos.filter(isUnlabeledMemo).length;
  const [labelingUnlabeled, setLabelingUnlabeled] = useState(false);
  const handleLabelUnlabeled = async () => {
    if (unlabeledCount === 0 || labelingUnlabeled) return;
    if (!window.confirm(`라벨이 없는 메모 ${unlabeledCount}개(완료된 것 포함)에 '${FALLBACK_LABEL}' 라벨을 붙일까요?`)) return;
    setLabelingUnlabeled(true);
    try {
      const n = await labelUnlabeledMemos(FALLBACK_LABEL);
      showToast(`🏷️ 메모 ${n}개에 '${FALLBACK_LABEL}' 라벨을 붙였습니다.`);
    } catch (error) {
      showErrorToast('라벨을 붙이지 못했습니다.', error);
    } finally {
      setLabelingUnlabeled(false);
    }
  };

  const handleDeleteCompleted = async () => {
    if (completedMemos.length === 0) return;
    if (
      window.confirm(
        `완료된 메모 ${completedMemos.length}개를 삭제하시겠습니까?\n(삭제된 항목은 휴지통으로 이동합니다.)`
      )
    ) {
      await deleteCompletedMemos(completedMemos);
    }
  };

  const renderGrid = (items: Memo[]) => (
    <MemoMasonry
      items={items}
      getKey={(memo) => memo.firestoreId}
      columns={columnsCount}
      gap={isMobile ? 8 : 16}
      renderItem={(memo) => (
        <MemoCard
          memo={memo}
          onEdit={handleOpenEdit}
          onToggleComplete={toggleComplete}
          onToggleFavorite={toggleFavorite}
          onDelete={deleteMemo}
        />
      )}
    />
  );

  // 고른 거르개가 어느 것인지 한눈에 들어와야 한다. 고른 것에는 테두리
  // 고리(ring)와 ✓를 붙이고, 안 고른 것은 흐리게 둔다. 색이 옅은 라벨은
  // 연한 배경만으로는 안 고른 것과 구분되지 않았다.
  const filterChip = (
    filter: string,
    text: React.ReactNode,
    selectedStyle: React.CSSProperties | undefined,
    selectedClass: string,
    title?: string
  ) => {
    const isSelected = currentFilter === filter;
    return (
      <button
        key={filter}
        type="button"
        onClick={() => chooseFilter(filter)}
        aria-pressed={isSelected}
        title={title ?? (typeof text === 'string' ? text : undefined)}
        className={`relative w-full flex items-center justify-between gap-1 px-1.5 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-xs text-left border transition-all cursor-pointer ${
          isSelected
            ? `font-black ring-2 ring-slate-900/70 ring-offset-1 shadow-sm ${selectedClass}`
            : 'font-bold bg-slate-50 text-slate-600 border-slate-200 opacity-60 hover:opacity-100'
        }`}
        style={isSelected ? selectedStyle : undefined}
      >
        <span className="min-w-0 break-keep wrap-anywhere leading-tight">
          {isSelected && <span className="mr-0.5">✓</span>}
          {text}
        </span>
        {/* 휴대폰의 좁은 칸에서는 이름과 나란히 둘 자리가 없어 모서리 배지로 띄운다 */}
        <span className="absolute -top-1.5 -right-1 min-w-4 h-4 px-1 rounded-full bg-slate-600 text-white text-2xs leading-4 text-center font-black sm:static sm:min-w-0 sm:h-auto sm:px-1.5 sm:bg-black/10 sm:text-current sm:text-xs sm:leading-normal shrink-0">
          {countOf(filter)}
        </span>
      </button>
    );
  };

  return (
    <div className="animate-fade-in pb-12 flex flex-col gap-3 sm:gap-5">
      {/* 왼쪽 라벨 거르개 + 오른쪽 메모 목록. 휴대폰에서도 나란히 둔다. */}
      <div className="flex items-start gap-2 sm:gap-4">
        {/* 왼쪽 칸: '+ 새 메모'와 라벨 거르개.
            목록이 길어도 이 칸은 머리줄 바로 아래에 멈춰 서 있고, 라벨이 많으면
            거르개 안에서만 따로 스크롤된다. 휴대폰은 아래 탭바 높이만큼 더 뺀다. */}
        <div className="w-29 sm:w-44 shrink-0 flex flex-col gap-2 sm:gap-3 sticky top-[calc(var(--app-header-h,64px)+12px)] max-h-[calc(100dvh-var(--app-header-h,64px)-96px)] sm:max-h-[calc(100dvh-var(--app-header-h,64px)-32px)]">
          <button
            type="button"
            onClick={handleOpenCreate}
            className="w-full flex items-center justify-center gap-1 sm:gap-1.5 px-2 py-2 sm:py-2.5 bg-primary hover:bg-blue-600 active:scale-98 text-white rounded-xl sm:rounded-2xl text-xs sm:text-sm font-bold shadow-sm hover:shadow-md transition-all cursor-pointer shrink-0"
            title="새 메모 작성 (오른쪽 배너가 열린다)"
          >
            <span className="font-extrabold leading-none">+</span>
            <span>새 메모</span>
          </button>
          <nav
            aria-label="메모 라벨 거르개"
            className="min-h-0 flex flex-col gap-2 sm:gap-1.5 bg-white rounded-2xl border border-slate-200/80 shadow-xs p-1.5 sm:p-3 overflow-y-auto overscroll-contain"
          >
            <div className="sticky -top-1.5 sm:-top-3 z-10 -mt-1.5 sm:-mt-3 pt-1.5 sm:pt-3 bg-white flex items-center justify-between gap-1 text-xs font-extrabold text-blue-800 border-b-2 border-slate-100 pb-1.5 mb-0.5 px-0.5">
              <span>📁 라벨<span className="hidden sm:inline"> 필터</span></span>
              <button
                type="button"
                onClick={() => openLabelModal('memo')}
                className="w-6 h-6 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer shrink-0"
                title="메모 라벨 설정"
                aria-label="메모 라벨 설정"
              >
                ⚙️
              </button>
            </div>
            {filterChip('전체', '전체 메모', undefined, 'bg-slate-800 text-white border-slate-800')}
            {filterChip(
              FAVORITE_FILTER,
              '⭐ 즐겨찾기',
              undefined,
              'bg-amber-100 text-amber-900 border-amber-300',
              '즐겨찾기한 메모만 보기'
            )}
            {memoLabels.map((labelName) => {
              const color = getLabelColor(labelName);
              return filterChip(
                labelName,
                labelName,
                { backgroundColor: color.bg, color: color.text, borderColor: color.border },
                ''
              );
            })}
          </nav>
        </div>

        <section
          ref={listRef}
          className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-200/80 shadow-xs p-2 sm:p-5"
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
              <p className="text-xs text-slate-400 font-medium">메모를 불러오는 중...</p>
            </div>
          ) : (
            <>
              {unlabeledCount > 0 && (
                <div className="flex items-center justify-between gap-2 flex-wrap mb-3 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <span className="font-bold">🏷️ 라벨이 없는 메모 {unlabeledCount}개</span>
                  <button
                    type="button"
                    onClick={handleLabelUnlabeled}
                    disabled={labelingUnlabeled}
                    className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold cursor-pointer disabled:opacity-50"
                  >
                    {labelingUnlabeled ? '붙이는 중...' : `'${FALLBACK_LABEL}' 라벨 붙이기`}
                  </button>
                </div>
              )}

              {/* 진행 */}
              <button
                type="button"
                onClick={() => setActiveOpen(!activeOpen)}
                className="w-full flex items-center justify-between mb-2 sm:mb-3 px-1 text-sm sm:text-base font-extrabold text-slate-900 cursor-pointer select-none"
                aria-expanded={activeOpen}
              >
                <span>진행 ({activeMemos.length})</span>
                <span className="text-xs text-slate-400">{activeOpen ? '▲' : '▼'}</span>
              </button>
              {activeOpen &&
                (activeMemos.length > 0 ? (
                  renderGrid(activeMemos)
                ) : (
                  <p className="text-center text-slate-400 text-sm py-6">
                    {currentFilter === FAVORITE_FILTER
                      ? '즐겨찾기한 메모가 없습니다. 메모의 ☆를 눌러 놓으면 여기 모입니다.'
                      : '조건에 맞는 메모가 없습니다.'}
                  </p>
                ))}

              {/* 완료 */}
              <div className="flex items-center justify-between gap-2 mt-6 sm:mt-8 mb-2 sm:mb-3 pb-1.5 border-b-2 border-slate-100">
                <button
                  type="button"
                  onClick={() => setCompletedOpen(!completedOpen)}
                  className="flex items-center gap-1.5 px-1 text-sm sm:text-base font-extrabold text-slate-900 cursor-pointer select-none"
                  aria-expanded={completedOpen}
                >
                  <span>완료 ({completedMemos.length})</span>
                  <span className="text-xs text-slate-400">{completedOpen ? '▲' : '▼'}</span>
                </button>
                {completedMemos.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDeleteCompleted}
                    className="px-2 sm:px-2.5 py-1 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-xs font-bold cursor-pointer shrink-0"
                    title="완료된 메모 모두 삭제"
                  >
                    🗑️<span className="hidden sm:inline"> 전체 비우기</span>
                  </button>
                )}
              </div>
              {completedOpen &&
                (completedMemos.length > 0 ? (
                  renderGrid(completedMemos)
                ) : (
                  <p className="text-center text-slate-400 text-sm py-4">아직 완료된 항목이 없습니다.</p>
                ))}
            </>
          )}
        </section>
      </div>

      {/* 새 메모 / 수정 - 기록과 같은 오른쪽 배너를 쓴다 */}
      <EntryDrawer
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setEditingMemo(null);
          justCreatedRef.current = null;
        }}
        kind="memo"
        entry={editingMemo}
        labelOptions={memoLabels}
        onSave={handleSaveMemo}
        onDelete={
          editingMemo
            ? async () => {
                await deleteMemo(editingMemo.firestoreId);
                showToast('🗑️ 메모를 삭제했습니다. 휴지통에서 복원할 수 있습니다.');
              }
            : undefined
        }
        defaultLabel={isLabelFilter ? currentFilter : memoLabels[0]}
      />

    </div>
  );
}
