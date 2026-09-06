import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

export interface EventItem {
  id: string;
  content: string;
  completed?: boolean;
  label?: string;
}

export interface PeriodSchedule {
  subject: string;
  content: string;
}

export interface JournalEntry {
  id: string;
  content: string;
  createdAt: number;
  label?: string;
}

/**
 * V3 eventText 문자열 파서
 * [v] 또는 [V] 로 시작하면 완료 처리
 * [라벨명] 내용 형식이면 라벨 분리
 */
export function parseV3EventText(rawText: string): EventItem[] {
  if (!rawText || !rawText.trim()) return [];
  const lines = rawText.split('\n');
  const list: EventItem[] = [];

  lines.forEach((line, idx) => {
    let t = line.trim();
    if (!t) return;

    let completed = false;
    if (t.startsWith('[v]') || t.startsWith('[V]')) {
      completed = true;
      t = t.substring(3).trim();
    }

    let label = '';
    const labelMatch = t.match(/^\[(.*?)\]\s*(.*)$/);
    let content = t;
    if (labelMatch) {
      label = labelMatch[1].trim();
      content = labelMatch[2].trim();
    }

    list.push({
      id: 'ev_' + idx + '_' + Date.now(),
      content: content || t,
      completed,
      label: label || undefined,
    });
  });

  return list;
}

/**
 * V3 호환 eventText 직렬화
 */
export function formatV3EventText(items: EventItem[]): string {
  return items
    .map((item) => {
      const checkPrefix = item.completed ? '[v] ' : '';
      const labelPrefix = item.label ? `[${item.label}] ` : '';
      return `${checkPrefix}${labelPrefix}${item.content}`;
    })
    .join('\n');
}

