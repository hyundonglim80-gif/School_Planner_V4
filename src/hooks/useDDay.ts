import { useState, useEffect, useCallback, useMemo } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { moveToTrash } from '../utils/trashHelper';

export interface DDayItem {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
}

export function calculateDDay(targetDateStr: string): { text: string; daysDiff: number } {
  const target = new Date(targetDateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffTime = target.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return { text: 'D-Day', daysDiff: 0 };
  } else if (diffDays > 0) {
    return { text: `D-${diffDays}`, daysDiff: diffDays };
  } else {
    return { text: `D+${Math.abs(diffDays)}`, daysDiff: diffDays };
  }
}

export function useDDay() {
  const [dDayList, setDDayList] = useState<DDayItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setDDayList([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const prefDocRef = doc(db, 'users', user.uid, 'settings', 'preferences');

    const unsubscribe = onSnapshot(prefDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setDDayList(data.dDayList || []);
      } else {
        setDDayList([]);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [auth.currentUser?.uid]);

  const saveDDayList = useCallback(async (newList: DDayItem[]) => {
    const user = auth.currentUser;
    if (!user) return;
    const prefDocRef = doc(db, 'users', user.uid, 'settings', 'preferences');
    await setDoc(prefDocRef, { dDayList: newList }, { merge: true });
  }, []);

  const addDDay = useCallback(async (title: string, date: string) => {
    if (!title.trim() || !date) return;
    const newItem: DDayItem = {
      id: 'dday_' + Date.now(),
      title: title.trim(),
      date,
    };
    const newList = [...dDayList, newItem];
    await saveDDayList(newList);
  }, [dDayList, saveDDayList]);

  const deleteDDay = useCallback(async (id: string) => {
    const target = dDayList.find((d) => d.id === id);
    if (target) {
      try {
        await moveToTrash({
          id: target.id,
          type: 'dday',
          content: target.title,
          data: target,
        });
      } catch (err) {
        console.error('D-Day 휴지통 이동 실패:', err);
      }
    }
    const newList = dDayList.filter((d) => d.id !== id);
    await saveDDayList(newList);
  }, [dDayList, saveDDayList]);

  // 가장 가까운 미래의 D-Day (없으면 첫 번째)
  const primaryDDay = useMemo(() => {
    if (dDayList.length === 0) return null;
    const sorted = [...dDayList].sort((a, b) => {
      const diffA = calculateDDay(a.date).daysDiff;
      const diffB = calculateDDay(b.date).daysDiff;
      if (diffA >= 0 && diffB >= 0) return diffA - diffB;
      if (diffA >= 0) return -1;
      if (diffB >= 0) return 1;
      return diffB - diffA;
    });
    const top = sorted[0];
    return {
      ...top,
      ...calculateDDay(top.date),
    };
  }, [dDayList]);

  return {
    dDayList,
    primaryDDay,
    loading,
    addDDay,
    deleteDDay,
  };
}
