import React, { useState, useEffect, useRef } from 'react';
import type { JournalEntry, Attachment } from '../../hooks/useDayData';
import { useAppStore } from '../../store/useAppStore';
import { isLongEntry, previewLine } from '../../lib/entryCollapse';
import { useLabels } from '../../hooks/useLabels';
import { attachmentImageSrc } from '../../lib/driveApi';
import ImageViewerModal, { type ViewerImage } from '../../components/ImageViewerModal';
import EntryDrawer, { type EntryDraft } from '../../components/EntryDrawer';
import { showToast } from '../../utils/toast';
import { formatDateStr } from '../../lib/dateUtils';

interface DayJournalProps {
  journals: JournalEntry[];
  onAddJournal: (content: string, label: string, labelIds?: string[], imageUrl?: string, options?: Partial<JournalEntry>) => Promise<string | void>;
  onDeleteJournal: (id: string) => Promise<void>;
  onUpdateJournal?: (id: string, updates: Partial<JournalEntry>) => Promise<void>;
  onReorderJournals?: (sourceIndex: number, targetIndex: number) => Promise<void>;
}

export default function DayJournal({
  journals,
  onAddJournal,
  onDeleteJournal,
  onUpdateJournal,
  onReorderJournals,
}: DayJournalProps) {
  const { openLinkViewerModal, currentDate } = useAppStore();
  const formattedDate = formatDateStr(new Date(currentDate));
  // 라벨은 useLabels 한 곳에서만 읽는다. 여기서 직접 Firestore를 읽으면
  // V3가 localStorage에만 남긴 라벨과 오프라인 캐시 보정을 놓쳐,
  // 기록 라벨이 통째로 사라진다.
  const { journalLabels } = useLabels();

  // 추가와 수정 모두 메모와 같은 오른쪽 배너에서 처리한다.
  // 수정 대상은 열 때의 값을 그대로 들고 있는다. 구독이 갱신되며 props의 항목
  // 객체가 새로 만들어지면, 배너가 입력 중인 내용을 되돌려 버린다.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);

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

  const [currentFilter, setCurrentFilter] = useState('전체');
  const [isCollapsed, setIsCollapsed] = useState(false);

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

  const getLabelColorClass = (entry: JournalEntry) => {
    const color = resolveLabel(entry)?.color || 'gray';

    const map: Record<string, string> = {
      blue: 'bg-blue-50 text-blue-700 border-blue-200',
      green: 'bg-green-50 text-green-700 border-green-200',
      red: 'bg-red-50 text-red-700 border-red-200',
      orange: 'bg-orange-50 text-orange-700 border-orange-200',
      yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
      indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      purple: 'bg-purple-50 text-purple-700 border-purple-200',
      gray: 'bg-slate-50 text-slate-700 border-slate-200',
    };
    return map[color] || map.gray;
  };

  const [viewerImages, setViewerImages] = useState<ViewerImage[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);

  const isImageAttachment = (att: Attachment) =>
    att.type === 'image' || /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(att.url || '');

  // 기록에 붙은 이미지(구버전 imageUrl 포함)를 뷰어용 목록으로 모은다.
  const getEntryImages = (entry: JournalEntry): ViewerImage[] => {
    const list: ViewerImage[] = [];
    if (entry.imageUrl) list.push({ url: attachmentImageSrc({ url: entry.imageUrl }), name: '첨부 이미지' });
    (entry.attachments || []).forEach((att) => {
      if (isImageAttachment(att)) list.push({ url: attachmentImageSrc(att), name: att.name });
    });
    return list;
  };

  const getEntryFiles = (entry: JournalEntry): Attachment[] =>
    (entry.attachments || []).filter((att) => !isImageAttachment(att));

  // 클릭한 썸네일부터 보여준다.
  const openEntryViewer = (entry: JournalEntry, clickedUrl?: string) => {
    const images = getEntryImages(entry);
    if (images.length === 0) return;
    const idx = clickedUrl ? images.findIndex((img) => img.url === clickedUrl) : 0;
    setViewerIndex(idx >= 0 ? idx : 0);
    setViewerImages(images);
  };

  // 방금 만든 기록. setEditingEntry는 다음 그림에서야 반영되므로,
  // 연달아 저장이 들어와도 새로 만들지 않도록 여기에도 담아 둔다. (메모도 같은 방식)
  const justCreatedRef = useRef<JournalEntry | null>(null);

  const openCreate = () => {
    setEditingEntry(null);
    justCreatedRef.current = null;
    setDrawerOpen(true);
  };

  const openEdit = (entry: JournalEntry) => {
    setEditingEntry(entry);
    justCreatedRef.current = null;
    setDrawerOpen(true);
  };

  // 배너의 라벨 칩은 이름으로 비교한다. ID로 저장된 라벨을 그대로 넘기면 선택 표시가
  // 안 되고, 그 상태로 저장하면 라벨이 지워진다. 이름으로 바꿔서 넘긴다.
  const drawerEntry = editingEntry
    ? (() => {
        const names = resolveLabelNames(editingEntry);
        return { ...editingEntry, labels: names, labelIds: names, label: names[0] || '' };
      })()
    : null;

  const handleSaveEntry = async (draft: EntryDraft) => {
    // 라벨을 고르지 않았으면 빈 값으로 둔다. 예전에는 '일반'을 넣었는데, 등록된
    // 라벨 어디에도 없는 이름이라 칩도 안 뜨고 어떤 필터에도 걸리지 않았다.
    const mainLabel = draft.labels.length > 0 ? draft.labels[0] : '';
    // 💡 labelIds는 "ID"로 저장한다. V3는 기록의 labelIds를 ID로만 찾아서(이름으로는
    // 안 찾는다) 이름을 넣으면 V3에서 라벨 칩이 하나도 안 보인다.
    // label(이름)은 그대로 두어 V3의 폴백과 V4의 해석이 모두 통하게 한다.
    const labelIds = draft.labels
      .map((name) => journalLabels.find((l) => l.name === name)?.id)
      .filter((id): id is string => !!id);
    const attachments: Attachment[] = draft.attachments.map((att) => ({
      id: att.id,
      name: att.name,
      url: att.url,
      type: att.type || 'file',
      size: att.size,
    }));

    // 저장해도 배너는 열려 있으므로, 방금 만든 기록이 있으면 그것을 고친다.
    // 안 그러면 한 번 더 저장할 때 같은 내용이 새로 하나 더 생긴다.
    const target = editingEntry || justCreatedRef.current;
    if (target && onUpdateJournal) {
      await onUpdateJournal(target.id, {
        content: draft.content,
        label: mainLabel,
        labelIds,
        // 배너가 구버전 imageUrl을 첨부 목록으로 옮겨 담으므로, 여기서 비워야
        // 같은 이미지가 본문과 첨부에 두 번 그려지지 않는다.
        imageUrl: '',
        attachments,
        linkedItems: draft.linkedItems,
      });
    } else {
      const newId = await onAddJournal(draft.content, mainLabel, labelIds, undefined, {
        attachments,
        linkedItems: draft.linkedItems,
      });
      if (typeof newId === 'string') {
        const created: JournalEntry = {
          id: newId,
          content: draft.content,
          createdAt: Date.now(),
          label: mainLabel,
          labelIds,
          imageUrl: '',
          attachments,
          linkedItems: draft.linkedItems,
        };
        justCreatedRef.current = created;
        setEditingEntry(created);
      }
    }
  };

  const [columnsCount, setColumnsCount] = useState(4);

  useEffect(() => {
    const updateCols = () => {
      if (window.innerWidth >= 1024) setColumnsCount(4);
      else if (window.innerWidth >= 768) setColumnsCount(3);
      else if (window.innerWidth >= 640) setColumnsCount(2);
      else setColumnsCount(1);
    };
    updateCols();
    window.addEventListener('resize', updateCols);
    return () => window.removeEventListener('resize', updateCols);
  }, []);

  // 필터 적용된 리스트
  const filteredJournals = currentFilter === '전체'
    ? journals
    : journals.filter((entry) => getLabelName(entry) === currentFilter);

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
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">

          <div className="flex flex-wrap items-center gap-3 flex-1">
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
            </div>

            {/* 라벨 필터 바 */}
            {!isCollapsed && journals.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setCurrentFilter('전체')}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all shadow-sm ${
                    currentFilter === '전체'
                      ? 'bg-slate-800 text-white'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  전체
                </button>
                {journalLabels.map((lbl) => (
                  <button
                    key={lbl.id}
                    onClick={() => setCurrentFilter(lbl.name)}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition-all shadow-sm ${
                      currentFilter === lbl.name
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {lbl.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 우측 상단 버튼 - 메모처럼 오른쪽 배너를 연다 */}
          {!isCollapsed && (
            <div className="flex items-center shrink-0">
              <button
                onClick={openCreate}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
              >
                + 추가
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 기록 카드 리스트 (메모 페이지와 동일한 가로 우선 다단 레이아웃) */}
      {!isCollapsed && (
        filteredJournals.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-start">
            {journalColumns.map((col, colIndex) => (
              <div key={colIndex} className="flex flex-col gap-4">
                {col.map(({ entry }) => {
                  const linkCount = (entry.linkedItems || []).length;
                  const isCollapsedItem = isEntryCollapsed(entry);
                  const origIdx = journals.findIndex(j => j.id === entry.id);

                  return (
                    <div
                      key={entry.id}
                      onClick={() => openEdit(entry)}
                      title="클릭하여 수정"
                      className="w-full group p-4 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-slate-300 bg-white transition-all flex flex-col gap-2 cursor-pointer"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* 항목 접기/펼치기 삼각형 토글 버튼 */}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleCollapse(entry.id, isCollapsedItem); }}
                            className="text-slate-400 hover:text-primary transition-colors p-0.5 text-xs cursor-pointer"
                            title={isCollapsedItem ? '펼치기' : '접기'}
                          >
                            {isCollapsedItem ? '▶' : '▼'}
                          </button>

                          {/* 순서 변경 아이콘 */}
                          <div className="flex flex-col items-center gap-0.5 shrink-0 px-0.5">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); if (origIdx > 0 && onReorderJournals) onReorderJournals(origIdx, origIdx - 1); }}
                              disabled={origIdx <= 0}
                              className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-xs cursor-pointer"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); if (origIdx < journals.length - 1 && onReorderJournals) onReorderJournals(origIdx, origIdx + 1); }}
                              disabled={origIdx >= journals.length - 1}
                              className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-xs cursor-pointer"
                            >
                              ▼
                            </button>
                          </div>

                          {/* 💡 라벨이 삭제되지 않고 남아있을 때만 뱃지 표시 */}
                          {getLabelName(entry) && (
                            <span className={`px-2 py-0.5 rounded-md text-xs font-bold border ${getLabelColorClass(entry)}`}>
                              {getLabelName(entry)}
                            </span>
                          )}

                          <span className="text-xs text-slate-400">
                            {new Date(entry.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                          </span>

                          {linkCount > 0 && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openLinkViewerModal('journal', formattedDate, entry.id); }}
                              className="bg-yellow-100 text-yellow-800 text-xs px-1.5 py-0.5 rounded font-bold border border-yellow-300 hover:bg-yellow-200 cursor-pointer"
                            >
                                🔗 {linkCount}
                            </button>
                          )}
                          {/* 접힌 상태에서는 썸네일이 안 보이므로 이때만 이미지 아이콘을 노출한다.
                              (펼친 상태에서는 썸네일 자체가 표시 역할을 하므로 중복) */}
                          {isCollapsedItem && getEntryImages(entry).length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openEntryViewer(entry); }}
                              className="bg-indigo-50 text-indigo-700 text-xs px-1.5 py-0.5 rounded font-bold border border-indigo-200 hover:bg-indigo-100 transition-colors cursor-pointer"
                              title="첨부 이미지 보기"
                            >
                              🖼️ {getEntryImages(entry).length}
                            </button>
                          )}
                          {getEntryFiles(entry).length > 0 && (
                            <span className="bg-slate-100 text-slate-600 text-xs px-1.5 py-0.5 rounded font-bold border border-slate-200">
                                📎 {getEntryFiles(entry).length}
                            </span>
                          )}
                        </div>

                        {/* 파일/링크 추가는 수정 배너 안에 있으므로 수정/삭제만 노출한다 */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openEdit(entry); }}
                            className="text-slate-400 hover:text-blue-600 p-1 rounded-md text-xs font-bold cursor-pointer"
                            title="기록 수정"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              await onDeleteJournal(entry.id);
                              showToast('🗑️ 기록을 삭제했습니다. 휴지통에서 복원할 수 있습니다.');
                            }}
                            className="text-slate-400 hover:text-red-500 p-1 rounded-md text-xs transition-colors cursor-pointer"
                            title="기록 삭제"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>

                      {/* 접혀 있을 때는 한 줄만 보여 준다. 아무것도 안 보이면
                          어느 기록인지 알 수 없어 하나씩 펼쳐 봐야 한다. */}
                      {isCollapsedItem && previewLine(entry.content) && (
                        <p className="text-sm text-slate-500 truncate leading-relaxed">
                          {previewLine(entry.content)}
                        </p>
                      )}

                      {/* 항목이 접히지 않았을 때만 본문 및 첨부파일 표시 */}
                      {!isCollapsedItem && (
                        <div className="flex flex-col gap-3 mt-1">
                          <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                            {entry.content}
                          </p>
                          {entry.imageUrl && (
                            <div
                              className="mt-1 rounded-lg overflow-hidden border border-slate-200/60 bg-slate-50 inline-block max-w-fit cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); openEntryViewer(entry, entry.imageUrl!); }}
                              title="클릭하여 크게 보기"
                            >
                              <img src={attachmentImageSrc({ url: entry.imageUrl })} alt="첨부 이미지" className="max-w-full h-auto object-cover max-h-48" loading="lazy" />
                            </div>
                          )}
                          {entry.attachments && entry.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-1">
                              {entry.attachments.map((att, attIdx) => (
                                isImageAttachment(att) ? (
                                  <button
                                    key={attIdx}
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); openEntryViewer(entry, att.url); }}
                                    className="block w-16 h-16 rounded-lg overflow-hidden border border-slate-200 hover:shadow-sm transition-shadow cursor-pointer"
                                    title="클릭하여 크게 보기"
                                  >
                                    <img src={attachmentImageSrc(att)} alt={att.name} className="w-full h-full object-cover" loading="lazy" />
                                  </button>
                                ) : (
                                  <a
                                    key={attIdx}
                                    href={att.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="block px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 truncate max-w-[150px] hover:bg-slate-100 transition-colors"
                                    title={att.name}
                                  >
                                    📎 {att.name}
                                  </a>
                                )
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="w-full text-center py-10 bg-white/60 rounded-2xl border border-dashed border-slate-300 p-6 shadow-xs">
            <p className="text-slate-500 font-bold text-sm">
              {currentFilter === '전체' ? '등록된 기록이 없습니다.' : `'${currentFilter}' 라벨에 해당하는 기록이 없습니다.`}
            </p>
          </div>
        )
      )}

      {/* 새 기록 / 수정 - 메모와 같은 오른쪽 배너 */}
      <EntryDrawer
        isOpen={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditingEntry(null);
          justCreatedRef.current = null;
        }}
        kind="journal"
        entry={drawerEntry}
        labelOptions={journalLabels.map((lbl) => lbl.name)}
        onSave={handleSaveEntry}
        onDelete={
          editingEntry
            ? async () => {
                await onDeleteJournal(editingEntry.id);
                showToast('🗑️ 기록을 삭제했습니다. 휴지통에서 복원할 수 있습니다.');
              }
            : undefined
        }
        defaultLabel={currentFilter !== '전체' ? currentFilter : journalLabels[0]?.name}
      />

      <ImageViewerModal
        isOpen={!!viewerImages}
        onClose={() => setViewerImages(null)}
        images={viewerImages || []}
        startIndex={viewerIndex}
      />
    </div>
  );
}
