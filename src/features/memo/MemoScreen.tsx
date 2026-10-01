import React, { useState, useEffect, useRef } from 'react';
import { useMemos, isUnlabeledMemo } from '../../hooks/useMemos';
import type { Memo } from '../../hooks/useMemos';
import { useAppStore } from '../../store/useAppStore';
import { useLabels } from '../../hooks/useLabels';
import MemoCard from './MemoCard';
import MemoMasonry from './MemoMasonry';
import { openEntryPanel } from '../../components/EntryPanelHost';
import {
  EMPTY_FILTER,
  filterLabelSet,
  labelPath,
  orderByTree,
  pruneFilter,
  toggleFilterChildren,
  clickFilterLabel,
  useLabelTree,
  type LabelFilter,
} from '../../lib/labelTree';
import { showToast, showErrorToast, showErrorToastOnce } from '../../utils/toast';
import { useIsMobile } from '../../hooks/useIsMobile';
import { showDeletedToast } from '../../lib/undoToast';

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
  const { memos, loading, deleteMemo, toggleComplete, toggleFavorite, deleteCompletedMemos, labelUnlabeledMemos, swapMemoOrder } = useMemos(selectedGroupId);
  const { getLabelColor, memoLabels, labelsLoaded } = useLabels();

  // 고른 거르개는 기억해 두었다가 다른 화면에서 돌아와도 그대로 연다.
  // 처음(기억한 것이 없을 때)은 즐겨찾기. 기억한 라벨이 그새 지워졌으면 즐겨찾기로 돌아간다.
  const rememberedFilter = useAppStore((s) => s.memoFilter);
  const setMemoFilter = useAppStore((s) => s.setMemoFilter);
  /** 검색에서 '이동'해 왔을 때만 잠깐 전체를 보인다 (기억한 거르개는 바꾸지 않는다) */
  const [showAllForFocus, setShowAllForFocus] = useState(false);
  const [activeOpen, setActiveOpen] = useState(true);
  const [completedOpen, setCompletedOpen] = useState(true);

  const listRef = useRef<HTMLElement>(null);
  const columnsCount = useColumnCount(listRef);
  const isMobile = useIsMobile();

  // 검색에서 메모로 '이동'해 오면, 걸러 둔 라벨이나 접어 둔 구역 때문에 그 메모가
  // 가려지지 않도록 전체를 펼쳐 보인다.
  const focusSection = useAppStore((s) => s.focusTarget?.section);
  useEffect(() => {
    if (focusSection === 'memo') {
      setShowAllForFocus(true);
      setActiveOpen(true);
      setCompletedOpen(true);
    }
  }, [focusSection]);

  // 거르개는 셋 중 하나: '전체', '⭐ 즐겨찾기', 라벨 여러 개(lib/labelTree의 LabelFilter).
  // 라벨은 여러 개 고를 수 있고, 상위는 앞의 '하위 포함' 체크를 켰을 때만 하위까지 거른다.
  const currentFilter: string | LabelFilter = (() => {
    if (showAllForFocus) return '전체';
    const f = rememberedFilter || FAVORITE_FILTER;
    if (f === '전체' || f === FAVORITE_FILTER) return f;
    // 예전에는 라벨 하나를 글자로 기억했다
    const asFilter: LabelFilter = typeof f === 'string' ? { labels: [f], withChildren: [] } : f;
    // 라벨 목록을 아직 못 읽었으면 판단을 미룬다 (기본값만 보고 '없는 라벨'로 단정하지 않는다)
    if (!labelsLoaded) return asFilter;
    const pruned = pruneFilter(asFilter, memoLabels);
    return pruned.labels.length > 0 ? pruned : FAVORITE_FILTER;
  })();

  const labelFilter: LabelFilter = typeof currentFilter === 'string' ? EMPTY_FILTER : currentFilter;
  const chooseFilter = (filter: string | LabelFilter) => {
    setShowAllForFocus(false);
    // 라벨을 모두 떼면 전체로
    setMemoFilter(typeof filter !== 'string' && filter.labels.length === 0 ? '전체' : filter);
  };

  // 라벨 상위/하위 (lib/labelTree)
  const memoParents = useLabelTree().memo;
  /** 접어 둔 상위 (하위 칩을 숨긴다). 처음에는 모두 펼쳐 둔다 */
  const [foldedParents, setFoldedParents] = useState<Record<string, boolean>>({});
  const allowedLabels = filterLabelSet(labelFilter, memoParents);

  // 라벨 칩은 윈도우 탐색기처럼 고른다 (lib/labelTree의 clickFilterLabel):
  // 그냥 누르면 하나만, Ctrl은 더하고 빼기, Shift는 기준부터 여기까지. ESC는 모두 뗀다.
  const anchorRef = useRef<string | null>(null);
  const treeRows = orderByTree(memoLabels, memoParents);
  /** 화면에 보이는 라벨 차례 (접힌 하위는 빼되, 고른 것은 보인다) - Shift 범위에 쓴다 */
  const visibleLabelOrder = treeRows
    .filter((r) => r.depth === 0 || !foldedParents[r.parent!] || labelFilter.labels.includes(r.name))
    .map((r) => r.name);
  const clickLabel = (name: string, e: React.MouseEvent) => {
    const click = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
    chooseFilter(clickFilterLabel(labelFilter, name, click, visibleLabelOrder, anchorRef.current));
    if (!click.shift) anchorRef.current = name;
  };
  // ESC: 라벨 고른 것을 모두 뗀다 (오른쪽 칸·팝업은 Layout의 ESC가 함께 닫는다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      anchorRef.current = null;
      const f = useAppStore.getState().memoFilter;
      const isLabel = typeof f === 'string' ? f !== '전체' && f !== FAVORITE_FILTER : !!f;
      if (isLabel) {
        setShowAllForFocus(false);
        setMemoFilter('전체');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setMemoFilter]);

  const matching =
    currentFilter === '전체'
      ? memos
      : currentFilter === FAVORITE_FILTER
      ? memos.filter((memo) => memo.favorite)
      : memos.filter((memo) => (memo.labels || []).some((l) => allowedLabels?.has(l)));

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
      : allActive.filter((m) => m.labels?.includes(filter)).length;

  // 새로 쓰기·고치기는 오른쪽 칸(Layout의 EntryPanelHost)에서 한다. 칸은 이 화면보다
  // 오래 살아서, 다른 화면으로 옮겨도 쓰던 것이 남는다.
  const handleOpenCreate = () =>
    openEntryPanel({
      kind: 'memo',
      groupId: selectedGroupId,
      defaultLabel: labelFilter.labels[0] ?? memoLabels[0],
    });

  const handleOpenEdit = (memo: Memo) =>
    openEntryPanel({ kind: 'memo', groupId: selectedGroupId, entryId: memo.firestoreId, initial: memo });

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
      try {
        const trashIds = await deleteCompletedMemos(completedMemos);
        showDeletedToast(`🗑️ 완료된 메모 ${trashIds.length}개를 휴지통으로 옮겼습니다. 휴지통에서 복원할 수 있습니다.`, trashIds);
      } catch (e) {
        showErrorToastOnce('완료된 메모를 지우지 못했습니다.', e);
      }
    }
  };

  const renderGrid = (items: Memo[]) => (
    <MemoMasonry
      items={items}
      getKey={(memo) => memo.firestoreId}
      columns={columnsCount}
      gap={isMobile ? 8 : 16}
      renderItem={(memo) => {
        // 차례는 지금 보이는 목록(거르개·진행/완료)에서의 앞뒤다. 즐겨찾기는 늘 위에
        // 모이므로, 즐겨찾기와 아닌 것 사이는 바꾸지 않는다 (바꿔도 제자리로 돌아온다).
        const i = items.findIndex((m) => m.firestoreId === memo.firestoreId);
        const prev = items[i - 1];
        const next = items[i + 1];
        const sameGroup = (other?: Memo) => !!other && !!other.favorite === !!memo.favorite;
        return (
          <MemoCard
            memo={memo}
            onEdit={handleOpenEdit}
            onToggleComplete={toggleComplete}
            onToggleFavorite={toggleFavorite}
            onDelete={deleteMemo}
            onMoveUp={sameGroup(prev) ? () => swapMemoOrder(memo, prev!) : undefined}
            onMoveDown={sameGroup(next) ? () => swapMemoOrder(memo, next!) : undefined}
          />
        );
      }}
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
    title?: string,
    label?: { included: boolean; caret?: boolean; plus?: boolean }
  ) => {
    // 라벨 칩은 여러 개 고르기(눌러서 붙이고 떼기), 즐겨찾기·전체는 하나만
    const isSelected = label ? labelFilter.labels.includes(filter) : currentFilter === filter;
    /** 고르지 않았지만 상위의 '하위 포함'으로 함께 걸러지는 하위 */
    const isIncluded = !isSelected && !!label?.included;
    return (
      <button
        key={filter}
        type="button"
        onClick={(e) => (label ? clickLabel(filter, e) : chooseFilter(filter))}
        // Shift+누르기가 글자를 긁어 고르지 않게
        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
        aria-pressed={isSelected}
        title={title ?? (typeof text === 'string' ? text : undefined)}
        className={`relative w-full flex items-center justify-between gap-1 ${
          // 칩 안 왼쪽에 ▸/▾(접기)가 앉는 상위 칩은 그만큼 비운다
          label?.caret ? 'pl-6 pr-1.5 sm:pl-7 sm:pr-3' : 'px-1.5 sm:px-3'
        } py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-xs text-left border transition-all cursor-pointer ${
          isSelected
            ? `font-black ring-2 ring-slate-900/70 ring-offset-1 shadow-sm ${selectedClass}`
            : isIncluded
            ? 'font-bold bg-slate-50 text-slate-700 border-dashed border-slate-500'
            : 'font-bold bg-slate-50 text-slate-600 border-slate-200 opacity-60 hover:opacity-100'
        }`}
        style={isSelected ? selectedStyle : undefined}
      >
        <span className="min-w-0 break-keep wrap-anywhere leading-tight">
          {isSelected && <span className="mr-0.5">✓</span>}
          {text}
        </span>
        {/* '하위 포함'을 켠 상위 - 칩 아래 테두리에 걸친 작은 꼬리표. 칸이 좁아 이름 옆에 두면 이름이 눌린다 */}
        {label?.plus && (
          <span
            aria-hidden
            className="absolute -bottom-2 left-5 sm:left-6 px-1 rounded border border-slate-300 bg-white text-slate-600 text-2xs leading-3.5 font-bold whitespace-nowrap"
          >
            +하위
          </span>
        )}
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
            {/* 차례: 즐겨찾기 → 라벨(통합 라벨 관리의 차례) → 전체 메모 */}
            {filterChip(
              FAVORITE_FILTER,
              '⭐ 즐겨찾기',
              undefined,
              'bg-amber-100 text-amber-900 border-amber-300',
              '즐겨찾기한 메모만 보기'
            )}
            {/* 라벨은 여러 개 고른다. 모양 (2026-09-30 다듬음 - 체크박스·└·바깥 단추가 칸을 좁혀 들쭉날쭉했다):
                - 하위가 있는 상위는 칩 안 왼쪽의 ▸/▾로 접고 편다. 칩 폭은 다른 칩과 같다.
                - 하위는 상위 밑에 왼쪽 안내선으로 묶는다. 묶음 맨 위에 '하위 포함' 토글.
                - '하위 포함'을 켠 채 접으면 상위 칩 아래에 +하위 꼬리표가 붙는다. */}
            {treeRows
              .filter((row) => row.depth === 0)
              .map((row) => {
                const chipOf = (name: string, extra?: { caret?: boolean; included?: boolean; plus?: boolean }) =>
                  filterChip(
                    name,
                    name,
                    { backgroundColor: getLabelColor(name).bg, color: getLabelColor(name).text, borderColor: getLabelColor(name).border },
                    '',
                    extra?.plus ? `${labelPath(name, memoParents)} (하위 라벨 포함)` : labelPath(name, memoParents),
                    { included: !!extra?.included, caret: !!extra?.caret, plus: !!extra?.plus }
                  );
                if (!row.hasChildren) return chipOf(row.name);
                const folded = !!foldedParents[row.name];
                const withChildren = labelFilter.withChildren.includes(row.name);
                const children = treeRows.filter((r) => r.parent === row.name);
                // 접었어도 고른 하위는 보인다 (무엇으로 거르는지 보여야 한다)
                const shown = folded ? children.filter((c) => labelFilter.labels.includes(c.name)) : children;
                return (
                  <div key={row.name} className="flex flex-col gap-1.5 sm:gap-1">
                    <div className="relative">
                      {/* +하위 꼬리표는 접었을 때만 (펼치면 아래 '하위 포함' 체크가 보인다) */}
                      {chipOf(row.name, { caret: true, plus: withChildren && folded })}
                      <button
                        type="button"
                        onClick={() => setFoldedParents((prev) => ({ ...prev, [row.name]: !folded }))}
                        aria-expanded={!folded}
                        aria-label={`${row.name} 하위 라벨 ${folded ? '펼치기' : '접기'}`}
                        title={`${row.name} 하위 라벨 ${folded ? '펼치기' : '접기'}`}
                        className="absolute left-0.5 sm:left-1 top-1/2 -translate-y-1/2 z-10 w-5 h-5 flex items-center justify-center rounded text-2xs text-slate-500 hover:bg-black/10 cursor-pointer"
                      >
                        {folded ? '▸' : '▾'}
                      </button>
                    </div>
                    {(shown.length > 0 || !folded) && (
                      <div className="ml-2 sm:ml-3 pl-1.5 sm:pl-2 border-l-2 border-slate-200 flex flex-col gap-1.5 sm:gap-1">
                        {!folded && (
                          <label
                            className="flex items-center gap-1 text-2xs font-bold text-slate-500 cursor-pointer select-none py-0.5"
                            title={`${row.name}을(를) 고르면 하위 라벨 메모까지 함께 보기`}
                          >
                            <input
                              type="checkbox"
                              checked={withChildren}
                              onChange={() => chooseFilter(toggleFilterChildren(labelFilter, row.name))}
                              aria-label={`${row.name} 하위 라벨 포함`}
                              className="w-3 h-3 accent-slate-700 cursor-pointer"
                            />
                            하위 포함
                          </label>
                        )}
                        {shown.map((c) => chipOf(c.name, { included: withChildren }))}
                      </div>
                    )}
                  </div>
                );
              })}
            {filterChip('전체', '전체 메모', undefined, 'bg-slate-800 text-white border-slate-800')}
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

    </div>
  );
}
