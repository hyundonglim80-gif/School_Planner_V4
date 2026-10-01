// src/hooks/usePeriodTimes.ts
//
// 교시 시각을 읽고 쓴다 (lib/periodTimes, docs/ROADMAP.md 2-2).
// users/{uid}/settings/v4_periodTimes - V4 전용. 시간표(timetable_v5)는 V3와 함께 쓰므로 건드리지 않는다.
import { useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { subscribeDocWithServerFallback } from '../lib/firestoreSubscribe';
import { toMinutes, fromMinutes, type PeriodTimes } from '../lib/periodTimes';

const EMPTY: PeriodTimes = {};
const timesRef = (uid: string) => doc(db, 'users', uid, 'settings', 'v4_periodTimes');

/** 저장된 모양을 믿지 않고 고쳐 읽는다 (시각을 알아볼 수 없는 칸은 빈칸) */
function sanitize(raw: unknown): PeriodTimes {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const out: PeriodTimes = {};
  for (const [key, v] of Object.entries(raw as Record<string, any>)) {
    if (!/^\d+$/.test(key)) continue;
    const s = toMinutes(v?.start);
    const e = toMinutes(v?.end);
    if (s === null && e === null) continue;
    out[key] = { start: s === null ? '' : fromMinutes(s), end: e === null ? '' : fromMinutes(e) };
  }
  return out;
}

/** 교시 시각. loaded는 서버(또는 캐시)에서 한 번이라도 답을 받았는가 - 받기 전에는 저장을 막는다 */
export function usePeriodTimes(): { times: PeriodTimes; loaded: boolean } {
  const [state, setState] = useState<{ times: PeriodTimes; loaded: boolean }>({ times: EMPTY, loaded: false });
  const uid = auth.currentUser?.uid;
  useEffect(() => {
    // 로그아웃하면 앱이 이 화면들을 내리므로 따로 비우지 않는다
    if (!uid) return;
    return subscribeDocWithServerFallback(
      timesRef(uid),
      (data) => setState({ times: sanitize(data?.times), loaded: true }),
      (err) => console.warn('교시 시각을 불러오지 못했습니다:', err)
    );
  }, [uid]);
  return state;
}

/** 교시 시각을 통째로 쓴다 (교시 수가 줄어 남은 칸도 지운다). 실패하면 던진다. */
export async function savePeriodTimes(times: PeriodTimes): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요합니다.');
  // merge 없이 times를 통째로 - 지운 교시의 시각이 남지 않게. 이 문서에는 다른 칸이 없다.
  await setDoc(timesRef(uid), { times: sanitize(times), updatedAt: Date.now() });
}
