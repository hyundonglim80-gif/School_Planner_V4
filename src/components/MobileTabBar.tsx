// src/components/MobileTabBar.tsx
// 휴대폰 세로 화면에서 화면 전환(하루/주간/월간/년간/메모)을 아래쪽으로 내린다.
// 세로로 긴 화면에서는 상단 탭이 엄지에서 가장 먼 자리라, 폭도 아끼고 누르기도 쉬워진다.
import React from 'react';
import { useAppStore } from '../store/useAppStore';

const TABS = [
  { id: 'day', label: '하루', icon: '📋' },
  { id: 'week', label: '주간', icon: '🗓️' },
  { id: 'month', label: '월간', icon: '📅' },
  { id: 'year', label: '년간', icon: '📊' },
  { id: 'memo', label: '메모', icon: '📝' },
] as const;

export default function MobileTabBar() {
  const { scope, setScope } = useAppStore();

  return (
    <nav
      className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-sm border-t border-border shadow-[0_-1px_3px_rgba(0,0,0,0.04)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch">
        {TABS.map((tab) => {
          const isActive = scope === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setScope(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
                isActive ? 'text-primary' : 'text-slate-400'
              }`}
            >
              <span className={`text-lg leading-none ${isActive ? '' : 'opacity-60 grayscale'}`}>
                {tab.icon}
              </span>
              <span className="text-[11px] font-bold leading-none">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
