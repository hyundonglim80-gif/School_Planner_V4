// src/lib/evalArchive.ts
//
// 한 학급의 한 학년도 조사표를 모은다 (ROADMAP 9 - 학생 카드·조사표 모아 보기). 읽기만 한다.
//
//   {공간}/evaluations/{날짜}  날짜 문서마다 그날 조사표 목록(evalList - V3 이름, lib/evalList.readEvalList로 읽는다)
//
// 학년도(3월 ~ 이듬해 2월)의 날짜 문서를 범위로 읽고, 만들 때의 학급(rosterMeta)이 이 학급인 것만 고른다.
// 공간은 부르는 쪽이 정한다(개인 + 지금 고른 공유 그룹 - 학생 기록(누가기록)과 같다).
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { readEvalList } from './evalList';
import { isClassEval } from './classHub';
import { schoolYearRange } from './evalSummary';
import type { EvaluationItem } from '../hooks/useEvaluation';

export interface ArchivedEval extends EvaluationItem {
  /** 어느 공간의 것인가 (null = 개인) */
  space: string | null;
  spaceName: string;
}

export interface EvalSpace {
  id: string | null;
  name: string;
}

/** 그 학급의 그 학년도 조사표 (공간마다 읽어 합친다). 못 읽으면 던진다 */
export async function loadClassEvals(
  uid: string,
  spaces: EvalSpace[],
  cls: { year: number | string; grade: string | number; classNum: string | number }
): Promise<ArchivedEval[]> {
  const { start, end } = schoolYearRange(Number(cls.year));
  const perSpace = await Promise.all(
    spaces.map(async (space) => {
      const col = space.id ? collection(db, 'groups', space.id, 'evaluations') : collection(db, 'users', uid, 'evaluations');
      const snap = await getDocs(query(col, where(documentId(), '>=', start), where(documentId(), '<=', end)));
      const out: ArchivedEval[] = [];
      snap.forEach((d) => {
        for (const ev of readEvalList(d.data()) as EvaluationItem[]) {
          if (!ev || !isClassEval(ev, cls)) continue;
          out.push({ ...ev, dateStr: ev.dateStr || d.id, space: space.id, spaceName: space.name });
        }
      });
      return out;
    })
  );
  return perSpace.flat();
}
