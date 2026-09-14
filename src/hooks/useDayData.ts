//src/hooks/useDayData.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { doc, onSnapshot, setDoc, getDoc, getDocFromServer, runTransaction } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { addReverseLink } from '../utils/linkUtils';
import { moveToTrash } from '../utils/trashHelper';
import { DEFAULT_EVENT_LABELS } from './useLabels';
import { showErrorToast } from '../utils/toast';
import { parseV3EventText, formatV3EventText, eventContentOf, eventDocPayload, readEventList } from '../lib/eventText';
import { pastDateStrings } from '../lib/forwarding';

// 기존 import 경로 호환을 위해 재수출한다 (직렬화 구현은 lib/eventText.ts로 이동).
export { parseV3EventText, formatV3EventText };

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
  calendar?: boolean;
  forward?: boolean;
  period?: boolean;
  recur?: boolean;
  skip?: boolean;
  // 일정 알림: "YYYY-MM-DDTHH:mm" 형식. 비어있으면 알림 꺼짐.
  time?: string;
  // 알림이 이미 한 번 울려서 확인 처리되었는지 여부 (time 값 자체는 보존)
  alarmTriggered?: boolean;
  // 공동 작업 그룹에서 누가 만든 항목인지. 저장할 때 덮어쓰지 말고 보존해야 한다.
  authorId?: string;
  authorName?: string;
  // V3 및 일부 모달이 쓰는 호환 필드
  text?: string;
  createdAt?: number;
  // V3의 이월 사슬 메타데이터. V3는 원본을 원래 날짜에 남겨둔 채 사슬로 관리한다.
  forwardChainId?: string;
  originalDate?: string;
  // V3가 항목에 함께 저장하는 값들
  date?: string;
  sharedGroupId?: string | null;
  groupId?: string | null;
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

// 일정 항목 하나를 Firestore에 저장할 형태로 정규화한다.
//
// 💡 authorId/authorName을 현재 사용자로 덮어쓰면 안 된다. 예전에는 저장할 때마다
// 그 날짜의 "모든" 항목에 저장자의 uid/이름을 찍어서, 공유 그룹에서 다른 사람이 만든
// 일정의 작성자가 마지막에 손댄 사람으로 전부 바뀌었다.
// 💡 attachments/text/createdAt도 예전에는 이 매핑에서 빠져 있어, 첨부파일이 저장
// 직후 사라지고 백업 내보내기(text 필드를 읽음)가 빈 값으로 나갔다.
function normalizeEventForWrite(
  item: any,
  idx: number,
  user: { uid: string; displayName: string | null }
) {
  const content = eventContentOf(item);
  const authorId = item.authorId || user.uid;
  const authorName = item.authorName || (authorId === user.uid ? (user.displayName || '') : '');
  const merged: Record<string, any> = {
    // 💡 화이트리스트로만 저장하면 V3가 쓰는 forwardChainId/originalDate/date/
    // sharedGroupId 같은 필드가 V4에서 저장할 때마다 사라져 V3의 이월 사슬이 깨진다.
    // 모르는 필드는 그대로 넘기고 아래에서 V4가 관리하는 값만 덮어쓴다.
    ...item,
    id: item.id || 'ev_' + Date.now().toString(36) + '_' + idx,
    content,
    text: content, // V3 및 백업 내보내기 호환
    completed: !!item.completed,
    authorId,
    authorName,
    label: item.label || '',
    labelIds: item.labelIds || [],
    linkedItems: item.linkedItems || [],
    attachments: item.attachments || [],
    imageUrl: item.imageUrl || '',
    createdAt: item.createdAt || Date.now(),
    ...(item.calendar !== undefined ? { calendar: item.calendar } : {}),
    ...(item.forward !== undefined ? { forward: item.forward } : {}),
    ...(item.period !== undefined ? { period: item.period } : {}),
    ...(item.recur !== undefined ? { recur: item.recur } : {}),
    ...(item.skip !== undefined ? { skip: item.skip } : {}),
    ...(item.time !== undefined ? { time: item.time } : {}),
    ...(item.alarmTriggered !== undefined ? { alarmTriggered: item.alarmTriggered } : {}),
    ...(item.forwardedFrom !== undefined ? { forwardedFrom: item.forwardedFrom } : {}),
  };
  // Firestore는 undefined 값을 거부하므로 걷어낸다
  for (const k of Object.keys(merged)) {
    if (merged[k] === undefined) delete merged[k];
  }
  return merged;
}

