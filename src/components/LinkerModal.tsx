//src/components/QuickAddModal.tsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { doc, getDoc, setDoc, getDocs, collection } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { showToast, showErrorToast } from '../utils/toast';
import { eventDocPayload } from '../lib/eventText';
import { useAppStore } from '../store/useAppStore';
import { parseV3EventText } from '../hooks/useDayData';
import { useLabels } from '../hooks/useLabels';
import { resolveEventLabelNames } from '../lib/eventLabels';
import { addReverseLink } from '../utils/linkUtils';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer } from '../hooks/useModalLayer';
import { useBackdropClose } from '../hooks/useBackdropClose';
import LinkCreateModal, { type CreatedItem } from './LinkCreateModal';

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
  /** 일정/기록은 라벨 이름을 label에도 들고 있다 (콤마로 이은 목록일 수 있다) */
  label?: string;
  period?: string | number;
}

/**
 * 'YYYY-MM-DD'만 남긴다.
 * Layout은 기준 날짜가 없으면 store의 currentDate를 그대로 넘기는데, 그 값은
 * toISOString()이라 '2026-09-15T10:23:45.123Z' 꼴이다. 이대로 <input type="date">에
 * 넣으면 칸이 빈 채로 그려져 '기간 설정'을 골라도 날짜를 못 고른다.
 */
