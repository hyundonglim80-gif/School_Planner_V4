import { useState, useEffect, useCallback, useMemo } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { subscribeDocWithServerFallback } from '../lib/firestoreSubscribe';
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
  // V3는 상단에 "선택한" D-Day 하나를 보여주고, 그 선택을 settings/preferences의
  // selectedDDayId에 저장한다. V4가 이 값을 읽지도 쓰지도 않아서, V3에서 고른
  // D-Day가 V4에 나오지 않고 V4에서 추가한 D-Day는 V3 상단에서 사라졌다.
  const [selectedDDayId, setSelectedDDayId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setDDayList([]);
      setSelectedDDayId(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const prefDocRef = doc(db, 'users', user.uid, 'settings', 'preferences');

    const unsubscribe = subscribeDocWithServerFallback(prefDocRef, (data) => {
      setDDayList(data?.dDayList || []);
      setSelectedDDayId(data?.selectedDDayId ?? null);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [auth.currentUser?.uid]);

  const savePref = useCallback(async (patch: Record<string, unknown>) => {
    const user = auth.currentUser;
    if (!user) return;
    const prefDocRef = doc(db, 'users', user.uid, 'settings', 'preferences');
    await setDoc(prefDocRef, patch, { merge: true });
  }, []);

  const addDDay = useCallback(async (title: string, date: string) => {
    if (!title.trim() || !date) return;
    const newItem: DDayItem = {
      id: 'dday_' + Date.now(),
      title: title.trim(),
      date,
    };
    const newList = [...dDayList, newItem];
    // 아직 고른 게 없으면 방금 추가한 것을 선택해 둔다 (V3와 같은 동작)
    const nextSelected = selectedDDayId ?? newItem.id;
    await savePref({ dDayList: newList, selectedDDayId: nextSelected });
  }, [dDayList, selectedDDayId, savePref]);

  const selectDDay = useCallback(async (id: string | null) => {
    await savePref({ selectedDDayId: id });
  }, [savePref]);

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
    await savePref({
      dDayList: newList,
      selectedDDayId: selectedDDayId === id ? null : selectedDDayId,
    });
  }, [dDayList, selectedDDayId, savePref]);

  // 사용자가 고른 D-Day. 고른 게 없으면 가장 가까운 미래의 D-Day를 보여준다.
  const primaryDDay = useMemo(() => {
    if (dDayList.length === 0) return null;
    const selected = selectedDDayId ? dDayList.find((d) => d.id === selectedDDayId) : null;
    const top =
      selected ||
      [...dDayList].sort((a, b) => {
        const diffA = calculateDDay(a.date).daysDiff;
        const diffB = calculateDDay(b.date).daysDiff;
        if (diffA >= 0 && diffB >= 0) return diffA - diffB;
        if (diffA >= 0) return -1;
        if (diffB >= 0) return 1;
        return diffB - diffA;
      })[0];
    return {
      ...top,
      ...calculateDDay(top.date),
    };
  }, [dDayList, selectedDDayId]);

  return {
    dDayList,
    primaryDDay,
    selectedDDayId,
    selectDDay,
    loading,
    addDDay,
    deleteDDay,
  };
}
