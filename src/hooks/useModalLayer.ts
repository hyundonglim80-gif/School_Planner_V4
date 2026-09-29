import { useEffect, useRef, useState } from 'react';

// 팝업(모달) 계층 관리
// - 팝업이 열린 순서대로 z-index를 올려 주어, 팝업 안에서 연 팝업이 항상 위에 쌓이게 한다.
//   (예전에는 z-50 / z-[100] 처럼 값을 직접 박아두어, 부모보다 낮은 자식 팝업이 뒤에 가려졌다.
//    그래서 자식을 열 때 부모를 닫아버리는 식으로 회피하고 있었다.)
// - 닫기 버튼(✕/취소)은 그 팝업 하나만 닫고 이전 팝업은 그대로 남는다(단계적 닫기).
// - ESC 또는 배경 클릭은 closeAllModals()로 열려 있는 팝업을 전부 닫는다.
// - 휴대폰 뒤로가기는 맨 위 팝업 하나만 닫는다 (아래 '뒤로가기' 참고).
// - 화면 옆에 붙은 오른쪽 칸(useBackLayer)은 팝업이 아니지만 뒤로가기는 받는다.

interface ModalEntry {
  id: number;
  close: () => void;
  /**
   * 뒤로가기만 받는 층 (화면 옆에 붙은 오른쪽 칸).
   * 팝업이 아니므로 ESC·배경 누르기(closeAllModals)로 닫히지 않고, 쌓임 순서(z-index)에도 끼지 않는다.
   */
  backOnly?: boolean;
}

const BASE_Z = 1000;
const STEP_Z = 10;

let stack: ModalEntry[] = [];
let nextId = 1;
let openCount = 0;

// ── 뒤로가기로 팝업 닫기 ─────────────────────────────────────────────
//
// 휴대폰에서 팝업을 열어 두고 뒤로가기를 누르면 앱이 통째로 닫혔다.
// 이 앱은 주소가 하나뿐이라(라우터가 없다) 팝업을 열어도 브라우저가 기억하는
// 자리는 그대로다. 그래서 뒤로가기가 곧 '앱에서 나가기'가 된다.
//
// 팝업이 열려 있는 동안 브라우저 기록에 자리를 딱 하나 만들어 둔다(표지판).
// 뒤로가기가 오면 그 표지판이 물러나면서 맨 위 팝업 하나만 닫고, 아래에 팝업이
// 더 남아 있으면 표지판을 다시 세운다. 그래서 뒤로가기를 누를 때마다 한 겹씩
// 벗겨지고, 마지막 팝업까지 닫힌 뒤의 뒤로가기라야 앱에서 나간다.
//
// ⚠️ 자리를 팝업마다 하나씩 쌓지 않는다. 그러면 우리가 되돌려야 할 자리 수를
//    세어 가며 맞춰야 하는데, 한 번이라도 어긋나면 그 뒤의 진짜 뒤로가기를
//    통째로 삼켜 버린다. 표지판 하나면 셀 것이 없다.
const HISTORY_MARK = 'sp4Modal';

/** 표지판이 지금 세워져 있는가 */
let signPosted = false;
/** 우리가 스스로 물러나려고 back()을 불렀다. 그때 오는 popstate는 우리 것이다. */
let awaitingSelfPop = false;
let selfPopTimer: ReturnType<typeof setTimeout> | null = null;
/** 기록이 이미 물러난 팝업 id (뒤로가기로 닫혔거나 한꺼번에 정리됐다) */
const historyHandled = new Set<number>();

/** 뒤로가기만 받는 층을 뺀 진짜 팝업들 */
const modalEntries = () => stack.filter((entry) => !entry.backOnly);

const canUseHistory = () => typeof window !== 'undefined' && !!window.history;

function clearSelfPopWait() {
  awaitingSelfPop = false;
  if (selfPopTimer) {
    clearTimeout(selfPopTimer);
    selfPopTimer = null;
  }
}

function postSign() {
  if (signPosted || !canUseHistory()) return;
  try {
    window.history.pushState({ [HISTORY_MARK]: true }, '');
    signPosted = true;
    // 새 표지판을 세웠으면 앞의 기다림은 더 볼 것이 없다.
    clearSelfPopWait();
  } catch {
    /* 기록을 못 쓰는 환경이면 뒤로가기 연동만 빠지고 나머지는 그대로 돈다 */
  }
}

function removeSign() {
  if (!signPosted || !canUseHistory()) return;
  signPosted = false;
  awaitingSelfPop = true;
  // popstate가 끝내 안 오면(뒤로 갈 자리가 없는 등) 기다림을 스스로 푼다.
  // 안 풀면 그다음 진짜 뒤로가기를 삼켜 버린다.
  if (selfPopTimer) clearTimeout(selfPopTimer);
  selfPopTimer = setTimeout(clearSelfPopWait, 600);
  try {
    window.history.back();
  } catch {
    clearSelfPopWait();
  }
}

function handlePopState() {
  if (awaitingSelfPop) {
    clearSelfPopWait();
    return;
  }
  // 팝업이 없으면 진짜 뒤로가기다. 막지 않는다.
  if (stack.length === 0) return;

  // 방금 표지판이 물러났다.
  signPosted = false;

  const top = stack[stack.length - 1];
  historyHandled.add(top.id);
  try {
    top.close();
  } catch (err) {
    console.error('팝업 닫기 실패:', err);
  }

  // 아래에 아직 팝업이 남아 있으면 다음 뒤로가기도 받아야 한다.
  // (이 시점의 stack에는 방금 닫은 것이 아직 들어 있다 - React가 나중에 뺀다)
  if (stack.length > 1) postSign();
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === 'Escape') closeAllModals();
}

