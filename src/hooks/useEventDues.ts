// src/hooks/useEventDues.ts
//
// 그 공간의 이월 사슬 기한(lib/eventDueStore)을 구독한다 (ROADMAP 11-2). 일정 칸의 due가 먼저고, 이것은 V3가 이월하며
// due를 빼먹은 일정을 위한 것이다 - lib/eventDue.dueOf(일정, 이 맵).
import { useEffect, useState } from 'react';
import { auth } from '../lib/firebase';
import { subscribeEventDues } from '../lib/eventDueStore';
import type { DueMap } from '../lib/eventDue';

export function useEventDues(groupId: string | null): DueMap {
  const uid = auth.currentUser?.uid;
  const [map, setMap] = useState<DueMap>({});
  useEffect(() => {
    setMap({});
    if (!uid) return;
    return subscribeEventDues(uid, groupId, setMap, (err) => console.warn('기한을 불러오지 못했습니다:', err));
  }, [uid, groupId]);
  return map;
}
