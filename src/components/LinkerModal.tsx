import React, { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc, getDocs, collection } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { useLabels } from '../hooks/useLabels';

interface LinkerModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceType: string;
  sourceDateStr: string;
  sourceId?: string;
  sourcePeriod?: string | number;
  sourceFId?: string;
}

export interface SelectedLinkItem {
  targetType: 'schedule' | 'event' | 'journal' | 'memo';
  targetId: string;
  targetDate: string;
  targetPeriod?: string | number;
  title: string;
  targetFId: string;
}

interface FetchedItem {
  id: string;
  type: 'schedule' | 'event' | 'journal' | 'memo';
  date: string;
  title: string;
  fId: string;
  labelIds?: string[];
  period?: string | number;
}

function formatDateStr(d: Date): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

export default function LinkerModal({
  isOpen,
  onClose,
  sourceType,
  sourceDateStr,
  sourceId,
  sourcePeriod,
  sourceFId,
}: LinkerModalProps) {
  const { selectedGroupId, linkerCallback } = useAppStore();
  const { eventLabels } = useLabels();

  const [currentTab, setCurrentTab] = useState<'event' | 'schedule' | 'journal' | 'memo'>('event');
  const [selectedSourcePeriod, setSelectedSourcePeriod] = useState<number>(
    sourcePeriod ? Number(sourcePeriod) : 1
  );

  // 데이터 탭별 항목 저장
  const [tabItems, setTabItems] = useState<{
    event: FetchedItem[];
    journal: FetchedItem[];
    memo: FetchedItem[];
  }>({
    event: [],
    journal: [],
    memo: [],
  });

  // 장바구니에 담긴 링크 목록
  const [selectedLinks, setSelectedLinks] = useState<SelectedLinkItem[]>([]);

  // 필터 및 페이징 상태
  const [dateRange, setDateRange] = useState('today');
  const [customStart, setCustomStart] = useState(sourceDateStr);
  const [customEnd, setCustomEnd] = useState(sourceDateStr);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]); // 빈 배열이면 '전체'
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;
  const [loading, setLoading] = useState(false);

  // 수업 탭 전용 상태
  const [scheduleDate, setScheduleDate] = useState(sourceDateStr || formatDateStr(new Date()));
  const [schedulePeriod, setSchedulePeriod] = useState<number>(1);

  const activeFId = sourceFId || selectedGroupId || 'personal';

  const getColPath = useCallback(
    (col: string, fId?: string) => {
      const uid = auth.currentUser?.uid;
      const targetFId = fId || activeFId;
      return targetFId === 'personal' || !targetFId
        ? `users/${uid}/${col}`
        : `groups/${targetFId}/${col}`;
    },
    [activeFId]
  );

  // 날짜 범위 계산
  const computeDateRange = useCallback(() => {
    const center = new Date(sourceDateStr || new Date());
    let s = new Date(center);
    let e = new Date(center);

    if (dateRange === 'today') {
      return { start: sourceDateStr, end: sourceDateStr };
    } else if (dateRange === '1week') {
      s.setDate(s.getDate() - 7);
      e.setDate(e.getDate() + 7);
    } else if (dateRange === '1month') {
      s.setDate(s.getDate() - 30);
      e.setDate(e.getDate() + 30);
    } else if (dateRange === 'sem1') {
      s = new Date(center.getFullYear(), 2, 1);
      e = new Date(center.getFullYear(), 7, 31);
    } else if (dateRange === 'sem2') {
      s = new Date(center.getFullYear(), 8, 1);
      e = new Date(center.getFullYear() + 1, 1, 28);
    } else if (dateRange === 'year') {
      s = new Date(center.getFullYear(), 2, 1);
      e = new Date(center.getFullYear() + 1, 1, 28);
    } else if (dateRange === 'custom') {
      return { start: customStart, end: customEnd };
    }
    return { start: formatDateStr(s), end: formatDateStr(e) };
  }, [dateRange, sourceDateStr, customStart, customEnd]);

  // 메모 전체 로드 (V3 fetchMemoData 이식)
  const fetchMemoData = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    try {
      const allMemos: FetchedItem[] = [];

      // 1. 개인 메모
      const personalSnap = await getDocs(collection(db, `users/${uid}/tasks`));
      personalSnap.forEach((d) => {
        const data = d.data();
        const text = data.content || data.text || '';
        const created = data.createdAt ? formatDateStr(new Date(data.createdAt)) : '';
        if (text.trim()) {
          allMemos.push({
            id: d.id,
            type: 'memo',
            title: text,
            date: created,
            fId: 'personal',
          });
        }
      });

      // 2. 그룹 메모 (현재 선택 그룹이 있으면)
      if (selectedGroupId && selectedGroupId !== 'personal') {
        const groupSnap = await getDocs(collection(db, `groups/${selectedGroupId}/tasks`));
        groupSnap.forEach((d) => {
          const data = d.data();
          const text = data.content || data.text || '';
          const created = data.createdAt ? formatDateStr(new Date(data.createdAt)) : '';
          if (text.trim()) {
            allMemos.push({
              id: d.id,
              type: 'memo',
              title: text,
              date: created,
              fId: selectedGroupId,
            });
          }
        });
      }

      setTabItems((prev) => ({
        ...prev,
        memo: allMemos.sort((a, b) => b.date.localeCompare(a.date)),
      }));
    } catch (e) {
      console.warn('fetchMemoData error:', e);
    }
  }, [selectedGroupId]);

  // 기간 범위 데이터 로드 (V3 fetchDateRangeData 이식)
  const fetchDateRangeData = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const { start, end } = computeDateRange();
    if (!start || !end) return;

    setLoading(true);
    const events: FetchedItem[] = [];
    const journals: FetchedItem[] = [];

    try {
      const cur = new Date(start);
      const endD = new Date(end);
      const maxDays = 370;
      let days = 0;

      while (cur <= endD && days < maxDays) {
        const dStr = formatDateStr(cur);
        const colFId = activeFId;

        // 일정 로드
        try {
          const evSnap = await getDoc(doc(db, getColPath('events', colFId), dStr));
          if (evSnap.exists()) {
            const list = evSnap.data().eventList || [];
            list.forEach((e: any, idx: number) => {
              const content = e.content || e.text || '';
              if (content.trim()) {
                events.push({
                  id: e.id || `ev_${dStr}_${idx}`,
                  type: 'event',
                  title: content,
                  date: dStr,
                  fId: colFId,
                  labelIds: e.labelIds || [],
                });
              }
            });
          }
        } catch {}

        // 기록(일지) 로드
        try {
          const jrSnap = await getDoc(doc(db, getColPath('journals', colFId), dStr));
          if (jrSnap.exists()) {
            const entries = jrSnap.data().entries || [];
            entries.forEach((j: any, idx: number) => {
              const content = j.content || '';
              if (content.trim()) {
                journals.push({
                  id: j.id || `jr_${dStr}_${idx}`,
                  type: 'journal',
                  title: content,
                  date: dStr,
                  fId: colFId,
                  labelIds: j.labelIds || [],
                });
              }
            });
          }
        } catch {}

        cur.setDate(cur.getDate() + 1);
        days++;
      }

      setTabItems((prev) => ({
        ...prev,
        event: events.sort((a, b) => b.date.localeCompare(a.date)),
        journal: journals.sort((a, b) => b.date.localeCompare(a.date)),
      }));
    } catch (e) {
      console.warn('fetchDateRangeData error:', e);
    } finally {
      setLoading(false);
      setCurrentPage(1);
    }
  }, [computeDateRange, activeFId, getColPath]);

  // 모달 오픈 시 초기화
  useEffect(() => {
    if (isOpen) {
      setSelectedLinks([]);
      setCurrentTab('event');
      setDateRange('today');
      setCurrentPage(1);
      setSearchKeyword('');
      setSelectedLabelIds([]);
      setSelectedSourcePeriod(sourcePeriod ? Number(sourcePeriod) : 1);
      setScheduleDate(sourceDateStr || formatDateStr(new Date()));
      setSchedulePeriod(1);
      fetchDateRangeData();
      fetchMemoData();
    }
  }, [isOpen, sourcePeriod, sourceDateStr, fetchDateRangeData, fetchMemoData]);

  // 기간 범위 변경 시 자동 재조회
  useEffect(() => {
    if (isOpen && dateRange !== 'custom') {
      fetchDateRangeData();
    }
  }, [dateRange, isOpen, fetchDateRangeData]);

  // 항목 선택/해제 토글
  const toggleSelection = (item: FetchedItem) => {
    const exists = selectedLinks.some((l) => l.targetId === item.id);
    if (exists) {
      setSelectedLinks((prev) => prev.filter((l) => l.targetId !== item.id));
    } else {
      setSelectedLinks((prev) => [
        ...prev,
        {
          targetType: item.type,
          targetId: item.id,
          targetDate: item.date,
          title: item.title,
          targetFId: item.fId,
        },
      ]);
    }
  };

  // 수업 링크 직접 담기 (V3 addScheduleLink 이식)
  const addScheduleLink = () => {
    if (!scheduleDate || !schedulePeriod) return;
    const fakeId = `class_${scheduleDate}_${schedulePeriod}`;
    const title = `${scheduleDate} ${schedulePeriod}교시 수업`;

    if (!selectedLinks.some((l) => l.targetId === fakeId)) {
      setSelectedLinks((prev) => [
        ...prev,
        {
          targetType: 'schedule',
          targetId: fakeId,
          targetDate: scheduleDate,
          targetPeriod: schedulePeriod,
          title,
          targetFId: activeFId,
        },
      ]);
    }
  };

  const removeLink = (targetId: string) => {
    setSelectedLinks((prev) => prev.filter((l) => l.targetId !== targetId));
  };

  // 라벨 토글
  const toggleLabel = (labelId: string) => {
    if (labelId === 'all') {
      setSelectedLabelIds([]);
    } else {
      setSelectedLabelIds((prev) =>
        prev.includes(labelId) ? prev.filter((id) => id !== labelId) : [...prev, labelId]
      );
    }
    setCurrentPage(1);
  };

  // 도착지 항목에 역방향 링크 주입 (V3 addReverseLink 이식)
  const addReverseLink = async (targetLink: SelectedLinkItem, sourceMeta: SelectedLinkItem) => {
    const tFId = targetLink.targetFId || activeFId;
    const colPath = (col: string) =>
      tFId === 'personal' || !tFId ? `users/${auth.currentUser?.uid}/${col}` : `groups/${tFId}/${col}`;

    try {
      if (targetLink.targetType === 'event') {
        const ref = doc(db, colPath('events'), targetLink.targetDate);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const list = snap.data().eventList || [];
          const item = list.find((e: any) => String(e.id) === String(targetLink.targetId));
          if (item) {
            item.linkedItems = item.linkedItems || [];
            if (!item.linkedItems.some((l: any) => String(l.targetId || l.id) === String(sourceMeta.targetId))) {
              item.linkedItems.push(sourceMeta);
              await setDoc(ref, { eventList: list }, { merge: true });
            }
          }
        }
      } else if (targetLink.targetType === 'journal') {
        const ref = doc(db, colPath('journals'), targetLink.targetDate);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const list = snap.data().entries || [];
          const item = list.find((j: any) => String(j.id) === String(targetLink.targetId));
          if (item) {
            item.linkedItems = item.linkedItems || [];
            if (!item.linkedItems.some((l: any) => String(l.targetId || l.id) === String(sourceMeta.targetId))) {
              item.linkedItems.push(sourceMeta);
              await setDoc(ref, { entries: list }, { merge: true });
            }
          }
        }
      } else if (targetLink.targetType === 'schedule') {
        const ref = doc(db, colPath('schedules'), targetLink.targetDate);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const periods = snap.data().periods || {};
          const pKey = targetLink.targetPeriod
            ? String(targetLink.targetPeriod)
            : String(targetLink.targetId).replace(/.*_/, '');
          const item = periods[pKey];
          if (item) {
            item.linkedItems = item.linkedItems || [];
            if (!item.linkedItems.some((l: any) => String(l.targetId || l.id) === String(sourceMeta.targetId))) {
              item.linkedItems.push(sourceMeta);
              await setDoc(ref, { periods }, { merge: true });
            }
          }
        }
      } else if (targetLink.targetType === 'memo') {
        const ref = doc(db, colPath('tasks'), targetLink.targetId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const linkedItems = snap.data().linkedItems || [];
          if (!linkedItems.some((l: any) => String(l.targetId || l.id) === String(sourceMeta.targetId))) {
            linkedItems.push(sourceMeta);
            await setDoc(ref, { linkedItems }, { merge: true });
          }
        }
      }
    } catch (err) {
      console.warn('addReverseLink error:', err);
    }
  };

  // 최종 링크 저장 (V3 saveLinks 이식)
  const handleSaveLinks = async () => {
    if (selectedLinks.length === 0) {
      alert('연결할 항목을 선택해주세요.');
      return;
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    // 수동 콜백 모드인 경우
    if (linkerCallback) {
      linkerCallback(selectedLinks);
      onClose();
      return;
    }

    if (sourceType === 'manual') {
      onClose();
      return;
    }

    const sFId = activeFId;
    const sDateStr = sourceDateStr;
    const colPath = (col: string) =>
      sFId === 'personal' || !sFId ? `users/${uid}/${col}` : `groups/${sFId}/${col}`;

    const updateTargetArray = (arr: any[]) => {
      selectedLinks.forEach((link) => {
        if (!arr.some((l) => String(l.targetId || l.id) === String(link.targetId))) {
          arr.push(link);
        }
      });
    };

    try {
      // 1. 출발지(Source) 업데이트
      if (sourceType === 'schedule_header' || sourceType === 'schedule') {
        const sp = String(selectedSourcePeriod || sourcePeriod || 1);
        const ref = doc(db, colPath('schedules'), sDateStr);
        const snap = await getDoc(ref);
        const periods = (snap.exists() ? snap.data().periods : {}) || {};
        periods[sp] = periods[sp] || { subject: '', memo: '', supplies: '', linkedItems: [] };
        periods[sp].linkedItems = periods[sp].linkedItems || [];
        updateTargetArray(periods[sp].linkedItems);
        await setDoc(ref, { periods, updatedAt: Date.now() }, { merge: true });
      } else if (sourceType === 'event') {
        const ref = doc(db, colPath('events'), sDateStr);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const list = snap.data().eventList || [];
          const item = list.find((e: any) => String(e.id) === String(sourceId));
          if (item) {
            item.linkedItems = item.linkedItems || [];
            updateTargetArray(item.linkedItems);
            await setDoc(ref, { eventList: list, updatedAt: Date.now() }, { merge: true });
          }
        }
      } else if (sourceType === 'journal') {
        const ref = doc(db, colPath('journals'), sDateStr);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const list = snap.data().entries || [];
          const item = list.find((j: any) => String(j.id) === String(sourceId));
          if (item) {
            item.linkedItems = item.linkedItems || [];
            updateTargetArray(item.linkedItems);
            await setDoc(ref, { entries: list, updatedAt: Date.now() }, { merge: true });
          }
        }
      } else if (sourceType === 'memo') {
        const ref = doc(db, colPath('tasks'), sourceId || '');
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const linkedItems = snap.data().linkedItems || [];
          updateTargetArray(linkedItems);
          await setDoc(ref, { linkedItems, updatedAt: Date.now() }, { merge: true });
        }
      }

      // 2. 도착지(Target) 역방향 링크 주입
      let sourceTitleLabel = '연결된 항목';
      let safeTargetId = sourceId || '';

      if (sourceType === 'schedule_header' || sourceType === 'schedule') {
        const sp = String(selectedSourcePeriod || sourcePeriod || 1);
        sourceTitleLabel = `${sp}교시 수업`;
        safeTargetId = `class_${sDateStr}_${sp}`;
      } else if (sourceType === 'event') sourceTitleLabel = '일정';
      else if (sourceType === 'journal') sourceTitleLabel = '기록';
      else if (sourceType === 'memo') sourceTitleLabel = '메모';

      const sourceMeta: SelectedLinkItem = {
        targetType:
          sourceType === 'schedule_header' || sourceType === 'schedule' ? 'schedule' : (sourceType as any),
        targetId: safeTargetId,
        targetDate: sDateStr || '',
        targetPeriod:
          sourceType === 'schedule_header' || sourceType === 'schedule'
            ? selectedSourcePeriod || sourcePeriod || 1
            : undefined,
        title: `[${sDateStr || '메모'}] ${sourceTitleLabel}`,
        targetFId: sFId,
      };

      for (const link of selectedLinks) {
        await addReverseLink(link, sourceMeta);
      }

      alert('✅ 데이터가 성공적으로 연결되었습니다.');
      onClose();
    } catch (e: any) {
      console.error('saveLinks error:', e);
      alert('연결 저장 중 오류가 발생했습니다: ' + e.message);
    }
  };

  if (!isOpen) return null;

  // 현재 탭의 데이터 필터링 (라벨 + 검색어)
  const currentList: FetchedItem[] = currentTab === 'schedule' ? [] : tabItems[currentTab] || [];
  const filteredList = currentList.filter((item: FetchedItem) => {
    // 1. 라벨 필터 (일정, 기록)
    if (selectedLabelIds.length > 0 && (currentTab === 'event' || currentTab === 'journal')) {
      if (!item.labelIds || !item.labelIds.some((id: string) => selectedLabelIds.includes(id))) {
        return false;
      }
    }
    // 2. 키워드 검색
    if (searchKeyword.trim()) {
      return item.title.toLowerCase().includes(searchKeyword.toLowerCase().trim());
    }
    return true;
  });

  const totalPages = Math.ceil(filteredList.length / itemsPerPage) || 1;
  const clampedPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (clampedPage - 1) * itemsPerPage;
  const pagedItems = filteredList.slice(startIndex, startIndex + itemsPerPage);

  const labels = eventLabels;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
            <span>🔗</span> 새 데이터 연결하기 (다중 선택 가능)
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {/* schedule_header인 경우 교시 선택 UI (V3 동일) */}
          {(sourceType === 'schedule_header' || sourceType === 'schedule') && (
            <div className="bg-blue-50 p-3 rounded-xl border border-blue-200 flex items-center gap-3">
              <span className="text-xs font-bold text-blue-800">📌 링크를 추가할 교시:</span>
              <select
                value={selectedSourcePeriod}
                onChange={(e) => setSelectedSourcePeriod(Number(e.target.value))}
                className="px-3 py-1.5 border border-blue-300 rounded-lg text-xs font-bold bg-white text-blue-900 focus:outline-none"
              >
                {[1, 2, 3, 4, 5, 6].map((p) => (
                  <option key={p} value={p}>
                    {p}교시
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 4대 탭 */}
          <div className="flex gap-2 border-b border-slate-200 pb-2">
            {[
              { key: 'event' as const, label: '📌 일정' },
              { key: 'schedule' as const, label: '🏫 수업' },
              { key: 'journal' as const, label: '📔 기록' },
              { key: 'memo' as const, label: '📝 메모' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setCurrentTab(tab.key);
                  setCurrentPage(1);
                }}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                  currentTab === tab.key
                    ? 'bg-blue-50 text-blue-700 border border-blue-300 shadow-2xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-transparent'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 수업 탭 내용 (V3와 완벽 일치) */}
          {currentTab === 'schedule' ? (
            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 flex flex-col gap-4">
              <h4 className="text-xs font-bold text-teal-800">🏫 수업 지정하여 연결</h4>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[11px] font-bold text-slate-600 mb-1 block">날짜</label>
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium bg-white"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] font-bold text-slate-600 mb-1 block">교시</label>
                  <select
                    value={schedulePeriod}
                    onChange={(e) => setSchedulePeriod(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-bold bg-white"
                  >
                    {[1, 2, 3, 4, 5, 6].map((p) => (
                      <option key={p} value={p}>
                        {p}교시
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="button"
                onClick={addScheduleLink}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-2xs cursor-pointer"
              >
                이 교시를 장바구니에 담기 ⬇️
              </button>
            </div>
          ) : (
            /* 일정/기록/메모 탭 공통 필터 영역 */
            <div className="flex flex-col gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              {/* 기간 범위 필터 (메모 탭 제외) */}
              {currentTab !== 'memo' && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-600 shrink-0">조회 범위:</span>
                    <select
                      value={dateRange}
                      onChange={(e) => setDateRange(e.target.value)}
                      className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 bg-white"
                    >
                      <option value="today">현재 페이지 날짜</option>
                      <option value="1week">±1주일</option>
                      <option value="1month">±1개월</option>
                      <option value="sem1">1학기 전체</option>
                      <option value="sem2">2학기 전체</option>
                      <option value="year">학년도 전체</option>
                      <option value="custom">직접 지정</option>
                    </select>
                    <button
                      type="button"
                      onClick={fetchDateRangeData}
                      className="ml-auto px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 transition-colors"
                    >
                      조회
                    </button>
                  </div>

                  {dateRange === 'custom' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={customStart}
                        onChange={(e) => setCustomStart(e.target.value)}
                        className="px-2 py-1 text-xs border rounded-lg bg-white"
                      />
                      <span className="text-xs text-slate-400">~</span>
                      <input
                        type="date"
                        value={customEnd}
                        onChange={(e) => setCustomEnd(e.target.value)}
                        className="px-2 py-1 text-xs border rounded-lg bg-white"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* 라벨 칩 필터 (일정, 기록 탭) */}
              {(currentTab === 'event' || currentTab === 'journal') && labels.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => toggleLabel('all')}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                      selectedLabelIds.length === 0
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    전체
                  </button>
                  {labels.map((l: any) => {
                    const isSelected = selectedLabelIds.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => toggleLabel(l.id)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                          isSelected
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 키워드 검색 */}
              <input
                type="text"
                placeholder="키워드로 목록 내 검색..."
                value={searchKeyword}
                onChange={(e) => {
                  setSearchKeyword(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          {/* 목록 영역 (일정/기록/메모) */}
          {currentTab !== 'schedule' && (
            <div className="border border-slate-200 rounded-xl bg-white overflow-hidden min-h-[260px] flex flex-col">
              {loading ? (
                <div className="p-10 text-center text-xs font-bold text-blue-600">데이터를 불러오는 중...⏳</div>
              ) : filteredList.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-400">
                  해당 조건에 맞는 데이터가 없습니다.
                </div>
              ) : (
                <>
                  <div className="flex-1 divide-y divide-slate-100">
                    {pagedItems.map((item: FetchedItem) => {
                      const isChecked = selectedLinks.some((l) => l.targetId === item.id);
                      return (
                        <div
                          key={item.id}
                          onClick={() => toggleSelection(item)}
                          className="flex items-center px-4 py-2.5 hover:bg-slate-50 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            readOnly
                            className="w-4 h-4 text-blue-600 rounded border-slate-300 pointer-events-none mr-3"
                          />
                          {item.date && (
                            <span className="text-[11px] text-slate-400 w-20 shrink-0 font-medium">
                              {item.date}
                            </span>
                          )}
                          <span className="text-xs text-slate-800 font-medium truncate flex-1" title={item.title}>
                            {item.title}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* 페이징 버튼 바 */}
                  {totalPages > 1 && (
                    <div className="p-2.5 bg-slate-50 border-t border-slate-100 flex justify-center items-center gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter((p) => p === 1 || p === totalPages || Math.abs(p - clampedPage) <= 2)
                        .map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setCurrentPage(p)}
                            className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                              p === clampedPage
                                ? 'bg-blue-600 text-white'
                                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* 장바구니 트레이 (V3 renderTray 완벽 이식) */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="font-bold text-xs text-slate-700 mb-2 flex items-center gap-1.5">
              <span>🛒 선택된 연결 항목</span>
              <span className="bg-blue-100 text-blue-700 px-1.5 py-0.2 rounded-full text-[10px]">
                {selectedLinks.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 min-h-[30px] items-center">
              {selectedLinks.length === 0 ? (
                <span className="text-xs text-slate-400">선택된 항목이 없습니다.</span>
              ) : (
                selectedLinks.map((l) => {
                  const icon =
                    l.targetType === 'event'
                      ? '📌'
                      : l.targetType === 'journal'
                      ? '📔'
                      : l.targetType === 'memo'
                      ? '📝'
                      : '🏫';
                  return (
                    <div
                      key={l.targetId}
                      className="inline-flex items-center bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg text-xs text-blue-900 shadow-2xs font-medium"
                    >
                      <span className="mr-1">{icon}</span>
                      <span className="max-w-[130px] truncate font-bold">{l.title}</span>
                      <button
                        type="button"
                        onClick={() => removeLink(l.targetId)}
                        className="ml-1.5 text-rose-500 hover:text-rose-700 font-bold cursor-pointer"
                        title="제거"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* 모달 푸터 버튼 */}
        <div className="px-6 py-4 bg-white border-t border-slate-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={handleSaveLinks}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer"
          >
            연결 저장
          </button>
        </div>
      </div>
    </div>
  );
}