export function useDayData(dateStr: string, groupId: string | null = null) {
  const [eventText, setEventText] = useState('');
  const [eventList, setEventList] = useState<EventItem[]>([]);
  const [schedules, setSchedules] = useState<Record<number, PeriodSchedule>>({});
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || !dateStr) {
      setEventText('');
      setEventList([]);
      setSchedules({});
      setJournals([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const eventDocRef = groupId
      ? doc(db, 'groups', groupId, 'events', dateStr)
      : doc(db, 'users', user.uid, 'events', dateStr);

    const scheduleDocRef = groupId
      ? doc(db, 'groups', groupId, 'schedules', dateStr)
      : doc(db, 'users', user.uid, 'schedules', dateStr);

    const journalDocRef = groupId
      ? doc(db, 'groups', groupId, 'journals', dateStr)
      : doc(db, 'users', user.uid, 'journals', dateStr);

    // 1. 이벤트/할일 동기화 (V3 eventList & eventText 호환)
    const unsubEvent = onSnapshot(eventDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const rawText = data.eventText || '';
        setEventText(rawText);

        if (Array.isArray(data.eventList) && data.eventList.length > 0) {
          const mapped: EventItem[] = data.eventList.map((e: any, idx: number) => ({
            id: e.id || 'ev_' + idx,
            content: e.content || '',
            completed: !!e.completed,
            label: e.label || undefined,
          }));
          setEventList(mapped);
        } else if (rawText) {
          setEventList(parseV3EventText(rawText));
        } else {
          setEventList([]);
        }
      } else {
        setEventText('');
        setEventList([]);
      }
    });

    // 2. 시간표 동기화 (V3 periods 구조 호환)
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
        setSchedules(normalized);
      } else {
        setSchedules({});
      }
    });

    // 3. 일지 동기화 (V3 entries 구조 호환)
    const unsubJournal = onSnapshot(journalDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const rawEntries = data.entries || [];
        const mapped: JournalEntry[] = rawEntries.map((j: any, idx: number) => ({
          id: j.id || 'jr_' + idx,
          content: j.content || '',
          createdAt: j.createdAt || Date.now(),
          label: j.label || (j.labelIds && j.labelIds.length > 0 ? j.labelIds[0] : '일반'),
        }));
        setJournals(mapped);
      } else {
        setJournals([]);
      }
      setLoading(false);
    });

    return () => {
      unsubEvent();
      unsubSchedule();
      unsubJournal();
    };
  }, [dateStr, groupId, auth.currentUser?.uid]);

  // 오늘 할 일 목록 저장 (V3 eventList + eventText 양방향 동시 저장)
  const saveEventItems = useCallback(async (newList: EventItem[]) => {
    const user = auth.currentUser;
    if (!user || !dateStr) return;

    const eventDocRef = groupId
      ? doc(db, 'groups', groupId, 'events', dateStr)
      : doc(db, 'users', user.uid, 'events', dateStr);

    const serializedText = formatV3EventText(newList);
    const v3EventList = newList.map(item => ({
      id: item.id,
      content: item.content,
      completed: !!item.completed,
      authorId: user.uid,
      authorName: user.displayName || '',
      label: item.label || '',
    }));

    await setDoc(eventDocRef, {
      eventText: serializedText,
      eventList: v3EventList,
      updatedAt: Date.now()
    }, { merge: true });
  }, [dateStr, groupId]);

  const addEventItem = useCallback(async (content: string) => {
    if (!content.trim()) return;
    const parsedList = parseV3EventText(content.trim());
    const parsed = parsedList.length > 0 ? parsedList[0] : null;
    const newItem: EventItem = {
      id: 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5),
      content: parsed ? parsed.content : content.trim(),
      completed: parsed ? parsed.completed : false,
      label: parsed && parsed.label ? parsed.label : undefined,
    };
    const newList = [...eventList, newItem];
    await saveEventItems(newList);
  }, [eventList, saveEventItems]);

  const toggleEventItem = useCallback(async (id: string) => {
    const newList = eventList.map(item =>
      item.id === id ? { ...item, completed: !item.completed } : item
    );
    await saveEventItems(newList);
  }, [eventList, saveEventItems]);

  const deleteEventItem = useCallback(async (id: string) => {
    const newList = eventList.filter(item => item.id !== id);
    await saveEventItems(newList);
  }, [eventList, saveEventItems]);

  // 시간표 특정 교시 저장
  const savePeriod = useCallback(async (period: number, data: PeriodSchedule) => {
    const user = auth.currentUser;
    if (!user || !dateStr) return;

    const scheduleDocRef = groupId
      ? doc(db, 'groups', groupId, 'schedules', dateStr)
      : doc(db, 'users', user.uid, 'schedules', dateStr);

    const newSchedules = {
      ...schedules,
      [period]: {
        subject: data.subject,
        content: data.content,
      }
    };
    await setDoc(scheduleDocRef, {
      periods: newSchedules,
      updatedAt: Date.now()
    }, { merge: true });
  }, [dateStr, groupId, schedules]);

  // 일지 추가/삭제
  const addJournalEntry = useCallback(async (content: string, label: string = '일반') => {
    const user = auth.currentUser;
    if (!user || !dateStr || !content.trim()) return;

    const journalDocRef = groupId
      ? doc(db, 'groups', groupId, 'journals', dateStr)
      : doc(db, 'users', user.uid, 'journals', dateStr);

    const newEntry = {
      id: 'jr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5),
      content: content.trim(),
      createdAt: Date.now(),
      label,
      authorId: user.uid,
      authorName: user.displayName || '',
    };
    const newJournals = [newEntry, ...journals];
    await setDoc(journalDocRef, {
      entries: newJournals,
      updatedAt: Date.now()
    }, { merge: true });
  }, [dateStr, groupId, journals]);

  const deleteJournalEntry = useCallback(async (id: string) => {
    const user = auth.currentUser;
    if (!user || !dateStr) return;

    const journalDocRef = groupId
      ? doc(db, 'groups', groupId, 'journals', dateStr)
      : doc(db, 'users', user.uid, 'journals', dateStr);

    const newJournals = journals.filter(j => j.id !== id);
    await setDoc(journalDocRef, {
      entries: newJournals,
      updatedAt: Date.now()
    }, { merge: true });
  }, [dateStr, groupId, journals]);

  
  // 지난 미완료 할 일 오늘로 가져오기 (Forwarding)
  const forwardIncompleteEvents = useCallback(async () => {
    const user = auth.currentUser;
    if (!user || !dateStr) return 0;

    // 지난 14일간의 날짜 조회
    const today = new Date(dateStr);
    const pastDates: string[] = [];
    for (let i = 1; i <= 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      pastDates.push(`${y}-${m}-${day}`);
    }

    // 설정된 라벨 가져오기 (forward가 true인 라벨 식별)
    const settingsRef = doc(db, 'users', user.uid, 'settings', 'labels');
    const settingsSnap = await getDoc(settingsRef);
    let forwardLabels = ['할일', '업무']; // 기본 forward 라벨명
    
    if (settingsSnap.exists() && settingsSnap.data().eventLabels) {
      const labels = settingsSnap.data().eventLabels;
      forwardLabels = labels.filter((l: any) => l.forward).map((l: any) => l.name);
    }

    const incompleteItems: EventItem[] = [];

    for (const pDate of pastDates) {
      const docRef = groupId
        ? doc(db, 'groups', groupId, 'events', pDate)
        : doc(db, 'users', user.uid, 'events', pDate);

      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        let items: EventItem[] = [];
        if (Array.isArray(data.eventList) && data.eventList.length > 0) {
          items = data.eventList;
        } else if (data.eventText) {
          items = parseV3EventText(data.eventText);
        }

        items.filter(it => !it.completed && it.content.trim() && forwardLabels.includes(it.label || '일반')).forEach(it => {
          // 중복 방지
          if (!eventList.some(e => e.content === it.content) && !incompleteItems.some(e => e.content === it.content)) {
            incompleteItems.push({
              id: 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5),
              content: it.content,
              completed: false,
              label: it.label,
            });
          }
        });
      }
    }

    if (incompleteItems.length > 0) {
      const newList = [...eventList, ...incompleteItems];
      await saveEventItems(newList);
    }

    return incompleteItems.length;
  }, [dateStr, groupId, eventList, saveEventItems]);

  // 자동 포워딩 (오늘 날짜일 때만, 한 번만 실행)
  useEffect(() => {
    if (!loading && eventList.length >= 0) {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      
      if (dateStr === todayStr && !(window as any).__sp4_forwarded) {
        (window as any).__sp4_forwarded = true;
        forwardIncompleteEvents().catch(console.error);
      }
    }
  }, [dateStr, loading, forwardIncompleteEvents]);

  return {
    eventText,
    forwardIncompleteEvents,
    eventList,
    schedules,
    journals,
    loading,
    addEventItem,
    toggleEventItem,
    deleteEventItem,
    savePeriod,
    addJournalEntry,
    deleteJournalEntry,
  };
}
