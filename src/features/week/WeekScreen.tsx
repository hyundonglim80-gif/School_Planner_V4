import React, { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getWeekDays, parseDateStr, addDays, formatDateStr } from '../../lib/dateUtils';
import { useCalendarData } from '../../hooks/useCalendarData';
import { useMainWidth } from '../../hooks/useMainWidth';
import WeekGrid from './WeekGrid';
import { openEntryPanel } from '../../components/EntryPanelHost';
import { lastYearWeekOf } from '../../lib/lastYearWeek';
import { useLastYearWeek } from '../../hooks/useLastYearWeek';

export default function WeekScreen() {
  const { currentDate, setCurrentDate, setScope, selectedGroupId, showWeekend, showLastYear, setShowLastYear } = useAppStore();
  // 날짜 칸의 + 는 그날의 새 일정을 오른쪽 칸에 연다
  const openQuickAdd = (dateStr: string) => void openEntryPanel({ kind: 'event', groupId: selectedGroupId, dateStr });

  const curDateObj = useMemo(() => new Date(currentDate), [currentDate]);
  const weekDays = useMemo(() => {
    return getWeekDays(curDateObj);
  }, [curDateObj]);

  /**
   * 넓은 화면(xl, 1280px 이상)에서는 요일이 한 줄로 서서 아래가 텅 빈다.
   * 그 자리에 다음 주를 한 줄 더 보여 준다. 폭 기준은 WeekGrid가 한 줄로
   * 서는 경계(본문 1200px)와 같다 - 두세 줄로 접히는 폭에서는 이번 주만 둔다.
   * 오른쪽 메모·기록 칸이 열려 본문이 좁아지면 다음 주는 빠진다.
   */
  const showNextWeek = useMainWidth() >= 1200;
  const nextWeekDays = useMemo(() => {
    return getWeekDays(parseDateStr(addDays(formatDateStr(curDateObj), 7)));
  }, [curDateObj]);

  // 두 주를 늘 한 번에 읽는다 (구독 하나). 다음 주를 보일지는 그리기만 가른다.
  // ⚠️ 폭에 따라 읽을 날짜를 바꾸면 안 된다. 교시를 눌러 수정 팝업이 오른쪽에 붙으면
  //    본문이 좁아져 다음 주가 빠지는데, 그때 읽을 날짜가 바뀌어 다시 읽는 동안 주간
  //    전체가 '불러오는 중'으로 바뀌었다가 다시 그려져 방금 연 팝업이 닫혔다.
  const dateStrings = useMemo(
    () => [...weekDays, ...nextWeekDays].map((d) => d.dateStr),
    [weekDays, nextWeekDays]
  );

  const { dataMap, loading, toggleEventItem, deleteEventItem } = useCalendarData(dateStrings, selectedGroupId);

  // 작년 이맘때 (ROADMAP 7): 이번 주의 작년 학년도 같은 주. 켰을 때만 읽는다. 다음 주 줄에는 붙이지 않는다.
  const lastYearWeek = useMemo(() => lastYearWeekOf(weekDays.map((d) => d.dateStr)), [weekDays]);
  const lastYear = useLastYearWeek(lastYearWeek?.lastDates || [], selectedGroupId, showLastYear);

  const rangeLabel = useMemo(() => {
    if (weekDays.length === 0) return '';
    const first = weekDays[0].dateStr;
    const last = weekDays[weekDays.length - 1].dateStr;
    const [y, m, d1] = first.split('-');
    const [, , d2] = last.split('-');
    return `${y}년 ${Number(m)}월 (${Number(m)}.${Number(d1)} ~ ${Number(d2)})`;
  }, [weekDays]);

  const handlePrevWeek = () => {
    const curStr = formatDateStr(curDateObj);
    setCurrentDate(parseDateStr(addDays(curStr, -7)));
  };

  const handleNextWeek = () => {
    const curStr = formatDateStr(curDateObj);
    setCurrentDate(parseDateStr(addDays(curStr, 7)));
  };

  const handleThisWeek = () => {
    setCurrentDate(new Date());
  };

  const handleSelectDate = (dateStr: string) => {
    setCurrentDate(parseDateStr(dateStr));
    setScope('day');
  };

  const displayWeekDays = useMemo(() => {
    if (!showWeekend) {
      return weekDays.filter(d => !d.isWeekend);
    }
    return weekDays;
  }, [weekDays, showWeekend]);

  const displayNextWeekDays = useMemo(
    () => (showWeekend ? nextWeekDays : nextWeekDays.filter((d) => !d.isWeekend)),
    [nextWeekDays, showWeekend]
  );

  const nextWeekLabel = useMemo(() => {
    if (nextWeekDays.length === 0) return '';
    const [, m1, d1] = nextWeekDays[0].dateStr.split('-');
    const [, m2, d2] = nextWeekDays[nextWeekDays.length - 1].dateStr.split('-');
    return `${Number(m1)}.${Number(d1)} ~ ${Number(m2)}.${Number(d2)}`;
  }, [nextWeekDays]);

  return (
    <div className="animate-fade-in pb-12">
      {/* 작년 이맘때 토글. 켜면 요일 카드 아래에 작년 같은 요일이 흐리게 붙는다. */}
      <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 mb-2 px-1">
        {showLastYear && lastYearWeek && (
          <span data-last-year-label className="text-xs text-slate-500 min-w-0">
            작년 같은 주 · <strong className="font-bold text-slate-700">{lastYearWeek.label}</strong>
            {lastYear.error && <span className="ml-1 text-rose-500">(서버에서 읽지 못했습니다)</span>}
          </span>
        )}
        <button
          type="button"
          data-last-year-toggle
          aria-pressed={showLastYear}
          onClick={() => setShowLastYear(!showLastYear)}
          title={showLastYear ? '작년 이맘때 숨기기' : '작년 학년도 같은 주의 일정·기록을 요일 카드 아래에 흐리게 보기'}
          className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all whitespace-nowrap ${
            showLastYear
              ? 'bg-amber-50 text-amber-800 border-amber-300 shadow-xs'
              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700'
          }`}
        >
          🕰️ 작년 이맘때
        </button>
      </div>
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">데이터를 불러오는 중...</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <WeekGrid
            onQuickAdd={openQuickAdd}
            days={displayWeekDays}
            dataMap={dataMap}
            onSelectDate={handleSelectDate}
            onToggleEvent={toggleEventItem}
            onDeleteEvent={deleteEventItem}
            lastYear={
              showLastYear && lastYearWeek
                ? { dateMap: lastYearWeek.dateMap, byDate: lastYear.byDate, loading: lastYear.loading, error: lastYear.error }
                : undefined
            }
          />
          {showNextWeek && (
            <section aria-label="다음 주">
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="text-xs font-extrabold text-slate-500">다음 주</span>
                <span className="text-xs text-slate-400">{nextWeekLabel}</span>
                <div className="flex-1 border-t border-dashed border-slate-200" />
              </div>
              <WeekGrid
                onQuickAdd={openQuickAdd}
                days={displayNextWeekDays}
                dataMap={dataMap}
                onSelectDate={handleSelectDate}
                onToggleEvent={toggleEventItem}
                onDeleteEvent={deleteEventItem}
              />
            </section>
          )}
        </div>
      )}
      
    </div>
  );
}