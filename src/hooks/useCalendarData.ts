//src/hooks/useCalendarData.ts

import { useState, useEffect } from 'react';
import { doc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { parseV3EventText, formatV3EventText, type PeriodSchedule, type EventItem, runAutoForwarding } from './useDayData';

export interface DaySummary {
  eventText?: string;
  eventList?: EventItem[];
  schedules?: Record<number, PeriodSchedule>;
}

export function useCalendarData(dateStrings: string[], groupId: string | null = null) {
  const [dataMap, setDataMap] = useState<Record<string, DaySummary>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || dateStrings.length === 0) {
      setDataMap({});
      setLoading(false);
      return;
    }

    setLoading(true);

    // 💡 주간/월간/년간 데이터 조회 시 이월 로직 자동 실행
    runAutoForwarding(groupId).catch((e) => console.error('Calendar Auto-forwarding error:', e));

    const unsubs: (() => void)[] = [];
    const currentMap: Record<string, DaySummary> = {};

    dateStrings.forEach((dStr) => {
      const eventDocRef = groupId
        ? doc(db, 'groups', groupId, 'events', dStr)
        : doc(db, 'users', user.uid, 'events', dStr);
      
      const scheduleDocRef = groupId
        ? doc(db, 'groups', groupId, 'schedules', dStr)
        : doc(db, 'users', user.uid, 'schedules', dStr);

      const unsubEvent = onSnapshot(eventDocRef, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const rawText = data.eventText || '';
          let list: EventItem[] = [];
          if (Array.isArray(data.eventList) && data.eventList.length > 0) {
            list = data.eventList
              .map((e: any, idx: number) => ({
                id: e.id || 'ev_' + idx,
                content: e.content || '',
                completed: !!e.completed,
                label: e.label || undefined,
                labelIds: e.labelIds || undefined,
                linkedItems: e.linkedItems || [],
              }))
              .filter((e: EventItem) => e.content && e.content.trim().length > 0);
          } else if (rawText) {
            list = parseV3EventText(rawText).filter((e: EventItem) => e.content && e.content.trim().length > 0);
          }

          currentMap[dStr] = {
            ...currentMap[dStr],
            eventText: rawText,
            eventList: list,
          };
        } else {
          currentMap[dStr] = {
            ...currentMap[dStr],
            eventText: '',
            eventList: [],
          };
        }
        setDataMap({ ...currentMap });

        // 💡 퀵 추가 등을 통해 "과거 날짜"에 새로운 데이터가 변경된 경우 즉시 이월 로직 재실행
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (dStr < todayStr) {
          runAutoForwarding(groupId).catch(console.error);
        }

      }, (error) => {
        console.error('Calendar Event Snapshot Error:', error);
        setLoading(false);
      });

      const unsubSchedule = onSnapshot(scheduleDocRef, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
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

          currentMap[dStr] = {
            ...currentMap[dStr],
            schedules: normalized,
          };
        } else {
          currentMap[dStr] = {
            ...currentMap[dStr],
            schedules: {},
          };
        }
        setDataMap({ ...currentMap });
      }, (error) => {
        console.error('Calendar Schedule Snapshot Error:', error);
        setLoading(false);
      });

      unsubs.push(unsubEvent, unsubSchedule);
    });

    setLoading(false);

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [JSON.stringify(dateStrings), groupId, auth.currentUser?.uid]);

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
        const data = snap.data();
        let list = data.eventList || [];
        if (list.length === 0 && data.eventText) {
          list = parseV3EventText(data.eventText);
        }
        const updatedList = list.map((item: any) => item.id === eventId ? { ...item, completed: !item.completed } : item);
        const textToSave = formatV3EventText(updatedList);
        
        await setDoc(eventDocRef, {
          eventList: updatedList,
          eventText: textToSave,
          updatedAt: Date.now()
        }, { merge: true });
      }
    } catch (error) {
      console.error('Toggle Event Snapshot Error:', error);
    }
  };

  return { dataMap, loading, toggleEventItem };
}