function toDateOnly(s: string): string {
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : formatDateStr(d);
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
  const { eventLabels, journalLabels, memoLabels } = useLabels();
  useBodyScrollLock(isOpen);

  const vv = useVisualViewport(isOpen);

  const zIndex = useModalLayer(isOpen, onClose);

  const backdrop = useBackdropClose();

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
  const [dateRange, setDateRange] = useState('1week');
  const [customStart, setCustomStart] = useState(() => toDateOnly(sourceDateStr));
  const [customEnd, setCustomEnd] = useState(() => toDateOnly(sourceDateStr));
  const [searchKeyword, setSearchKeyword] = useState('');
  // 라벨 필터는 탭마다 라벨 종류가 다르므로 "이름"으로 고른다. 종류별로 ID 체계가
  // 달라서(일정 ev_*, 기록 j_*, 메모는 이름만) ID로 비교하면 탭을 바꿀 때 어긋난다.
  const [selectedLabelNames, setSelectedLabelNames] = useState<string[]>([]); // 빈 배열이면 '전체'
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6;
  const [loading, setLoading] = useState(false);

  // 수업 탭 전용 상태
  const [scheduleDate, setScheduleDate] = useState(sourceDateStr || formatDateStr(new Date()));
  const [schedulePeriod, setSchedulePeriod] = useState<number>(1);

  // 새 항목 즉시 생성 상태
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setScheduleDate(sourceDateStr || formatDateStr(new Date()));
      if (sourcePeriod) setSchedulePeriod(Number(sourcePeriod));
    }
  }, [isOpen, sourceDateStr, sourcePeriod]);

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

    if (dateRange === '1week') {
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

  // 메모 전체 로드
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
            // 메모 라벨은 이름을 그대로 저장한다
            labelIds: data.labels || [],
          });
        }
      });

      // 2. 그룹 메모
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
              labelIds: data.labels || [],
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

  // 기간 범위 데이터 로드
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
            const data = evSnap.data();
            let list = data.eventList;
            if (!list || list.length === 0) {
              if (data.eventText) list = parseV3EventText(data.eventText);
            }
            if (list) {
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
                    // 라벨 필터가 label(콤마로 이은 이름)도 봐야 한다
                    label: e.label,
                  });
                }
              });
            }
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
                  label: j.label,
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

  // 조회 함수는 늘 최신 것을 담아 둔다. 아래 초기화 효과가 조회 함수를
  // 의존성으로 잡으면 안 되기 때문이다 (그 이유는 바로 아래에 적어 두었다).
  const fetchMemoDataRef = useRef(fetchMemoData);
  useEffect(() => {
    fetchMemoDataRef.current = fetchMemoData;
  }, [fetchMemoData]);

  // 모달이 닫힘 -> 열림으로 바뀌는 순간에만 초기화한다.
  // ⚠️ 조회 범위(dateRange)나 조회 함수를 의존성에 넣지 말 것.
  //    조회 범위를 바꾸면 fetchDateRangeData가 새로 만들어지는데, 그것이 의존성에
  //    들어 있으면 이 효과가 곧바로 다시 돌아 방금 고른 범위를 '±1주일'로 되돌린다.
  //    ('기간 설정'을 골라도 날짜 칸이 안 나오던 것도 같은 원인이었다)
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setSelectedLinks([]);
      setCurrentTab('event');
      setDateRange('1week');
      setCustomStart(toDateOnly(sourceDateStr));
      setCustomEnd(toDateOnly(sourceDateStr));
      setCurrentPage(1);
      setSearchKeyword('');
      setSelectedLabelNames([]);
      setCreateOpen(false);
      setSelectedSourcePeriod(sourcePeriod ? Number(sourcePeriod) : 1);
      setScheduleDate(sourceDateStr || formatDateStr(new Date()));
      setSchedulePeriod(1);
      // 일정/기록은 아래 '조회 범위 변경 시 자동 재조회'가 맡는다 (두 번 읽지 않도록).
      fetchMemoDataRef.current();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, sourcePeriod, sourceDateStr]);

  // 기간 범위 변경 시 자동 재조회
  useEffect(() => {
    if (isOpen && dateRange !== 'custom') {
      fetchDateRangeData();
    }
  }, [dateRange, isOpen, fetchDateRangeData]);

  // 등록창에서 만들어 준 항목을 연결 목록(장바구니)에 담는다.
  // 만드는 일 자체는 LinkCreateModal이 한다. 여기서는 담기만 한다.
  const handleCreated = (item: CreatedItem) => {
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
    // 방금 만든 것이 아래 목록에도 보이게 다시 읽는다
    if (item.type === 'memo') fetchMemoData();
    else fetchDateRangeData();
  };

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

  // 수업 링크 직접 담기
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
  const toggleLabel = (labelName: string) => {
    if (labelName === 'all') {
      setSelectedLabelNames([]);
    } else {
      setSelectedLabelNames((prev) =>
        prev.includes(labelName) ? prev.filter((n) => n !== labelName) : [...prev, labelName]
      );
    }
    setCurrentPage(1);
  };

  // 최종 링크 저장
  const handleSaveLinks = async () => {
    if (selectedLinks.length === 0) {
      showErrorToast('연결할 항목을 선택해주세요.');
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

    // 출발지 항목을 못 찾으면 연결이 한쪽도 저장되지 않는다. 예전에는 그래도
    // '연결되었습니다' 토스트를 띄워서, 안 된 것을 된 것처럼 알려 주고 있었다.
    let sourceUpdated = false;

    try {
      // 1. 출발지(Source) 업데이트
      if (sourceType === 'schedule_header' || sourceType === 'schedule') {
        const sp = String(selectedSourcePeriod || sourcePeriod || 1);
        const ref = doc(db, colPath('schedules'), sDateStr);
        const snap = await getDoc(ref);
        const periods = (snap.exists() ? snap.data().periods : {}) || {};
        
        let item = periods[sp];
        if (!item) {
          item = { subject: '', memo: '', supplies: '', linkedItems: [] };
        } else if (typeof item === 'string') {
          item = { subject: item, memo: '', supplies: '', linkedItems: [] };
        }
        
        item.linkedItems = item.linkedItems || [];
        updateTargetArray(item.linkedItems);
        periods[sp] = item;
        
        await setDoc(ref, { periods, updatedAt: Date.now() }, { merge: true });
        sourceUpdated = true;
      } else if (sourceType === 'event') {
        const ref = doc(db, colPath('events'), sDateStr);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          let list = data.eventList;
          if (!list || list.length === 0) {
            if (data.eventText) list = parseV3EventText(data.eventText);
          }
          if (list) {
            const item = list.find((e: any) => String(e.id) === String(sourceId));
            if (item) {
              item.linkedItems = item.linkedItems || [];
              updateTargetArray(item.linkedItems);
              await setDoc(ref, eventDocPayload(list), { merge: true });
              sourceUpdated = true;
            }
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
            sourceUpdated = true;
          }
        }
      } else if (sourceType === 'memo') {
        const ref = doc(db, colPath('tasks'), sourceId || '');
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const linkedItems = snap.data().linkedItems || [];
          updateTargetArray(linkedItems);
          await setDoc(ref, { linkedItems, updatedAt: Date.now() }, { merge: true });
          sourceUpdated = true;
        }
      }

      if (!sourceUpdated) {
        showErrorToast('연결할 항목을 찾지 못해 저장하지 못했습니다. 화면을 새로 고친 뒤 다시 해 주세요.');
        return;
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
            : '',
        title: `[${sDateStr || '메모'}] ${sourceTitleLabel}`,
        targetFId: sFId,
      };

      for (const targetLink of selectedLinks) {
        await addReverseLink(targetLink, sourceMeta, activeFId);
      }

      showToast('✅ 데이터가 연결되었습니다.');
    } catch (e: any) {
      console.error('saveLinks error:', e);
      showErrorToast('연결 저장 중 오류가 발생했습니다: ' + e.message);
    }
  };

  if (!isOpen) return null;

  // 지금 탭에서 고를 수 있는 라벨. 탭에 맞는 종류를 보여준다.
  const tabLabelNames: string[] =
    currentTab === 'event'
      ? eventLabels.map((l) => l.name)
      : currentTab === 'journal'
      ? journalLabels.map((l) => l.name)
      : currentTab === 'memo'
      ? memoLabels
      : [];

  // 항목이 들고 있는 라벨을 이름으로 풀어낸다. 저장 형태가 종류마다 다르다.
  const itemLabelNames = (item: FetchedItem): string[] => {
    if (currentTab === 'event') return resolveEventLabelNames({ ...item, content: item.title }, eventLabels);
    const keys = [...((item as any).labelIds || []), ...((item as any).label ? [(item as any).label] : [])];
    if (currentTab === 'journal') {
      const names: string[] = [];
      for (const key of keys.map((k: any) => String(k ?? '').trim())) {
        const found = journalLabels.find((l) => l.id === key || l.name === key);
        if (found && !names.includes(found.name)) names.push(found.name);
      }
      return names;
    }
    // 메모는 이름을 그대로 저장한다
    return keys.map((k: any) => String(k ?? '').trim()).filter(Boolean);
  };

  // 현재 탭의 데이터 필터링 (라벨 + 검색어)
  const currentList: FetchedItem[] = currentTab === 'schedule' ? [] : tabItems[currentTab] || [];
  const filteredList = currentList.filter((item: FetchedItem) => {
    // 1. 기간 필터 (메모는 서버에서 전체 로드하므로 클라이언트에서 기간 필터링)
    if (currentTab === 'memo' && item.date) {
      const { start, end } = computeDateRange();
      if (start && end && (item.date < start || item.date > end)) {
        return false;
      }
    }
    // 2. 라벨 필터 (탭에 맞는 라벨 이름으로 비교)
    if (selectedLabelNames.length > 0) {
      const names = itemLabelNames(item);
      if (!names.some((n) => selectedLabelNames.includes(n))) return false;
    }
    // 3. 키워드 검색
    if (searchKeyword.trim()) {
      return item.title.toLowerCase().includes(searchKeyword.toLowerCase().trim());
    }
    return true;
  });

  const totalPages = Math.ceil(filteredList.length / itemsPerPage) || 1;
  const clampedPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (clampedPage - 1) * itemsPerPage;
  const pagedItems = filteredList.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div
      className="fixed inset-0 flex items-start justify-center overflow-y-auto p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in" style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }}
      {...backdrop}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-full flex flex-col border border-slate-200 overflow-hidden"
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

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-4 flex flex-col gap-4" data-scroll-lock>
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
                  // 탭마다 라벨 종류가 다르므로 고른 필터는 비운다.
                  // 안 그러면 다른 종류의 라벨이 걸린 채로 목록이 전부 비어 보인다.
                  setSelectedLabelNames([]);
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

          {/* 수업 탭 내용 */}
          {currentTab === 'schedule' ? (
            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 flex flex-col gap-4">
              <h4 className="text-xs font-bold text-teal-800">🏫 수업 지정하여 연결</h4>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs font-bold text-slate-600 mb-1 block">날짜</label>
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium bg-white"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-bold text-slate-600 mb-1 block">교시</label>
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
              {/* 기간 범위 필터 (일정/기록/메모 공통) */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-600 shrink-0">조회 범위:</span>
                  <select
                    value={dateRange}
                    onChange={(e) => {
                      setDateRange(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 bg-white"
                  >
                    <option value="1week">±1주일</option>
                    <option value="1month">±1개월</option>
                    <option value="sem1">1학기 전체</option>
                    <option value="sem2">2학기 전체</option>
                    <option value="year">학년도 전체</option>
                    <option value="custom">기간 설정</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (currentTab === 'memo') fetchMemoData();
                      else fetchDateRangeData();
                      setCurrentPage(1);
                    }}
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
                      onChange={(e) => {
                        setCustomStart(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="px-2 py-1 text-xs border rounded-lg bg-white"
                    />
                    <span className="text-xs text-slate-400">~</span>
                    <input
                      type="date"
                      value={customEnd}
                      onChange={(e) => {
                        setCustomEnd(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="px-2 py-1 text-xs border rounded-lg bg-white"
                    />
                  </div>
                )}
              </div>

              {/* 라벨 칩 필터 - 탭(일정/기록/메모)에 맞는 라벨을 보여준다 */}
              {tabLabelNames.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => toggleLabel('all')}
                    className={`px-2.5 py-1 rounded-full text-xs font-bold border transition-colors ${
                      selectedLabelNames.length === 0
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    전체
                  </button>
                  {tabLabelNames.map((name) => {
                    const isSelected = selectedLabelNames.includes(name);
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => toggleLabel(name)}
                        className={`px-2.5 py-1 rounded-full text-xs font-bold border transition-colors ${
                          isSelected
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        {name}
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

              {/* 새 항목 만들어 연결. 누르면 등록창이 뜨고, 저장하면 연결 목록에 담긴 채
                  이 창으로 돌아온다. 예전에는 여기 한 줄 입력칸에서 제목만 받아 바로
                  만들었는데, 그러면 날짜도 라벨도 정할 수 없었다. */}
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="w-full mt-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors shadow-xs"
              >
                + 새 {currentTab === 'memo' ? '메모' : currentTab === 'journal' ? '기록' : '일정'} 만들어 연결
              </button>
            </div>
          )}

          {/* 목록 영역 (일정/기록/메모) */}
          {currentTab !== 'schedule' && (
            <div className="border border-slate-200 rounded-xl bg-white overflow-hidden flex flex-col">
              {loading ? (
                <div className="h-[228px] flex items-center justify-center text-xs font-bold text-blue-600">
                  데이터를 불러오는 중...⏳
                </div>
              ) : filteredList.length === 0 ? (
                <div className="h-[228px] flex items-center justify-center text-xs text-slate-400">
                  해당 조건에 맞는 데이터가 없습니다.
                </div>
              ) : (
                <>
                  <div className="h-[228px] overflow-y-auto overscroll-contain divide-y divide-slate-100" data-scroll-lock>
                    {pagedItems.map((item: FetchedItem) => {
                      const isChecked = selectedLinks.some((l) => l.targetId === item.id);
                      return (
                        <div
                          key={item.id}
                          onClick={() => toggleSelection(item)}
                          className="flex items-center px-4 py-2 hover:bg-slate-50 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            readOnly
                            className="w-4 h-4 text-blue-600 rounded border-slate-300 pointer-events-none mr-3 shrink-0"
                          />
                          {item.date && (
                            <span className="text-xs text-slate-400 shrink-0 whitespace-nowrap font-medium mr-2">
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
                    <div className="p-2 bg-slate-50 border-t border-slate-100 flex justify-center items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={clampedPage === 1}
                        className="px-2 py-1 rounded text-xs font-bold bg-white text-slate-600 border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white"
                      >
                        ‹
                      </button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter((p) => p === 1 || p === totalPages || Math.abs(p - clampedPage) <= 2)
                        .map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setCurrentPage(p)}
                            className={`px-2.5 py-1 rounded text-xs font-bold ${
                              p === clampedPage
                                ? 'bg-blue-600 text-white'
                                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                      <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={clampedPage === totalPages}
                        className="px-2 py-1 rounded text-xs font-bold bg-white text-slate-600 border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white"
                      >
                        ›
                      </button>
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
              <span className="bg-blue-100 text-blue-700 px-1.5 py-0.2 rounded-full text-xs">
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

      {/* 새 항목 등록창. 저장하면 연결 목록에 담고 스스로 닫혀 이 창으로 돌아온다. */}
      {createOpen && currentTab !== 'schedule' && (
        <LinkCreateModal
          isOpen
          onClose={() => setCreateOpen(false)}
          type={currentTab}
          defaultDate={sourceDateStr || formatDateStr(new Date())}
          fId={activeFId}
          colPathOf={(col) => getColPath(col)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
