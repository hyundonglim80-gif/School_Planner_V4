import { useState, useEffect, useCallback, useMemo } from 'react';
import { doc, setDoc, runTransaction } from 'firebase/firestore';
import { subscribeDocWithServerFallback } from '../lib/firestoreSubscribe';
import { db, auth } from '../lib/firebase';
import { moveToTrash } from '../utils/trashHelper';
import { showToast, showErrorToast } from '../utils/toast';

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

  // 💡 목록을 로컬 상태로 만들어 덮어쓰면 안 된다. 구독이 값을 주기 전이거나
  // 오프라인 캐시가 "문서 없음"이라고 답한 순간에는 dDayList가 빈 배열인데,
  // 그때 D-Day를 하나 추가하면 dDayList에 그 하나만 남아 기존 것이 전부 사라졌다.
  // 쓰기 직전 서버 값을 다시 읽어 그 위에서 고친다.
  const mutateDDays = useCallback(
    async (
      mutate: (list: DDayItem[], selected: string | null) => { list: DDayItem[]; selected: string | null }
    ) => {
      const user = auth.currentUser;
      if (!user) return;
      const prefDocRef = doc(db, 'users', user.uid, 'settings', 'preferences');
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(prefDocRef);
          const data = snap.exists() ? snap.data() : {};
          const current: DDayItem[] = Array.isArray(data.dDayList) ? data.dDayList : [];
          const next = mutate(current, data.selectedDDayId ?? null);
          tx.set(prefDocRef, { dDayList: next.list, selectedDDayId: next.selected }, { merge: true });
        });
      } catch (e) {
        showErrorToast('D-Day 저장에 실패했습니다. 네트워크를 확인해 주세요.', e);
      }
    },
    []
  );

  const addDDay = useCallback(async (title: string, date: string) => {
    if (!title.trim() || !date) return;
    const newItem: DDayItem = {
      id: 'dday_' + Date.now(),
      title: title.trim(),
      date,
    };
    await mutateDDays((list, selected) => ({
      list: [...list, newItem],
      // 아직 고른 게 없으면 방금 추가한 것을 선택해 둔다 (V3와 같은 동작)
      selected: selected ?? newItem.id,
    }));
    showToast('✅ D-Day를 추가했습니다.');
  }, [mutateDDays]);

  const selectDDay = useCallback(async (id: string | null) => {
    // 단일 값이라 병합 저장으로 충분하다
    await savePref({ selectedDDayId: id });
  }, [savePref]);

  const deleteDDay = useCallback(async (id: string) => {
    let removed: DDayItem | undefined;
    await mutateDDays((list, selected) => {
      removed = list.find((d) => d.id === id);
      return {
        list: list.filter((d) => d.id !== id),
        selected: selected === id ? null : selected,
      };
    });

    if (removed) {
      try {
        await moveToTrash({
          id: removed.id,
          type: 'dday',
          content: removed.title,
          data: removed,
        });
      } catch (err) {
        console.error('D-Day 휴지통 이동 실패:', err);
      }
    }
    showToast('🗑️ D-Day를 삭제했습니다. 휴지통에서 복원할 수 있습니다.');
  }, [mutateDDays]);

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
