import { useState, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { moveToTrash } from '../utils/trashHelper';

export interface EvalRecord {
  [studentNum: number]: {
    indivScore?: string;
    groupScore?: string;
    groupName?: string;
    reason?: string;
    checked?: boolean;
    memo?: string;
  };
}

export interface EvaluationItem {
  id: string;
  authorId?: string;
  title: string;
  subject: string;
  type: 'eval' | 'check' | 'memo';
  methodObj: { indiv: boolean; group: boolean };
  steps: string[];
  groups: { name: string; members: number[] }[];
  dateStr: string;
  periodStr: number | string;
  context: { source: string; period: number | string };
  rosterMeta: { year: number | string; grade: string; classNum: string };
  studentsSnapshot: { num: number; name: string; gender: string }[];
  records: EvalRecord;
}

export function useEvaluation(groupId?: string | null) {
  const [loading, setLoading] = useState(false);

  const getDocRef = useCallback((dateStr: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return null;
    if (groupId && groupId !== 'personal') {
      return doc(db, 'groups', groupId, 'evaluations', dateStr);
    }
    return doc(db, 'users', uid, 'evaluations', dateStr);
  }, [groupId]);

  const loadEvaluations = useCallback(async (dateStr: string): Promise<EvaluationItem[]> => {
    const ref = getDocRef(dateStr);
    if (!ref) return [];
    setLoading(true);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        // 💡 V3는 같은 문서를 evalList 라는 이름으로 읽고 쓴다. V4가 list만 보던 탓에
        // V3에서 만든 조사표가 V4에 하나도 안 보였다(그 반대도 마찬가지).
        const data = snap.data();
        return data.list || data.evalList || [];
      }
      return [];
    } catch (e) {
      console.error('loadEvaluations error:', e);
      return [];
    } finally {
      setLoading(false);
    }
  }, [getDocRef]);

  const saveEvaluations = useCallback(async (dateStr: string, list: EvaluationItem[]) => {
    const ref = getDocRef(dateStr);
    if (!ref) return;
    try {
      // 두 이름에 같이 쓴다. 한쪽만 쓰면 다른 앱이 옛 목록을 계속 보게 된다.
      await setDoc(ref, { list, evalList: list, updatedAt: Date.now() }, { merge: true });
    } catch (e) {
      console.error('saveEvaluations error:', e);
      throw e;
    }
  }, [getDocRef]);

  const deleteEvaluation = useCallback(async (dateStr: string, evalId: string) => {
    const list = await loadEvaluations(dateStr);
    const target = list.find(e => e.id === evalId);
    if (target) {
      try {
        await moveToTrash({
          id: target.id,
          type: 'eval',
          originalDateStr: dateStr,
          fId: groupId || 'personal',
          content: target.title,
          data: target,
        });
      } catch (err) {
        console.error('조사표 휴지통 이동 실패:', err);
      }
    }
    const filtered = list.filter(e => e.id !== evalId);
    await saveEvaluations(dateStr, filtered);
    return filtered;
  }, [loadEvaluations, saveEvaluations, groupId]);

  return { loading, loadEvaluations, saveEvaluations, deleteEvaluation };
}
