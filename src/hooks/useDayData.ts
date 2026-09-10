//src/hooks/useDayData.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { addReverseLink } from '../utils/linkUtils';
import { moveToTrash } from '../utils/trashHelper';
import { DEFAULT_EVENT_LABELS } from './useLabels'; // 💡 기본 라벨 임포트

export interface Attachment {
  id?: string;
  name: string;
  url: string;
  type: string;
  size?: number;
}

export interface EventItem {
  id: string;
  content: string;
  completed?: boolean;
  label?: string;
  labelIds?: string[];
  linkedItems?: any[];
  imageUrl?: string;
  attachments?: Attachment[];
}

export interface PeriodSchedule {
  subject: string;
  content: string;
  memo?: string;
  supplies?: string;
  linkedItems?: any[];
  imageUrl?: string;
  attachments?: Attachment[];
}

export interface JournalEntry {
  id: string;
  content: string;
  createdAt: number;
  label?: string;
  labelIds?: string[];
  linkedItems?: any[];
  imageUrl?: string;
  attachments?: Attachment[];
}

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

    const contentStr = content || t;
    const contentHash = Math.abs(contentStr.split('').reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0)).toString(36);
    list.push({
      id: 'ev_t_' + idx + '_' + contentHash,
      content: contentStr,
      completed,
      label: label || undefined,
    });
  });

  return list;
}

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

    const fallbackTimeout = setTimeout(() => {
      setLoading(false);
    }, 3000);

    const eventDocRef = groupId
      ? doc(db, 'groups', groupId, 'events', dateStr)
      : doc(db, 'users', user.uid, 'events', dateStr);

    const scheduleDocRef = groupId
      ? doc(db, 'groups', groupId, 'schedules', dateStr)
      : doc(db, 'users', user.uid, 'schedules', dateStr);

    const journalDocRef = groupId
      ? doc(db, 'groups', groupId, 'journals', dateStr)
      : doc(db, 'users', user.uid, 'journals', dateStr);

    const unsubEvent = onSnapshot(eventDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const rawText = data.eventText || '';
        setEventText(rawText);

        if (Array.isArray(data.eventList) && data.eventList.length > 0) {
          const mapped: EventItem[] = data.eventList.map((e: any, idx: number) => {
            let label = e.label || (e.labels && e.labels[0]);
            let content = e.content || '';
            const match = content.match(/^\[(.*?)\]\s*(.*)$/);
            if (match) {
              if (!label) label = match[1].trim();
              content = match[2].trim();
            }
            return {
              id: e.id || 'ev_' + idx,
              content: content,
              completed: !!e.completed,
              label: label || undefined,
              labelIds: e.labelIds,
              linkedItems: e.linkedItems || [],
            };
          }).filter((e: EventItem) => 
            (e.content && e.content.trim().length > 0) || 
            e.label || 
            (e.labelIds && e.labelIds.length > 0) ||
            (e.attachments && e.attachments.length > 0) ||
            (e.linkedItems && e.linkedItems.length > 0)
          );
          setEventList(mapped);
        } else if (rawText) {
          setEventList(parseV3EventText(rawText).filter((e: EventItem) => 
            (e.content && e.content.trim().length > 0) || e.label
          ));
        } else {
          setEventList([]);
        }
      } else {
        setEventText('');
        setEventList([]);
      }
    }, (error) => {
      console.error('DayScreen Event Snapshot Error:', error);
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
              memo: val.memo || '',
              supplies: val.supplies || '',
              linkedItems: val.linkedItems || [],
            };
          }
        }
        setSchedules(normalized);
      } else {
        setSchedules({});
      }
    }, (error) => {
      console.error('DayScreen Schedule Snapshot Error:', error);
      setLoading(false);
    });

    const unsubJournal = onSnapshot(journalDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const rawEntries = data.entries || [];
        const mapped: JournalEntry[] = rawEntries.map((j: any, idx: number) => ({
          id: j.id || 'jr_' + idx,
          content: j.content || '',
          createdAt: j.createdAt || Date.now(),
          label: j.label || (j.labelIds && j.labelIds.length > 0 ? j.labelIds[0] : '일반'),
          labelIds: j.labelIds || [],
          linkedItems: j.linkedItems || [],
          imageUrl: j.imageUrl || '',
        })).filter((j: JournalEntry) => 
          (j.content && j.content.trim().length > 0) || 
          !!j.imageUrl ||
          j.label ||
          (j.labelIds && j.labelIds.length > 0) ||
          (j.attachments && j.attachments.length > 0) ||
          (j.linkedItems && j.linkedItems.length > 0)
        );
        setJournals(mapped);
      } else {
        setJournals([]);
      }
      setLoading(false);
    }, (error) => {
      console.error('DayScreen Journal Snapshot Error:', error);
      setLoading(false);
    });

    return () => {
      clearTimeout(fallbackTimeout);
      unsubEvent();
      unsubSchedule();
      unsubJournal();
    };
  }, [dateStr, groupId, auth.currentUser?.uid]);

  const saveEventItems = useCallback(async (newList: EventItem[]) => {
    const user = auth.currentUser;
    if (!user || !dateStr) return;

    const eventDocRef = groupId
      ? doc(db, 'groups', groupId, 'events', dateStr)
      : doc(db, 'users', user.uid, 'events', dateStr);

    const validList = newList.filter((item) => 
      (item.content && item.content.trim().length > 0) || 
      item.label || 
      (item.labelIds && item.labelIds.length > 0) ||
      (item.attachments && item.attachments.length > 0) ||
      (item.linkedItems && item.linkedItems.length > 0)
    );
    const textToSave = formatV3EventText(validList);
    const v3EventList = validList.map(item => ({
      id: item.id,
      content: item.content,
      completed: !!item.completed,
      authorId: user.uid,
      authorName: user.displayName || '',
      label: item.label || '',
      labelIds: item.labelIds || [],
      linkedItems: item.linkedItems || [],
    }));

    await setDoc(eventDocRef, {
      eventText: textToSave,
      eventList: v3EventList,
      updatedAt: Date.now()
    }, { merge: true });
  }, [dateStr, groupId]);

  const addEventItem = useCallback(async (content: string, options?: Partial<EventItem>) => {
    if (!content.trim()) return;
    const parsedList = parseV3EventText(content.trim());
    const parsed = parsedList.length > 0 ? parsedList[0] : null;
    const newId = 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5);
    
    const newItem: EventItem = {
      id: newId,
      content: parsed ? parsed.content : content.trim(),
      completed: parsed ? parsed.completed : false,
      
      // 수정된 부분: options.label을 먼저 확인하고, 없으면 파싱된 라벨을 적용합니다.
      label: options?.label || (parsed && parsed.label ? parsed.label : undefined),
      labelIds: options?.labelIds || (parsed && parsed.label ? [] : undefined),
      
      linkedItems: options?.linkedItems || [],
      attachments: options?.attachments || [],
    };
    
    const validList = [...eventList, newItem].filter((item) => 
      (item.content && item.content.trim().length > 0) || 
      item.label || 
      (item.labelIds && item.labelIds.length > 0) ||
      (item.attachments && item.attachments.length > 0) ||
      (item.linkedItems && item.linkedItems.length > 0)
    );
    await saveEventItems(validList);

    if (newItem.linkedItems && newItem.linkedItems.length > 0) {
      const sourceMeta = {
        targetType: 'event',
        targetId: newId,
        targetDate: dateStr || '',
        targetPeriod: undefined,
        title: `[${dateStr || '메모'}] 일정`,
        targetFId: groupId || 'personal',
      };
      for (const link of newItem.linkedItems) {
        await addReverseLink(link, sourceMeta as any, groupId || 'personal');
      }
    }
  }, [eventList, saveEventItems, dateStr, groupId]);

  const toggleEventItem = useCallback(async (id: string) => {
    const newList = eventList.map(item =>
      item.id === id ? { ...item, completed: !item.completed } : item
    );
    await saveEventItems(newList);
  }, [eventList, saveEventItems]);

  const deleteEventItem = useCallback(async (id: string, fallbackItem?: Partial<EventItem>) => {
    const user = auth.currentUser;
    if (!user || !dateStr) return;

    const eventDocRef = groupId
      ? doc(db, 'groups', groupId, 'events', dateStr)
      : doc(db, 'users', user.uid, 'events', dateStr);

    let currentList = [...eventList];

    if (currentList.length === 0) {
      try {
        const snap = await getDoc(eventDocRef);
        if (snap.exists()) {
          const data = snap.data();
          if (Array.isArray(data.eventList) && data.eventList.length > 0) {
            currentList = data.eventList.map((e: any, idx: number) => ({
              id: String(e.id || 'ev_' + idx),
              content: e.content || '',
              completed: !!e.completed,
              label: e.label || undefined,
              labelIds: e.labelIds,
              linkedItems: e.linkedItems || [],
            }));
          } else if (data.eventText) {
            currentList = parseV3EventText(data.eventText);
          }
        }
      } catch (e) {
        console.warn('Failed to fetch remote event list for deletion:', e);
      }
    }

    let itemToDelete = currentList.find(item => String(item.id) === String(id));

    if (!itemToDelete && fallbackItem && fallbackItem.content) {
      itemToDelete = {
        id: String(id),
        content: fallbackItem.content,
        completed: !!fallbackItem.completed,
        label: fallbackItem.label,
        labelIds: fallbackItem.labelIds,
        linkedItems: fallbackItem.linkedItems,
      };
    }

    if (itemToDelete) {
      try {
        await moveToTrash({
          id: String(itemToDelete.id),
          type: 'event',
          originalDateStr: dateStr,
          fId: groupId || 'personal',
          content: itemToDelete.content,
          data: itemToDelete
        });
      } catch (err) {
        console.error('Failed to move to trash:', err);
      }
    }

    const newList = currentList.filter(item => String(item.id) !== String(id));
    await saveEventItems(newList);
  }, [eventList, saveEventItems, dateStr, groupId]);

  const updateEventItem = useCallback(async (id: string, updates: Partial<EventItem>) => {
    const newList = eventList
      .map(item => item.id === id ? { ...item, ...updates } : item)
      .filter((item) => 
        (item.content && item.content.trim().length > 0) || 
        item.label || 
        (item.labelIds && item.labelIds.length > 0) ||
        (item.attachments && item.attachments.length > 0) ||
        (item.linkedItems && item.linkedItems.length > 0)
      );
    
    const itemStillExists = newList.some(item => item.id === id);
    if (!itemStillExists) {
      await deleteEventItem(id);
      return;
    }

    await saveEventItems(newList);
  }, [eventList, saveEventItems, deleteEventItem]);

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
        memo: data.memo || '',
        supplies: data.supplies || '',
        linkedItems: data.linkedItems || [],
      }
    };
    await setDoc(scheduleDocRef, {
      periods: newSchedules,
      updatedAt: Date.now()
    }, { merge: true });
  }, [dateStr, groupId, schedules]);

  const reorderPeriods = useCallback(async (sourcePeriod: number, targetPeriod: number, maxPeriods: number = 6) => {
    const user = auth.currentUser;
    if (!user || !dateStr || sourcePeriod === targetPeriod) return;
    const scheduleDocRef = groupId
      ? doc(db, 'groups', groupId, 'schedules', dateStr)
      : doc(db, 'users', user.uid, 'schedules', dateStr);
    const newSchedules = { ...schedules };
    const sourceData = newSchedules[sourcePeriod] ? { ...newSchedules[sourcePeriod] } : null;

    const emptyPeriod = { subject: '', content: '', memo: '', supplies: '', linkedItems: [] };

    if (sourcePeriod < targetPeriod) {
      for (let i = sourcePeriod; i < targetPeriod; i++) {
        if (newSchedules[i + 1]) newSchedules[i] = { ...newSchedules[i + 1] };
        else newSchedules[i] = { ...emptyPeriod };
      }
    } else {
      for (let i = sourcePeriod; i > targetPeriod; i--) {
        if (newSchedules[i - 1]) newSchedules[i] = { ...newSchedules[i - 1] };
        else newSchedules[i] = { ...emptyPeriod };
      }
    }
    
    if (sourceData) newSchedules[targetPeriod] = sourceData;
    else newSchedules[targetPeriod] = { ...emptyPeriod };
    
    await setDoc(scheduleDocRef, {
      periods: newSchedules,
      updatedAt: Date.now()
    }, { merge: true });
  }, [dateStr, groupId, schedules]);

  const addJournalEntry = useCallback(async (content: string, label: string = '일반', labelIds: string[] = [], imageUrl?: string, options?: Partial<JournalEntry>) => {
    const user = auth.currentUser;
    if (!user || !dateStr || (!content.trim() && !imageUrl && (!options?.attachments || options.attachments.length === 0))) return;

    const journalDocRef = groupId
      ? doc(db, 'groups', groupId, 'journals', dateStr)
      : doc(db, 'users', user.uid, 'journals', dateStr);

    const newId = 'jr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5);
    const newEntry: JournalEntry = {
      id: newId,
      content: content.trim(),
      createdAt: Date.now(),
      label,
      labelIds,
      linkedItems: options?.linkedItems || [],
      imageUrl: imageUrl || '',
      ...options
    };
    
    const newJournals = [...journals, newEntry];
    await setDoc(journalDocRef, {
      entries: newJournals,
      updatedAt: Date.now()
    }, { merge: true });

    if (newEntry.linkedItems && newEntry.linkedItems.length > 0) {
      const sourceMeta = {
        targetType: 'journal',
        targetId: newId,
        targetDate: dateStr || '',
        targetPeriod: undefined,
        title: `[${dateStr || '메모'}] 기록`,
        targetFId: groupId || 'personal',
      };
      for (const link of newEntry.linkedItems) {
        await addReverseLink(link, sourceMeta as any, groupId || 'personal');
      }
    }
  }, [dateStr, groupId, journals]);

  const reorderEvents = useCallback(async (sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0 || sourceIndex >= eventList.length || targetIndex >= eventList.length) return;
    const newList = [...eventList];
    const [moved] = newList.splice(sourceIndex, 1);
    newList.splice(targetIndex, 0, moved);
    await saveEventItems(newList);
  }, [eventList, saveEventItems]);

  const reorderJournals = useCallback(async (sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0 || sourceIndex >= journals.length || targetIndex >= journals.length) return;
    const user = auth.currentUser;
    if (!user || !dateStr) return;

    const journalDocRef = groupId
      ? doc(db, 'groups', groupId, 'journals', dateStr)
      : doc(db, 'users', user.uid, 'journals', dateStr);

    const newList = [...journals];
    const [moved] = newList.splice(sourceIndex, 1);
    newList.splice(targetIndex, 0, moved);
    await setDoc(journalDocRef, {
      entries: newList,
      updatedAt: Date.now()
    }, { merge: true });
  }, [dateStr, groupId, journals]);

  const deleteJournalEntry = useCallback(async (id: string) => {
    const user = auth.currentUser;
    if (!user || !dateStr) return;

    const journalDocRef = groupId
      ? doc(db, 'groups', groupId, 'journals', dateStr)
      : doc(db, 'users', user.uid, 'journals', dateStr);

    const itemToDelete = journals.find(j => j.id === id);
    if (itemToDelete) {
      try {
        await moveToTrash({
          id: itemToDelete.id,
          type: 'journal',
          originalDateStr: dateStr,
          fId: groupId || 'personal',
          content: itemToDelete.content,
          data: itemToDelete
        });
      } catch (err) {
        console.error('Failed to move to trash:', err);
      }
    }

    const newJournals = journals.filter(j => j.id !== id);
    await setDoc(journalDocRef, {
      entries: newJournals,
      updatedAt: Date.now()
    }, { merge: true });
  }, [dateStr, groupId, journals]);

  const updateJournalEntry = useCallback(async (id: string, updates: { content?: string; label?: string; labelIds?: string[]; imageUrl?: string }) => {
    const user = auth.currentUser;
    if (!user || !dateStr) return;

    const target = journals.find(j => j.id === id);
    const newContent = updates.content !== undefined ? updates.content.trim() : (target?.content || '');
    const newImage = updates.imageUrl !== undefined ? updates.imageUrl : (target?.imageUrl || '');

    const hasLabel = updates.label !== undefined ? !!updates.label : !!target?.label;
    const hasLabelIds = updates.labelIds !== undefined ? updates.labelIds.length > 0 : !!(target?.labelIds && target.labelIds.length > 0);
    const hasAttachments = !!(target?.attachments && target.attachments.length > 0);
    const hasLinks = !!(target?.linkedItems && target.linkedItems.length > 0);

    if (!newContent && !newImage && !hasLabel && !hasLabelIds && !hasAttachments && !hasLinks) {
      await deleteJournalEntry(id);
      return;
    }

    const journalDocRef = groupId
      ? doc(db, 'groups', groupId, 'journals', dateStr)
      : doc(db, 'users', user.uid, 'journals', dateStr);

    const newJournals = journals
      .map(j => j.id === id ? { ...j, ...updates, updatedAt: Date.now() } : j)
      .filter((j) => 
        (j.content && j.content.trim().length > 0) || 
        !!j.imageUrl ||
        j.label ||
        (j.labelIds && j.labelIds.length > 0) ||
        (j.attachments && j.attachments.length > 0) ||
        (j.linkedItems && j.linkedItems.length > 0)
      );

    const itemStillExists = newJournals.some(j => j.id === id);
    if (!itemStillExists) {
      await deleteJournalEntry(id);
      return;
    }

    await setDoc(journalDocRef, {
      entries: newJournals,
      updatedAt: Date.now()
    }, { merge: true });
  }, [dateStr, groupId, journals, deleteJournalEntry]);

  
  // 💡 지난 미완료 할 일 오늘로 가져오기 (Forwarding)
  const forwardIncompleteEvents = useCallback(async () => {
    const user = auth.currentUser;
    if (!user || !dateStr) return 0;
    
    // 타임존 오차 방지를 위해 기준 시간을 확실히 설정
    const today = new Date(dateStr + 'T00:00:00');
    const pastDates: string[] = [];
    for (let i = 1; i <= 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      pastDates.push(`${y}-${m}-${day}`);
    }
    
    const settingsRef = doc(db, 'users', user.uid, 'settings', 'labels');
    const settingsSnap = await getDoc(settingsRef);
    
    // 설정이 없을 경우 DEFAULT_EVENT_LABELS를 기본으로 사용 (이월 속성 복구 핵심)
    let rawLabelDefs: any[] = [...DEFAULT_EVENT_LABELS];
    
    if (settingsSnap.exists()) {
      const data = settingsSnap.data();
      if (Array.isArray(data.eventLabels) || Array.isArray(data.labels)) {
        rawLabelDefs = data.eventLabels || data.labels;
      }
    }
    
    const forwardLabelNames = rawLabelDefs.filter((l: any) => l.forward || l.isForward).map((l: any) => l.name);
    
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
        
        items.forEach(it => {
          if (it.completed || !it.content.trim()) return;

          let labelName = '';
          if (it.label) {
            labelName = it.label.split(',')[0].trim();
          } else if (it.labelIds && it.labelIds.length > 0) {
            const found = rawLabelDefs.find(l => l.id === it.labelIds![0]);
            if (found) labelName = found.name;
          } else {
            const match = it.content.match(/^\[(.*?)\]\s*(.*)$/);
            if (match) labelName = match[1].trim();
          }

          if (forwardLabelNames.includes(labelName)) {
            // 중복 검사 후 안전하게 복제 (링크와 첨부파일까지 복사)
            if (!eventList.some(e => e.content === it.content) && !incompleteItems.some(e => e.content === it.content)) {
              incompleteItems.push({
                id: 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5),
                content: it.content,
                completed: false,
                label: it.label,
                labelIds: it.labelIds,
                linkedItems: it.linkedItems || [], 
                attachments: it.attachments || [],
              });
            }
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

  // 이월 로직 실행을 제어하는 단일 Ref 트리거
  const forwardedDateRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !auth.currentUser) return;
    
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    // 오늘 날짜가 아니면 리셋 (다시 오늘로 돌아오면 실행되도록)
    if (dateStr !== todayStr) {
      forwardedDateRef.current = null;
      return;
    }
    
    if (dateStr === todayStr && forwardedDateRef.current !== dateStr) {
      forwardedDateRef.current = dateStr;
      forwardIncompleteEvents().catch(console.error);
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
    updateEventItem,
    reorderEvents,
    savePeriod,
    reorderPeriods,
    addJournalEntry,
    deleteJournalEntry,
    updateJournalEntry,
    reorderJournals,
  };
}