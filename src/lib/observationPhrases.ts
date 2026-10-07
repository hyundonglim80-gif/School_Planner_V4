// src/lib/observationPhrases.ts
//
// 관찰 문구 단추 (ROADMAP 10-2). 자리표 학생 칸·학생 기록(누가기록) 카드에서 누르면 그 학생 태그를 붙여 오늘 기록에 한 줄.
//
//   users/{uid}/settings/v4_observationPhrases  { phrases: string[] }   V4 전용, 계정에 하나(기기끼리 같다)
//
// 문서가 없으면 기본 문구를 보인다. 처음 고칠 때 목록 통째로 쓴다(짧은 설정 목록이라 마지막에 쓴 쪽이 남는다).
import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { subscribeDocWithServerFallback } from './firestoreSubscribe';

export const DEFAULT_PHRASES = [
  '발표를 잘함',
  '친구를 도움',
  '수업에 집중함',
  '과제를 성실히 함',
  '질문을 많이 함',
  '준비물을 안 가져옴',
];

export const MAX_PHRASES = 30;
export const MAX_PHRASE_LENGTH = 40;

const phrasesRef = (uid: string) => doc(db, 'users', uid, 'settings', 'v4_observationPhrases');

/** 빈 것·겹치는 것·너무 긴 것을 걸러 차례대로 */
export function sanitizePhrases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const p = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_PHRASE_LENGTH);
    if (p && !out.includes(p)) out.push(p);
    if (out.length >= MAX_PHRASES) break;
  }
  return out;
}

/** 문구 목록을 구독한다. 문서가 없으면 기본 문구 */
export function subscribeObservationPhrases(uid: string, onData: (phrases: string[]) => void, onError?: (err: unknown) => void) {
  return subscribeDocWithServerFallback(
    phrasesRef(uid),
    (data) => onData(data && Array.isArray(data.phrases) ? sanitizePhrases(data.phrases) : DEFAULT_PHRASES),
    onError
  );
}

/** 목록을 통째로 쓴다. 실패하면 던진다 */
export async function saveObservationPhrases(uid: string, phrases: string[]): Promise<void> {
  await setDoc(phrasesRef(uid), { phrases: sanitizePhrases(phrases), updatedAt: Date.now() });
}
