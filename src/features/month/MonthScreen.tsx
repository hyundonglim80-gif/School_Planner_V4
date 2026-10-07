import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getMonthCalendarDays, parseDateStr } from '../../lib/dateUtils';
import { useCalendarData } from '../../hooks/useCalendarData';
import MonthGrid from './MonthGrid';
import MonthDaySheet from './MonthDaySheet';
import { openEntryPanel } from '../../components/EntryPanelHost';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useLabels } from '../../hooks/useLabels';
import { useGovHolidays } from '../../hooks/useGovHolidays';
import { useSchoolSchedule } from '../../hooks/useNeis';
import { useTimetableTemplate } from '../../hooks/useTimetableTemplate';

export default function MonthScreen() {
  const { currentDate, setCurrentDate, setScope, selectedGroupId, showWeekend, showClass, showEvents, openSchoolEventPeek, isMultiSelectMode } = useAppStore();
  // 날짜 칸의 + 는 그날의 새 일정을 오른쪽 칸에 연다
  const openQuickAdd = (dateStr: string) => void openEntryPanel({ kind: 'event', groupId: selectedGroupId, dateStr });
  const isMobile = useIsMobile();

  const curDateObj = useMemo(() => new Date(currentDate), [currentDate]);
  const year = curDateObj.getFullYear();
  const month = curDateObj.getMonth() + 1;

  const calendarDays = useMemo(() => {
    return getMonthCalendarDays(year, month);
  }, [year, month]);

  const dateStrings = useMemo(() => {
    return calendarDays.map(d => d.dateStr);
  }, [calendarDays]);

  const { dataMap, loading, toggleEventItem, deleteEventItem } = useCalendarData(dateStrings, selectedGroupId);

  // 휴대폰: 날짜를 누르면 아래에 그날 목록 (ROADMAP 15). 같은 날을 한 번 더 누르면 하루 화면.
  const [sheetDate, setSheetDate] = useState<string | null>(null);
  // 달을 넘기면 닫는다 (다른 달 날짜의 목록이 남지 않게)
  useEffect(() => setSheetDate(null), [year, month]);
  useEffect(() => {
    if (!isMobile) setSheetDate(null);
  }, [isMobile]);
  const { eventLabels, labelsLoaded, getLabelColor } = useLabels();
  const { holidays } = useGovHolidays();
  const { byDate: schoolEvents } = useSchoolSchedule(sheetDate ? [sheetDate.slice(0, 7)] : []);
  const { templates, currentTemplateName } = useTimetableTemplate();
  const periodArray = useMemo(
    () => Array.from({ length: templates[currentTemplateName]?.names.length || 6 }, (_, i) => i + 1),
    [templates, currentTemplateName],
  );

  const goDay = (dateStr: string) => {
    setCurrentDate(parseDateStr(dateStr));
    setScope('day');
  };

  const handleSelectDate = (dateStr: string) => {
    if (isMobile && sheetDate !== dateStr) {
      setSheetDate(dateStr);
      return;
    }
    goDay(dateStr);
  };

  const sheetDay = sheetDate ? calendarDays.find((d) => d.dateStr === sheetDate) : undefined;

  return (
    <div className={`animate-fade-in ${sheetDate ? 'pb-[48vh]' : 'pb-12'}`}>
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">데이터를 불러오는 중...</p>
        </div>
      ) : (
        /*
          휴대폰에서도 달력 격자를 쓴다.
          예전에는 목록(MonthAgenda, 이 커밋에서 지웠다)으로 갈아 끼웠다. 한 칸이 50px 남짓이라
          제목이 거의 안 보인다는 까닭이었는데, 그러면 월간이 '하루를 길게 이어
          붙인 것'이 되어 달력을 여는 뜻이 없어진다. 칸을 바꾸는 대신 칸 안에
          든 것을 줄이는 쪽으로 풀었다(MonthGrid 의 compact 참고).
          그날 것을 다 보려면 날짜를 누른다 - 아래에 그날 목록이 올라온다(MonthDaySheet).
        */
        <MonthGrid
          compact={isMobile}
          onQuickAdd={openQuickAdd}
          days={calendarDays}
          dataMap={dataMap}
          onSelectDate={handleSelectDate}
          showWeekend={showWeekend}
          onToggleEvent={toggleEventItem}
          onDeleteEvent={deleteEventItem}
          selectedDate={sheetDate}
        />
      )}

      {isMobile && sheetDate && (
        <MonthDaySheet
          dateStr={sheetDate}
          summary={dataMap[sheetDate]}
          holidayName={sheetDay?.holidayName || holidays[sheetDate]}
          schoolItems={schoolEvents[sheetDate]}
          eventLabels={eventLabels}
          labelsLoaded={labelsLoaded}
          getLabelColor={getLabelColor}
          periodArray={periodArray}
          showClass={showClass}
          showEvents={showEvents}
          onClose={() => setSheetDate(null)}
          onGoDay={() => goDay(sheetDate)}
          onAdd={() => openQuickAdd(sheetDate)}
          onOpenEvent={(ev) =>
            void openEntryPanel({ kind: 'event', groupId: selectedGroupId, dateStr: sheetDate, entryId: String(ev.id), initial: ev })
          }
          onToggleEvent={isMultiSelectMode ? undefined : (ev) => void toggleEventItem(sheetDate, String(ev.id))}
          onOpenSchool={(items) => openSchoolEventPeek(sheetDate, items)}
        />
      )}
    </div>
  );
}
