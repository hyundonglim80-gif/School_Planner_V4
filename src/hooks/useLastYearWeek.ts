// src/hooks/useLastYearWeek.ts
//
// 작년 이맘때 (docs/ROADMAP.md 7) - 작년 같은 주의 일정·기록을 읽는다. 보기만 하므로 구독하지 않고
// 켤 때·주를 넘길 때 서버에서 한 번 읽는다(범위 쿼리 두 개). 서버가 답하지 않으면 '못 읽음'으로 둔다 -
// 캐시의 '없다'를 믿고 빈 날로 보이면 작년에 아무것도 없던 것처럼 보인다(ARCHITECTURE 4-2).
import { useEffect, useState } from 'react';
import { collection, documentId, getDocsFromServer, query, where } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { readEventList, eventContentOf } from '../lib/eventText';
import { readJournalEntries } from '../lib/journalEntries';
import { splitHolidayEvents } from '../lib/holiday';
import type { EventItem, JournalEntry } from './useDayData';

export interface LastYearDay {
  events: EventItem[];
  journals: JournalEntry[];
}

/** 보일 만한 기록인가 (글·표·첨부 중 하나라도) - 달력의 기록 수 세기와 같다 */
const hasJournalBody = (j: any) =>
  (j?.content && String(j.content).trim().length > 0) ||
  (Array.isArray(j?.tables) && j.tables.length > 0) ||
  j?.imageUrl ||
  (Array.isArray(j?.attachments) && j.attachments.length > 0);

export function useLastYearWeek(dates: string[], groupId: string | null, enabled: boolean) {
  const key = JSON.stringify([dates, groupId]);
  const [state, setState] = useState<{ key: string; byDate: Record<string, LastYearDay>; error: boolean } | null>(null);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!enabled || !uid || dates.length === 0) return;
    let cancelled = false;
    const sorted = [...dates].sort();
    const wanted = new Set(dates);
    const range = (name: string) =>
      query(
        groupId ? collection(db, 'groups', groupId, name) : collection(db, 'users', uid, name),
        where(documentId(), '>=', sorted[0]),
        where(documentId(), '<=', sorted[sorted.length - 1])
      );
    Promise.all([getDocsFromServer(range('events')), getDocsFromServer(range('journals'))])
      .then(([events, journals]) => {
        if (cancelled) return;
        const byDate: Record<string, LastYearDay> = {};
        const day = (d: string) => (byDate[d] ||= { events: [], journals: [] });
        events.forEach((snap) => {
          if (!wanted.has(snap.id)) return;
          // 공휴일 일정(옛 방식)은 빼고, 글이 있는 일정만
          const { events: list } = splitHolidayEvents(readEventList(snap.data()) as any[]);
          day(snap.id).events = list.filter((e: any) => eventContentOf(e).trim().length > 0) as EventItem[];
        });
        journals.forEach((snap) => {
          if (!wanted.has(snap.id)) return;
          day(snap.id).journals = readJournalEntries(snap.data()).filter(hasJournalBody) as JournalEntry[];
        });
        setState({ key, byDate, error: false });
      })
      .catch((e) => {
        console.warn('작년 이맘때를 읽지 못했습니다:', e);
        if (!cancelled) setState({ key, byDate: {}, error: true });
      });
    return () => {
      cancelled = true;
    };
    // key가 dates·groupId를 담는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  const ready = enabled && state?.key === key;
  return {
    byDate: ready ? state!.byDate : ({} as Record<string, LastYearDay>),
    loading: enabled && !ready,
    error: ready && state!.error,
  };
}
