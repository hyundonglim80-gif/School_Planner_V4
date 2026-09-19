//src/features/year/YearScreen.tsx

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { collection, query, where, documentId, onSnapshot, doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { useLabels } from '../../hooks/useLabels';
import { useGovHolidays } from '../../hooks/useGovHolidays';
import { useTimetableTemplate } from '../../hooks/useTimetableTemplate';
import { getAcademicYear, getAcademicMonths, parseDateStr, formatDateStr } from '../../lib/dateUtils';
import { parseV3EventText, formatV3EventText, runAutoForwarding } from '../../hooks/useDayData';
import { eventDocPayload, readEventList } from '../../lib/eventText';
import { useIsMobile } from '../../hooks/useIsMobile';
import { moveToTrash } from '../../utils/trashHelper';
import { showToast, showErrorToast } from '../../utils/toast';
import DetailEditModal from '../../components/DetailEditModal';
import QuickAddModal from '../../components/QuickAddModal';
import YearMonthCard from './YearMonthCard';

/**
 * 한 번에 그릴 달의 수.
 *
 * ⚠️ 열두 달을 한 판에 그리면 본 스레드가 1초 넘게 붙잡혀 화면이 굳는다.
 *    그 사이에 다른 화면을 누르면 누른 것이 1~2초 뒤에야 먹는다(실제로 그랬다).
 *    몇 달씩 나눠 그리면 사이사이 브라우저가 숨을 쉬므로 눌러도 바로 반응한다.
 *    달 카드는 React.memo라 이미 그린 달은 다시 그리지 않는다.
 */
const MONTHS_PER_FRAME = 3;

export default function YearScreen() {
  const { currentDate, setCurrentDate, setScope, semesterFilter, showWeekend, showClass, showEvents, selectedGroupId, isMultiSelectMode, selectedEventIds, toggleEventSelection, openLinkViewerModal } = useAppStore();
  const [eventsMap, setEventsMap] = useState<Record<string, any[]>>({});
  const [schedulesMap, setSchedulesMap] = useState<Record<string, any>>({});
  // 그날 기록이 몇 건인지. 내용은 아이콘을 눌렀을 때 그때 읽는다.
  const [journalCountMap, setJournalCountMap] = useState<Record<string, number>>({});
  // 조사표도 마찬가지로 개수만 쓴다
  const [evalCountMap, setEvalCountMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [quickAddDate, setQuickAddDate] = useState<string | null>(null);
  const isMobile = useIsMobile();
  // 휴대폰에서 월 카드 접기/펼치기. 기본값은 "이번 달만 펼침"이라 값이 없으면
  // 이번 달인지로 판단하고, 사용자가 누른 달만 여기에 기록한다.
  const [collapsedMonths, setCollapsedMonths] = useState<Record<string, boolean>>({});
  const toggleMonth = useCallback((key: string, defaultCollapsed: boolean) => {
    setCollapsedMonths((prev) => ({ ...prev, [key]: !(prev[key] ?? defaultCollapsed) }));
  }, []);

  const [detailModal, setDetailModal] = useState<{
    isOpen: boolean;
    type: 'schedule' | 'event';
    dateStr: string;
    itemId: string | number;
    initialData: any;
  } | null>(null);

  const { getLabelColor, eventLabels, labelsLoaded } = useLabels();
  const { holidays } = useGovHolidays();
  const { templates, currentTemplateName } = useTimetableTemplate();
  const maxPeriods = templates[currentTemplateName]?.names.length || 6;
  const periodArray = useMemo(
    () => Array.from({ length: maxPeriods }, (_, i) => i + 1),
    [maxPeriods]
  );

  /**
   * 라벨 빛깔을 집는 함수.
   *
   * useLabels가 주는 getLabelColor는 판마다 새로 만들어진다. 그대로 달 카드에
   * 넘기면 달마다 '넘어온 값이 달라졌다'가 되어 React.memo가 아무 일도 못 한다.
   * 붙들어 둔 껍데기를 넘기고, 알맹이는 늘 최신 것을 본다. (라벨이 실제로
   * 바뀌면 eventLabels가 함께 넘어가므로 그때는 제대로 다시 그린다.)
   */
  const labelColorRef = useRef(getLabelColor);
  labelColorRef.current = getLabelColor;
  const labelColorOf = useCallback((name: string) => labelColorRef.current(name), []);

  const curDateObj = useMemo(() => new Date(currentDate), [currentDate]);
  const defaultAcademicYear = useMemo(() => getAcademicYear(curDateObj), [curDateObj]);
  const realTodayStr = formatDateStr(new Date());

  const months = useMemo(() => {
    const list = getAcademicMonths(defaultAcademicYear);
    if (semesterFilter === 'all') return list;
    return list.filter((m) => m.semester === semesterFilter);
  }, [defaultAcademicYear, semesterFilter]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    
    const startStr = `${defaultAcademicYear}-03-01`;
    const endStr = `${defaultAcademicYear + 1}-02-29`;
    
    const colPath = (col: string) => selectedGroupId && selectedGroupId !== 'personal' ? `groups/${selectedGroupId}/${col}` : `users/${user.uid}/${col}`;
    
    setLoading(true);

    const unsubEvents = onSnapshot(query(collection(db, colPath('events')), where(documentId(), '>=', startStr), where(documentId(), '<=', endStr)), (snap) => {
      const map: Record<string, any[]> = {};
      let shouldForward = false;
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      snap.forEach(d => {
        const data = d.data();
        let list = data.eventList || [];
        if (list.length === 0 && data.eventText) list = parseV3EventText(data.eventText);
        map[d.id] = list.filter((e: any) => e.content?.trim());
      });

      // 💡 년간 뷰에서 과거 날짜의 수정 사항이 있다면 이월 로직 자동 실행 예약
      snap.docChanges().forEach(change => {
        if (change.doc.id < todayStr) {
          shouldForward = true;
        }
      });

      setEventsMap(map);
      setLoading(false);

      if (shouldForward) {
        runAutoForwarding(selectedGroupId).catch(console.error);
      }
    });

    const unsubSchedules = onSnapshot(query(collection(db, colPath('schedules')), where(documentId(), '>=', startStr), where(documentId(), '<=', endStr)), (snap) => {
      const map: Record<string, any> = {};
      snap.forEach(d => {
        map[d.id] = d.data().periods || {};
      });
      setSchedulesMap(map);
    });

    const unsubJournals = onSnapshot(
      query(collection(db, colPath('journals')), where(documentId(), '>=', startStr), where(documentId(), '<=', endStr)),
      (snap) => {
        const map: Record<string, number> = {};
        snap.forEach(d => {
          // 빈 항목은 세지 않는다 (지운 뒤 껍데기만 남는 경우가 있다)
          const entries = (d.data().entries || []) as any[];
          const count = entries.filter(
            (j) => (j?.content && String(j.content).trim()) || j?.imageUrl || (j?.attachments || []).length > 0
          ).length;
          if (count > 0) map[d.id] = count;
        });
        setJournalCountMap(map);
      },
      // 기록 개수는 곁다리 정보다. 못 읽어도 달력 자체는 그대로 보여야 한다.
      (err) => console.error('Year Journal Snapshot Error:', err)
    );

    const unsubEvaluations = onSnapshot(
      query(collection(db, colPath('evaluations')), where(documentId(), '>=', startStr), where(documentId(), '<=', endStr)),
      (snap) => {
        const map: Record<string, number> = {};
        snap.forEach(d => {
          // V3는 evalList, V4는 list라는 이름으로 같은 목록을 담는다
          const data = d.data();
          const count = ((data.list || data.evalList || []) as any[]).filter((ev) => ev && ev.id).length;
          if (count > 0) map[d.id] = count;
        });
        setEvalCountMap(map);
      },
      (err) => console.error('Year Evaluation Snapshot Error:', err)
    );

    return () => { unsubEvents(); unsubSchedules(); unsubJournals(); unsubEvaluations(); };
  }, [defaultAcademicYear, selectedGroupId]);

  /**
   * 지금까지 그린 달의 수. 한 프레임에 MONTHS_PER_FRAME씩 늘려 간다.
   *
   * 이렇게 하면 첫 프레임에 나오는 것은 세 달뿐이라 화면이 곧바로 뜨고,
   * 나머지는 뒤따라 채워진다. 그리는 사이에 다른 화면을 눌러도 그 자리에서 먹는다.
   */
  const [shownMonths, setShownMonths] = useState(MONTHS_PER_FRAME);

  /**
   * ⚠️ 이 일을 효과 둘로 나누지 말 것.
   *    처음에는 '처음으로 되돌리는 효과'와 '한 걸음 나아가는 효과'를 따로 두었다.
   *    두 효과의 의존성이 서로 물려 돌면서, 2학기(여섯 달)를 보다가 전체(열두 달)로
   *    되돌리면 여섯 달에서 멈춰 섰다. 나머지 여섯 달이 영영 안 나왔다.
   *    한 효과 안에서 끝까지 걸어가게 두면 그런 경합이 없다.
   */
  useEffect(() => {
    if (loading) {
      setShownMonths(MONTHS_PER_FRAME);
      return;
    }
    let alive = true;
    let n = Math.min(MONTHS_PER_FRAME, months.length);
    setShownMonths(n);

    let id = requestAnimationFrame(function step() {
      if (!alive) return;
      n = Math.min(n + MONTHS_PER_FRAME, months.length);
      setShownMonths(n);
      if (n < months.length) id = requestAnimationFrame(step);
    });

    return () => {
      alive = false;
      cancelAnimationFrame(id);
    };
  }, [months, loading]);

  const handleDateClick = useCallback((dateStr: string) => {
    setCurrentDate(parseDateStr(dateStr));
    setScope('day');
  }, [setCurrentDate, setScope]);

  const handleQuickAdd = useCallback((dateStr: string) => setQuickAddDate(dateStr), []);

  const handleOpenDetail = useCallback(
    (type: 'schedule' | 'event', dateStr: string, itemId: string | number, initialData: any) => {
      setDetailModal({ isOpen: true, type, dateStr, itemId, initialData });
    },
    []
  );

  const handleToggleEvent = useCallback(async (dateStr: string, eventId: string) => {
    const user = auth.currentUser;
    if (!user) return;
    const eventDocRef = selectedGroupId
      ? doc(db, 'groups', selectedGroupId, 'events', dateStr)
      : doc(db, 'users', user.uid, 'events', dateStr);
    
    try {
      const snap = await getDoc(eventDocRef);
      if (snap.exists()) {
        const data = snap.data();
        let list = data.eventList || [];
        if (list.length === 0 && data.eventText) {
          list = parseV3EventText(data.eventText);
        }
        const updatedList = list.map((item: any) => item.id === eventId ? { ...item, completed: !item.completed } : item);
        const textToSave = formatV3EventText(updatedList);
        
        await setDoc(eventDocRef, {
          eventList: updatedList,
          eventText: textToSave,
          updatedAt: Date.now()
        }, { merge: true });
      }
    } catch (err) {
      console.error('Toggle event error:', err);
    }
  }, [selectedGroupId]);

  const handleDeleteEvent = useCallback(async (dateStr: string, eventId: string, fallbackItem?: any) => {
    const user = auth.currentUser;
    if (!user) return;
    const eventDocRef = selectedGroupId
      ? doc(db, 'groups', selectedGroupId, 'events', dateStr)
      : doc(db, 'users', user.uid, 'events', dateStr);

    try {
      const snap = await getDoc(eventDocRef);
      const list = snap.exists() ? readEventList(snap.data()) : [];
      const removed = list.find((item: any) => String(item.id) === String(eventId)) || fallbackItem;
      const kept = list.filter((item: any) => String(item.id) !== String(eventId));
      await setDoc(eventDocRef, eventDocPayload(kept), { merge: true });

      if (removed) {
        try {
          await moveToTrash({
            id: String(eventId),
            type: 'event',
            originalDateStr: dateStr,
            fId: selectedGroupId || 'personal',
            content: removed.content || '',
            data: removed,
          });
        } catch (err) {
          console.error('Failed to move to trash:', err);
        }
      }
      showToast('🗑️ 일정을 삭제했습니다. 휴지통에서 복원할 수 있습니다.');
    } catch (err) {
      showErrorToast('일정을 삭제하지 못했습니다.', err);
    }
  }, [selectedGroupId]);

  return (
    <div className="animate-fade-in pb-12">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">데이터를 불러오는 중...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {months.slice(0, shownMonths).map((mInfo) => {
            const monthKey = `${mInfo.year}-${mInfo.month}`;
            const now = new Date();
            const isCurrentMonthCard = mInfo.year === now.getFullYear() && mInfo.month === now.getMonth() + 1;
            // 휴대폰에서는 12개월이 한 줄로 쌓여 끝없이 스크롤된다. 이번 달만 펼치고
            // 나머지는 접어서, 머리글만 훑다가 필요한 달을 눌러 펼치게 한다.
            const isOpen = !isMobile || (collapsedMonths[monthKey] ?? !isCurrentMonthCard) === false;

            return (
              <YearMonthCard
                key={monthKey}
                mInfo={mInfo}
                eventsMap={eventsMap}
                schedulesMap={schedulesMap}
                journalCountMap={journalCountMap}
                evalCountMap={evalCountMap}
                holidays={holidays}
                eventLabels={eventLabels}
                labelsLoaded={labelsLoaded}
                labelColorOf={labelColorOf}
                periodArray={periodArray}
                showWeekend={showWeekend}
                showClass={showClass}
                showEvents={showEvents}
                isMobile={isMobile}
                isOpen={isOpen}
                isCurrentMonthCard={isCurrentMonthCard}
                realTodayStr={realTodayStr}
                selectedGroupId={selectedGroupId}
                isMultiSelectMode={isMultiSelectMode}
                selectedEventIds={selectedEventIds}
                onToggleMonth={toggleMonth}
                onDateClick={handleDateClick}
                onToggleEvent={handleToggleEvent}
                onDeleteEvent={handleDeleteEvent}
                onQuickAdd={handleQuickAdd}
                onOpenDetail={handleOpenDetail}
                onToggleSelection={toggleEventSelection}
                onOpenLinkViewer={openLinkViewerModal}
              />
            );
          })}
        </div>
      )}

      {detailModal && (
        <DetailEditModal
          isOpen={detailModal.isOpen}
          onClose={() => setDetailModal(null)}
          type={detailModal.type}
          dateStr={detailModal.dateStr}
          itemId={detailModal.itemId}
          initialData={detailModal.initialData}
        />
      )}
      
      {quickAddDate && <QuickAddModal isOpen={true} onClose={() => setQuickAddDate(null)} dateStr={quickAddDate} />}
    </div>
  );
}