import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

export interface Student {
  num: number;
  name: string;
  gender?: string; // 'M' | 'F' | ''
  isActive?: boolean;
  note?: string;
}

export interface ClassRoster {
  year: number;
  grade: string;
  classNum: string;
  students: Student[];
}

export function useRoster() {
  const [rosterList, setRosterList] = useState<ClassRoster[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setRosterList([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const rosterDocRef = doc(db, 'users', user.uid, 'settings', 'rosters');

    const unsubscribe = onSnapshot(rosterDocRef, async (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        let list: any[] = data.classList || data.rosters || data.list || [];
        
        // 정규화: V3의 num, number 호환
        const normalized: ClassRoster[] = list.map((item) => ({
          year: item.year || new Date().getFullYear(),
          grade: String(item.grade || ''),
          classNum: String(item.classNum || ''),
          students: (item.students || []).map((s: any, idx: number) => ({
            num: s.num !== undefined ? Number(s.num) : (s.number !== undefined ? Number(s.number) : idx + 1),
            name: s.name || '',
            gender: s.gender || '',
            isActive: s.isActive !== false,
            note: s.note || '',
          })),
        }));

        setRosterList(normalized);
      } else {
        // V3 구버전 단일 roster 문서 확인
        try {
          const oldDocRef = doc(db, 'users', user.uid, 'settings', 'roster');
          const oldSnap = await getDoc(oldDocRef);
          if (oldSnap.exists()) {
            const oldData = oldSnap.data();
            setRosterList([{
              year: oldData.year || new Date().getFullYear(),
              grade: String(oldData.grade || ''),
              classNum: String(oldData.classNum || ''),
              students: (oldData.students || []).map((s: any, idx: number) => ({
                num: s.num !== undefined ? Number(s.num) : idx + 1,
                name: s.name || '',
                gender: s.gender || '',
                isActive: s.isActive !== false,
                note: s.note || '',
              })),
            }]);
          } else {
            setRosterList([]);
          }
        } catch (e) {
          setRosterList([]);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [auth.currentUser?.uid]);

  const saveRosterList = useCallback(async (newList: ClassRoster[]) => {
    const user = auth.currentUser;
    if (!user) return;
    const rosterDocRef = doc(db, 'users', user.uid, 'settings', 'rosters');
    await setDoc(rosterDocRef, {
      classList: newList, // V3 필드명 호환
      rosters: newList,   // V4 필드명 호환
      updatedAt: Date.now(),
    }, { merge: true });
  }, []);

  return {
    rosterList,
    loading,
    saveRosterList,
  };
}
