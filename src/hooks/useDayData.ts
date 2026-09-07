import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { addReverseLink } from '../utils/linkUtils';
import { moveToTrash } from '../utils/trashHelper';

export interface Attachment {
  id?: string;
  name: string;
  url: string;
  type: string; // 'image', 'document', etc.
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
  content: string; // V4 기존 (V3에서는 memo로 사용되기도 함)
  memo?: string;   // V3 호환
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

    // Generate stable hash-based ID instead of Date.now() to prevent ID churn across re-renders
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

    // 네트워크 지연/학교 방화벽 차단 등으로 인한 무한 로딩 방지 타임아웃 (3초)
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

    // 1. 이벤트/할일 동기화 (V3 eventList & eventText 호환)
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

  // 오늘 할 일 목록 저장 (V3 eventList + eventText 양방향 동시 저장)
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
      label: parsed && parsed.label ? parsed.label : undefined,
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

    // 만약 현재 state의 eventList가 비어있다면 Firestore에서 최신 목록 가져오기 (DetailEditModal 등 대비)
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

    // 1. 문자열로 엄격/비엄격 변환 매칭하여 대상 항목 찾기
    let itemToDelete = currentList.find(item => String(item.id) === String(id));

    // 2. 만약 못 찾았을 경우 fallbackItem 활용
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

    // 3. 휴지통으로 이동
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

    // 4. 원래 목록에서 해당 id 제외 후 저장
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
    
    // 원래 있던 항목이 새로운 업데이트로 인해 완전히 빈 값이 되어 필터링으로 사라지면 휴지통으로 이동(삭제) 처리
    const itemStillExists = newList.some(item => item.id === id);
    if (!itemStillExists) {
      await deleteEventItem(id);
      return;
    }

    await saveEventItems(newList);
  }, [eventList, saveEventItems, deleteEventItem]);

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

  // 시간표 순서 일괄 재배치 (Drag & Drop 용)
  const reorderPeriods = useCallback(async (sourcePeriod: number, targetPeriod: number, maxPeriods: number = 6) => {
    const user = auth.currentUser;
    if (!user || !dateStr || sourcePeriod === targetPeriod) return;

    const scheduleDocRef = groupId
      ? doc(db, 'groups', groupId, 'schedules', dateStr)
      : doc(db, 'users', user.uid, 'schedules', dateStr);

    const newSchedules = { ...schedules };
    const sourceData = newSchedules[sourcePeriod] ? { ...newSchedules[sourcePeriod] } : null;

    if (sourcePeriod < targetPeriod) {
      for (let i = sourcePeriod; i < targetPeriod; i++) {
        if (newSchedules[i + 1]) newSchedules[i] = { ...newSchedules[i + 1] };
        else delete newSchedules[i];
      }
    } else {
      for (let i = sourcePeriod; i > targetPeriod; i--) {
        if (newSchedules[i - 1]) newSchedules[i] = { ...newSchedules[i - 1] };
        else delete newSchedules[i];
      }
    }

    if (sourceData) newSchedules[targetPeriod] = sourceData;
    else delete newSchedules[targetPeriod];

    await setDoc(scheduleDocRef, {
      periods: newSchedules,
      updatedAt: Date.now()
    }, { merge: true });
  }, [dateStr, groupId, schedules]);

  // 일지 추가/삭제
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
    // 🚨 최하단에 추가
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

  // 일정 순서 변경 (Drag & Drop)
  const reorderEvents = useCallback(async (sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0 || sourceIndex >= eventList.length || targetIndex >= eventList.length) return;
    const newList = [...eventList];
    const [moved] = newList.splice(sourceIndex, 1);
    newList.splice(targetIndex, 0, moved);
    await saveEventItems(newList);
  }, [eventList, saveEventItems]);

  // 기록 순서 변경 (Drag & Drop)
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
    
    if (settingsSnap.exists()) {
      const data = settingsSnap.data();
      const labels = data.eventLabels || data.labels;
      if (labels) {
        forwardLabels = labels.filter((l: any) => l.forward || l.isForward).map((l: any) => l.name);
      }
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
