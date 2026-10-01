// src/hooks/useClock.ts
//
// 화면에 '지금'을 보여 줄 때 쓰는 시계. enabled일 때만 intervalMs마다 다시 그린다
// (지금 몇 교시 - 오늘을 볼 때만 돌고, 다른 날을 볼 때는 돌지 않는다).
import { useEffect, useState } from 'react';

export function useClock(enabled: boolean, intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs]);
  return now;
}
