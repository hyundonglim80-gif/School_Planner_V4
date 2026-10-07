import React, { useState, useEffect, useRef } from 'react';
import type { JournalEntry } from '../../hooks/useDayData';
import { useAppStore } from '../../store/useAppStore';
import { focusKey } from '../../lib/searchFocus';
import { isLongEntry } from '../../lib/entryCollapse';
import { useLabels } from '../../hooks/useLabels';
import { openEntryPanel } from '../../components/EntryPanelHost';
import { useMainWidth } from '../../hooks/useMainWidth';
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
import { formatDateStr } from '../../lib/dateUtils';
import { TABLE_ONLY_CONTENT, normalizeTables } from '../../lib/entryTable';
import { useDayEvalCounts } from '../../hooks/useDayEvalCounts';
import EntryCard from '../../components/EntryCard';

interface DayJournalProps {
  journals: JournalEntry[];
  /** 휴지통 문서 id를 돌려주면 안내에 '되돌리기'가 붙는다 */
  onDeleteJournal: (id: string) => Promise<string | void>;
  onReorderJournals?: (sourceIndex: number, targetIndex: number) => Promise<void>;
  /** 완료·즐겨찾기 (19번 U6, useDayData.setJournalFlags) */
  onSetJournalFlags?: (id: string, patch: { completed?: boolean; favorite?: boolean }) => Promise<void>;
}

