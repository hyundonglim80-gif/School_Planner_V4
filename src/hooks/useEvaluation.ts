import { useState, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

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
        return snap.data().list || [];
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
      await setDoc(ref, { list, updatedAt: Date.now() }, { merge: true });
    } catch (e) {
      console.error('saveEvaluations error:', e);
      throw e;
    }
  }, [getDocRef]);

  const deleteEvaluation = useCallback(async (dateStr: string, evalId: string) => {
    const list = await loadEvaluations(dateStr);
    const filtered = list.filter(e => e.id !== evalId);
    await saveEvaluations(dateStr, filtered);
    return filtered;
  }, [loadEvaluations, saveEvaluations]);

  return { loading, loadEvaluations, saveEvaluations, deleteEvaluation };
}
