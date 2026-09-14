import React, { useState, useEffect } from 'react';
import type { JournalEntry, Attachment } from '../../hooks/useDayData';
import { useAppStore } from '../../store/useAppStore';
import { useLabels } from '../../hooks/useLabels';
import ImageViewerModal, { type ViewerImage } from '../../components/ImageViewerModal';
import EntryDrawer, { type EntryDraft } from '../../components/EntryDrawer';
import { showToast } from '../../utils/toast';
import { formatDateStr } from '../../lib/dateUtils';

interface DayJournalProps {
  journals: JournalEntry[];
  onAddJournal: (content: string, label: string, labelIds?: string[], imageUrl?: string, options?: Partial<JournalEntry>) => Promise<void>;
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

  // 항목별 접기/펼치기 상태
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({});
  const toggleCollapse = (id: string) => {
    setCollapsedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const [currentFilter, setCurrentFilter] = useState('전체');
  const [isCollapsed, setIsCollapsed] = useState(false);

  // 💡 라벨이 삭제된 경우 빈 문자열('')을 반환하도록 수정
  const getLabelName = (entry: JournalEntry) => {
    if (entry.labelIds && entry.labelIds.length > 0) {
      // 💡 ID뿐만 아니라 Name으로도 매칭되도록 유연하게 수정
      const firstLabel = entry.labelIds[0];
      const found = journalLabels.find(l => l.id === firstLabel || l.name === firstLabel);
      if (found) return found.name;
      return ''; // 삭제된 라벨 숨김
    }
    if (entry.label && entry.label.startsWith('j_')) {
      const found = journalLabels.find(l => l.id === entry.label);
      if (found) return found.name;
      return ''; // 삭제된 라벨 숨김
    }
    const found = journalLabels.find(l => l.name === entry.label);
    if (found) return found.name;
    return ''; // 삭제된 라벨 숨김
  };

  const getLabelColorClass = (entry: JournalEntry) => {
    let color = 'gray';
    if (entry.labelIds && entry.labelIds.length > 0) {
      const firstLabel = entry.labelIds[0];
      const found = journalLabels.find(l => l.id === firstLabel || l.name === firstLabel);
      if (found) color = found.color;
    } else if (entry.label && entry.label.startsWith('j_')) {
      const found = journalLabels.find(l => l.id === entry.label);
      if (found) color = found.color;
    } else {
      const found = journalLabels.find(l => l.name === entry.label);
      if (found) color = found.color;
    }

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
    if (entry.imageUrl) list.push({ url: entry.imageUrl, name: '첨부 이미지' });
    (entry.attachments || []).forEach((att) => {
      if (isImageAttachment(att)) list.push({ url: att.url, name: att.name });
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

  const openCreate = () => {
    setEditingEntry(null);
    setDrawerOpen(true);
  };

  const openEdit = (entry: JournalEntry) => {
    setEditingEntry(entry);
    setDrawerOpen(true);
  };

  const handleSaveEntry = async (draft: EntryDraft) => {
    const mainLabel = draft.labels.length > 0 ? draft.labels[0] : '일반';
    const attachments: Attachment[] = draft.attachments.map((att) => ({
      id: att.id,
      name: att.name,
      url: att.url,
      type: att.type || 'file',
      size: att.size,
    }));

    if (editingEntry && onUpdateJournal) {
      await onUpdateJournal(editingEntry.id, {
        content: draft.content,
        label: mainLabel,
        labelIds: draft.labels,
        // 배너가 구버전 imageUrl을 첨부 목록으로 옮겨 담으므로, 여기서 비워야
        // 같은 이미지가 본문과 첨부에 두 번 그려지지 않는다.
        imageUrl: '',
        attachments,
        linkedItems: draft.linkedItems,
      });
    } else {
      await onAddJournal(draft.content, mainLabel, draft.labels, undefined, {
        attachments,
        linkedItems: draft.linkedItems,
      });
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
                  const isCollapsedItem = !!collapsedIds[entry.id];
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
                            onClick={(e) => { e.stopPropagation(); toggleCollapse(entry.id); }}
                            className="text-slate-400 hover:text-primary transition-colors p-0.5 text-[15px] cursor-pointer"
                          >
                            {isCollapsedItem ? '▶' : '▼'}
                          </button>

                          {/* 순서 변경 아이콘 */}
                          <div className="flex flex-col items-center gap-0.5 shrink-0 px-0.5">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); if (origIdx > 0 && onReorderJournals) onReorderJournals(origIdx, origIdx - 1); }}
                              disabled={origIdx <= 0}
                              className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-[15px] cursor-pointer"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); if (origIdx < journals.length - 1 && onReorderJournals) onReorderJournals(origIdx, origIdx + 1); }}
                              disabled={origIdx >= journals.length - 1}
                              className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-[15px] cursor-pointer"
                            >
                              ▼
                            </button>
                          </div>

                          {/* 💡 라벨이 삭제되지 않고 남아있을 때만 뱃지 표시 */}
                          {getLabelName(entry) && (
                            <span className={`px-2 py-0.5 rounded-md text-[16.5px] font-bold border ${getLabelColorClass(entry)}`}>
                              {getLabelName(entry)}
                            </span>
                          )}

                          <span className="text-[16.5px] text-slate-400">
                            {new Date(entry.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                          </span>

                          {linkCount > 0 && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openLinkViewerModal('journal', formattedDate, entry.id); }}
                              className="bg-yellow-100 text-yellow-800 text-[15px] px-1.5 py-0.5 rounded font-bold border border-yellow-300 hover:bg-yellow-200 cursor-pointer"
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
                              className="bg-indigo-50 text-indigo-700 text-[15px] px-1.5 py-0.5 rounded font-bold border border-indigo-200 hover:bg-indigo-100 transition-colors cursor-pointer"
                              title="첨부 이미지 보기"
                            >
                              🖼️ {getEntryImages(entry).length}
                            </button>
                          )}
                          {getEntryFiles(entry).length > 0 && (
                            <span className="bg-slate-100 text-slate-600 text-[15px] px-1.5 py-0.5 rounded font-bold border border-slate-200">
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
                              if (!window.confirm('정말 삭제하시겠습니까?')) return;
                              await onDeleteJournal(entry.id);
                              showToast('기록이 삭제되었습니다 (휴지통 보관)');
                            }}
                            className="text-slate-400 hover:text-red-500 p-1 rounded-md text-xs transition-colors cursor-pointer"
                            title="기록 삭제"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>

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
                              <img src={entry.imageUrl} alt="첨부 이미지" className="max-w-full h-auto object-cover max-h-48" loading="lazy" />
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
                                    <img src={att.url} alt={att.name} className="w-full h-full object-cover" loading="lazy" />
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
        }}
        kind="journal"
        entry={editingEntry}
        labelOptions={journalLabels.map((lbl) => lbl.name)}
        onSave={handleSaveEntry}
        onDelete={
          editingEntry
            ? async () => {
                await onDeleteJournal(editingEntry.id);
                showToast('기록이 삭제되었습니다 (휴지통 보관)');
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