export default function DayJournal({
  journals,
  onDeleteJournal,
  onReorderJournals,
  onSetJournalFlags,
}: DayJournalProps) {
  const { openLinkViewerModal, currentDate, openEvaluationModal, selectedGroupId, openLabelModal } = useAppStore();
  // store의 currentDate는 ISO 문자열(2026-09-18T05:12:33.000Z)이다. 문서 이름은
  // 2026-09-18 꼴이라 그대로 넘기면 없는 문서를 보게 된다.
  const dateStr = formatDateStr(new Date(currentDate));
  // 기록 칸에 붙여 둔 조사표가 몇 건인지. 교시에 붙은 것과 자리를 달리해야
  // 어디에 만들어 두었는지 알 수 있다.
  const evalCounts = useDayEvalCounts(dateStr, selectedGroupId);
  const journalEvalCount = evalCounts.byPeriod['journal'] || 0;
  // 라벨은 useLabels 한 곳에서만 읽는다. 여기서 직접 Firestore를 읽으면
  // V3가 localStorage에만 남긴 라벨과 오프라인 캐시 보정을 놓쳐,
  // 기록 라벨이 통째로 사라진다.
  const { journalLabels } = useLabels();

  // 추가와 수정은 오른쪽 칸(Layout의 EntryPanelHost)에서 한다. 칸은 이 화면보다
  // 오래 살아서, 다른 날짜·다른 화면으로 옮겨도 쓰던 것이 남는다.

  // 항목별 접기/펼치기 상태.
  // 여기에는 '사용자가 직접 누른 것'만 담는다. 손대지 않은 항목은 길이를 보고
  // 정한다(긴 것은 접은 채로 시작). 처음 상태를 여기에 미리 채워 넣으면,
  // 기록이 새로 들어오거나 내용이 길어질 때 그 값이 낡아 버린다.
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({});
  const isEntryCollapsed = (entry: JournalEntry) =>
    collapsedIds[entry.id] ?? isLongEntry(entry.content);
  const toggleCollapse = (id: string, current: boolean) => {
    setCollapsedIds(prev => ({ ...prev, [id]: !current }));
  };

  /** 라벨 거르개 (여러 개). 아무것도 안 골랐으면 전체 */
  const [rawLabelFilter, setLabelFilter] = useState<LabelFilter>(EMPTY_FILTER);
  // 고른 라벨이 그새 지워지거나 이름이 바뀌었으면 뺀다 (보이지 않는 칩으로 걸러 두지 않게)
  const labelFilter = pruneFilter(rawLabelFilter, journalLabels.map((l) => l.name));
  const [isCollapsed, setIsCollapsed] = useState(false);

  // 검색에서 이 칸의 항목으로 '이동'해 오면 접혀 있던 칸을 펼친다.
  // 접힌 채로는 항목이 그려지지 않아 찾아 줄 수가 없다.
  const focusSection = useAppStore((s) => s.focusTarget?.section);
  useEffect(() => {
    if (focusSection === 'journal') {
      setIsCollapsed(false);
    }
  }, [focusSection]);

  // 기록에 저장된 라벨을 등록된 라벨 목록에서 찾는다.
  //
  // 기록 항목은 라벨을 이름으로도, ID로도 들고 있다(V3/V4, 추가 폼/배너가 서로 달랐다).
  // 게다가 ID가 없는 라벨에는 useLabels가 `j_<순번>_<이름>` 식으로 자리 번호를 섞어
  // ID를 만들어 준다. 그래서 라벨 순서가 바뀌면 예전에 저장된 ID는 더 이상 맞지 않는다.
  // 예전에는 label이 'j_'로 시작하면 ID로만 찾아서, 이런 항목은 라벨 칩이 사라지고
  // 필터에도 걸리지 않았다. 이름과 ID를 모두, labelIds와 label을 모두 훑는다.
  const resolveLabelNames = (entry: JournalEntry): string[] => {
    const keys = [...(entry.labelIds || []), ...(entry.label ? [entry.label] : [])];
    const names: string[] = [];
    for (const key of keys) {
      if (!key) continue;
      const found = journalLabels.find((l) => l.id === key || l.name === key);
      if (found && !names.includes(found.name)) names.push(found.name);
    }
    return names;
  };

  const resolveLabel = (entry: JournalEntry) => {
    const name = resolveLabelNames(entry)[0];
    return name ? journalLabels.find((l) => l.name === name) || null : null;
  };

  // 등록된 라벨을 찾지 못하면(설정에서 지운 라벨 등) 칩을 숨긴다.
  const getLabelName = (entry: JournalEntry) => resolveLabel(entry)?.name || '';

  const openCreate = () =>
    openEntryPanel({
      kind: 'journal',
      groupId: selectedGroupId,
      dateStr,
      defaultLabel: labelFilter.labels[0] ?? journalLabels[0]?.name,
    });

  const openEdit = (entry: JournalEntry) =>
    openEntryPanel({ kind: 'journal', groupId: selectedGroupId, dateStr, entryId: entry.id, initial: entry });

  // 칸 수는 창 폭이 아니라 본문 폭으로 정한다. 오른쪽 칸이 열려 본문이 좁아지면 줄인다.
  const mainWidth = useMainWidth();
  // 휴대폰에서도 2열 (일정 칸과 같게). 넓으면 3·4열.
  const columnsCount = mainWidth >= 980 ? 4 : mainWidth >= 720 ? 3 : 2;

  // 라벨 상위/하위 (lib/labelTree). 라벨은 여러 개 고르고, 상위 앞 '하위 포함' 체크를 켜야 하위까지 거른다.
  const journalParents = useLabelTree().journal;
  const [openParents, setOpenParents] = useState<Record<string, boolean>>({});

  // 라벨 칩은 윈도우 탐색기처럼 고른다 (lib/labelTree의 clickFilterLabel):
  // 그냥 누르면 하나만, Ctrl은 더하고 빼기, Shift는 기준부터 여기까지. ESC는 모두 뗀다.
  const anchorRef = useRef<string | null>(null);
  const treeRows = orderByTree(journalLabels.map((l) => l.name), journalParents);
  /** 화면에 보이는 라벨 차례 (접힌 하위는 빼되, 고른 것은 보인다) - Shift 범위에 쓴다 */
  const visibleLabelOrder = treeRows
    .filter((r) => r.depth === 0 || !!openParents[r.parent!] || labelFilter.labels.includes(r.name))
    .map((r) => r.name);
  const clickLabel = (name: string, e: React.MouseEvent) => {
    const click = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
    setLabelFilter(clickFilterLabel(labelFilter, name, click, visibleLabelOrder, anchorRef.current));
    if (!click.shift) anchorRef.current = name;
  };
  // ESC: 라벨 고른 것을 모두 뗀다 (오른쪽 칸·팝업은 Layout의 ESC가 함께 닫는다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      anchorRef.current = null;
      setLabelFilter((prev) => (prev.labels.length === 0 ? prev : EMPTY_FILTER));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 필터 적용된 리스트
  const allowedLabels = filterLabelSet(labelFilter, journalParents);
  // 즐겨찾기한 기록은 그날 기록의 맨 위 (19번 U6). 나머지 차례는 그대로
  const filteredJournals = (allowedLabels === null
    ? journals
    : journals.filter((entry) => allowedLabels.has(getLabelName(entry)))
  ).slice().sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));

  const distributeJournals = (items: JournalEntry[]) => {
    const columns = Array.from({ length: columnsCount }, () => [] as { entry: JournalEntry; idx: number }[]);
    items.forEach((item, index) => {
      columns[index % columnsCount].push({ entry: item, idx: index });
    });
    return columns;
  };

  const journalColumns = distributeJournals(filteredJournals);

  return (
    <div className="flex flex-col gap-4">
      {/* 상단 헤더 */}
      {/* 조사표 표식은 만들어 둔 것이 없으면 마우스를 올렸을 때만 나온다.
          그 group-hover가 걸릴 자리가 여기다. */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 group">
        {/* 머리줄: ▼ 📔 기록 N [+ 추가] 📊 · 라벨 거르개 ……… ⚙️  (일정 칸과 같은 배치)
            휴대폰에서는 ⚙️가 제목 줄 오른쪽 끝에 남고, 거르개는 아랫줄로 내려간다. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="text-slate-400 hover:text-slate-700 text-xs px-1 py-0.5 rounded hover:bg-slate-100 transition-colors"
                title={isCollapsed ? '펼치기' : '접기'}
              >
                {isCollapsed ? '▶' : '▼'}
              </button>
              <span className="text-xl">📔</span>
              <h3 className="text-base font-extrabold text-slate-800">기록</h3>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {journals.length}
              </span>
              {!isCollapsed && (
                <button
                  onClick={openCreate}
                  aria-label="기록 추가"
                  title="기록 추가 (오른쪽 칸)"
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors shrink-0"
                >
                  + 추가
                </button>
              )}
              {/* 기록 칸에 붙은 조사표. 만들어 둔 것이 있을 때만 보인다. */}
              <button
                type="button"
                onClick={() => openEvaluationModal(dateStr, 'journal')}
                title={journalEvalCount > 0 ? `조사표 ${journalEvalCount}건` : '조사표 관리'}
                className={`px-1.5 py-0.5 rounded-md text-xs transition-all ${
                  journalEvalCount > 0
                    ? 'text-blue-700 bg-blue-50 border border-blue-200 font-bold'
                    : 'opacity-0 group-hover:opacity-100 text-slate-400 hover:text-emerald-600 hover:bg-slate-100'
                }`}
              >
                📊{journalEvalCount || ''}
              </button>
            </div>

            <button
              type="button"
              onClick={() => openLabelModal('journal')}
              className="order-2 sm:order-3 ml-auto w-7 h-7 flex items-center justify-center rounded-md text-sm text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              title="기록 라벨 설정"
              aria-label="기록 라벨 설정"
            >
              ⚙️
            </button>

            {/* 라벨 필터 바 */}
            {!isCollapsed && journals.length > 0 && (
              <div className="order-3 sm:order-2 w-full sm:w-auto sm:flex-1 flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setLabelFilter(EMPTY_FILTER)}
                  aria-pressed={labelFilter.labels.length === 0}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all shadow-sm ${
                    labelFilter.labels.length === 0
                      ? 'bg-slate-800 text-white'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  전체
                </button>
                {/* 라벨은 눌러서 붙이고 떼며 여러 개 고른다. 모양 (2026-09-30 다듬음):
                    - 하위가 있는 상위는 상위와 하위를 한 묶음(테두리)으로 둔다 - 휴대폰에서 줄이 바뀌어도 떨어지지 않게.
                    - 묶음 맨 앞 ▸/▾로 하위를 펼치고, 펼치면 '하위 포함' 토글과 하위 칩이 묶음 안에 보인다.
                    - '하위 포함'을 켠 채 접으면 상위 칩에 +하위가 붙는다. 고른 하위는 접어도 보인다. */}
                {treeRows
                  .filter((row) => row.depth === 0)
                  .map((row) => {
                    const chip = (name: string, opts?: { included?: boolean; plus?: boolean }) => {
                      const selected = labelFilter.labels.includes(name);
                      /** 고르지 않았지만 상위의 '하위 포함'으로 함께 걸러지는 하위 */
                      const included = !selected && !!opts?.included;
                      return (
                        <button
                          key={name}
                          onClick={(e) => clickLabel(name, e)}
                          // Shift+누르기가 글자를 긁어 고르지 않게
                          onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                          aria-pressed={selected}
                          title={opts?.plus ? `${name} (하위 라벨 포함)` : labelPath(name, journalParents)}
                          className={`px-3 py-1 rounded-full text-xs font-bold transition-all shadow-sm whitespace-nowrap ${
                            selected
                              ? 'bg-blue-600 text-white'
                              : included
                              ? 'bg-blue-50 text-blue-700 border border-dashed border-blue-400'
                              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {name}
                          {opts?.plus && (
                            <span aria-hidden className={`ml-1 px-1 rounded text-2xs ${selected ? 'bg-white/25' : 'bg-blue-100 text-blue-700'}`}>
                              +하위
                            </span>
                          )}
                        </button>
                      );
                    };
                    if (!row.hasChildren) return chip(row.name);
                    const open = !!openParents[row.name];
                    const withChildren = labelFilter.withChildren.includes(row.name);
                    const children = treeRows.filter((r) => r.parent === row.name);
                    const shown = open ? children : children.filter((c) => labelFilter.labels.includes(c.name));
                    return (
                      <span
                        key={row.name}
                        className="inline-flex flex-wrap items-center gap-1 p-0.5 pr-1 rounded-full bg-slate-100/80 border border-slate-200"
                      >
                        <button
                          type="button"
                          onClick={() => setOpenParents((prev) => ({ ...prev, [row.name]: !open }))}
                          aria-expanded={open}
                          aria-label={`${row.name} 하위 라벨 ${open ? '접기' : '펼치기'}`}
                          title={`${row.name} 하위 라벨 ${open ? '접기' : '펼치기'}`}
                          className="w-5 h-5 flex items-center justify-center rounded-full text-2xs text-slate-500 hover:bg-white"
                        >
                          {open ? '▾' : '▸'}
                        </button>
                        {/* +하위 표시는 접었을 때만 (펼치면 옆의 '하위 포함' 체크가 보인다) */}
                        {chip(row.name, { plus: withChildren && !open })}
                        {open && (
                          <label
                            className="inline-flex items-center gap-1 px-1.5 text-2xs font-bold text-slate-500 cursor-pointer select-none"
                            title={`${row.name}을(를) 고르면 하위 라벨 기록까지 함께 보기`}
                          >
                            <input
                              type="checkbox"
                              checked={withChildren}
                              onChange={() => setLabelFilter((prev) => toggleFilterChildren(prev, row.name))}
                              aria-label={`${row.name} 하위 라벨 포함`}
                              className="w-3 h-3 accent-blue-600 cursor-pointer"
                            />
                            하위 포함
                          </label>
                        )}
                        {shown.map((c) => chip(c.name, { included: withChildren }))}
                      </span>
                    );
                  })}
              </div>
            )}
        </div>
      </div>

      {/* 기록 카드 리스트 (메모 페이지와 동일한 가로 우선 다단 레이아웃) */}
      {!isCollapsed && (
        filteredJournals.length > 0 ? (
          <div className="grid gap-4 items-start" style={{ gridTemplateColumns: `repeat(${columnsCount}, minmax(0, 1fr))` }}>
            {journalColumns.map((col, colIndex) => (
              <div key={colIndex} className="flex flex-col gap-4">
                {col.map(({ entry }) => {
                  const origIdx = journals.findIndex(j => j.id === entry.id);
                  const tableOnly = entry.content === TABLE_ONLY_CONTENT && normalizeTables(entry.tables).length > 0;
                  // 카드는 메모와 같은 EntryCard (19번 U6) - 라벨 칩은 위, 완료·즐겨찾기
                  return (
                    <EntryCard
                      key={entry.id}
                      kind="journal"
                      focusKey={focusKey.journal(dateStr, entry.id)}
                      // 표만 있는 기록의 '[표]'(V3가 빼지 않게 넣은 글)는 보이지 않는다
                      content={tableOnly ? '' : entry.content}
                      labels={resolveLabelNames(entry)}
                      labelParents={journalParents}
                      completed={!!entry.completed}
                      favorite={!!entry.favorite}
                      dateText={new Date(entry.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                      attachments={entry.attachments}
                      imageUrl={entry.imageUrl}
                      tables={entry.tables}
                      linkCount={(entry.linkedItems || []).length}
                      onOpenLinks={() => openLinkViewerModal('journal', dateStr, entry.id)}
                      onOpen={() => openEdit(entry)}
                      onToggleComplete={onSetJournalFlags ? () => void onSetJournalFlags(entry.id, { completed: !entry.completed }) : undefined}
                      onToggleFavorite={onSetJournalFlags ? () => void onSetJournalFlags(entry.id, { favorite: !entry.favorite }) : undefined}
                      onMoveUp={origIdx > 0 && onReorderJournals ? () => void onReorderJournals(origIdx, origIdx - 1) : undefined}
                      onMoveDown={origIdx < journals.length - 1 && onReorderJournals ? () => void onReorderJournals(origIdx, origIdx + 1) : undefined}
                      onDelete={() => onDeleteJournal(entry.id)}
                      collapsed={isEntryCollapsed(entry)}
                      onToggleCollapse={(current) => toggleCollapse(entry.id, current)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="w-full text-center py-10 bg-white/60 rounded-2xl border border-dashed border-slate-300 p-6 shadow-xs">
            <p className="text-slate-500 font-bold text-sm">
              {labelFilter.labels.length === 0
                ? '등록된 기록이 없습니다.'
                : `'${labelFilter.labels.join(', ')}' 라벨에 해당하는 기록이 없습니다.`}
            </p>
          </div>
        )
      )}

    </div>
  );
}
