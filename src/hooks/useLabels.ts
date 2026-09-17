//src/hooks/useLabels.ts
import { useState, useEffect, useRef } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import {
  readLegacyEventLabels,
  readLegacyJournalLabels,
  readLegacyMemoLabels,
} from '../lib/legacyLabels';
import { subscribeDocWithServerFallback } from '../lib/firestoreSubscribe';
import { showErrorToast } from '../utils/toast';
import { db, auth } from '../lib/firebase';

export interface EventLabel {
  id: string;
  name: string;
  color: string;
  calendar?: boolean;
  skip?: boolean;
  forward?: boolean;
  period?: boolean;
  recur?: boolean;
}

// 💡 5대 기본 라벨 규격 완벽 통일 (이월 기능 정상 동작의 핵심)
export const DEFAULT_EVENT_LABELS: EventLabel[] = [
  { id: 'ev_1', name: '달력', color: 'red', calendar: true, skip: false, forward: false, period: false, recur: false },
  { id: 'ev_2', name: '수업X', color: 'orange', calendar: true, skip: true, forward: false, period: false, recur: false },
  { id: 'ev_3', name: '이월', color: 'green', calendar: false, skip: false, forward: true, period: false, recur: false },
  { id: 'ev_4', name: '기간', color: 'indigo', calendar: false, skip: false, forward: false, period: true, recur: false },
  { id: 'ev_5', name: '반복', color: 'purple', calendar: false, skip: false, forward: false, period: false, recur: true },
];

const DEFAULT_MEMO_LABELS = ['긴급', '중요', '업무', '개인', '기타'];

