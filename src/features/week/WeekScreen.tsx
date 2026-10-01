import React, { useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getWeekDays, parseDateStr, addDays, formatDateStr } from '../../lib/dateUtils';
import { useCalendarData } from '../../hooks/useCalendarData';
import { useMainWidth } from '../../hooks/useMainWidth';
import WeekGrid from './WeekGrid';
import { openEntryPanel } from '../../components/EntryPanelHost';
import { lastYearWeekOf } from '../../lib/lastYearWeek';
import { useLastYearWeek } from '../../hooks/useLastYearWeek';
import {
  importLastYear,
  undoLastYearImport,
  importedMessage,
  isImportableJournal,
  pickKey,
  ImportFailedError,
  type ImportPick,
  type ImportResult,
} from '../../lib/lastYearImport';
import { eventContentOf } from '../../lib/eventText';
import { showUndoToast } from '../../lib/undoToast';
import { showToast, showErrorToastOnce } from '../../utils/toast';
import { runAutoForwarding } from '../../hooks/useDayData';
import { printNode } from '../../lib/print';

export default function WeekScreen() {
  const { currentDate, setCurrentDate, setScope, selectedGroupId, showWeekend, showEvents, showLastYear, setShowLastYear } = useAppStore();
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

  // 고른 작년 항목 (7-2). 주·공간이 바뀌거나 끄면 풀린다 - 고른 때의 열쇠와 지금 열쇠가 다르면 빈 것으로 본다.
  const pickScope = `${lastYearWeek?.label}|${selectedGroupId}|${showLastYear}`;
  const [pickState, setPickState] = useState<{ scope: string; picked: Record<string, ImportPick> }>({ scope: '', picked: {} });
  const picked = pickState.scope === pickScope ? pickState.picked : {};
  const pickedCount = Object.keys(picked).length;
  const setPicked = (next: Record<string, ImportPick>) => setPickState({ scope: pickScope, picked: next });
  const togglePick = (pick: ImportPick) => {
    const key = pickKey(pick.kind, pick.fromDate, pick.item.id);
    const next = { ...picked };
    if (next[key]) delete next[key];
    else next[key] = pick;
    setPicked(next);
  };
  const [importing, setImporting] = useState(false);
  /** 인쇄할 이번 주 칸 (ROADMAP 12-1 - A4 가로) */
  const printRef = useRef<HTMLDivElement>(null);

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

  /** 보이는 요일의 작년 항목 중 고를 수 있는 것 전부 ('모두 고르기') */
  const importablePicks = (): ImportPick[] => {
    if (!lastYearWeek) return [];
    const out: ImportPick[] = [];
    for (const day of displayWeekDays) {
      const fromDate = lastYearWeek.dateMap[day.dateStr];
      const data = fromDate ? lastYear.byDate[fromDate] : undefined;
      if (!data) continue;
      const existing = new Set((dataMap[day.dateStr]?.eventList || []).map((e) => (e.content || '').trim()));
      if (showEvents) {
        for (const ev of data.events) {
          if (!existing.has(eventContentOf(ev))) out.push({ kind: 'event', fromDate, toDate: day.dateStr, item: ev });
        }
      }
      for (const j of data.journals) {
        const text = String(j.content || '').trim();
        if (isImportableJournal(j) && (text || (j.tables || []).length > 0)) {
          out.push({ kind: 'journal', fromDate, toDate: day.dateStr, item: j });
        }
      }
    }
    return out;
  };

  const pickAll = () => {
    const next: Record<string, ImportPick> = {};
    for (const p of importablePicks()) next[pickKey(p.kind, p.fromDate, p.item.id)] = p;
    setPicked(next);
  };

  /** 고른 것을 올해 같은 요일로. 안내에 되돌리기. 실패하면 고른 것을 그대로 두어 다시 누를 수 있게(같은 글은 건너뛴다). */
  const runImport = async () => {
    const picks = Object.values(picked);
    if (picks.length === 0 || importing) return;
    const groupId = selectedGroupId; // 누른 순간의 공간에 쓴다 (ARCHITECTURE 4-6)
    const undoable = (r: ImportResult, message: string) => {
      if (r.added.length === 0) {
        showToast(message);
        return;
      }
      showUndoToast(message, async () => {
        const n = await undoLastYearImport(groupId, r.added);
        return n > 0 ? `↩️ 가져온 ${n}개를 뺐습니다.` : '뺄 것이 없습니다. 이미 지웠습니다.';
      });
    };
    setImporting(true);
    try {
      const r = await importLastYear(groupId, picks);
      setPicked({});
      undoable(r, importedMessage(r));
      // 지난 날짜에 넣었으면 이월을 한 번 (새 일정을 지난 날에 넣을 때와 같다)
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      if (r.added.some((a) => a.kind === 'event' && a.date < todayStr)) runAutoForwarding(groupId).catch(console.error);
    } catch (e) {
      if (e instanceof ImportFailedError && e.partial.added.length > 0) {
        undoable(e.partial, `${importedMessage(e.partial)}\n${e.date}부터는 서버에 연결되지 않아 가져오지 못했습니다.`);
      } else {
        showErrorToastOnce(e instanceof Error ? e.message : '가져오지 못했습니다.', e);
      }
    } finally {
      setImporting(false);
    }
  };

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
        {/* 고른 작년 항목을 올해 같은 요일로 (7-2) */}
        {showLastYear && !lastYear.loading && !lastYear.error && (
          pickedCount > 0 ? (
            <span data-last-year-picks className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-amber-700">{pickedCount}개 고름</span>
              <button
                type="button"
                data-last-year-import
                disabled={importing}
                onClick={() => void runImport()}
                title="고른 작년 일정·기록을 올해 같은 요일에 복사합니다 (작년 것은 그대로)"
                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 shadow-xs whitespace-nowrap"
              >
                {importing ? '가져오는 중…' : '📥 올해로 가져오기'}
              </button>
              <button
                type="button"
                onClick={() => setPicked({})}
                className="px-2 py-1 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 whitespace-nowrap"
              >
                풀기
              </button>
            </span>
          ) : (
            <button
              type="button"
              data-last-year-pick-all
              onClick={pickAll}
              title="보이는 요일의 작년 일정·기록을 모두 고릅니다 (올해 이미 있는 것은 빼고)"
              className="px-2 py-1 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 whitespace-nowrap"
            >
              모두 고르기
            </button>
          )
        )}
        <button
          type="button"
          data-week-guide
          onClick={() => useAppStore.getState().openWeeklyGuide(displayWeekDays[0]?.dateStr || '')}
          title="보고 있는 주의 주간학습안내(요일 × 교시 + 준비물·알림장)를 만듭니다"
          className="px-2.5 py-1 rounded-lg text-xs font-bold border bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700 whitespace-nowrap"
        >
          📰 주간학습안내
        </button>
        <button
          type="button"
          data-week-print
          onClick={() => {
            if (!printRef.current || displayWeekDays.length === 0) return;
            const first = displayWeekDays[0].dateStr;
            const last = displayWeekDays[displayWeekDays.length - 1].dateStr;
            const md = (s: string) => `${Number(s.slice(5, 7))}.${Number(s.slice(8, 10))}`;
            printNode(printRef.current, {
              title: `${first.slice(0, 4)}년 ${md(first)} ~ ${md(last)} 주간`,
              subtitle: `인쇄 ${formatDateStr(new Date())}`,
              landscape: true,
            });
          }}
          title="이번 주 칸을 A4 가로로 인쇄합니다 (인쇄 창에서 'PDF로 저장'도 됩니다)"
          className="px-2.5 py-1 rounded-lg text-xs font-bold border bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700 whitespace-nowrap"
        >
          🖨️ 인쇄
        </button>
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
          <div ref={printRef}>
          <WeekGrid
            onQuickAdd={openQuickAdd}
            days={displayWeekDays}
            dataMap={dataMap}
            onSelectDate={handleSelectDate}
            onToggleEvent={toggleEventItem}
            onDeleteEvent={deleteEventItem}
            lastYear={
              showLastYear && lastYearWeek
                ? {
                    dateMap: lastYearWeek.dateMap,
                    byDate: lastYear.byDate,
                    loading: lastYear.loading,
                    error: lastYear.error,
                    picked,
                    onTogglePick: togglePick,
                  }
                : undefined
            }
          />
          </div>
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