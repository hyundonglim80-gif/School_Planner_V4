//src/hooks/useCalendarData.ts

import { useState, useEffect } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  getDoc,
  setDoc,
  query,
  where,
  documentId,
  getDocsFromServer,
  type QuerySnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { markFirestoreAlive } from '../lib/firestoreRecovery';
import { type PeriodSchedule, type EventItem, runAutoForwarding } from './useDayData';
import { eventDocPayload, readEventList } from '../lib/eventText';
import { showErrorToast, showToast } from '../utils/toast';
import { moveToTrash } from '../utils/trashHelper';

export interface DaySummary {
  eventText?: string;
  eventList?: EventItem[];
  schedules?: Record<number, PeriodSchedule>;
}

// 캐시만 보고 있을 때 서버에 다시 물어보기까지 기다리는 시간.
// 이 사이에 서버 스냅샷이 도착하면 추가 조회를 하지 않는다.
const SERVER_RECHECK_DELAY_MS = 2000;

function mapEvents(data: DocumentData): EventItem[] {
  return readEventList(data)
    .map((e: any, idx: number) => ({
      id: e.id || 'ev_' + idx,
      content: e.content || e.text || '',
      completed: !!e.completed,
      label: e.label || undefined,
      labelIds: e.labelIds || undefined,
      linkedItems: e.linkedItems || [],
      attachments: e.attachments || [],
    }))
    .filter((e: EventItem) => e.content && e.content.trim().length > 0);
}

function mapPeriods(data: DocumentData): Record<number, PeriodSchedule> {
  const rawPeriods = data.periods || {};
  const normalized: Record<number, PeriodSchedule> = {};
  for (const p in rawPeriods) {
    const val = rawPeriods[p];
    if (typeof val === 'string') {
      normalized[Number(p)] = { subject: val, content: '' };
    } else if (val && typeof val === 'object') {
      normalized[Number(p)] = {
        subject: val.subject || '',
        content: val.content || '',
        linkedItems: val.linkedItems || [],
      };
    }
  }
  return normalized;
}