export const COLOR_PALETTE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  blue: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd', label: '파랑' },
  green: { bg: '#dcfce7', text: '#166534', border: '#86efac', label: '초록' },
  red: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5', label: '빨강' },
  orange: { bg: '#ffedd5', text: '#9a3412', border: '#fdba74', label: '주황' },
  yellow: { bg: '#fef9c3', text: '#854d0e', border: '#fde047', label: '노랑' },
  indigo: { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc', label: '남색' },
  purple: { bg: '#f3e8ff', text: '#6b21a8', border: '#d8b4fe', label: '보라' },
  pink: { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4', label: '분홍' },
  gray: { bg: '#f1f5f9', text: '#334155', border: '#cbd5e1', label: '회색' },
};

export interface JournalLabel {
  id: string;
  name: string;
  color: string;
}

export const DEFAULT_JOURNAL_LABELS: JournalLabel[] = [
  { id: 'j_1', name: '학급활동', color: 'green' },
  { id: 'j_2', name: '학생상담', color: 'yellow' },
  { id: 'j_3', name: '업무전달', color: 'blue' },
  { id: 'j_4', name: '수업기록', color: 'purple' },
];

// V3는 isSkip/isPeriod/isRecur/showInCalendar, V4는 skip/period/recur/calendar를 쓴다.
// 어느 쪽으로 저장되어 있든 같게 읽는다.
export function normalizeEventLabel(l: any, i: number): EventLabel {
  return {
    id: l.id || `ev_${i}_${l.name || ''}`,
    name: l.name || '',
    color: l.color || 'blue',
    calendar: l.calendar !== false && l.showInCalendar !== false,
    skip: !!(l.skip || l.isSkip),
    forward: !!(l.forward || l.isForward),
    period: !!(l.period || l.isPeriod),
    recur: !!(l.recur || l.isRecur),
  };
}

/**
 * 클라우드에 쓸 모양으로 바꾼다.
 *
 * ⚠️ V3는 isForward/isSkip/isPeriod/isRecur를 보고, V4는 forward/skip/period/recur를
 *    쓴다. V4가 자기 이름만 써 두면 V3는 '시스템 라벨이 하나도 없다'고 보고
 *    완료·주간·반복·휴일을 새로 만들어 덧붙인다. 실제로 선생님 라벨 목록이
 *    8개에서 12개로 늘며 완료/주간/반복/휴일이 두 번씩 들어갔다.
 *    두 이름을 함께 적어 두 앱이 같은 것을 보게 한다.
 */
export function toSharedEventLabel(l: EventLabel): Record<string, any> {
  return {
    id: l.id,
    name: l.name,
    color: l.color,
    calendar: l.calendar,
    skip: l.skip,
    forward: l.forward,
    period: l.period,
    recur: l.recur,
    // V3가 읽는 이름
    showInCalendar: l.calendar,
    isSkip: l.skip,
    isForward: l.forward,
    isPeriod: l.period,
    isRecur: l.recur,
  };
}

/**
 * 마지막으로 라벨을 어디서 가져왔는지. 문제를 살필 때만 쓴다.
 * '라벨 칩이 사라졌다'는 신고를 받았을 때, 클라우드를 못 읽은 것인지
 * 클라우드에 아예 없는 것인지 가려야 다음 손을 쓸 수 있다.
 */
export const labelDiagnostics: {
  source: 'cloud' | 'legacy' | 'default' | 'none';
  docExists: boolean;
  cloudCount: number;
  legacyCount: number;
  at: number;
  error?: string;
  migratedAt?: number;
  migrateError?: string;
} = { source: 'none', docExists: false, cloudCount: 0, legacyCount: 0, at: 0 };

export function useLabels() {
  const [eventLabels, setEventLabels] = useState<EventLabel[]>(DEFAULT_EVENT_LABELS);
  const [memoLabels, setMemoLabels] = useState<string[]>(DEFAULT_MEMO_LABELS);
  const [journalLabels, setJournalLabels] = useState<JournalLabel[]>(DEFAULT_JOURNAL_LABELS);
  const migratedRef = useRef(false);
  // 한 번이라도 라벨을 받아 봤는가. 받은 뒤에 난 오류로 사용자를 놀라게 하지 않는다.
  const loadedRef = useRef(false);
  // 선생님의 라벨 목록을 실제로 확보했는가(클라우드 또는 V3 localStorage).
  // 기본값만 들고 있는 상태에서 '목록에 없는 라벨'을 걸러내면 칩이 전부 사라진다.
  const [labelsLoaded, setLabelsLoaded] = useState(false);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setEventLabels(DEFAULT_EVENT_LABELS);
      setMemoLabels(DEFAULT_MEMO_LABELS);
      setJournalLabels(DEFAULT_JOURNAL_LABELS);
      setLabelsLoaded(false);
      return;
    }

    const docRef = doc(db, 'users', user.uid, 'settings', 'labels');
    const unsub = subscribeDocWithServerFallback(docRef, (data) => {
      loadedRef.current = true;
      // Firestore에 라벨이 없으면 V3가 쓰던 localStorage 값을 쓴다.
      const cloudEvents =
        (Array.isArray(data?.eventLabels) && data!.eventLabels.length > 0 && data!.eventLabels) ||
        (Array.isArray(data?.labels) && data!.labels.length > 0 && data!.labels) ||
        null;
      const legacyEvents = cloudEvents ? null : readLegacyEventLabels();
      const rawEvents = cloudEvents || legacyEvents || DEFAULT_EVENT_LABELS;

      setEventLabels(rawEvents.map(normalizeEventLabel));
      // 기본값으로 때운 것이면 '확보했다'고 하면 안 된다.
      setLabelsLoaded(!!(cloudEvents || legacyEvents));

      labelDiagnostics.source = cloudEvents ? 'cloud' : legacyEvents ? 'legacy' : 'default';
      labelDiagnostics.docExists = !!data;
      labelDiagnostics.cloudCount = cloudEvents ? cloudEvents.length : 0;
      labelDiagnostics.legacyCount = legacyEvents ? legacyEvents.length : 0;
      labelDiagnostics.at = Date.now();
      labelDiagnostics.error = undefined;

      const cloudMemo =
        Array.isArray(data?.memoLabels) && data!.memoLabels.length > 0 ? data!.memoLabels : null;
      const legacyMemo = cloudMemo ? null : readLegacyMemoLabels();
      const rawMemo = cloudMemo || legacyMemo;
      setMemoLabels(
        rawMemo
          ? rawMemo.map((l: any) => (typeof l === 'string' ? l : l.name))
          : DEFAULT_MEMO_LABELS
      );

      const cloudJournal =
        Array.isArray(data?.journalLabels) && data!.journalLabels.length > 0
          ? data!.journalLabels
          : null;
      const legacyJournal = cloudJournal ? null : readLegacyJournalLabels();
      const rawJournal = cloudJournal || legacyJournal;
      setJournalLabels(
        rawJournal
          ? rawJournal.map((l: any, i: number) => ({
              id: l.id || `j_${i}_${l.name || ''}`,
              name: l.name || '',
              color: l.color || 'green',
            }))
          : DEFAULT_JOURNAL_LABELS
      );

      // localStorage에만 있던 라벨을 Firestore로 한 번 옮겨 두 앱이 같은 곳을 보게 한다
      if (!migratedRef.current && (legacyEvents || legacyMemo || legacyJournal)) {
        migratedRef.current = true;
        const payload: Record<string, any> = { updatedAt: Date.now() };
        // V3 값을 그대로 올린다 (이미 isForward 등 V3 이름을 갖고 있다)
        if (legacyEvents) payload.eventLabels = legacyEvents;
        if (legacyMemo) payload.memoLabels = legacyMemo;
        if (legacyJournal) payload.journalLabels = legacyJournal;
        // ⚠️ 이 한 번의 쓰기가 실패하면 라벨 정의는 이 기기의 localStorage에만
        //    남는다. 사용기록을 지우는 순간 통째로 사라지고, 일정은 라벨을
        //    id(lbl_ev_...)로 들고 있어서 대응표 없이는 이름을 알 길이 없다.
        //    조용히 넘길 일이 아니다.
        setDoc(docRef, payload, { merge: true })
          .then(() => {
            labelDiagnostics.migratedAt = Date.now();
          })
          .catch((e) => {
            console.error('라벨을 클라우드로 옮기지 못했습니다:', e);
            labelDiagnostics.migrateError = String((e as any)?.code || (e as any)?.message || e);
            showErrorToast(
              '라벨을 클라우드에 저장하지 못했습니다. 이 기기 기록을 지우면 라벨이 사라질 수 있습니다.',
              e
            );
          });
      }
    },
    (err) => {
      // ⚠️ 여기가 비어 있었다. 라벨 읽기가 실패해도 아무 말 없이 기본 라벨에
      //    머물렀고, 그 상태에서는 등록되지 않은 라벨이 전부 걸러져 화면에서
      //    라벨 칩이 하나도 안 보였다. 이월도 '어떤 라벨이 이월 대상인지'를
      //    이 값으로 판단하므로 오늘로 와야 할 일정이 오지 않았다.
      //    사용자는 데이터가 사라진 줄 알게 된다. 조용히 넘어가지 않는다.
      console.error('라벨을 불러오지 못했습니다:', err);
      labelDiagnostics.error = String((err as any)?.code || (err as any)?.message || err);
      labelDiagnostics.at = Date.now();
      if (!loadedRef.current) {
        showErrorToast('라벨을 불러오지 못했습니다. 새로고침해 주세요. (그때까지 라벨 칩이 보이지 않을 수 있습니다)', err);
      }
    });

    return () => unsub();
  }, [auth.currentUser?.uid]);

  const getLabelColor = (labelName: string) => {
    const label = eventLabels.find(l => l.name === labelName);
    const colorKey = label?.color || 'gray';
    return COLOR_PALETTE[colorKey] || COLOR_PALETTE['gray'];
  };

  const getLabel = (labelName: string) => eventLabels.find(l => l.name === labelName);

  return { eventLabels, getLabelColor, getLabel, memoLabels, journalLabels, labelsLoaded };
}