// 💡 추가된 과거 일정을 이월하는 독립 함수 (전역 호출용)
//
// 앱 시작, 그룹 변경, 일정 추가/수정, 달력 스냅샷 등 여러 곳에서 호출된다.
// 월간 뷰는 날짜별로 리스너를 걸기 때문에 최초 로드에 수십 번이 동시에 들어오는데,
// 그대로 두면 같은 문서를 서로 덮어써서 방금 이월된 일정이 사라진다.
// 대상(개인/그룹)별로 실행 중인 작업이 있으면 그 Promise를 그대로 돌려준다.
const forwardingInFlight = new Map<string, Promise<number>>();

export function runAutoForwarding(groupId: string | null): Promise<number> {
  const key = groupId || 'personal';
  const running = forwardingInFlight.get(key);
  if (running) return running;

  const task = doAutoForwarding(groupId).finally(() => {
    forwardingInFlight.delete(key);
  });
  forwardingInFlight.set(key, task);
  return task;
}

async function doAutoForwarding(groupId: string | null) {
  const user = auth.currentUser;
  if (!user) return 0;
  
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  
  const pastDates = pastDateStrings(now);
  
  const settingsRef = doc(db, 'users', user.uid, 'settings', 'labels');
  const settingsSnap = await getDoc(settingsRef);
  
  let rawLabelDefs: any[] = [...DEFAULT_EVENT_LABELS];
  if (settingsSnap.exists()) {
    const data = settingsSnap.data();
    if (Array.isArray(data.eventLabels) || Array.isArray(data.labels)) {
      rawLabelDefs = data.eventLabels || data.labels;
    }
  }
  
  const forwardLabelNames = rawLabelDefs.filter((l: any) => l.forward || l.isForward).map((l: any) => l.name);
  
  // 오늘 날짜의 이월 중복 방지를 위해 오늘 목록 미리 조회
  const todayDocRef = groupId
    ? doc(db, 'groups', groupId, 'events', todayStr)
    : doc(db, 'users', user.uid, 'events', todayStr);
  const todaySnap = await getDoc(todayDocRef);
  let todayEventList: EventItem[] = [];
  if (todaySnap.exists()) {
    todayEventList = readEventList(todaySnap.data()) as EventItem[];
  }

  const incompleteItems: EventItem[] = [];
  const pastUpdates: { pDate: string, updatedList: EventItem[] }[] = [];

  for (const pDate of pastDates) {
    const docRef = groupId
      ? doc(db, 'groups', groupId, 'events', pDate)
      : doc(db, 'users', user.uid, 'events', pDate);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const items: EventItem[] = readEventList(snap.data()) as EventItem[];
      
      let hasChanges = false;
      const remainingItems: EventItem[] = [];

      for (const it of items) {
        if (it.completed || !it.content.trim()) {
          remainingItems.push(it);
          continue;
        }

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

        const isForwardTarget =
          it.forward === true || (it.forward !== false && forwardLabelNames.includes(labelName));

        if (isForwardTarget) {
          // 같은 사슬의 항목이 오늘 이미 완료되었으면 이월을 멈춘다.
          const chainDone =
            !!it.forwardChainId &&
            todayEventList.some((e: any) => e.forwardChainId === it.forwardChainId && e.completed);
          if (chainDone) {
            remainingItems.push(it);
            continue;
          }

          // 오늘 목록에 같은 내용이 이미 있으면 이월 복사본을 만들지 않는다.
          const isDuplicate =
            todayEventList.some(e => eventContentOf(e) === eventContentOf(it)) ||
            incompleteItems.some(e => eventContentOf(e) === eventContentOf(it));
          if (isDuplicate) {
            // 💡 내용이 같다고 다른 날짜의 원본을 지우면 안 된다. 예전에는 휴지통으로
            // 보냈는데, 사용자 입장에선 과거 일정이 예고 없이 사라지는 것으로 보였고
            // 이월이 돌 때마다 같은 항목이 휴지통에 계속 쌓였다. 원본은 그대로 둔다.
            remainingItems.push(it);
            continue;
          }
          // 이월된 일정은 지난 날짜에 남기지 않는다 (오늘로 옮긴다).
          // remainingItems에 넣지 않으므로 과거 문서에서 빠진다.
          const chainId =
            it.forwardChainId || 'chain_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
          const originalDate = it.originalDate || pDate;
          hasChanges = true;

          incompleteItems.push({
            id: 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5),
            forwardChainId: chainId,
            originalDate,
            content: it.content,
            completed: false,
            label: it.label,
            labelIds: it.labelIds,
            linkedItems: it.linkedItems || [],
            attachments: it.attachments || [],
            imageUrl: it.imageUrl,
            calendar: it.calendar,
            forward: it.forward,
            period: it.period,
            recur: it.recur,
            skip: it.skip,
            authorId: it.authorId,
            authorName: it.authorName,
          });
        } else {
          remainingItems.push(it);
        }
      }

      if (hasChanges) {
        pastUpdates.push({ pDate, updatedList: remainingItems });
      }
    }
  }

  if (incompleteItems.length > 0) {
    // 1. 오늘 날짜에 저장
    // 💡 여기까지 오는 동안(과거 14일 조회 등) 시간이 걸리므로, 그 사이 사용자가 오늘 일정을
    // 추가/수정했을 수 있다. 처음에 미리 읽어둔 todayEventList로 그냥 덮어쓰면 그 변경이
    // 통째로 사라질 수 있어, 트랜잭션으로 쓰기 직전 최신 상태를 다시 읽어 병합한다.
    await runTransaction(db, async (tx) => {
      const freshSnap = await tx.get(todayDocRef);
      const freshList: EventItem[] = freshSnap.exists()
        ? (readEventList(freshSnap.data()) as EventItem[])
        : [];
      // 트랜잭션 재시도 등으로 이미 반영되어 있을 수 있으니 중복 추가 방지
      const toAdd = incompleteItems.filter(
        (ni) => !freshList.some((fi: any) => eventContentOf(fi) === eventContentOf(ni))
      );
      const mergedList = [...freshList, ...toAdd].map((item: any, idx: number) =>
        normalizeEventForWrite(item, idx, user)
      );
      tx.set(todayDocRef, eventDocPayload(mergedList), { merge: true });
    });

    // 2. 이월된 항목의 링크 타겟 업데이트
    for (const newItem of incompleteItems) {
      if (newItem.linkedItems && newItem.linkedItems.length > 0) {
        const sourceMeta = {
          targetType: 'event',
          targetId: newItem.id,
          targetDate: todayStr,
          title: `[${todayStr || ''}] ${newItem.content}`,
          targetFId: groupId || 'personal',
        };
        for (const link of newItem.linkedItems) {
          await addReverseLink(link, sourceMeta as any, groupId || 'personal');
        }
      }
    }

  }

  // 3. 과거 문서에서 이월된 항목 제거.
  // 💡 예전에는 이 블록이 incompleteItems.length > 0 안에 있어서, 이월 대상이 전부
  // 중복 처리된 경우 과거 문서가 영원히 정리되지 않았다.
  for (const update of pastUpdates) {
    const pDocRef = groupId
      ? doc(db, 'groups', groupId, 'events', update.pDate)
      : doc(db, 'users', user.uid, 'events', update.pDate);

    const v3EventList = update.updatedList.map((item, idx) =>
      normalizeEventForWrite(item, idx, user)
    );
    await setDoc(pDocRef, eventDocPayload(v3EventList), { merge: true });
  }

  return incompleteItems.length;
}

