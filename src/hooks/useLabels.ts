//src/hooks/useLabels.ts
import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
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

export function useLabels() {
  const [eventLabels, setEventLabels] = useState<EventLabel[]>(DEFAULT_EVENT_LABELS);
  const [memoLabels, setMemoLabels] = useState<string[]>(DEFAULT_MEMO_LABELS);
  const [journalLabels, setJournalLabels] = useState<JournalLabel[]>(DEFAULT_JOURNAL_LABELS);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setEventLabels(DEFAULT_EVENT_LABELS);
      setMemoLabels(DEFAULT_MEMO_LABELS);
      setJournalLabels(DEFAULT_JOURNAL_LABELS);
      return;
    }

    const docRef = doc(db, 'users', user.uid, 'settings', 'labels');
    const unsub = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const rawEvents = data.eventLabels || data.labels || DEFAULT_EVENT_LABELS;
        setEventLabels(rawEvents.map((l: any, i: number) => ({
          id: l.id || `ev_${i}_${l.name || ''}`,
          name: l.name || '',
          color: l.color || 'blue',
          calendar: l.calendar !== false,
          skip: !!l.skip,
          forward: !!(l.forward || l.isForward),
          period: !!l.period,
          recur: !!l.recur,
        })));

        if (Array.isArray(data.memoLabels) && data.memoLabels.length > 0) {
          setMemoLabels(data.memoLabels.map((l: any) => (typeof l === 'string' ? l : l.name)));
        } else {
          setMemoLabels(DEFAULT_MEMO_LABELS);
        }

        if (Array.isArray(data.journalLabels) && data.journalLabels.length > 0) {
          setJournalLabels(data.journalLabels.map((l: any, i: number) => ({
            id: l.id || `j_${i}_${l.name || ''}`,
            name: l.name || '',
            color: l.color || 'green',
          })));
        } else {
          setJournalLabels(DEFAULT_JOURNAL_LABELS);
        }
      } else {
        setEventLabels(DEFAULT_EVENT_LABELS);
        setMemoLabels(DEFAULT_MEMO_LABELS);
        setJournalLabels(DEFAULT_JOURNAL_LABELS);
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

  return { eventLabels, getLabelColor, getLabel, memoLabels, journalLabels };
}