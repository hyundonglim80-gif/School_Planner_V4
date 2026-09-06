import React from 'react';
import Layout from './components/Layout';
import LoginScreen from './features/auth/LoginScreen';
import DayScreen from './features/day/DayScreen';
import WeekScreen from './features/week/WeekScreen';
import MonthScreen from './features/month/MonthScreen';
import YearScreen from './features/year/YearScreen';
import MemoScreen from './features/memo/MemoScreen';
import { useAuth } from './features/auth/useAuth';
import { useAppStore } from './store/useAppStore';

function App() {
  const { user, loading } = useAuth();
  const { scope } = useAppStore();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-body">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
          <p className="text-xs text-slate-400 font-medium">로그인 상태 확인 중...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <Layout>
      {scope === 'day' && <DayScreen />}
      {scope === 'week' && <WeekScreen />}
      {scope === 'month' && <MonthScreen />}
      {scope === 'year' && <YearScreen />}
      {scope === 'memo' && <MemoScreen />}
    </Layout>
  );
}

export default App;
