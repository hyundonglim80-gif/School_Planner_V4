import React, { useEffect } from 'react';
import Layout from './components/Layout';
import LoginScreen from './features/auth/LoginScreen';
import DayScreen from './features/day/DayScreen';
import WeekScreen from './features/week/WeekScreen';
import MonthScreen from './features/month/MonthScreen';
import YearScreen from './features/year/YearScreen';
import MemoScreen from './features/memo/MemoScreen';
import { useAuth } from './features/auth/useAuth';
import { useAppStore } from './store/useAppStore';
import { db } from './lib/firebase';
import { runAutoForwarding } from './hooks/useDayData';
import { startPersistenceWatchdog } from './lib/firestoreRecovery';
import { useEventAlarms } from './hooks/useEventAlarms';
import { useLabels } from './hooks/useLabels';
import EventAlarmPopup from './components/EventAlarmPopup';
import AccountMismatchBanner from './components/AccountMismatchBanner';

function App() {
  const { user, loading } = useAuth();
  const { scope, selectedGroupId } = useAppStore();
  const { ringingAlarms, dismissAlarms } = useEventAlarms();
  // 라벨을 아직 못 읽었으면 이월은 판단을 미루고 건너뛴다. 그러니 라벨이 읽힌
  // 순간 한 번 더 불러 줘야 한다. 그러지 않으면 그날은 영영 이월되지 않는다.
  const { labelsLoaded } = useLabels();

  // 💡 추가된 부분: 앱 구동 시 전역으로 이월 실행 (주간, 월간, 년간 화면 등 전체 반영)
  useEffect(() => {
    if (user) {
      // ⚠️ 여기서 '제대로 돌고 있다'고 단정하면 안 된다. 로그인이 됐다는 것과
      //    Firestore가 답을 준다는 것은 다른 이야기다. 캐시가 반쯤 지워진 채
      //    남으면 로그인은 되는데 구독이 한 번도 안 불린다. 그래서 답이 오는지를
      //    지켜보고, 한참을 안 오면 캐시를 비우고 다시 시작한다.
      startPersistenceWatchdog(db);
      runAutoForwarding(selectedGroupId).catch(console.error);
    }
  }, [user, selectedGroupId, labelsLoaded]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-body">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
          <p className="text-xs text-slate-400 font-medium"> ...</p>
        </div>
      </div>
    );
  }
  if (!user) {
    return <LoginScreen />;
  }
  return (
    <>
      {/* V3와 다른 계정으로 들어와 있으면, 빈 화면을 보여 주기 전에 먼저 말해 준다 */}
      <AccountMismatchBanner />
      <Layout>
        {scope === 'day' && <DayScreen />}
        {scope === 'week' && <WeekScreen />}
        {scope === 'month' && <MonthScreen />}
        {scope === 'year' && <YearScreen />}
        {scope === 'memo' && <MemoScreen />}
      </Layout>
      <EventAlarmPopup alarms={ringingAlarms} onDismiss={dismissAlarms} />
    </>
  );
}

export default App;