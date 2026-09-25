// src/lib/memoEvents.ts
//
// 헤더의 '새 메모 작성' 단추와 메모 화면의 오른쪽 배너를 잇는다.
// 단추는 Layout(헤더)에 있고 배너는 MemoScreen이 가지고 있어서, 둘 사이에
// 신호 하나만 주고받는다.
const NEW_MEMO_EVENT = 'sp4:new-memo';

/** 메모 화면에 새 메모 배너를 열어 달라고 알린다. */
export function requestNewMemo() {
  window.dispatchEvent(new CustomEvent(NEW_MEMO_EVENT));
}

/** 새 메모 요청을 듣는다. 돌려준 함수를 부르면 그만 듣는다. */
export function onNewMemoRequest(handler: () => void): () => void {
  window.addEventListener(NEW_MEMO_EVENT, handler);
  return () => window.removeEventListener(NEW_MEMO_EVENT, handler);
}
