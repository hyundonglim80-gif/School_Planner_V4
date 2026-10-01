//src/features/year/YearScreen.tsx

import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { collection, query, where, documentId, onSnapshot, doc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { readEvalList } from '../../lib/evalList';
import { useAppStore } from '../../store/useAppStore';
import { useLabels } from '../../hooks/useLabels';
import { useGovHolidays } from '../../hooks/useGovHolidays';
import { useSchoolSchedule } from '../../hooks/useNeis';
import { useTimetableTemplate } from '../../hooks/useTimetableTemplate';
import { getAcademicYear, getAcademicMonths, parseDateStr, formatDateStr } from '../../lib/dateUtils';
import { runAutoForwarding } from '../../hooks/useDayData';
import { readEventList } from '../../lib/eventText';
import { useIsMobile } from '../../hooks/useIsMobile';
import { updateEventInDoc, deleteEventFromDoc, TrashFailedError } from '../../lib/eventDocOps';
import { showErrorToast } from '../../utils/toast';
import { lazyWithReload } from '../../lib/lazyWithReload';
import { openEntryPanel } from '../../components/EntryPanelHost';
import { useGroupDelete } from '../../hooks/useGroupDelete';
import YearMonthCard from './YearMonthCard';
import { useEventDropMove } from '../../hooks/useEventDrag';
import { showDeletedToast } from '../../lib/undoToast';
import YearSheetMonth from './YearSheet';
import { useDDay } from '../../hooks/useDDay';
import { printNode } from '../../lib/print';
import type { NeisScheduleItem } from '../../lib/neis';

// Layout도 같은 편집기를 따로 불러온다. 여기서 곧바로 불러오면 분리가 무너져
// 편집기가 첫 화면 묶음에 함께 실려 온다. 그래서 여기서도 필요할 때 불러온다.
const DetailEditModal = lazyWithReload(() => import('../../components/DetailEditModal'));

/**
 * 한 번에 그릴 달의 수.
 *
 * ⚠️ 열두 달을 한 판에 그리면 본 스레드가 1초 넘게 붙잡혀 화면이 굳는다.
 *    그 사이에 다른 화면을 누르면 누른 것이 1~2초 뒤에야 먹는다(실제로 그랬다).
 *    몇 달씩 나눠 그리면 사이사이 브라우저가 숨을 쉬므로 눌러도 바로 반응한다.
 *    달 카드는 React.memo라 이미 그린 달은 다시 그리지 않는다.
 */
const MONTHS_PER_FRAME = 3;

/** 년간 보기: 학사력 한 장(ROADMAP 14) / 자세히(예전 모양). 이 기기에 남긴다. */
type YearView = 'sheet' | 'detail';
const YEAR_VIEW_KEY = 'sp4_yearView';
function loadYearView(): YearView {
  try {
    return localStorage.getItem(YEAR_VIEW_KEY) === 'detail' ? 'detail' : 'sheet';
  } catch {
    return 'sheet';
  }
}

export default function YearScreen() {
  const { currentDate, setCurrentDate, setScope, semesterFilter, showWeekend, showClass, showEvents, selectedGroupId, isMultiSelectMode, selectedEventIds, toggleEventSelection, openLinkViewerModal } = useAppStore();
  const [eventsMap, setEventsMap] = useState<Record<string, any[]>>({});
  const [schedulesMap, setSchedulesMap] = useState<Record<string, any>>({});
  // 그날 기록이 몇 건인지. 내용은 아이콘을 눌렀을 때 그때 읽는다.
  const [journalCountMap, setJournalCountMap] = useState<Record<string, number>>({});
  // 조사표도 마찬가지로 개수만 쓴다
  const [evalCountMap, setEvalCountMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();
  const [yearView, setYearViewState] = useState<YearView>(loadYearView);
  const setYearView = (v: YearView) => {
    setYearViewState(v);
    try {
      localStorage.setItem(YEAR_VIEW_KEY, v);
    } catch {
      /* 저장하지 못해도 이번에는 바뀐다 */
    }
  };
  const { dDayList } = useDDay();
  const openSchoolEventPeek = useAppStore((st) => st.openSchoolEventPeek);
  const sheetRef = useRef<HTMLDivElement>(null);
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

  // 우리 학교 학사일정 (나이스 - 표시만, ROADMAP 4-4). 열두 달을 한꺼번에 (달마다 담아 둔다)
  const { byDate: schoolEvents } = useSchoolSchedule(months.map((m) => `${m.year}-${String(m.month).padStart(2, '0')}`));

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
        // readEventList: V3 옛 글도 읽고, id 없는 V3 항목에 저장 쪽과 같은 id(ev_차례)를 붙인다.
        // 예전엔 eventList를 바로 읽어 id 없는 항목의 완료·삭제가 아무것도 찾지 못했다.
        const list = readEventList(data);
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
          const count = readEvalList(data).filter((ev) => ev && ev.id).length;
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
  // 학사력: 달 이름을 누르면 그 달 월간, 일정을 누르면 오른쪽 칸, 학사일정은 학사일정 창
  const handleMonthClick = useCallback((year: number, month: number) => {
    setCurrentDate(new Date(year, month - 1, 1));
    setScope('month');
  }, [setCurrentDate, setScope]);
  const handleOpenSheetEvent = useCallback((dateStr: string, ev: any) => {
    void openEntryPanel({ kind: 'event', groupId: selectedGroupId, dateStr, entryId: String(ev.id), initial: ev });
  }, [selectedGroupId]);
  const handleOpenSchool = useCallback((dateStr: string, items: NeisScheduleItem[]) => openSchoolEventPeek(dateStr, items), [openSchoolEventPeek]);

  // 날짜 칸의 + 는 그날의 새 일정을 오른쪽 칸에 연다
  const handleQuickAdd = useCallback(
    (dateStr: string) => void openEntryPanel({ kind: 'event', groupId: selectedGroupId, dateStr }),
    [selectedGroupId]
  );

  const handleOpenDetail = useCallback(
    (type: 'schedule' | 'event', dateStr: string, itemId: string | number, initialData: any) => {
      // 일정은 오른쪽 칸에서 고친다. 수업(교시)은 지금처럼 팝업.
      if (type === 'event') {
        void openEntryPanel({ kind: 'event', groupId: selectedGroupId, dateStr, entryId: String(itemId), initial: initialData });
        return;
      }
      setDetailModal({ isOpen: true, type, dateStr, itemId, initialData });
    },
    [selectedGroupId]
  );

  const handleToggleEvent = useCallback(async (dateStr: string, eventId: string) => {
    const user = auth.currentUser;
    if (!user) return;
    const eventDocRef = selectedGroupId
      ? doc(db, 'groups', selectedGroupId, 'events', dateStr)
      : doc(db, 'users', user.uid, 'events', dateStr);

    try {
      // 트랜잭션으로 서버의 지금 목록에서 그 일정만 뒤집는다 (lib/eventDocOps).
      // 예전엔 캐시로 읽어 통째로 썼고, eventList를 바로 읽어 id 없는 V3 항목을 못 찾았다.
      await updateEventInDoc(eventDocRef, eventId, (item) => ({ ...item, completed: !item.completed }));
    } catch (err) {
      showErrorToast('완료 표시를 저장하지 못했습니다.', err);
    }
  }, [selectedGroupId]);

  const handleDeleteEvent = useCallback(async (dateStr: string, eventId: string, fallbackItem?: any) => {
    const user = auth.currentUser;
    if (!user) return;
    const eventDocRef = selectedGroupId
      ? doc(db, 'groups', selectedGroupId, 'events', dateStr)
      : doc(db, 'users', user.uid, 'events', dateStr);

    try {
      // 휴지통에 먼저 넣고, 서버의 지금 목록에서 그 항목만 뺀다 (lib/eventDocOps)
      const trashId = await deleteEventFromDoc(eventDocRef, { dateStr, fId: selectedGroupId || 'personal', eventId, fallbackItem });
      showDeletedToast('🗑️ 일정을 삭제했습니다. 휴지통에서 복원할 수 있습니다.', trashId);
    } catch (err) {
      showErrorToast(err instanceof TrashFailedError ? '휴지통에 옮기지 못해 일정을 지우지 않았습니다. 네트워크를 확인해 주세요.' : '일정을 삭제하지 못했습니다.', err);
    }
  }, [selectedGroupId]);

  // 기간·반복으로 묶인 일정은 지우기 전에 어디까지 지울지 묻는다.
  // (requestDelete는 붙들려 있어야 달 카드의 memo가 살아 있다)
  const { requestDelete, groupDeleteModal } = useGroupDelete({
    fId: selectedGroupId,
    deleteOne: handleDeleteEvent,
  });
  // 일정을 끌어 다른 날에 놓으면 그 날로 옮긴다 (마우스 화면에서만). 처리 함수는 늘 같아 달 카드 memo가 살아 있다.
  const drop = useEventDropMove();

  return (
    <div className="animate-fade-in pb-12">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">데이터를 불러오는 중...</p>
        </div>
      ) : (
        /*
          휴대폰에서도 두 열로 둔다. 한 열이면 접힌 달 머리글이 세로로 열두 개
          쌓여, 훑는 데 뜻이 있는 화면인데도 끝없이 스크롤해야 했다.
          펼친 달은 좁으면 읽기 어려우므로 두 칸을 다 쓴다(YearMonthCard 참고).
        */
        <>
        {/* 학사력 / 자세히 전환과 인쇄 (ROADMAP 14) */}
        <div className="flex flex-wrap items-center gap-2 mb-3" data-print-hide>
          <div className="inline-flex bg-slate-100 p-0.5 rounded-xl gap-0.5" role="group" aria-label="년간 보기">
            {([['sheet', '📅 학사력', '열두 달을 작은 달력 한 장으로 (공휴일·D-Day·학사일정·달력 일정)'], ['detail', '📋 자세히', '날마다 수업과 일정을 모두 (고치기·끌어 옮기기·여러 개 고르기)']] as const).map(([v, label, hint]) => (
              <button
                key={v}
                type="button"
                data-year-view={v}
                aria-pressed={yearView === v}
                onClick={() => setYearView(v)}
                title={hint}
                className={`px-2.5 py-1 text-xs rounded-lg font-bold whitespace-nowrap transition-all ${yearView === v ? 'bg-white text-primary shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {yearView === 'sheet' && (
            <>
              <span className="hidden sm:flex items-center gap-2.5 text-2xs font-bold text-slate-500">
                <span className="flex items-center gap-1"><span className="w-[6px] h-[6px] rounded-full bg-red-500" />공휴일</span>
                <span className="flex items-center gap-1"><span className="w-[10px] h-[10px] rounded-full ring-[1.5px] ring-amber-400" />D-Day</span>
                <span className="flex items-center gap-1"><span className="w-[6px] h-[6px] rounded-full bg-teal-500" />학사일정</span>
                <span className="flex items-center gap-1"><span className="w-[6px] h-[6px] rounded-full bg-blue-400" />달력 일정(라벨 빛깔)</span>
                <span className="flex items-center gap-1"><span className="w-[14px] h-[3px] rounded-full bg-blue-400" />기간 일정</span>
              </span>
              <button
                type="button"
                data-year-print
                onClick={() => {
                  if (!sheetRef.current) return;
                  const semLabel = semesterFilter === 'all' ? '' : ` (${semesterFilter}학기)`;
                  printNode(sheetRef.current, { title: `${defaultAcademicYear}학년도 학사력${semLabel}`, landscape: true });
                }}
                title="학사력을 A4 가로로 인쇄합니다 (PDF로 저장도)"
                className="ml-auto px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-xs font-bold"
              >
                🖨️ 인쇄
              </button>
            </>
          )}
        </div>
        {yearView === 'sheet' ? (
          <div ref={sheetRef} data-year-sheet className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3 items-start">
            {months.slice(0, shownMonths).map((mInfo) => {
              const now = new Date();
              return (
                <YearSheetMonth
                  key={`${mInfo.year}-${mInfo.month}`}
                  mInfo={mInfo}
                  eventsMap={eventsMap}
                  holidays={holidays}
                  schoolEvents={schoolEvents}
                  ddays={dDayList}
                  eventLabels={eventLabels}
                  labelsLoaded={labelsLoaded}
                  labelColorOf={labelColorOf}
                  showWeekend={showWeekend}
                  showEvents={showEvents}
                  isCurrentMonthCard={mInfo.year === now.getFullYear() && mInfo.month === now.getMonth() + 1}
                  realTodayStr={realTodayStr}
                  onDateClick={handleDateClick}
                  onMonthClick={handleMonthClick}
                  onOpenEvent={handleOpenSheetEvent}
                  onOpenSchool={handleOpenSchool}
                />
              );
            })}
          </div>
        ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-4">
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
                schoolEvents={schoolEvents}
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
                onDeleteEvent={requestDelete}
                onQuickAdd={handleQuickAdd}
                onOpenDetail={handleOpenDetail}
                onToggleSelection={toggleEventSelection}
                onOpenLinkViewer={openLinkViewerModal}
                dropHandlers={drop.handlers}
                dragEnabled={drop.dragEnabled}
                onDragEnd={drop.clearOver}
                // 짚은 날짜는 그 달 카드에만 넘긴다 (다른 달은 다시 그리지 않는다)
                overDate={drop.overDate && drop.overDate.startsWith(`${mInfo.year}-${String(mInfo.month).padStart(2, '0')}-`) ? drop.overDate : null}
              />
            );
          })}
        </div>
        )}
        </>
      )}

      {detailModal && (
        <Suspense fallback={null}>
          <DetailEditModal
            isOpen={detailModal.isOpen}
            onClose={() => setDetailModal(null)}
            type={detailModal.type}
            dateStr={detailModal.dateStr}
            itemId={detailModal.itemId}
            initialData={detailModal.initialData}
          />
        </Suspense>
      )}

      {groupDeleteModal}
      {drop.groupMoveModal}

    </div>
  );
}