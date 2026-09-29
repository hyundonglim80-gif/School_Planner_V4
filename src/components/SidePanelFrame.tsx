// src/components/SidePanelFrame.tsx
//
// 오른쪽 칸(배너)의 껍데기. 메모·기록(EntryDrawer)과 일정(EventDrawer)이 함께 쓴다.
// 두 곳이 각자 들고 있으면 옆에 붙는 방식·ESC·배경 누르기가 조금씩 어긋난다.
//
//   docked  : 화면 옆에 붙는 칸. 팝업이 아니다 - 뒤 화면을 잠그지 않고, 팝업 층
//             (ESC로 모두 닫기)에도 들지 않는다. 칸 안에서 누른 ESC만 칸을 닫는다.
//             뒤로가기는 받는다 (useBackLayer).
//             팝업과 같은 오른쪽 줄에 서고(폭·스크롤은 줄이 맡는다), Layout이 그 폭만큼 화면을 줄인다.
//   아니면  : 휴대폰처럼 좁은 화면. 예전처럼 어두운 배경 위로 오른쪽에서 뜬다.
import React, { useContext } from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer, useBackLayer } from '../hooks/useModalLayer';
import { useBackdropClose } from '../hooks/useBackdropClose';
import { createPortal } from 'react-dom';
import { useSideSlot, sideSlotProps, getSideColumn } from './PopupFrame';
import { PanelRaiseContext } from './panelRaise';

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
  const raisedAt = useContext(PanelRaiseContext);
  // 휴대폰(덮는 배너)에서도 다시 연 칸이 맨 앞으로 오게 층에 다시 선다
  const zIndex = useModalLayer(!docked, onClose, raisedAt);
  // 옆에 붙은 칸은 팝업이 아니지만 휴대폰 뒤로가기는 칸을 닫아야 한다 (안 그러면 크롬이 닫힌다)
  useBackLayer(docked, onClose);
  // 이 칸 위에서 팝업·다른 칸을 열면 그것이 위에 쌓이고 이 칸은 아래로 내려간다.
  // 이미 열린 이 칸을 다시 열면(raisedAt) 줄에 다시 서서 맨 위로 올라온다.
  const slot = useSideSlot(docked, raisedAt);
  const backdrop = useBackdropClose(onBackdropClose);

  if (docked) {
    // 팝업과 같은 오른쪽 줄(PopupFrame.getSideColumn)에 선다. 폭도, 스크롤도 줄이 맡는다.
    const { className, style } = sideSlotProps(slot);
    return createPortal(
      <aside
        ref={panelRef}
        aria-label={ariaLabel}
        className={className}
        style={style}
        onKeyDown={(e) => {
          // 이 칸 안에서 누른 ESC는 이 칸만 닫는다 (저장하지 않는다)
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {children}
      </aside>,
      getSideColumn()
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
      {/* 칸이 여럿 떠 있을 때 Ctrl+S가 커서가 든 칸만 저장하도록, 휴대폰에서도 칸을 가리킨다 */}
      <div ref={panelRef as React.RefObject<HTMLDivElement>} className="contents">
        {children}
      </div>
    </div>
  );
}

/** 칸의 안쪽 판. 옆에 붙을 때는 칸을 꽉 채우고, 뜰 때는 오른쪽에 너비를 정해 붙는다. */
export function sidePanelClass(docked: boolean) {
  return `relative bg-white h-full flex flex-col ${
    docked ? 'w-full' : 'w-full max-w-lg shadow-2xl z-10 transform transition-transform duration-300 ease-in-out'
  }`;
}
