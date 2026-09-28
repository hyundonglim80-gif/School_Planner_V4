// src/components/SidePanelFrame.tsx
//
// 오른쪽 칸(배너)의 껍데기. 메모·기록(EntryDrawer)과 일정(EventDrawer)이 함께 쓴다.
// 두 곳이 각자 들고 있으면 옆에 붙는 방식·ESC·배경 누르기가 조금씩 어긋난다.
//
//   docked  : 화면 옆에 붙는 칸. 팝업이 아니다 - 뒤 화면을 잠그지 않고, 팝업 층
//             (ESC로 모두 닫기)에도 들지 않는다. 칸 안에서 누른 ESC만 칸을 닫는다.
//             Layout이 이 폭(--entry-panel-w)만큼 화면을 왼쪽으로 줄여 둔다.
//   아니면  : 휴대폰처럼 좁은 화면. 예전처럼 어두운 배경 위로 오른쪽에서 뜬다.
import React from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer } from '../hooks/useModalLayer';
import { useBackdropClose } from '../hooks/useBackdropClose';

interface SidePanelFrameProps {
  docked: boolean;
  /** 닫기 (저장 없이). ESC가 부른다. */
  onClose: () => void;
  /** 배경을 눌렀을 때 (좁은 화면에서만). 고친 것을 저장하고 닫는 쪽이 쓴다. */
  onBackdropClose: () => void;
  /** 옆에 붙은 칸의 이름 (예: '일정 쓰기') */
  ariaLabel: string;
  /** 옆에 붙은 칸. 초점이 칸 안에 있는지 알아볼 때 쓴다. */
  panelRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

export default function SidePanelFrame({
  docked,
  onClose,
  onBackdropClose,
  ariaLabel,
  panelRef,
  children,
}: SidePanelFrameProps) {
  useBodyScrollLock(!docked);
  const vv = useVisualViewport(true);
  const zIndex = useModalLayer(!docked, onClose);
  const backdrop = useBackdropClose(onBackdropClose);

  if (docked) {
    return (
      <aside
        ref={panelRef}
        aria-label={ariaLabel}
        className="fixed top-0 right-0 bottom-0 z-[45] border-l border-slate-200 shadow-xl bg-white"
        style={{ width: 'var(--entry-panel-w)' }}
        onKeyDown={(e) => {
          // 이 칸 안에서 누른 ESC는 이 칸만 닫는다 (저장하지 않는다)
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {children}
      </aside>
    );
  }

  return (
    <div
      className="fixed inset-0 flex justify-end"
      style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }}
    >
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300"
        {...backdrop}
      />
      {children}
    </div>
  );
}

/** 칸의 안쪽 판. 옆에 붙을 때는 칸을 꽉 채우고, 뜰 때는 오른쪽에 너비를 정해 붙는다. */
export function sidePanelClass(docked: boolean) {
  return `relative bg-white h-full flex flex-col ${
    docked ? 'w-full' : 'w-full max-w-lg shadow-2xl z-10 transform transition-transform duration-300 ease-in-out'
  }`;
}
