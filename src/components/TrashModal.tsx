import React, { useState, useEffect } from 'react';
import { showToast, showErrorToast } from '../utils/toast';
import { collection, query, getDocs, orderBy } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { deleteFromTrash, type TrashItem } from '../utils/trashHelper';
import { collectUploadUrls, deleteUnreferencedUploads } from '../utils/storageCleanup';
import PopupFrame from './PopupFrame';
import { deleteClipTrash, listClipTrash } from '../lib/clipboardHistory';
import { loadTrashRetention, purgeExpiredTrash } from '../lib/trashRetention';
import { restoreTrashItem, CLIP_TRASH_PREFIX } from '../lib/trashRestore';
import { ModalCloseButton } from './ModalShell';

interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  event: '일정',
  journal: '기록',
  memo: '메모',
  schedule: '수업',
  dday: 'D-Day',
  eval: '조사표',
  roster: '명단',
  label: '라벨',
  template: '시간표',
  progress: '진도',
  clip: '클립보드',
};

/**
 * 위쪽 탭 (2026-09-30 사용자 요청). 기타 = 일정·기록·메모·클립보드를 뺀 모든 것
 * (수업·D-Day·조사표·명단·라벨·시간표, 그리고 앞으로 생길 다른 종류도).
 */
export type TrashTab = 'all' | 'event' | 'journal' | 'memo' | 'clip' | 'etc';
export const TRASH_TABS: { key: TrashTab; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'event', label: '일정' },
  { key: 'journal', label: '기록' },
  { key: 'memo', label: '메모' },
  { key: 'clip', label: '클립보드' },
  { key: 'etc', label: '기타' },
];
export function trashTabOf(type: string): Exclude<TrashTab, 'all'> {
  return type === 'event' || type === 'journal' || type === 'memo' || type === 'clip' ? type : 'etc';
}

/** 클립보드 휴지통 항목은 계정 휴지통과 id가 겹치지 않게 앞에 붙인다 */
const CLIP_PREFIX = CLIP_TRASH_PREFIX;
const isClip = (item: TrashItem) => item.type === 'clip';
const clipIdOf = (item: TrashItem) => item.id.slice(CLIP_PREFIX.length);

/** 영구 삭제: 클립보드 항목은 이 기기에서, 나머지는 계정 휴지통에서 */
async function deleteTrashItem(item: TrashItem) {
  if (isClip(item)) await deleteClipTrash([clipIdOf(item)]);
  else await deleteFromTrash(item.id);
}

