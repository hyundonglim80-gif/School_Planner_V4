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

export const DEFAULT_EVENT_LABELS: EventLabel[] = [
  { id: 'ev_1', name: ' ', color: 'red', calendar: true, skip: false, forward: false },
  { id: 'ev_2', name: ' ', color: 'orange', calendar: true, skip: false, forward: false },
  { id: 'ev_3', name: ' ', color: 'blue', calendar: false, skip: false, forward: false },
  { id: 'ev_4', name: ' ', color: 'green', calendar: false, skip: false, forward: true },
  { id: 'ev_5', name: ' ', color: 'purple', calendar: false, skip: false, forward: false },
];

const DEFAULT_MEMO_LABELS = ['긴급', '중요', '업무', '개인', '기타'];

export const COLOR_PALETTE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  blue: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd', label: ' ' },
  green: { bg: '#dcfce7', text: '#166534', border: '#86efac', label: ' ' },
  red: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5', label: ' ' },
  orange: { bg: '#ffedd5', text: '#9a3412', border: '#fdba74', label: ' ' },
  yellow: { bg: '#fef9c3', text: '#854d0e', border: '#fde047', label: ' ' },
  indigo: { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc', label: ' ' },
  purple: { bg: '#f3e8ff', text: '#6b21a8', border: '#d8b4fe', label: ' ' },
  pink: { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4', label: ' ' },
  gray: { bg: '#f1f5f9', text: '#334155', border: '#cbd5e1', label: ' ' },
};

export function useLabels() {
  const [eventLabels, setEventLabels] = useState<EventLabel[]>(DEFAULT_EVENT_LABELS);
  const [memoLabels, setMemoLabels] = useState<string[]>(DEFAULT_MEMO_LABELS);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setEventLabels(DEFAULT_EVENT_LABELS);
      setMemoLabels(DEFAULT_MEMO_LABELS);
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
      } else {
        setEventLabels(DEFAULT_EVENT_LABELS);
        setMemoLabels(DEFAULT_MEMO_LABELS);
      }
    });

    return () => unsub();
  }, [auth.currentUser?.uid]); // Using auth.currentUser?.uid to re-trigger if needed, though mostly it's constant once logged in

  const getLabelColor = (labelName: string) => {
    const label = eventLabels.find(l => l.name === labelName);
    const colorKey = label?.color || 'gray';
    return COLOR_PALETTE[colorKey] || COLOR_PALETTE['gray'];
  };

  const getLabel = (labelName: string) => eventLabels.find(l => l.name === labelName);

  return { eventLabels, getLabelColor, getLabel, memoLabels };
}