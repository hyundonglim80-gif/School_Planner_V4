// src/components/ColumnResizer.tsx
//
// 오른쪽 줄(팝업·쓰는 칸)과 왼쪽 클립보드 칸의 경계선. 끌어서 폭을 바꾼다.
//   - 바꾼 폭은 이 기기에 기억한다 (useAppStore.rightPanelWidth / leftPanelWidth).
//   - 두 번 누르면 기본 폭으로 돌아간다.
//   - 반대쪽 화면이 320px은 남도록 묶는다.
// 넓은 화면에서 칸이 화면 옆에 붙어 있을 때만 Layout이 그린다.
import { useRef } from 'react';
import { useAppStore } from '../store/useAppStore';

const MIN_PX = 280;
const KEEP_MAIN_PX = 320;

export default function ColumnResizer({ side, width }: { side: 'left' | 'right'; width: string }) {
  const setWidth = useAppStore((s) => (side === 'right' ? s.setRightPanelWidth : s.setLeftPanelWidth));
  const dragging = useRef(false);

  const widthAt = (clientX: number) => {
    const px = side === 'right' ? window.innerWidth - clientX : clientX;
    return Math.round(Math.max(MIN_PX, Math.min(px, window.innerWidth - KEEP_MAIN_PX)));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'right' ? '오른쪽 칸 폭 조절' : '클립보드 칸 폭 조절'}
      title="끌어서 폭 조절 · 두 번 눌러 기본 폭"
      data-column-resizer={side}
      className="fixed top-0 bottom-0 z-[46] w-2 cursor-col-resize touch-none group"
      // 경계선을 가운데에 두고 양쪽으로 0.25rem씩 잡을 자리를 준다
      style={side === 'right' ? { right: `calc(${width} - 0.25rem)` } : { left: `calc(${width} - 0.25rem)` }}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        document.body.style.userSelect = 'none';
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (dragging.current) setWidth(widthAt(e.clientX));
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        document.body.style.userSelect = '';
      }}
      onDoubleClick={() => setWidth(null)}
    >
      <div className="mx-auto h-full w-0.5 bg-transparent group-hover:bg-primary/60 transition-colors" />
    </div>
  );
}