export default function TrashModal({ isOpen, onClose }: TrashModalProps) {
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  /** 자동 비우기 기간(일). 0이면 꺼짐. 환경설정에서 정한다. */
  const [retentionDays, setRetentionDays] = useState(0);
  const [tab, setTab] = useState<TrashTab>('all');
  /** 지금 탭에 보이는 항목. 선택·일괄 처리·비우기는 이것만 대상으로 한다 */
  const visibleItems = tab === 'all' ? trashItems : trashItems.filter((t) => trashTabOf(t.type) === tab);
  const tabCount = (key: TrashTab) => (key === 'all' ? trashItems.length : trashItems.filter((t) => trashTabOf(t.type) === key).length);
  const tabLabel = TRASH_TABS.find((t) => t.key === tab)!.label;
  const chooseTab = (key: TrashTab) => {
    setTab(key);
    // 안 보이는 항목을 고른 채로 일괄 처리하지 않게 선택을 푼다
    setSelectedIds(new Set());
  };

  useEffect(() => {
    if (isOpen) {
      fetchTrash();
    }
  }, [isOpen]);

  const fetchTrash = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setLoading(true);
    setSelectedIds(new Set());
    try {
      // 기간이 지난 것부터 비운다 (앱을 열 때 하루 한 번도 돌지만, 휴지통을 열면 바로 맞춘다)
      const days = await loadTrashRetention(user.uid);
      setRetentionDays(days);
      if (days > 0) await purgeExpiredTrash(user.uid, days).catch(console.warn);

      const q = query(collection(db, 'users', user.uid, 'trash'), orderBy('deletedAt', 'desc'));
      const snap = await getDocs(q);
      const items: TrashItem[] = [];
      snap.forEach(doc => {
        items.push(doc.data() as TrashItem);
      });
      // 이 기기의 클립보드 휴지통도 함께 보여 준다
      for (const c of await listClipTrash()) {
        items.push({
          id: CLIP_PREFIX + c.id,
          type: 'clip',
          deletedAt: c.deletedAt,
          content: c.kind === 'image' ? '🖼️ 그림' : c.text || '',
          data: null,
        });
      }
      items.sort((a, b) => b.deletedAt - a.deletedAt);
      setTrashItems(items);
    } catch (err) {
      console.error('Failed to fetch trash', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (item: TrashItem) => {
    setActionLoadingId(item.id);
    try {
      await restoreTrashItem(item);
      setTrashItems(prev => prev.filter(t => t.id !== item.id));
      setSelectedIds(prev => {
        if (!prev.has(item.id)) return prev;
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      showToast('✅ 복원되었습니다.');
    } catch (err: any) {
      showErrorToast('복원 실패: ' + err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handlePermanentDelete = async (item: TrashItem) => {
    if (!window.confirm('이 항목을 영구 삭제하시겠습니까? 복구할 수 없습니다.')) return;

    setActionLoadingId(item.id);
    try {
      // 문서를 지우기 전에 첨부 URL을 모아 둔다
      const uploadUrls = collectUploadUrls(item.data);
      await deleteTrashItem(item);
      // 살아 있는 곳에서 더 이상 쓰지 않는 파일만 Storage에서 정리한다
      const uid = auth.currentUser?.uid;
      if (uid && uploadUrls.length > 0) {
        deleteUnreferencedUploads(uploadUrls, uid).catch(console.warn);
      }
      setTrashItems(prev => prev.filter(t => t.id !== item.id));
      setSelectedIds(prev => {
        if (!prev.has(item.id)) return prev;
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    } catch (err) {
      showErrorToast('삭제 실패');
    } finally {
      setActionLoadingId(null);
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isAllSelected = visibleItems.length > 0 && visibleItems.every((t) => selectedIds.has(t.id));
  const toggleSelectAll = () => {
    setSelectedIds(isAllSelected ? new Set() : new Set(visibleItems.map(t => t.id)));
  };

  // 일괄 복원/삭제: 같은 날짜 문서를 여러 항목이 동시에 건드릴 수 있어 순차 처리한다(동시 처리 시 서로 덮어쓰는 경쟁 조건 방지)
  // 복원은 지우는 일이 아니므로 묻지 않는다. (다시 지우면 되돌아간다)
  const handleBulkRestore = async () => {
    if (selectedIds.size === 0 || bulkProcessing) return;

    setBulkProcessing(true);
    const targets = trashItems.filter(t => selectedIds.has(t.id));
    const restoredIds: string[] = [];
    const failedContents: string[] = [];

    for (const item of targets) {
      try {
        await restoreTrashItem(item);
        restoredIds.push(item.id);
      } catch (err) {
        console.error('일괄 복원 실패:', item.id, err);
        failedContents.push(item.content || item.id);
      }
    }

    setTrashItems(prev => prev.filter(t => !restoredIds.includes(t.id)));
    setSelectedIds(new Set());
    setBulkProcessing(false);

    if (failedContents.length > 0) {
      showErrorToast(`${restoredIds.length}개 복원 완료, ${failedContents.length}개 실패:\n${failedContents.join(', ')}`);
    } else {
      showToast(`${restoredIds.length}개 항목을 복원했습니다.`);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0 || bulkProcessing) return;
    if (!window.confirm(`선택한 ${selectedIds.size}개 항목을 영구 삭제하시겠습니까? 복구할 수 없습니다.`)) return;

    setBulkProcessing(true);
    const targets = trashItems.filter(t => selectedIds.has(t.id));
    const deletedIds: string[] = [];

    const uploadUrls: string[] = [];
    for (const item of targets) {
      try {
        uploadUrls.push(...collectUploadUrls(item.data));
        await deleteTrashItem(item);
        deletedIds.push(item.id);
      } catch (err) {
        console.error('일괄 삭제 실패:', item.id, err);
      }
    }

    // 참조 스캔은 항목 수와 무관하게 한 번만 돈다
    const uid = auth.currentUser?.uid;
    if (uid && uploadUrls.length > 0) {
      deleteUnreferencedUploads(uploadUrls, uid).catch(console.warn);
    }

    setTrashItems(prev => prev.filter(t => !deletedIds.includes(t.id)));
    setSelectedIds(new Set());
    setBulkProcessing(false);
    showToast(`${deletedIds.length}개 항목을 영구 삭제했습니다.`);
  };

  // 휴지통 비우기: 지금 들어 있는 것을 모두 영구 삭제한다 (기간을 기다리지 않고 바로).
  // 탭을 골라 두었으면 그 탭의 항목만.
  const handleEmptyTrash = async () => {
    const targets = visibleItems;
    if (targets.length === 0 || bulkProcessing) return;
    const where = tab === 'all' ? '휴지통의' : `휴지통 '${tabLabel}' 탭의`;
    if (!window.confirm(`${where} ${targets.length}개 항목을 모두 영구 삭제하시겠습니까? 복구할 수 없습니다.`)) return;

    setBulkProcessing(true);
    const uploadUrls: string[] = [];
    const deletedIds: string[] = [];
    for (const item of targets) {
      try {
        uploadUrls.push(...collectUploadUrls(item.data));
        await deleteTrashItem(item);
        deletedIds.push(item.id);
      } catch (err) {
        console.error('휴지통 비우기 실패:', item.id, err);
      }
    }
    const uid = auth.currentUser?.uid;
    if (uid && uploadUrls.length > 0) {
      deleteUnreferencedUploads(uploadUrls, uid).catch(console.warn);
    }
    setTrashItems(prev => prev.filter(t => !deletedIds.includes(t.id)));
    setSelectedIds(new Set());
    setBulkProcessing(false);
    showToast(tab === 'all' ? `휴지통을 비웠습니다 (${deletedIds.length}개 영구 삭제).` : `'${tabLabel}' 탭을 비웠습니다 (${deletedIds.length}개 영구 삭제).`);
  };

  if (!isOpen) return null;

  return (
    <PopupFrame isOpen={isOpen} onClose={onClose} width="2xl">
        <div className="p-4 border-b flex justify-between items-center bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <span>🗑️</span> 휴지통
          </h2>
          <button
            title="닫기" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200">
            ✕
          </button>
        </div>

        {/* 종류별 탭 - 지운 것을 나눠 본다 */}
        <div role="tablist" aria-label="휴지통 종류" className="px-1 sm:px-3 pt-2 border-b bg-white flex sm:gap-1 overflow-x-auto shrink-0">
          {TRASH_TABS.map((t) => {
            const active = tab === t.key;
            const n = tabCount(t.key);
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => chooseTab(t.key)}
                className={`px-1.5 sm:px-3 py-2 -mb-px border-b-2 text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  active ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.label}
                <span className={`ml-0.5 sm:ml-1 px-1 sm:px-1.5 rounded-full text-2xs ${active ? 'bg-primary/10' : 'bg-slate-100 text-slate-400'}`}>{n}</span>
              </button>
            );
          })}
        </div>

        {/* 자동 비우기 안내와 지금 비우기 */}
        <div className="px-4 py-2 border-b bg-amber-50/60 flex items-center justify-between gap-2 flex-wrap text-xs">
          <span className="text-slate-600">
            {retentionDays > 0 ? (
              <>🕒 지운 지 <b>{retentionDays}일</b>이 지난 항목은 자동으로 영구 삭제됩니다.</>
            ) : (
              <>🕒 자동 비우기 꺼짐 - 직접 지우기 전까지 남아 있습니다.</>
            )}
            <span className="text-slate-400"> (환경설정에서 바꿈)</span>
          </span>
          {visibleItems.length > 0 && (
            <button
              onClick={handleEmptyTrash}
              disabled={bulkProcessing}
              className="px-3 py-1.5 bg-red-600 text-white hover:bg-red-700 font-bold text-xs rounded-lg transition-colors disabled:opacity-40"
            >
              {tab === 'all' ? '휴지통 비우기' : `${tabLabel} 비우기`}
            </button>
          )}
        </div>

        {visibleItems.length > 0 && (
          <div className="px-4 py-2.5 border-b bg-white flex items-center justify-between gap-2 flex-wrap">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded shrink-0"
              />
              전체 선택
              {selectedIds.size > 0 && (
                <span className="text-primary">({selectedIds.size}개 선택됨)</span>
              )}
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkRestore}
                disabled={selectedIds.size === 0 || bulkProcessing}
                className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold text-xs rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {bulkProcessing ? '처리 중...' : '일괄 복원'}
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0 || bulkProcessing}
                className="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 font-bold text-xs rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {bulkProcessing ? '처리 중...' : '일괄 삭제'}
              </button>
            </div>
          </div>
        )}

        <div className="p-4 overflow-y-auto overscroll-contain flex-1 min-h-0 bg-slate-50/50" data-scroll-lock>
          {loading ? (
            <div className="text-center py-8 text-slate-500">불러오는 중...</div>
          ) : visibleItems.length === 0 ? (
            <div className="text-center py-12 text-slate-400 flex flex-col items-center gap-2">
              <span className="text-4xl opacity-50">🍃</span>
              <p>{tab === 'all' ? '휴지통이 비어 있습니다.' : `지운 ${tabLabel} 항목이 없습니다.`}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleItems.map((item) => (
                <div key={item.id} className="bg-white border rounded-xl p-3 flex items-center gap-3 shadow-sm hover:border-slate-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelectOne(item.id)}
                    className="w-4 h-4 rounded shrink-0"
                  />
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-2 mb-1 text-xs text-slate-500">
                      <span className="font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 whitespace-nowrap shrink-0">
                        {TYPE_LABELS[item.type] || item.type}
                      </span>
                      <span className="whitespace-nowrap">{isClip(item) ? '이 기기' : item.originalDateStr || (item as any).dateStr || '날짜 없음'}</span>
                      <span>•</span>
                      <span>{new Date(item.deletedAt).toLocaleString()} 삭제됨</span>
                    </div>
                    <p className="text-sm text-slate-700 truncate font-medium">
                      {item.content || '(내용 없음)'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleRestore(item)}
                      disabled={actionLoadingId === item.id || bulkProcessing}
                      className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold text-xs rounded-lg transition-colors disabled:opacity-50"
                    >
                      복원
                    </button>
                    <button
                      onClick={() => handlePermanentDelete(item)}
                      disabled={actionLoadingId === item.id || bulkProcessing}
                      className="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 font-bold text-xs rounded-lg transition-colors disabled:opacity-50"
                    >
                      영구 삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 바닥 닫기 줄 — 다른 팝업은 모두 여기에 '닫기'가 있는데 휴지통만 없었다.
            ✕만 있으면 좁은 화면에서 맨 위까지 올라가야 닫을 수 있다. */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2 shrink-0">
          <ModalCloseButton onClose={onClose} />
        </div>
      </PopupFrame>
  );
}
