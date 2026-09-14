//src/features/year/YearScreen.tsx

import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, documentId, onSnapshot, doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { useLabels } from '../../hooks/useLabels';
import { useGovHolidays } from '../../hooks/useGovHolidays';
import { useTimetableTemplate } from '../../hooks/useTimetableTemplate';
import { getAcademicYear, getAcademicMonths, parseDateStr, formatDateStr } from '../../lib/dateUtils';
import { parseV3EventText, formatV3EventText, runAutoForwarding } from '../../hooks/useDayData';
import { eventDocPayload, readEventList } from '../../lib/eventText';
import { resolveEventLabel, eventDisplayContent, isForwardLabel } from '../../lib/eventLabels';
import { dayToneOf, DAY_CELL_BG, DAY_NUMBER_COLOR } from '../../lib/holiday';
import { useIsMobile } from '../../hooks/useIsMobile';
import { moveToTrash } from '../../utils/trashHelper';
import { showToast, showErrorToast } from '../../utils/toast';
import DetailEditModal from '../../components/DetailEditModal';
import EventItemActions from '../../components/EventItemActions';
import QuickAddModal from '../../components/QuickAddModal';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export default function YearScreen() {
  const { currentDate, setCurrentDate, setScope, semesterFilter, showWeekend, showClass, showEvents, selectedGroupId, isMultiSelectMode, selectedEventIds, toggleEventSelection, openLinkViewerModal } = useAppStore();
  const [eventsMap, setEventsMap] = useState<Record<string, any[]>>({});
  const [schedulesMap, setSchedulesMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [quickAddDate, setQuickAddDate] = useState<string | null>(null);
  const isMobile = useIsMobile();
  // 휴대폰에서 월 카드 접기/펼치기. 기본값은 "이번 달만 펼침"이라 값이 없으면
  // 이번 달인지로 판단하고, 사용자가 누른 달만 여기에 기록한다.
  const [collapsedMonths, setCollapsedMonths] = useState<Record<string, boolean>>({});
  const toggleMonth = (key: string, defaultCollapsed: boolean) => {
    setCollapsedMonths((prev) => ({ ...prev, [key]: !(prev[key] ?? defaultCollapsed) }));
  };

  const [detailModal, setDetailModal] = useState<{
    isOpen: boolean;
    type: 'schedule' | 'event';
    dateStr: string;
    itemId: string | number;
    initialData: any;
  } | null>(null);

  const { getLabelColor, eventLabels } = useLabels();
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

    return () => { unsubEvents(); unsubSchedules(); };
  }, [defaultAcademicYear, selectedGroupId]);

  const handleDateClick = (dateStr: string) => {
    setCurrentDate(parseDateStr(dateStr));
    setScope('day');
  };

  const handleToggleEvent = async (dateStr: string, eventId: string) => {
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
  };

  const handleDeleteEvent = async (dateStr: string, eventId: string, fallbackItem?: any) => {
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
  };

  return (
    <div className="animate-fade-in pb-12">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">데이터를 불러오는 중...</p>
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

            const activeDays = days.filter(dObj => {
              const dayOfWeekNum = dObj.dateObj.getDay();
              if (!showWeekend && (dayOfWeekNum === 0 || dayOfWeekNum === 6)) return false;
              
              const evs = eventsMap[dObj.dateStr] || [];
              const sch = schedulesMap[dObj.dateStr] || {};
              const hasClasses = periodArray.some(p => sch[p]?.subject?.trim() && sch[p]?.subject?.toUpperCase() !== 'X');
              
              return evs.length > 0 || (showClass && hasClasses);
            });

            const isCurrentMonthCard = mInfo.year === new Date().getFullYear() && mInfo.month === new Date().getMonth() + 1;
            const monthKey = `${mInfo.year}-${mInfo.month}`;
            // 휴대폰에서는 12개월이 한 줄로 쌓여 끝없이 스크롤된다. 이번 달만 펼치고
            // 나머지는 접어서, 머리글만 훑다가 필요한 달을 눌러 펼치게 한다.
            const isOpen = !isMobile || (collapsedMonths[monthKey] ?? !isCurrentMonthCard) === false;

            return (
              <div
                key={monthKey}
                className={`bg-white rounded-2xl border shadow-sm p-4 sm:p-5 flex flex-col transition-all ${
                  isCurrentMonthCard ? 'border-primary ring-2 ring-primary/10' : 'border-slate-200/80 hover:shadow-md'
                }`}
              >
                <button
                  type="button"
                  onClick={() => isMobile && toggleMonth(monthKey, !isCurrentMonthCard)}
                  className={`text-center font-black text-blue-800 text-lg flex items-center justify-center gap-2 ${
                    isOpen ? 'mb-4 pb-2 border-b-2 border-blue-100' : ''
                  } ${isMobile ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  {isMobile && <span className="text-xs text-slate-400">{isOpen ? '▼' : '▶'}</span>}
                  <span>{mInfo.label}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-lg">
                    {mInfo.semester}학기
                  </span>
                  {!isOpen && (
                    <span className="text-[11px] font-bold text-slate-400">
                      {activeDays.length > 0 ? `${activeDays.length}일` : '비어 있음'}
                    </span>
                  )}
                </button>

                <div className={`flex flex-col gap-3 flex-1 ${isOpen ? '' : 'hidden'}`}>
                  {activeDays.length > 0 ? (
                    activeDays.map(dObj => {
                      const dayOfWeekNum = dObj.dateObj.getDay();
                      const dayOfWeek = DAY_NAMES[dayOfWeekNum];
                      const isTodayEvent = dObj.dateStr === realTodayStr;
                      
                      const evs = eventsMap[dObj.dateStr] || [];
                      const sch = schedulesMap[dObj.dateStr] || {};
                      
                      const holidayEvent = evs.find((e: any) => e.label === '휴일' || e.labelIds?.includes('휴일'));
                      const holidayName = holidays[dObj.dateStr] || holidayEvent?.content;
                      // 토요일 파랑 / 일요일·공휴일 빨강 (lib/holiday의 공통 규칙)
                      const tone = dayToneOf({
                        isSunday: dayOfWeekNum === 0,
                        isSaturday: dayOfWeekNum === 6,
                        holidayName,
                      });

                      const visibleEvents = evs.filter((e: any) => e.label !== '휴일' && !e.labelIds?.includes('휴일'));
                      const hasClasses = periodArray.some(p => sch[p]?.subject?.trim() && sch[p]?.subject?.toUpperCase() !== 'X');

                      return (
                        <div
                          key={dObj.dateStr}
                          className={`flex flex-col gap-1.5 p-2 -mx-2 rounded-xl border-b border-dashed border-slate-200 last:border-0 ${DAY_CELL_BG[tone]} ${isTodayEvent ? 'ring-1 ring-primary/40 border-solid' : ''}`}
                        >
                          <div className="flex items-center justify-between">
                            <div
                              className={`font-black cursor-pointer hover:underline flex items-center gap-1 ${DAY_NUMBER_COLOR[tone]} ${isTodayEvent ? 'text-base' : 'text-sm'}`}
                              onClick={() => handleDateClick(dObj.dateStr)}
                            >
                              <span>{dObj.day}일 ({dayOfWeek})</span>
                              {isTodayEvent && <span className="text-[11px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full ml-1">오늘</span>}
                              {holidayName && <span className="text-[11px] text-red-500 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-md ml-1">{holidayName}</span>}
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); setQuickAddDate(dObj.dateStr); }}
                              className="text-xs font-bold text-slate-400 hover:text-primary bg-slate-50 hover:bg-slate-100 px-1.5 py-0.5 rounded transition-colors"
                            >
                              + 일정
                            </button>
                          </div>

                          <div className="flex flex-col gap-2">
                            {/* 휴대폰에서는 6칸을 고정으로 나누면 한 칸이 56px도 안 되어 과목명이 잘린다.
                                채워진 교시만 칩으로 보여주고 줄바꿈한다. */}
                            {showClass && hasClasses && isMobile && (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {periodArray.map((p) => {
                                  const item = sch[p];
                                  const text = item?.subject?.trim() || '';
                                  if (!text || text.toUpperCase() === 'X') return null;
                                  return (
                                    <button
                                      key={p}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDetailModal({ isOpen: true, type: 'schedule', dateStr: dObj.dateStr, itemId: p, initialData: item });
                                      }}
                                      className="flex items-center gap-1 px-1.5 py-1 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-[11px] font-bold"
                                    >
                                      <span className="text-[10px] text-emerald-500">{p}</span>
                                      <span className="max-w-[90px] truncate">{text}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            {showClass && hasClasses && !isMobile && (
                              <div className="flex flex-nowrap gap-[1px] w-full mt-0.5">
                                {periodArray.map((p) => {
                                  const item = sch[p];
                                  const text = item?.subject?.trim() || '';
                                  if (text && text.toUpperCase() !== 'X') {
                                    let fontSize = "text-[11px]";
                                    let tracking = "tracking-normal";
                                    if (text.length >= 5) { fontSize = "text-[10.5px]"; tracking = "tracking-tighter"; }
                                    else if (text.length === 4) { fontSize = "text-[10px]"; tracking = "tracking-tighter"; }
                                    else if (text.length === 3) { fontSize = "text-[11px]"; tracking = "tracking-tight"; }

                                    return (
                                      <div
                                        key={p}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDetailModal({ isOpen: true, type: 'schedule', dateStr: dObj.dateStr, itemId: p, initialData: item });
                                        }}
                                        className={`flex-1 min-w-0 h-[22px] flex items-center justify-center border border-emerald-300 rounded-[3px] bg-emerald-50 text-emerald-700 font-bold ${fontSize} ${tracking} whitespace-nowrap overflow-hidden cursor-pointer hover:bg-emerald-200 transition-colors shadow-2xs`}
                                        title={`${text} (${p}교시)`}
                                      >
                                        {text}
                                      </div>
                                    );
                                  }
                                  return <div key={p} className="flex-1 min-w-0 h-[22px] flex items-center justify-center border border-slate-200 rounded-[3px] bg-slate-50" />;
                                })}
                              </div>
                            )}

                            {showEvents && visibleEvents.length > 0 && (
                              <div className="flex flex-col gap-1">
                                {visibleEvents.map((ev) => {
                                  // 라벨 해석은 lib/eventLabels 한 곳에서만 한다
                                  const labelDef = resolveEventLabel(ev, eventLabels);
                                  const labelName = labelDef?.name || '';
                                  const labelColor = labelDef ? getLabelColor(labelName) : null;
                                  const forwardLabel = isForwardLabel(labelDef);

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
                                      className={`group relative px-1.5 py-1 rounded-lg text-xs leading-snug transition-all border block hover:shadow-sm cursor-pointer break-words ${
                                        selectedEventIds.includes(ev.id)
                                          ? 'bg-primary/10 border-primary text-primary'
                                          : ev.completed
                                          ? 'bg-slate-50 border-slate-100 text-slate-400'
                                          : 'bg-white border-slate-200 text-slate-700 font-medium'
                                      }`}
                                      title="클릭하여 상세 보기"
                                    >
                                      {/* 💡 체크박스 삭제 및 인라인 정렬 지원 */}
                                      {isMultiSelectMode && (
                                        <input type="checkbox" checked={selectedEventIds.includes(ev.id)} readOnly className="inline-block align-middle mr-1.5 pointer-events-none" />
                                      )}
                                      {/* 라벨 칩 클릭 시 완료 토글(이월 라벨이면 이월도 정지) */}
                                      {labelColor && !isMultiSelectMode && (
                                        <span
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleToggleEvent(dObj.dateStr, ev.id);
                                          }}
                                          title={forwardLabel ? '클릭하여 완료 처리 (이월 정지)' : '클릭하여 완료 처리'}
                                          className="inline-block align-middle mr-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded shadow-2xs whitespace-nowrap cursor-pointer"
                                          style={{
                                            backgroundColor: ev.completed ? '#f1f5f9' : labelColor.bg,
                                            color: ev.completed ? '#94a3b8' : labelColor.text,
                                            border: '1px solid ' + (ev.completed ? '#e2e8f0' : labelColor.border)
                                          }}
                                        >
                                          {labelName}
                                        </span>
                                      )}
                                      <span className={`inline align-middle ${ev.completed ? 'line-through text-slate-400' : ''}`}>
                                        {eventDisplayContent(ev)}
                                      </span>
                                      
                                      {(ev.linkedItems || []).length > 0 && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openLinkViewerModal('event', dObj.dateStr, ev.id);
                                          }}
                                          className="inline-flex align-middle ml-1 bg-yellow-100 text-yellow-800 text-[10px] px-1 py-0.5 rounded font-bold border border-yellow-300 shrink-0 hover:bg-yellow-200 cursor-pointer"
                                          title={`링크된 항목 ${(ev.linkedItems || []).length}개`}
                                        >
                                          🔗 {(ev.linkedItems || []).length}
                                        </button>
                                      )}

                                      {!isMultiSelectMode && (
                                        <EventItemActions
                                          floating
                                          onEdit={() =>
                                            setDetailModal({ isOpen: true, type: 'event', dateStr: dObj.dateStr, itemId: ev.id, initialData: ev })
                                          }
                                          onDelete={() => handleDeleteEvent(dObj.dateStr, ev.id, ev)}
                                        />
                                      )}
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
                      기록된 일정이 없습니다.
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