// popstate는 늘 듣는다. 팝업이 없을 때는 위에서 곧바로 돌아 나가므로 하는 일이
// 없고, 우리가 스스로 부른 back()의 답을 놓치지 않는다. (팝업이 있을 때만 듣게
// 하면, 마지막 팝업을 닫으며 부른 back()의 popstate를 아무도 안 받는다)
let popStateBound = false;
function bindPopState() {
  if (popStateBound || typeof window === 'undefined') return;
  window.addEventListener('popstate', handlePopState);
  popStateBound = true;
}

// 같은 함수 참조를 등록하므로 중복 호출되어도 리스너는 하나만 유지된다.
function syncEscapeListener() {
  if (modalEntries().length > 0) {
    document.addEventListener('keydown', handleEscape);
  } else {
    document.removeEventListener('keydown', handleEscape);
  }
}

/**
 * 지금 팝업이 하나라도 열려 있는지.
 * 화면 안의 수정 섹션을 "바깥 클릭"으로 닫을 때, 그 섹션에서 띄운 팝업(알림/링크/
 * 라벨/조사표)은 DOM상 섹션 밖에 그려지므로 그 클릭까지 바깥으로 세면 안 된다.
 */
export function isAnyModalOpen(): boolean {
  return modalEntries().length > 0;
}

export function closeAllModals() {
  const snapshot = modalEntries().reverse();
  // 옆에 붙은 칸은 팝업이 아니다. 팝업 배경을 눌렀다고 같이 닫히면 안 된다.
  stack = stack.filter((entry) => entry.backOnly);
  openCount = 0;
  syncEscapeListener();
  // 한꺼번에 닫으므로 아래 각 팝업의 정리에서 또 물러나지 않도록 미리 표시한다.
  snapshot.forEach((entry) => historyHandled.add(entry.id));
  snapshot.forEach((entry) => {
    try {
      entry.close();
    } catch (err) {
      console.error('팝업 닫기 실패:', err);
    }
  });
  // 옆에 붙은 칸이 남아 있으면 그 칸이 표지판을 계속 쓴다.
  if (snapshot.length > 0 && stack.length === 0) removeSign();
}

/**
 * raise가 바뀌면 층에서 빠졌다가 맨 위로 다시 선다 (휴대폰에서 이미 열린 쓰는 칸을 다시 열 때).
 * 빠지고 서는 것이 한 번에 일어나므로 뒤로가기 표지판은 그대로 둔다(아래 '한 박자 늦게').
 */
export function useModalLayer(isOpen: boolean, onClose: () => void, raise?: number): number {
  return useLayer(isOpen, onClose, false, raise);
}

/**
 * 뒤로가기만 받는 층. 화면 옆에 붙은 오른쪽 칸(메모·기록·일정·알림장·출석부)이 쓴다.
 *
 * 옆에 붙은 칸은 팝업이 아니라서 useModalLayer를 거치지 않았고, 그래서 기록에 자리를
 * 만들지 않았다. 태블릿·가로 화면·'데스크톱 사이트'처럼 폭이 768px 이상인 휴대 기기에서
 * 칸을 열고 뒤로가기를 누르면 칸이 아니라 크롬이 닫혔다.
 * 팝업과 같은 표지판을 함께 쓰므로, 칸 위에 팝업을 띄워도 뒤로가기는 맨 위부터 한 겹씩 닫는다.
 */
export function useBackLayer(isOpen: boolean, onClose: () => void): void {
  useLayer(isOpen, onClose, true);
}

function useLayer(isOpen: boolean, onClose: () => void, backOnly: boolean, raise?: number): number {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [zIndex, setZIndex] = useState(BASE_Z);

  useEffect(() => {
    if (!isOpen) return;

    const id = nextId++;
    if (!backOnly) {
      openCount += 1;
      setZIndex(BASE_Z + openCount * STEP_Z);
    }
    stack.push({ id, close: () => closeRef.current(), backOnly });
    bindPopState();
    postSign();
    syncEscapeListener();

    return () => {
      stack = stack.filter((entry) => entry.id !== id);
      if (modalEntries().length === 0) openCount = 0;
      syncEscapeListener();

      // 뒤로가기로 닫혔거나 한꺼번에 정리된 것이면 기록은 이미 물러나 있다.
      if (historyHandled.has(id)) {
        historyHandled.delete(id);
        return;
      }
      // 닫기 단추처럼 스스로 닫힌 경우. 마지막 층이었으면 표지판을 치운다.
      // (아래에 층이 남아 있으면 그것이 계속 쓰므로 그대로 둔다)
      //
      // ⚠️ 한 박자 늦게 본다. 오른쪽 칸에서 다른 항목을 열거나(칸을 새로 그린다) 화면을
      //    돌려 칸이 옆에 붙었다 떴다 하면, 같은 순간에 앞 층이 닫히고 새 층이 열린다.
      //    여기서 곧바로 back()을 부르면 새 층이 세운 표지판 뒤에 그 back()이 도착해
      //    방금 연 칸을 닫아 버린다.
      queueMicrotask(() => {
        if (stack.length === 0) removeSign();
      });
    };
  }, [isOpen, backOnly, raise]);

  return zIndex;
}
