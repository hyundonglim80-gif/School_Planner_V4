import React, { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';

interface LinkViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceType: string;
  sourceDateStr: string;
  sourceId: string;
  sourcePeriod?: number | string;
  sourceFId?: string;
}

export interface NormalizedLink {
  targetType: 'schedule' | 'event' | 'journal' | 'memo';
  targetId: string;
  targetDate: string;
  targetPeriod?: string | number;
  title: string;
  targetFId: string;
  liveText?: string;
  loadingText?: boolean;
}

export default function LinkViewerModal({
  isOpen,
  onClose,
  sourceType,
  sourceDateStr,
  sourceId,
  sourcePeriod,
  sourceFId,
}: LinkViewerModalProps) {
  const { selectedGroupId, setCurrentDate, setScope } = useAppStore();
  const [links, setLinks] = useState<NormalizedLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [editModeTargetId, setEditModeTargetId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const getColPath = useCallback((col: string, fId?: string) => {
    const uid = auth.currentUser?.uid;
    const targetFId = fId || selectedGroupId || 'personal';
    return targetFId === 'personal' || !targetFId
      ? `users/${uid}/${col}`
      : `groups/${targetFId}/${col}`;
  }, [selectedGroupId]);

  // 실시간 아이템 텍스트 조회 (V3 fetchItemText 이식)
  const fetchItemText = useCallback(async (
    type: string,
    dateStr: string,
    id: string,
    period: string | number | undefined,
    fId: string
  ): Promise<string> => {
    try {
      if (type === 'event') {
        const snap = await getDoc(doc(db, getColPath('events', fId), dateStr));
        if (snap.exists()) {
          const list = snap.data().eventList || [];
          const item = list.find((e: any) => String(e.id) === String(id));
          return item?.content || item?.text || '';
        }
      } else if (type === 'journal') {
        const snap = await getDoc(doc(db, getColPath('journals', fId), dateStr));
        if (snap.exists()) {
          const entries = snap.data().entries || [];
          const item = entries.find((e: any) => String(e.id) === String(id));
          return item?.content || '';
        }
      } else if (type === 'schedule') {
        const snap = await getDoc(doc(db, getColPath('schedules', fId), dateStr));
        if (snap.exists()) {
          const periods = snap.data().periods || {};
          const p = period ? String(period) : String(id).replace(/.*_/, '');
          const item = periods[p];
          if (item) {
            const subjectStr = item.subject ? `[${item.subject}] ` : '';
            return `${subjectStr}${item.memo || item.content || ''}`.trim();
          }
        }
      } else if (type === 'memo') {
        const snap = await getDoc(doc(db, getColPath('tasks', fId), id));
        if (snap.exists()) {
          return snap.data().content || snap.data().text || '';
        }
      }
    } catch (err) {
      console.warn('fetchItemText failed:', err);
    }
    return '';
  }, [getColPath]);

  // 링크 목록 조회 (V3 호환 구조 추출)
  const fetchLinks = useCallback(async () => {
    setLoading(true);
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setLoading(false);
      return;
    }

    try {
      const activeFId = sourceFId || selectedGroupId || 'personal';
      let foundRawLinks: any[] = [];

      if (sourceType === 'event') {
        const snap = await getDoc(doc(db, getColPath('events', activeFId), sourceDateStr));
        if (snap.exists()) {
          const ev = (snap.data().eventList || []).find((e: any) => String(e.id) === String(sourceId));
          if (ev?.linkedItems) foundRawLinks = [...ev.linkedItems];
          if (snap.data().links?.[`event_${sourceId}`]) {
            foundRawLinks = [...foundRawLinks, ...snap.data().links[`event_${sourceId}`]];
          }
        }
      } else if (sourceType === 'journal') {
        const snap = await getDoc(doc(db, getColPath('journals', activeFId), sourceDateStr));
        if (snap.exists()) {
          const j = (snap.data().entries || []).find((e: any) => String(e.id) === String(sourceId));
          if (j?.linkedItems) foundRawLinks = [...j.linkedItems];
          if (snap.data().links?.[`journal_${sourceId}`]) {
            foundRawLinks = [...foundRawLinks, ...snap.data().links[`journal_${sourceId}`]];
          }
        }
      } else if (sourceType === 'schedule' || sourceType === 'schedule_header') {
        const snap = await getDoc(doc(db, getColPath('schedules', activeFId), sourceDateStr));
        if (snap.exists()) {
          const pKey = sourcePeriod ? String(sourcePeriod) : String(sourceId);
          const p = (snap.data().periods || {})[pKey];
          if (p?.linkedItems) foundRawLinks = [...p.linkedItems];
          if (snap.data().links?.[`schedule_${pKey}`]) {
            foundRawLinks = [...foundRawLinks, ...snap.data().links[`schedule_${pKey}`]];
          }
        }
      } else if (sourceType === 'memo') {
        const snap = await getDoc(doc(db, getColPath('tasks', activeFId), sourceId));
        if (snap.exists()) {
          if (snap.data().linkedItems) foundRawLinks = [...snap.data().linkedItems];
        }
      }

      // V3 및 V4 구버전 호환 정규화
      const normalizedMap = new Map<string, NormalizedLink>();

      foundRawLinks.forEach((raw) => {
        const targetType = (raw.targetType || raw.type || 'event') as NormalizedLink['targetType'];
        const targetId = String(raw.targetId || raw.id || '');
        const targetDate = String(raw.targetDate || raw.dateStr || '');
        const targetPeriod = raw.targetPeriod !== undefined ? raw.targetPeriod : (raw.period !== undefined ? raw.period : undefined);
        const title = raw.title || raw.text || '';
        const targetFId = raw.targetFId || raw.fId || activeFId;

        const uniqueKey = targetId || `${targetType}_${targetDate}_${targetPeriod || ''}_${title}`;

        if (!normalizedMap.has(uniqueKey) && targetId) {
          normalizedMap.set(uniqueKey, {
            targetType,
            targetId,
            targetDate,
            targetPeriod,
            title,
            targetFId,
            liveText: raw.text || raw.title || '',
            loadingText: true,
          });
        }
      });

      const initialLinks = Array.from(normalizedMap.values());
      setLinks(initialLinks);
      setLoading(false);

      // 비동기로 실시간 본문 로드
      const updatedLinks = await Promise.all(
        initialLinks.map(async (item) => {
          const text = await fetchItemText(
            item.targetType,
            item.targetDate,
            item.targetId,
            item.targetPeriod,
            item.targetFId
          );
          return {
            ...item,
            liveText: text || item.title || '(내용 없음)',
            loadingText: false,
          };
        })
      );
      setLinks(updatedLinks);
    } catch (e) {
      console.error('fetchLinks failed:', e);
      setLoading(false);
    }
  }, [sourceType, sourceDateStr, sourceId, sourcePeriod, sourceFId, selectedGroupId, getColPath, fetchItemText]);

  useEffect(() => {
    if (isOpen) {
      fetchLinks();
    } else {
      setLinks([]);
      setEditModeTargetId(null);
      setEditText('');
    }
  }, [isOpen, fetchLinks]);

  // 해당 화면으로 이동 (V3 navigateAndClose 이식)
  const handleNavigate = (link: NormalizedLink) => {
    onClose();
    if (link.targetType === 'memo') {
      setScope('memo');
    } else if (link.targetDate) {
      const parts = link.targetDate.split('-');
      if (parts.length === 3) {
        setCurrentDate(new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
      } else {
        setCurrentDate(new Date(link.targetDate));
      }
      setScope('day');
    } else {
      alert('이동할 수 없는 항목입니다.');
    }
  };

  // 실시간 본문 수정 저장 (V3 updateItemText 이식)
  const handleSaveEdit = async (link: NormalizedLink) => {
    const newVal = editText.trim();
    if (!newVal) {
      alert('내용을 입력해주세요.');
      return;
    }

    setSavingEdit(true);
    try {
      const colPath = getColPath(
        link.targetType === 'event'
          ? 'events'
          : link.targetType === 'journal'
          ? 'journals'
          : link.targetType === 'schedule'
          ? 'schedules'
          : 'tasks',
        link.targetFId
      );

      if (link.targetType === 'event') {
        const ref = doc(db, colPath, link.targetDate);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const list = snap.data().eventList || [];
          const item = list.find((e: any) => String(e.id) === String(link.targetId));
          if (item) {
            item.content = newVal;
            await setDoc(ref, { eventList: list, updatedAt: Date.now() }, { merge: true });
          }
        }
      } else if (link.targetType === 'journal') {
        const ref = doc(db, colPath, link.targetDate);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const list = snap.data().entries || [];
          const item = list.find((e: any) => String(e.id) === String(link.targetId));
          if (item) {
            item.content = newVal;
            await setDoc(ref, { entries: list, updatedAt: Date.now() }, { merge: true });
          }
        }
      } else if (link.targetType === 'schedule') {
        const ref = doc(db, colPath, link.targetDate);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const periods = snap.data().periods || {};
          const pKey = link.targetPeriod
            ? String(link.targetPeriod)
            : String(link.targetId).replace(/.*_/, '');
          if (periods[pKey]) {
            let newMemo = newVal;
            let newSubj = periods[pKey].subject || '';
            const match = newMemo.match(/^\[(.*?)\]\s*(.*)$/);
            if (match) {
              newSubj = match[1].trim();
              newMemo = match[2].trim();
            }
            periods[pKey].subject = newSubj;
            periods[pKey].memo = newMemo;
            periods[pKey].content = newMemo;
            await setDoc(ref, { periods, updatedAt: Date.now() }, { merge: true });
          }
        }
      } else if (link.targetType === 'memo') {
        const ref = doc(db, colPath, link.targetId);
        await setDoc(ref, { text: newVal, content: newVal, updatedAt: Date.now() }, { merge: true });
      }

      setLinks((prev) =>
        prev.map((l) => (l.targetId === link.targetId ? { ...l, liveText: newVal } : l))
      );
      setEditModeTargetId(null);
      setEditText('');
      alert('✅ 수정된 내용이 저장되었습니다.');
    } catch (e: any) {
      console.error(e);
      alert('저장에 실패했습니다: ' + e.message);
    } finally {
      setSavingEdit(false);
    }
  };

  // 단방향 링크 데이터 삭제 도우미 (V3 _removeLinkFromSide 이식)
  const removeLinkFromSide = async (
    type: string,
    dateStr: string,
    id: string,
    period: string | number | undefined,
    fId: string,
    targetIdToRemove: string
  ) => {
    const colPath = getColPath(
      type === 'event'
        ? 'events'
        : type === 'journal'
        ? 'journals'
        : type === 'schedule' || type === 'schedule_header'
        ? 'schedules'
        : 'tasks',
      fId
    );

    try {
      if (type === 'event') {
        const ref = doc(db, colPath, dateStr);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const list = snap.data().eventList || [];
          const item = list.find((e: any) => String(e.id) === String(id));
          if (item && item.linkedItems) {
            item.linkedItems = item.linkedItems.filter(
              (l: any) => String(l.targetId || l.id) !== String(targetIdToRemove)
            );
            await setDoc(ref, { eventList: list, updatedAt: Date.now() }, { merge: true });
          }
        }
      } else if (type === 'journal') {
        const ref = doc(db, colPath, dateStr);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const list = snap.data().entries || [];
          const item = list.find((e: any) => String(e.id) === String(id));
          if (item && item.linkedItems) {
            item.linkedItems = item.linkedItems.filter(
              (l: any) => String(l.targetId || l.id) !== String(targetIdToRemove)
            );
            await setDoc(ref, { entries: list, updatedAt: Date.now() }, { merge: true });
          }
        }
      } else if (type === 'schedule' || type === 'schedule_header') {
        const ref = doc(db, colPath, dateStr);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const periods = snap.data().periods || {};
          const pKey = period ? String(period) : String(id).replace(/.*_/, '');
          const item = periods[pKey];
          if (item && item.linkedItems) {
            item.linkedItems = item.linkedItems.filter(
              (l: any) => String(l.targetId || l.id) !== String(targetIdToRemove)
            );
            await setDoc(ref, { periods, updatedAt: Date.now() }, { merge: true });
          }
        }
      } else if (type === 'memo') {
        const ref = doc(db, colPath, id);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const linkedItems = snap.data().linkedItems || [];
          const filtered = linkedItems.filter(
            (l: any) => String(l.targetId || l.id) !== String(targetIdToRemove)
          );
          await setDoc(ref, { linkedItems: filtered, updatedAt: Date.now() }, { merge: true });
        }
      }
    } catch (err) {
      console.error('removeLinkFromSide error:', err);
    }
  };

  // 양방향 링크 삭제 (V3 deleteLinkConnection 이식)
  const handleDeleteConnection = async (link: NormalizedLink) => {
    if (!window.confirm('이 연결을 해제하시겠습니까? (양쪽 모두에서 연결이 끊어집니다)')) return;

    const sType = sourceType;
    const sDate = sourceDateStr;
    const sPeriod = sourcePeriod || (sType === 'schedule' ? sourceId : '');
    const sFId = sourceFId || selectedGroupId || 'personal';

    const actualSourceId =
      (sType === 'schedule' || sType === 'schedule_header')
        ? `class_${sDate}_${sPeriod}`
        : sourceId;

    const actualTargetId =
      link.targetType === 'schedule'
        ? `class_${link.targetDate}_${link.targetPeriod || link.targetId.replace(/.*_/, '')}`
        : link.targetId;

    try {
      // 1. 출발지에서 타겟 제거
      await removeLinkFromSide(sType, sDate, actualSourceId, sPeriod, sFId, actualTargetId);
      // 2. 도착지에서 출발지 제거
      await removeLinkFromSide(link.targetType, link.targetDate, actualTargetId, link.targetPeriod, link.targetFId, actualSourceId);

      setLinks((prev) => prev.filter((l) => l.targetId !== link.targetId));
      alert('✅ 연결이 정상적으로 해제되었습니다.');
    } catch (e: any) {
      console.error(e);
      alert('연결 해제 중 오류가 발생했습니다.');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
            <span>📑</span> 연결된 데이터 확인 (수정/이동 가능)
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* 본문 링크 목록 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 bg-slate-50/50 space-y-3">
          {loading ? (
            <div className="text-center py-12 text-slate-400 flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-slate-300 border-t-primary rounded-full animate-spin" />
              <p className="text-xs font-bold text-blue-600">실시간 데이터를 불러오는 중입니다...⏳</p>
            </div>
          ) : links.length === 0 ? (
            <div className="text-center py-12 text-slate-400 flex flex-col items-center gap-2">
              <span className="text-3xl opacity-50">📂</span>
              <p className="text-xs font-medium">연결된 항목의 데이터를 찾을 수 없습니다.</p>
            </div>
          ) : (
            links.map((link) => {
              const icon =
                link.targetType === 'event'
                  ? '📌'
                  : link.targetType === 'journal'
                  ? '📔'
                  : link.targetType === 'memo'
                  ? '📝'
                  : '🏫';

              const typeLabel =
                link.targetType === 'event'
                  ? '일정'
                  : link.targetType === 'journal'
                  ? '기록'
                  : link.targetType === 'memo'
                  ? '메모'
                  : '수업';

              let displayTitle = `[${link.targetDate || '날짜없음'}] ${typeLabel}`;
              if (link.targetType === 'schedule' && link.targetPeriod) {
                displayTitle += ` (${link.targetPeriod}교시)`;
              }

              const isEditing = editModeTargetId === link.targetId;

              return (
                <div
                  key={link.targetId}
                  className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm hover:border-slate-300 transition-colors"
                >
                  <div className="flex justify-between items-center gap-2 mb-2 pb-2 border-b border-slate-100">
                    <span className="font-bold text-blue-700 text-xs flex items-center gap-1">
                      <span>{icon}</span> {displayTitle}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDeleteConnection(link)}
                        className="px-2 py-1 text-[16.5px] font-bold bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                        title="이 연결을 삭제합니다"
                      >
                        🗑️ 삭제
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNavigate(link)}
                        className="px-2.5 py-1 text-[16.5px] font-bold bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                        title="해당 페이지로 이동"
                      >
                        📌 이동
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (isEditing) {
                            setEditModeTargetId(null);
                          } else {
                            setEditModeTargetId(link.targetId);
                            setEditText(link.liveText || '');
                          }
                        }}
                        className="px-2.5 py-1 text-[16.5px] font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors cursor-pointer"
                      >
                        ✏️ 수정
                      </button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="flex flex-col gap-2 mt-2">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="w-full text-xs p-2.5 border border-indigo-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 min-h-[70px] leading-relaxed"
                        autoFocus
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditModeTargetId(null)}
                          className="px-3 py-1.5 text-xs bg-slate-100 text-slate-600 rounded-lg font-bold hover:bg-slate-200 transition-colors"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          disabled={savingEdit}
                          onClick={() => handleSaveEdit(link)}
                          className="px-3.5 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                        >
                          {savingEdit ? '저장 중...' : '수정 내용 반영'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 bg-slate-50/70 border border-slate-100 rounded-lg text-xs font-medium text-slate-800 whitespace-pre-wrap break-words leading-relaxed min-h-[36px]">
                      {link.loadingText ? (
                        <span className="text-slate-400">데이터를 불러오는 중...</span>
                      ) : (
                        link.liveText || <span className="text-slate-400">(내용 없음)</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 모달 하단 닫기 */}
        <div className="px-6 py-3.5 bg-white border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
