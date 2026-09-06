import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { formatDateStr, parseDateStr } from '../../lib/dateUtils';
import { useDayData } from '../../hooks/useDayData';
import DayEvents from './DayEvents';
import DaySchedule from './DaySchedule';
import DayJournal from './DayJournal';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';

export default function DayScreen() {
  const { currentDate, setCurrentDate, selectedGroupId } = useAppStore();

  const dateStr = formatDateStr(new Date(currentDate));

  const {
    eventList,
    schedules,
    journals,
    loading,
    addEventItem,
    toggleEventItem,
    deleteEventItem,
    savePeriod,
    addJournalEntry,
    deleteJournalEntry,
    forwardIncompleteEvents,
  } = useDayData(dateStr, selectedGroupId);

  const handleDateChange = (newDateStr: string) => {
    setCurrentDate(parseDateStr(newDateStr));
  };

  return (
    <div className="animate-fade-in pb-12">
      {/* 🚀 임시 DB 진단 버튼 (테스트 완료 후 제거 예정) */}
      <div className="flex justify-center my-4">
        <button 
          onClick={async () => {
            try {
              const u = auth.currentUser;
              if(!u) { alert('로그인이 안되어 있습니다.'); return; }
              const ref = doc(db, 'users', u.uid, 'events', dateStr);
              alert(`조회 시도 중...\n경로: users/${u.uid}/events/${dateStr}`);
              const snap = await getDoc(ref);
              if(snap.exists()) {
                alert(`✅ DB 연결 정상! 데이터 있음:\n${JSON.stringify(snap.data()).slice(0, 100)}`);
              } else {
                alert(`✅ DB 연결 정상! (데이터는 없음)`);
              }
            } catch(e: any) {
              alert(`❌ DB 에러 발생!\n이름: ${e.name}\n메시지: ${e.message}\n코드: ${e.code}`);
            }
          }}
          className="bg-red-500 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-md animate-pulse"
        >
          🔍 DB 연결 진단 테스트 실행하기
        </button>
      </div>

      {/* 날짜 네비게이션 헤더 */}{loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
          <p className="text-xs text-slate-400 font-medium">데이터를 불러오는 중입니다...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 좌측 영역: 시간표 & 일지 (7열) */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            <DaySchedule schedules={schedules} onSavePeriod={savePeriod} />
            <DayJournal
              journals={journals}
              onAddJournal={addJournalEntry}
              onDeleteJournal={deleteJournalEntry}
            />
          </div>

          {/* 우측 영역: 오늘 할 일 및 일정 (5열) */}
          <div className="lg:col-span-5">
            <DayEvents
              events={eventList}
              onAddEvent={addEventItem}
              onToggleEvent={toggleEventItem}
              onDeleteEvent={deleteEventItem}
              onForwardIncomplete={forwardIncompleteEvents}
            />
          </div>
        </div>
      )}
    </div>
  );
}