export function useCalendarData(dateStrings: string[], groupId: string | null = null) {
  const [dataMap, setDataMap] = useState<Record<string, DaySummary>>({});
  const [loading, setLoading] = useState(true);

  const dateKey = JSON.stringify(dateStrings);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || dateStrings.length === 0) {
      setDataMap({});
      setLoading(false);
      return;
    }

    setLoading(true);

    // 💡 주간/월간 데이터 조회 시 이월 로직 실행. runAutoForwarding 자체에
    // 중복 실행 방지 가드가 있어 여러 화면에서 불러도 한 번만 돈다.
    runAutoForwarding(groupId).catch((e) => console.error('Calendar Auto-forwarding error:', e));

    // 💡 예전에는 날짜마다 리스너를 2개씩 붙여 월간 화면에서 84개를 구독했다.
    // 문서 ID가 곧 날짜이므로 범위 쿼리 2개로 같은 일을 할 수 있다.
    const sorted = [...dateStrings].sort();
    const startStr = sorted[0];
    const endStr = sorted[sorted.length - 1];
    const wanted = new Set(dateStrings);

    const eventsCol = groupId
      ? collection(db, 'groups', groupId, 'events')
      : collection(db, 'users', user.uid, 'events');
    const schedulesCol = groupId
      ? collection(db, 'groups', groupId, 'schedules')
      : collection(db, 'users', user.uid, 'schedules');

    const eventsQuery = query(
      eventsCol,
      where(documentId(), '>=', startStr),
      where(documentId(), '<=', endStr)
    );
    const schedulesQuery = query(
      schedulesCol,
      where(documentId(), '>=', startStr),
      where(documentId(), '<=', endStr)
    );

    let cancelled = false;
    let eventsByDate: Record<string, { text: string; list: EventItem[] }> = {};
    let periodsByDate: Record<string, Record<number, PeriodSchedule>> = {};
    let eventsReady = false;
    let schedulesReady = false;

    const rebuild = () => {
      if (cancelled) return;
      const next: Record<string, DaySummary> = {};
      for (const dStr of dateStrings) {
        next[dStr] = {
          eventText: eventsByDate[dStr]?.text ?? '',
          eventList: eventsByDate[dStr]?.list ?? [],
          schedules: periodsByDate[dStr] ?? {},
        };
      }
      setDataMap(next);
      if (eventsReady && schedulesReady) setLoading(false);
    };

    const applyEvents = (snap: QuerySnapshot<DocumentData>) => {
      const next: typeof eventsByDate = {};
      snap.forEach((d) => {
        if (!wanted.has(d.id)) return;
        const data = d.data();
        next[d.id] = { text: data.eventText || '', list: mapEvents(data) };
      });
      eventsByDate = next;
      eventsReady = true;
      rebuild();
    };

    const applySchedules = (snap: QuerySnapshot<DocumentData>) => {
      const next: typeof periodsByDate = {};
      snap.forEach((d) => {
        if (!wanted.has(d.id)) return;
        next[d.id] = mapPeriods(d.data());
      });
      periodsByDate = next;
      schedulesReady = true;
      rebuild();
    };

    // 💡 오프라인 캐시가 비어 있으면 서버에 실제로 있는 일정이 통째로 가려져
    // 달력이 텅 빈 것처럼 보인다(일간 화면에서 실제로 겪은 문제).
    // 캐시 결과만 받은 채 잠시 지나면 서버에 직접 한 번 물어본다.
    let recheckTimer: ReturnType<typeof setTimeout> | null = null;
    let recheckDone = false;

    const scheduleServerRecheck = () => {
      if (recheckDone || recheckTimer) return;
      recheckTimer = setTimeout(() => {
        recheckTimer = null;
        if (cancelled || recheckDone) return;
        recheckDone = true;
        Promise.all([getDocsFromServer(eventsQuery), getDocsFromServer(schedulesQuery)])
          .then(([evSnap, scSnap]) => {
            if (cancelled) return;
            applyEvents(evSnap);
            applySchedules(scSnap);
          })
          .catch(() => {
            /* 오프라인 등 - 캐시 결과를 그대로 유지한다 */
          });
      }, SERVER_RECHECK_DELAY_MS);
    };

    const cancelServerRecheck = () => {
      recheckDone = true;
      if (recheckTimer) {
        clearTimeout(recheckTimer);
        recheckTimer = null;
      }
    };

    const unsubEvents = onSnapshot(
      eventsQuery,
      (snap) => {
        markFirestoreAlive();
        applyEvents(snap);
        // ⚠️ 캐시에서 온 것이 아니어도, 비어 있으면 한 번은 서버에 확인한다.
        //    사이트 데이터를 지운 직후에는 서버에 있는 날짜가 통째로 비어
        //    오는 일이 있었다. 그러면 그 날의 일정이 화면에서 사라진다.
        if (snap.metadata.fromCache || snap.empty) scheduleServerRecheck();
        else cancelServerRecheck();

        // 과거 날짜 데이터가 바뀌었으면 이월 로직을 다시 돌린다.
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const pastChanged = snap
          .docChanges()
          .some((c) => c.doc.id < todayStr);
        if (pastChanged) runAutoForwarding(groupId).catch(console.error);
      },
      (error) => {
        console.error('Calendar Event Snapshot Error:', error);
        eventsReady = true;
        rebuild();
      }
    );

    const unsubSchedules = onSnapshot(
      schedulesQuery,
      (snap) => {
        markFirestoreAlive();
        applySchedules(snap);
        if (snap.metadata.fromCache || snap.empty) scheduleServerRecheck();
      },
      (error) => {
        console.error('Calendar Schedule Snapshot Error:', error);
        schedulesReady = true;
        rebuild();
      }
    );

    // 리스너가 아무 응답도 주지 않는 경우를 대비한 안전장치
    const loadingFallback = setTimeout(() => setLoading(false), 3000);

    return () => {
      cancelled = true;
      if (recheckTimer) clearTimeout(recheckTimer);
      clearTimeout(loadingFallback);
      unsubEvents();
      unsubSchedules();
    };
  }, [dateKey, groupId, auth.currentUser?.uid]);

  // 💡 달력형 뷰에서 즉시 완료 상태를 토글하는 헬퍼 함수
  const toggleEventItem = async (dateStr: string, eventId: string) => {
    const user = auth.currentUser;
    if (!user) return;
    const eventDocRef = groupId
      ? doc(db, 'groups', groupId, 'events', dateStr)
      : doc(db, 'users', user.uid, 'events', dateStr);

    try {
      const snap = await getDoc(eventDocRef);
      if (snap.exists()) {
        const list = readEventList(snap.data());
        const updatedList = list.map((item: any) =>
          item.id === eventId ? { ...item, completed: !item.completed } : item
        );
        await setDoc(eventDocRef, eventDocPayload(updatedList), { merge: true });
      }
    } catch (error) {
      showErrorToast('완료 표시를 저장하지 못했습니다.', error);
    }
  };

  // 달력형 뷰(주간/월간)에서 일정 하나를 지운다. 그 날짜의 useDayData를 쓰지 않는
  // 화면이라, 문서를 직접 읽어 해당 항목만 빼고 다시 쓴다.
  const deleteEventItem = async (dateStr: string, eventId: string, fallbackItem?: Partial<EventItem>) => {
    const user = auth.currentUser;
    if (!user) return;
    const eventDocRef = groupId
      ? doc(db, 'groups', groupId, 'events', dateStr)
      : doc(db, 'users', user.uid, 'events', dateStr);

    try {
      const snap = await getDoc(eventDocRef);
      const list = snap.exists() ? readEventList(snap.data()) : [];
      const removed = list.find((item: any) => String(item.id) === String(eventId)) || fallbackItem;
      const kept = list.filter((item: any) => String(item.id) !== String(eventId));
      await setDoc(eventDocRef, eventDocPayload(kept), { merge: true });

      if (removed) {
        try {
          await moveToTrash({
            id: String(eventId),
            type: 'event',
            originalDateStr: dateStr,
            fId: groupId || 'personal',
            content: (removed as any).content || '',
            data: removed,
          });
        } catch (err) {
          console.error('Failed to move to trash:', err);
        }
      }
      showToast('🗑️ 일정을 삭제했습니다. 휴지통에서 복원할 수 있습니다.');
    } catch (error) {
      showErrorToast('일정을 삭제하지 못했습니다.', error);
    }
  };

  return { dataMap, loading, toggleEventItem, deleteEventItem };
}
