import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { SelectedLinkItem } from '../components/LinkerModal';
import { parseV3EventText } from '../hooks/useDayData';

export const addReverseLink = async (targetLink: SelectedLinkItem, sourceMeta: SelectedLinkItem, activeFId: string) => {
  const tFId = targetLink.targetFId || activeFId;
  const colPath = (col: string) =>
    tFId === 'personal' || !tFId ? `users/${auth.currentUser?.uid}/${col}` : `groups/${tFId}/${col}`;

  try {
    if (targetLink.targetType === 'event') {
      const ref = doc(db, colPath('events'), targetLink.targetDate);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        let list = data.eventList;
        if (!list || list.length === 0) {
          if (data.eventText) list = parseV3EventText(data.eventText);
        }
        if (list) {
          const item = list.find((e: any) => String(e.id) === String(targetLink.targetId));
          if (item) {
            item.linkedItems = item.linkedItems || [];
            if (!item.linkedItems.some((l: any) => String(l.targetId || l.id) === String(sourceMeta.targetId))) {
              item.linkedItems.push(sourceMeta);
              await setDoc(ref, { eventList: list }, { merge: true });
            }
          }
        }
      }
    } else if (targetLink.targetType === 'journal') {
      const ref = doc(db, colPath('journals'), targetLink.targetDate);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const list = snap.data().entries || [];
        const item = list.find((j: any) => String(j.id) === String(targetLink.targetId));
        if (item) {
          item.linkedItems = item.linkedItems || [];
          if (!item.linkedItems.some((l: any) => String(l.targetId || l.id) === String(sourceMeta.targetId))) {
            item.linkedItems.push(sourceMeta);
            await setDoc(ref, { entries: list }, { merge: true });
          }
        }
      }
    } else if (targetLink.targetType === 'schedule') {
      const ref = doc(db, colPath('schedules'), targetLink.targetDate);
      const snap = await getDoc(ref);
      const periods = snap.exists() ? (snap.data().periods || {}) : {};
      const pKey = targetLink.targetPeriod
        ? String(targetLink.targetPeriod)
        : String(targetLink.targetId).replace(/.*_/, '');
      if (!periods[pKey]) {
        periods[pKey] = { subject: '', content: '', memo: '', supplies: '', linkedItems: [] };
      }
      const item = periods[pKey];
      item.linkedItems = item.linkedItems || [];
      if (!item.linkedItems.some((l: any) => String(l.targetId || l.id) === String(sourceMeta.targetId))) {
        item.linkedItems.push(sourceMeta);
        await setDoc(ref, { periods }, { merge: true });
      }
    } else if (targetLink.targetType === 'memo') {
      const ref = doc(db, colPath('tasks'), targetLink.targetId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const linkedItems = snap.data().linkedItems || [];
        if (!linkedItems.some((l: any) => String(l.targetId || l.id) === String(sourceMeta.targetId))) {
          linkedItems.push(sourceMeta);
          await setDoc(ref, { linkedItems }, { merge: true });
        }
      }
    }
  } catch (err) {
    console.warn('addReverseLink error:', err);
  }
};
