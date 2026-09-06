import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { parseV3EventText, type PeriodSchedule, type EventItem } from './useDayData';

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

  return { dataMap, loading };
}