export function useDayData(dateStr: string, groupId: string | null = null) {
  const [eventText, setEventText] = useState('');
  const [eventList, setEventList] = useState<EventItem[]>([]);
  const [schedules, setSchedules] = useState<Record<number, PeriodSchedule>>({});
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // 저장할 때 "내가 마지막으로 본 목록"을 기준선으로 삼아, 그 사이 다른 기기나
  // V3에서 추가된 항목을 지우지 않도록 한다. state 대신 ref를 쓰는 이유는
  // saveEventItems의 의존성이 목록이 바뀔 때마다 흔들리지 않게 하기 위함이다.
  const eventBaselineRef = useRef<EventItem[]>([]);

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

    // 💡 오프라인 캐시가 "문서 없음"이라고 답하면 서버에 실제로 있는 데이터가
    // 통째로 가려져 일정이 사라진 것처럼 보인다. 매핑을 함수로 빼서, 캐시 결과와
    // 서버 재확인 결과 양쪽에서 같은 로직을 쓴다.
    const applyEventData = (data: any | null) => {
      if (!data) {
        setEventText('');
        setEventList([]);
        return;
      }
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
              // V3가 붙인 필드(forwardChainId, originalDate 등)를 그대로 통과시킨다
              ...e,
              id: e.id || 'ev_' + idx,
              content: content,
              completed: !!e.completed,
              label: label || undefined,
              labelIds: e.labelIds,
              linkedItems: e.linkedItems || [],
              imageUrl: e.imageUrl,
              calendar: e.calendar,
              forward: e.forward,
              period: e.period,
              recur: e.recur,
              skip: e.skip,
              time: e.time || undefined,
              alarmTriggered: !!e.alarmTriggered,
              // 💡 예전에는 attachments를 읽지 않아, 첨부한 파일이 저장은 되어도
              // 다시 불러오면 사라졌다 (기록(journal) 쪽과 같은 문제였다).
              attachments: e.attachments || [],
              authorId: e.authorId,
              authorName: e.authorName,
              createdAt: e.createdAt,
            };
          }).filter((e: EventItem) =>
            (e.content && e.content.trim().length > 0) || 
            e.label || 
            (e.labelIds && e.labelIds.length > 0) ||
            (e.attachments && e.attachments.length > 0) ||
            (e.linkedItems && e.linkedItems.length > 0)
          );
          setEventList(mapped);
          eventBaselineRef.current = mapped;
        } else if (rawText) {
          const parsed = parseV3EventText(rawText).filter((e: any) =>
            (e.content && e.content.trim().length > 0) || e.label
          ) as EventItem[];
          setEventList(parsed);
          eventBaselineRef.current = parsed;
        } else {
          setEventList([]);
          eventBaselineRef.current = [];
        }
    };

    // 같은 날짜에서 서버 재확인은 한 번만 한다 (불필요한 읽기 방지)
    let serverRecheckDone = false;

    const unsubEvent = onSnapshot(eventDocRef, (snap) => {
      if (snap.exists()) {
        applyEventData(snap.data());
        return;
      }
      applyEventData(null);
      // 캐시에만 근거해 "문서 없음"으로 판단하지 않고 서버에 한 번 직접 물어본다.
      // 오프라인이면 실패하므로 캐시 결과를 그대로 둔다.
      if (snap.metadata.fromCache && !serverRecheckDone) {
        serverRecheckDone = true;
        getDocFromServer(eventDocRef)
          .then((serverSnap) => {
            if (serverSnap.exists()) applyEventData(serverSnap.data());
          })
          .catch(() => { /* 오프라인 등 - 캐시 결과를 유지한다 */ });
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
          label: j.label || (j.labelIds && j.labelIds.length > 0 ? j.labelIds[0] : ''),
          labelIds: j.labelIds || [],
          linkedItems: j.linkedItems || [],
          imageUrl: j.imageUrl || '',
          // 💡 attachments를 읽어오지 않아, 저장은 되는데 다시 불러오면 사라지고 있었다.
          attachments: j.attachments || [],
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
    // 예전에는 로컬 목록으로 문서를 통째로 덮어써서, 그 사이 다른 기기나 V3에서
    // 추가된 일정이 통째로 사라졌다. 쓰기 직전 최신 목록을 다시 읽어 병합한다.
    const baselineIds = new Set(eventBaselineRef.current.map((i) => String(i.id)));
    const keptIds = new Set(validList.map((i) => String(i.id)));
    try {
      await runTransaction(db, async (tx) => {
        const freshSnap = await tx.get(eventDocRef);
        const fresh: any[] = freshSnap.exists() ? readEventList(freshSnap.data()) : [];
        // 내가 마지막으로 본 뒤에 남이 추가한 항목만 보존한다.
        // (기준선에 있었는데 지금 없는 항목 = 내가 지운 것이므로 되살리지 않는다)
        const addedByOthers = fresh.filter(
          (f) => !baselineIds.has(String(f.id)) && !keptIds.has(String(f.id))
        );
        const merged = [...validList, ...addedByOthers].map((item: any, idx: number) =>
          normalizeEventForWrite(item, idx, user)
        );
        tx.set(eventDocRef, eventDocPayload(merged), { merge: true });
      });
    } catch (err) {
      showErrorToast('일정 저장에 실패했습니다. 네트워크를 확인해 주세요.', err);
    }
  }, [dateStr, groupId]);

  const addEventItem = useCallback(async (content: string, options?: Partial<EventItem>) => {
    if (!content.trim()) return;
    const parsedList = parseV3EventText(content.trim());
    const parsed = parsedList.length > 0 ? parsedList[0] : null;
    const newId = 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5);
    
    // 💡 options.label을 먼저 확인하도록 수정한 부분
    const newItem: EventItem = {
      id: newId,
      content: parsed ? parsed.content : content.trim(),
      completed: parsed ? parsed.completed : false,
      label: options?.label || (parsed && parsed.label ? parsed.label : undefined),
      labelIds: options?.labelIds || (parsed && parsed.label ? [] : undefined),
      linkedItems: options?.linkedItems || [],
      attachments: options?.attachments || [],
      time: options?.time || undefined,
      // 추가 폼에서도 개별 속성을 고를 수 있다. 예전에는 여기서 빠뜨려서, 새로 만든
      // 일정은 라벨에서 유추한 속성만 갖고 폼에서 고친 값은 버려졌다.
      ...(options?.calendar !== undefined ? { calendar: options.calendar } : {}),
      ...(options?.forward !== undefined ? { forward: options.forward } : {}),
      ...(options?.period !== undefined ? { period: options.period } : {}),
      ...(options?.recur !== undefined ? { recur: options.recur } : {}),
      ...(options?.skip !== undefined ? { skip: options.skip } : {}),
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
        title: `[${dateStr || ''}] ${newItem.content}`,
        targetFId: groupId || 'personal',
      };
      for (const link of newItem.linkedItems) {
        await addReverseLink(link, sourceMeta as any, groupId || 'personal');
      }
    }

    // 💡 추가된 부분: 저장 후, 수정 중인 날짜가 오늘이 아니라면 즉시 이월 로직 실행
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (dateStr !== todayStr) {
      runAutoForwarding(groupId).catch(console.error);
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
              imageUrl: e.imageUrl,
              calendar: e.calendar,
              forward: e.forward,
              period: e.period,
              recur: e.recur,
              skip: e.skip,
              time: e.time || undefined,
              alarmTriggered: !!e.alarmTriggered,
              attachments: e.attachments || [],
              authorId: e.authorId,
              authorName: e.authorName,
              createdAt: e.createdAt,
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

    // 💡 추가된 부분: 수정된 날짜가 오늘이 아니라면 즉시 이월 로직 실행
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (dateStr !== todayStr) {
      runAutoForwarding(groupId).catch(console.error);
    }
  }, [eventList, saveEventItems, deleteEventItem, dateStr, groupId]);

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

    try {
      await setDoc(scheduleDocRef, {
        periods: newSchedules,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (err) {
      showErrorToast('수업 저장에 실패했습니다. 네트워크를 확인해 주세요.', err);
    }
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
    
    try {
      await setDoc(scheduleDocRef, {
        periods: newSchedules,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (err) {
      showErrorToast('교시 순서 변경에 실패했습니다.', err);
    }
  }, [dateStr, groupId, schedules]);

  const addJournalEntry = useCallback(async (content: string, label: string = '', labelIds: string[] = [], imageUrl?: string, options?: Partial<JournalEntry>) => {
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

    try {
      await setDoc(journalDocRef, {
        entries: newJournals,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (err) {
      showErrorToast('기록 저장에 실패했습니다. 네트워크를 확인해 주세요.', err);
      return;
    }

    if (newEntry.linkedItems && newEntry.linkedItems.length > 0) {
      const sourceMeta = {
        targetType: 'journal',
        targetId: newId,
        targetDate: dateStr || '',
        title: `[${dateStr || ''}] ${newEntry.content.substring(0, 20)}`,
        targetFId: groupId || 'personal',
      };
      for (const link of newEntry.linkedItems) {
        await addReverseLink(link, sourceMeta as any, groupId || 'personal');
      }
    }

    // 저장 후에도 배너가 열려 있으므로, 화면이 방금 만든 항목으로 수정 대상을
    // 바꿀 수 있게 ID를 돌려준다. 안 그러면 한 번 더 저장할 때 새로 추가된다.
    return newId;
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
    
    try {
      await setDoc(journalDocRef, {
        entries: newList,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (err) {
      showErrorToast('기록 순서 변경에 실패했습니다.', err);
    }
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

    try {
      await setDoc(journalDocRef, {
        entries: newJournals,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (err) {
      showErrorToast('기록 삭제에 실패했습니다.', err);
    }
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

    try {
      await setDoc(journalDocRef, {
        entries: newJournals,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (err) {
      showErrorToast('기록 수정에 실패했습니다.', err);
    }
  }, [dateStr, groupId, journals, deleteJournalEntry]);

  // 내부적으로 위에서 정의한 전역 이월 함수를 호출하도록 변경
  const forwardIncompleteEvents = useCallback(async () => {
    return await runAutoForwarding(groupId);
  }, [groupId]);

  // 오늘 날짜 접속 시 최초 1회 이월 로직 자동 실행 (ref 활용)
  const forwardedDateRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !auth.currentUser) return;
    
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
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