import { useState, useCallback } from 'react';
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { readEvalList, evalDocPayload } from '../lib/evalList';
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
        return readEvalList(data);
      }
      return [];
    } catch (e) {
      console.error('loadEvaluations error:', e);
      return [];
    } finally {
      setLoading(false);
    }
  }, [getDocRef]);

  /**
   * 그날 조사표 목록을 서버에서 읽어 바꿀 것만 바꿔 쓴다. 바꾼 뒤의 목록을 돌려준다.
   *
   * ⚠️ 예전에는 팝업을 열 때 읽은 목록을 고쳐 통째로 썼다. 그 사이 V3·다른 기기에서 더한 조사표가 지워졌고,
   *    새 조사표의 날짜를 바꿔 만들면 '연 날'의 목록에 새 것을 붙여 '바꾼 날' 문서를 덮어서
   *    그날 원래 있던 조사표가 사라지고 연 날의 조사표가 복사됐다.
   */
  const mutateEvaluations = useCallback(async (
    dateStr: string,
    mutate: (fresh: EvaluationItem[]) => EvaluationItem[]
  ): Promise<EvaluationItem[]> => {
    const ref = getDocRef(dateStr);
    if (!ref) return [];
    return runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const fresh = (snap.exists() ? readEvalList(snap.data()) : []) as EvaluationItem[];
      const next = mutate(fresh);
      tx.set(ref, evalDocPayload(next), { merge: true });
      return next;
    });
  }, [getDocRef]);

  /** 조사표 하나를 넣거나(없으면) 바꾼다(있으면). 그날의 나머지는 서버에 있는 그대로 둔다. */
  const upsertEvaluation = useCallback(
    (dateStr: string, item: EvaluationItem) =>
      mutateEvaluations(dateStr, (fresh) =>
        fresh.some((e) => e.id === item.id) ? fresh.map((e) => (e.id === item.id ? item : e)) : [...fresh, item]
      ),
    [mutateEvaluations]
  );

  /** 조사표 하나를 그날 목록에서 뺀다 (휴지통은 거치지 않는다 - 옮길 때 쓴다) */
  const removeEvaluation = useCallback(
    (dateStr: string, evalId: string) => mutateEvaluations(dateStr, (fresh) => fresh.filter((e) => e.id !== evalId)),
    [mutateEvaluations]
  );

  /** 휴지통에 먼저 넣고 뺀다. 남은 목록과 휴지통 문서 id(지운 뒤 안내의 '되돌리기')를 준다. */
  const deleteEvaluation = useCallback(async (dateStr: string, evalId: string) => {
    const list = await loadEvaluations(dateStr);
    const target = list.find(e => e.id === evalId);
    let trashId: string | undefined;
    if (target) {
      try {
        trashId = await moveToTrash({
          id: target.id,
          type: 'eval',
          originalDateStr: dateStr,
          fId: groupId || 'personal',
          content: target.title,
          data: target,
        });
      } catch (err) {
        // 휴지통에 못 넣었으면 지우지 않는다
        console.error('조사표 휴지통 이동 실패:', err);
        throw err;
      }
    }
    const remaining = await removeEvaluation(dateStr, evalId);
    return { remaining, trashId };
  }, [loadEvaluations, removeEvaluation, groupId]);

  return { loading, loadEvaluations, upsertEvaluation, removeEvaluation, deleteEvaluation };
}
