// src/hooks/useDayEvalCounts.ts
//
// 하루 화면에서 교시마다 조사표가 몇 건 달려 있는지 센다.
//
// 조사표 단추는 마우스를 올려야 나타나고 모양도 늘 같아서, 조사표를 만들어 둔
// 교시인지 아닌지 알 수가 없었다. 개수만 있으면 되므로 내용은 읽지 않는다.
import { useState, useEffect } from 'react';
import { doc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { subscribeDocWithServerFallback } from '../lib/firestoreSubscribe';

export interface DayEvalCounts {
  /** 교시 번호 → 조사표 건수. 기록(일지)에 달린 것은 'journal'에 모은다. */
  byPeriod: Record<string, number>;
  total: number;
}

const EMPTY: DayEvalCounts = { byPeriod: {}, total: 0 };

export function useDayEvalCounts(dateStr: string, groupId: string | null = null): DayEvalCounts {
  const [counts, setCounts] = useState<DayEvalCounts>(EMPTY);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || !dateStr) {
      setCounts(EMPTY);
      return;
    }

    const ref = groupId
      ? doc(db, 'groups', groupId, 'evaluations', dateStr)
      : doc(db, 'users', user.uid, 'evaluations', dateStr);

    const unsubscribe = subscribeDocWithServerFallback(ref, (data) => {
      // V3는 evalList, V4는 list라는 이름으로 같은 목록을 담는다
      const list = (data?.list || data?.evalList || []) as any[];
      const byPeriod: Record<string, number> = {};
      let total = 0;

      for (const ev of list) {
        if (!ev || !ev.id) continue;
        const period = ev.context?.period ?? ev.periodStr;
        const key = period === '' || period === undefined || period === null ? 'journal' : String(period);
        byPeriod[key] = (byPeriod[key] || 0) + 1;
        total++;
      }

      setCounts({ byPeriod, total });
    });

    return () => unsubscribe();
  }, [dateStr, groupId, auth.currentUser?.uid]);

  return counts;
}
