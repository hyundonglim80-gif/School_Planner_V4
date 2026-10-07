// src/lib/gcalNote.ts
//
// 일정 날짜 문서를 쓸 때 '이 날이 바뀌었다'고 알린다 (19번 U11 구글 캘린더 자동 보내기, lib/gcalAuto).
// 일정을 쓰는 곳이 여러 군데라(하루 화면·끌어 옮기기·다중 선택·기간·반복·이월·휴지통 되살리기…) 쓰기를 setEventDoc 하나로 모았다.
// 여기는 가벼워야 한다 - useAppStore도 부르므로 구글·캘린더 모듈을 들이지 않는다(서로 부르는 고리가 생긴다).
// 트랜잭션 안에서 불러도 된다: 거래가 실패해도 그날을 한 번 더 맞춰 볼 뿐이다(받는 쪽이 서버의 지금 일정으로 맞춘다).
import type { DocumentReference, Transaction } from 'firebase/firestore';
import { eventDocPayload } from './eventText';

/** date: 바뀐 날짜, list: 그날 새 일정 목록 (일정마다 켠 '구글 캘린더'를 보려고) */
type Listener = (date: string, list?: any[]) => void;
let listener: Listener | null = null;

/** gcalAuto가 듣는다 (하나만) */
export function onEventDocWrite(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** 개인 공간의 일정 날짜 문서면 그 날짜를 알린다 (그룹 공간은 1차에서 뺀다) */
export function noteEventDocWrite(path: string, list?: any[]) {
  const m = /^users\/[^/]+\/events\/(\d{4}-\d{2}-\d{2})$/.exec(path);
  if (m && listener) listener(m[1], list);
}

/** 일정 날짜 문서 쓰기: tx.set(ref, eventDocPayload(list), merge) + 알리기 */
export function setEventDoc(tx: Transaction, ref: DocumentReference, list: any[]) {
  tx.set(ref, eventDocPayload(list), { merge: true });
  noteEventDocWrite(ref.path, list);
}
