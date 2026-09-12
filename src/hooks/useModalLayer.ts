import { useEffect, useRef, useState } from 'react';

// 팝업(모달) 계층 관리
// - 팝업이 열린 순서대로 z-index를 올려 주어, 팝업 안에서 연 팝업이 항상 위에 쌓이게 한다.
//   (예전에는 z-50 / z-[100] 처럼 값을 직접 박아두어, 부모보다 낮은 자식 팝업이 뒤에 가려졌다.
//    그래서 자식을 열 때 부모를 닫아버리는 식으로 회피하고 있었다.)
// - 닫기 버튼(✕/취소)은 그 팝업 하나만 닫고 이전 팝업은 그대로 남는다(단계적 닫기).
// - ESC 또는 배경 클릭은 closeAllModals()로 열려 있는 팝업을 전부 닫는다.

interface ModalEntry {
  id: number;
  close: () => void;
}

const BASE_Z = 1000;
const STEP_Z = 10;

let stack: ModalEntry[] = [];
let nextId = 1;
let openCount = 0;

function handleEscape(e: KeyboardEvent) {
  if (e.key === 'Escape') closeAllModals();
}

// 같은 함수 참조를 등록하므로 중복 호출되어도 리스너는 하나만 유지된다.
function syncEscapeListener() {
  if (stack.length > 0) {
    document.addEventListener('keydown', handleEscape);
  } else {
    document.removeEventListener('keydown', handleEscape);
  }
}

export function closeAllModals() {
  const snapshot = [...stack].reverse();
  stack = [];
  openCount = 0;
  syncEscapeListener();
  snapshot.forEach((entry) => {
    try {
      entry.close();
    } catch (err) {
      console.error('팝업 닫기 실패:', err);
    }
  });
}

export function useModalLayer(isOpen: boolean, onClose: () => void): number {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [zIndex, setZIndex] = useState(BASE_Z);

  useEffect(() => {
    if (!isOpen) return;

    const id = nextId++;
    openCount += 1;
    setZIndex(BASE_Z + openCount * STEP_Z);
    stack.push({ id, close: () => closeRef.current() });
    syncEscapeListener();

    return () => {
      stack = stack.filter((entry) => entry.id !== id);
      if (stack.length === 0) openCount = 0;
      syncEscapeListener();
    };
  }, [isOpen]);

  return zIndex;
}
