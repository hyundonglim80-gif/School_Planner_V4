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
import { runAutoForwarding } from './hooks/useDayData';
import { useEventAlarms } from './hooks/useEventAlarms';
import EventAlarmPopup from './components/EventAlarmPopup';

function App() {
  const { user, loading } = useAuth();
  const { scope, selectedGroupId } = useAppStore();
  const { ringingAlarms, dismissAlarms } = useEventAlarms();

  // 💡 추가된 부분: 앱 구동 시 전역으로 이월 실행 (주간, 월간, 년간 화면 등 전체 반영)
  useEffect(() => {
    if (user) {
      runAutoForwarding(selectedGroupId).catch(console.error);
    }
  }, [user, selectedGroupId]);

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