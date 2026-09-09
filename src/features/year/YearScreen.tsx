//src/features/year/YearScreen.tsx

import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, documentId, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { useLabels } from '../../hooks/useLabels';
import { useGovHolidays } from '../../hooks/useGovHolidays';
import { useTimetableTemplate } from '../../hooks/useTimetableTemplate';
import { getAcademicYear, getAcademicMonths, parseDateStr, formatDateStr } from '../../lib/dateUtils';
import { parseV3EventText } from '../../hooks/useDayData';
import DetailEditModal from '../../components/DetailEditModal';
import QuickAddModal from '../../components/QuickAddModal';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export default function YearScreen() {
  const { currentDate, setCurrentDate, setScope, semesterFilter, showWeekend, showClass, showEvents, selectedGroupId, isMultiSelectMode, selectedEventIds, toggleEventSelection } = useAppStore();
  
  const [eventsMap, setEventsMap] = useState<Record<string, any[]>>({});
  const [schedulesMap, setSchedulesMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [quickAddDate, setQuickAddDate] = useState<string | null>(null);

  const [detailModal, setDetailModal] = useState<{
    isOpen: boolean;
    type: 'schedule' | 'event';
    dateStr: string;
    itemId: string | number;
    initialData: any;
  } | null>(null);

  const { getLabelColor, getLabel } = useLabels();
  const { holidays } = useGovHolidays();
  const { templates, currentTemplateName } = useTimetableTemplate();
  
  const maxPeriods = templates[currentTemplateName]?.names.length || 6;
  const periodArray = Array.from({ length: maxPeriods }, (_, i) => i + 1);

  const curDateObj = useMemo(() => new Date(currentDate), [currentDate]);
  const defaultAcademicYear = useMemo(() => getAcademicYear(curDateObj), [curDateObj]);
  const realTodayStr = formatDateStr(new Date());

  const months = useMemo(() => {
    const list = getAcademicMonths(defaultAcademicYear);
    if (semesterFilter === 'all') return list;
    return list.filter((m) => m.semester === semesterFilter);
  }, [defaultAcademicYear, semesterFilter]);

  // 1년치 데이터 범위 로드 (V3 최적화 방식)
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const startStr = `${defaultAcademicYear}-03-01`;
    const endStr = `${defaultAcademicYear + 1}-02-29`;

    const colPath = (col: string) => selectedGroupId && selectedGroupId !== 'personal' ? `groups/${selectedGroupId}/${col}` : `users/${user.uid}/${col}`;

    setLoading(true);

    const unsubEvents = onSnapshot(query(collection(db, colPath('events')), where(documentId(), '>=', startStr), where(documentId(), '<=', endStr)), (snap) => {
      const map: Record<string, any[]> = {};
      snap.forEach(d => {
        const data = d.data();
        let list = data.eventList || [];
        if (list.length === 0 && data.eventText) list = parseV3EventText(data.eventText);
        map[d.id] = list.filter((e: any) => e.content?.trim());
      });
      setEventsMap(map);
      setLoading(false);
    });

    const unsubSchedules = onSnapshot(query(collection(db, colPath('schedules')), where(documentId(), '>=', startStr), where(documentId(), '<=', endStr)), (snap) => {
      const map: Record<string, any> = {};
      snap.forEach(d => {
        map[d.id] = d.data().periods || {};
      });
      setSchedulesMap(map);
    });

    return () => { unsubEvents(); unsubSchedules(); };
  }, [defaultAcademicYear, selectedGroupId]);

  const handleDateClick = (dateStr: string) => {
    setCurrentDate(parseDateStr(dateStr));
    setScope('day');
  };

  return (
    <div className="animate-fade-in pb-12">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">연간 데이터를 불러오는 중입니다...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {months.map((mInfo) => {
            const daysInMonth = new Date(mInfo.year, mInfo.month, 0).getDate();
            const days = Array.from({ length: daysInMonth }, (_, i) => {
              const d = i + 1;
              const dateStr = `${mInfo.year}-${String(mInfo.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              return { day: d, dateStr, dateObj: new Date(mInfo.year, mInfo.month - 1, d) };
            });

            // V3와 동일하게 일정이 있거나 수업이 있는 날짜만 추출
            const activeDays = days.filter(dObj => {
              const dayOfWeekNum = dObj.dateObj.getDay();
              if (!showWeekend && (dayOfWeekNum === 0 || dayOfWeekNum === 6)) return false;
              
              const evs = eventsMap[dObj.dateStr] || [];
              const sch = schedulesMap[dObj.dateStr] || {};
              const hasClasses = periodArray.some(p => sch[p]?.subject?.trim() && sch[p]?.subject?.toUpperCase() !== 'X');
              
              return evs.length > 0 || (showClass && hasClasses);
            });

            const isCurrentMonthCard = mInfo.year === new Date().getFullYear() && mInfo.month === new Date().getMonth() + 1;

            return (
              <div
                key={`${mInfo.year}-${mInfo.month}`}
                className={`bg-white rounded-2xl border shadow-sm p-5 flex flex-col transition-all ${
                  isCurrentMonthCard ? 'border-primary ring-2 ring-primary/10' : 'border-slate-200/80 hover:shadow-md'
                }`}
              >
                <div className="text-center font-black text-blue-800 text-lg mb-4 pb-2 border-b-2 border-blue-100 flex items-center justify-center gap-2">
                  <span>{mInfo.label}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-lg">
                    {mInfo.semester}학기
                  </span>
                </div>

                <div className="flex flex-col gap-3 flex-1">
                  {activeDays.length > 0 ? (
                    activeDays.map(dObj => {
                      const dayOfWeekNum = dObj.dateObj.getDay();
                      const dayOfWeek = DAY_NAMES[dayOfWeekNum];
                      const isTodayEvent = dObj.dateStr === realTodayStr;
                      
                      const evs = eventsMap[dObj.dateStr] || [];
                      const sch = schedulesMap[dObj.dateStr] || {};

                      const holidayName = holidays[dObj.dateStr];
                      const isHoliday = !!holidayName || dayOfWeekNum === 0;
                      
                      const dateColor = isHoliday ? 'text-red-500' : dayOfWeekNum === 6 ? 'text-blue-500' : 'text-blue-700';
                      const hasClasses = periodArray.some(p => sch[p]?.subject?.trim() && sch[p]?.subject?.toUpperCase() !== 'X');

                      return (
                        <div 
                          key={dObj.dateStr} 
                          className={`flex flex-col gap-1.5 pb-3 border-b border-dashed border-slate-200 last:border-0 last:pb-0 ${isTodayEvent ? 'bg-blue-50/50 p-2 rounded-xl border-blue-200 border-solid -mx-2 px-2' : ''}`}
                        >
                          {/* 날짜 헤더 */}
                          <div className="flex items-center justify-between">
                            <div 
                              className={`font-black cursor-pointer hover:underline flex items-center gap-1 ${dateColor} ${isTodayEvent ? 'text-base' : 'text-sm'}`}
                              onClick={() => handleDateClick(dObj.dateStr)}
                            >
                              <span>{dObj.day}일({dayOfWeek})</span>
                              {isTodayEvent && <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full ml-1">오늘</span>}
                              {holidayName && <span className="text-[10px] text-red-500 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-md ml-1">{holidayName}</span>}
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); setQuickAddDate(dObj.dateStr); }}
                              className="text-xs font-bold text-slate-400 hover:text-primary bg-slate-50 hover:bg-slate-100 px-1.5 py-0.5 rounded transition-colors"
                            >
                              + 일정
                            </button>
                          </div>

                          {/* 콘텐츠: 수업 & 일정 */}
                          <div className="flex flex-col gap-2">
                            {/* 수업 블록 */}
                            {showClass && hasClasses && (
                              <div className="flex flex-nowrap gap-[1px] w-full mt-0.5">
                                {periodArray.map((p) => {
                                  const item = sch[p];
                                  const text = item?.subject?.trim() || '';
                                  if (text && text.toUpperCase() !== 'X') {
                                    let fontSize = "text-[11px]";
                                    let tracking = "tracking-normal";
                                    if (text.length >= 5) { fontSize = "text-[7px]"; tracking = "tracking-tighter"; }
                                    else if (text.length === 4) { fontSize = "text-[9px]"; tracking = "tracking-tighter"; }
                                    else if (text.length === 3) { fontSize = "text-[10px]"; tracking = "tracking-tight"; }

                                    return (
                                      <div
                                        key={p}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDetailModal({ isOpen: true, type: 'schedule', dateStr: dObj.dateStr, itemId: p, initialData: item });
                                        }}
                                        className={`flex-1 min-w-0 h-[22px] flex items-center justify-center border border-emerald-300 rounded-[3px] bg-emerald-50 text-emerald-700 font-bold ${fontSize} ${tracking} whitespace-nowrap overflow-hidden cursor-pointer hover:bg-emerald-200 transition-colors shadow-2xs`}
                                        title={`${text} (클릭하여 수정)`}
                                      >
                                        {text}
                                      </div>
                                    );
                                  }
                                  return <div key={p} className="flex-1 min-w-0 h-[22px] flex items-center justify-center border border-slate-200 rounded-[3px] bg-slate-50" />;
                                })}
                              </div>
                            )}

                            {/* 일정 뱃지 목록 */}
                            {showEvents && evs.length > 0 && (
                              <div className="flex flex-col gap-1">
                                {evs.map((ev) => {
                                  const hasLabel = !!ev.label;
                                  const labelColor = hasLabel ? getLabelColor(ev.label!) : null;
                                  return (
                                    <div
                                      key={ev.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (isMultiSelectMode) {
                                          toggleEventSelection(ev.id, dObj.dateStr);
                                        } else {
                                          setDetailModal({ isOpen: true, type: 'event', dateStr: dObj.dateStr, itemId: ev.id, initialData: ev });
                                        }
                                      }}
                                      className={`px-1.5 py-1 rounded-lg text-xs leading-tight transition-all border flex items-center gap-1.5 hover:shadow-sm cursor-pointer ${
                                        selectedEventIds.includes(ev.id)
                                          ? 'bg-primary/10 border-primary text-primary'
                                          : ev.completed
                                          ? 'bg-slate-50 border-slate-100 text-slate-400 line-through'
                                          : 'bg-white border-slate-200 text-slate-700 font-medium'
                                      }`}
                                    >
                                      {isMultiSelectMode && (
                                        <input type="checkbox" checked={selectedEventIds.includes(ev.id)} readOnly className="pointer-events-none" />
                                      )}
                                      {hasLabel && labelColor && !isMultiSelectMode && (
                                        <span
                                          className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0 shadow-2xs"
                                          style={{
                                            backgroundColor: ev.completed ? '#f1f5f9' : labelColor.bg,
                                            color: ev.completed ? '#94a3b8' : labelColor.text,
                                            border: '1px solid ' + (ev.completed ? '#e2e8f0' : labelColor.border)
                                          }}
                                        >
                                          {ev.label}
                                        </span>
                                      )}
                                      <span className="break-words flex-1 leading-snug">{ev.content}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center text-slate-400 text-xs py-8 font-semibold">
                      등록된 일정이 없습니다.
                    </div>
                  )}
                </div>
              </div>
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