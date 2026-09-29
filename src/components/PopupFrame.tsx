// src/components/PopupFrame.tsx
//
// 모든 팝업의 바깥 틀. 환경설정 > 팝업 모양(popupStyle)에 따라 세 가지로 그린다.
//
//   side + 넓은 화면(768px 이상) : 메모·기록 쓰는 칸처럼 화면 오른쪽을 나눠 쓴다.
//        뒤 화면을 어둡게 덮지 않고, 스크롤도 잠그지 않는다. 왼쪽 화면은 평소처럼
//        보고 누를 수 있다. Layout이 칸 폭만큼 화면을 왼쪽으로 줄인다(useSidePopups).
//   side + 좁은 화면(휴대폰)      : 어두운 배경 위로 오른쪽에서 뜨는 배너.
//   center                       : 예전처럼 화면 가운데에 뜨는 팝업.
//
// 어느 모양이든 팝업 층(useModalLayer)에는 똑같이 든다. 그래서 겹쳐 연 팝업의 순서,
// ESC로 모두 닫기, 뒤로가기로 한 겹씩 닫기가 모양과 상관없이 그대로다.
//
// 오른쪽 칸 위에서 또 칸을 열면(팝업에서 연 팝업, 일정 쓰는 칸에서 연 링크 등) 오른쪽을
// 위아래로 나눈다. 나중에 연 것(하위)이 위, 먼저 연 것(상위)이 아래. 셋이면 셋으로 나눈다.
// 위 칸이 지금 쓰는 칸이라 더 크게 준다 (sideSlotRange).
// 메모·기록·일정 쓰는 칸(SidePanelFrame)도 같은 줄에 선다 (useSideSlot).
// 휴대폰 배너는 나누지 않는다 - 화면이 작아 반으로 나누면 둘 다 쓸 수 없다. 위에 덮는다.
//
// 칸마다 스크롤이 따로 돈다. 칸 끝까지 굴려도 뒤 화면으로 넘어가 굴러가지 않는다(overscroll-contain).
import React, { useEffect, useId } from 'react';
import { create } from 'zustand';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer } from '../hooks/useModalLayer';
import { useBackdropClose } from '../hooks/useBackdropClose';
import { useMinWidth } from '../hooks/useMinWidth';
import { useAppStore } from '../store/useAppStore';

export type ModalWidth = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';

/** 이 폭 이상이면 오른쪽 칸을 화면 옆에 붙인다 (메모·기록 칸과 같은 경계, EntryPanelHost.DOCK_MIN_WIDTH) */
const SIDE_DOCK_MIN_WIDTH = 768;

const CENTER_WIDTH: Record<ModalWidth, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
};

/** 휴대폰 배너의 최대 폭. 휴대폰에서는 어차피 화면을 꽉 채운다. */
const BANNER_WIDTH: Record<ModalWidth, string> = {
  sm: 'max-w-lg',
  md: 'max-w-lg',
  lg: 'max-w-lg',
  xl: 'max-w-lg',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
};

/**
 * 화면 옆에 붙은 칸의 폭. 보통은 메모·기록 칸(EntryPanelHost.entryPanelWidth)과 같고,
 * 표·목록이 넓은 팝업(라벨 관리·시간표 등)만 넓게 연다. 넓게 열어도 왼쪽 화면이 남도록 vw로 묶는다.
 */
export function sidePopupWidth(width: ModalWidth): string {
  if (width === '4xl') return 'clamp(340px, 58vw, 896px)';
  if (width === '2xl') return 'clamp(340px, 46vw, 672px)';
  return 'clamp(340px, 36vw, 512px)';
}

/**
 * 지금 화면 오른쪽에 붙어 있는 칸들. order는 연 순서(먼저 연 것이 앞),
 * widths는 팝업 칸의 폭(Layout이 가장 넓은 만큼 화면을 줄인다. 쓰는 칸의 폭은 Layout이 따로 안다).
 */
export const useSidePopups = create<{ order: string[]; widths: Record<string, string> }>(() => ({
  order: [],
  widths: {},
}));

export interface SideSlot {
  /** 위에서부터 몇 번째 칸인가 (0이 맨 위 = 가장 나중에 연 것) */
  row: number;
  /** 오른쪽을 몇 칸으로 나눴나 */
  rows: number;
}

/**
 * 오른쪽 줄에 자리를 잡는다. 켜져 있는 동안 줄에 서고, 몇 번째 칸인지 돌려준다.
 * width를 주면 그 폭을 Layout에 알린다 (팝업 칸). 쓰는 칸(SidePanelFrame)은 주지 않는다.
 */
export function useSideSlot(active: boolean, width?: string): SideSlot {
  const id = useId();
  useEffect(() => {
    if (!active) return;
    useSidePopups.setState((s) => ({
      order: [...s.order, id],
      widths: width ? { ...s.widths, [id]: width } : s.widths,
    }));
    return () => {
      useSidePopups.setState((s) => {
        const widths = { ...s.widths };
        delete widths[id];
        return { order: s.order.filter((x) => x !== id), widths };
      });
    };
  }, [active, width, id]);

  const order = useSidePopups((s) => s.order);
  const index = order.indexOf(id);
  if (!active || index < 0) return { row: 0, rows: 1 };
  return { row: order.length - 1 - index, rows: order.length };
}

/**
 * 나눈 칸의 위치(화면 높이의 %). 맨 위 칸이 지금 쓰는 칸이라 더 크게 준다.
 * 똑같이 반으로 나누니 위 칸(단축키·링크 고르기 등)의 저장 줄이 화면 밖으로 밀렸다.
 *   둘: 62 / 38     셋: 50 / 25 / 25
 */
export function sideSlotRange({ row, rows }: SideSlot): { top: number; height: number } {
  if (rows <= 1) return { top: 0, height: 100 };
  const first = rows === 2 ? 62 : 50;
  const rest = (100 - first) / (rows - 1);
  if (row === 0) return { top: 0, height: first };
  return { top: first + (row - 1) * rest, height: rest };
}

export function sideSlotStyle(slot: SideSlot): React.CSSProperties {
  const { top, height } = sideSlotRange(slot);
  return { top: `${top}%`, height: `${height}%` };
}

/**
 * 칸 안쪽 판의 높이. 나뉘지 않았으면 칸을 꽉 채우고, 나뉘면 최소 32rem은 준다.
 * 반으로 나뉜 칸에 판을 억지로 맞추면 가운데 목록(링크 고르기 등)이 0으로 눌려 쓸 수 없었다.
 * 모자란 만큼은 칸이 스스로 스크롤한다.
 */
export function sideSlotInnerStyle({ rows }: SideSlot): React.CSSProperties {
  return { height: rows > 1 ? 'max(100%, 32rem)' : '100%' };
}

/** 나뉜 칸 사이의 줄. 맨 위 칸이 아니면 위쪽에 굵은 줄을 둔다. */
export function sideSlotClass({ row }: SideSlot): string {
  return row > 0 ? 'border-t-4 border-t-slate-300' : '';
}

interface PopupFrameProps {
  isOpen: boolean;
  onClose: () => void;
  width?: ModalWidth;
  /** 배경을 눌렀을 때 할 일. 주지 않으면 열린 팝업을 모두 닫는다. (옆에 붙은 칸에는 배경이 없다) */
  onBackdropClose?: () => void;
  /** 가운데 팝업의 판에 더할 class (예: 모서리·그림자를 조금 다르게) */
  cardClassName?: string;
  children: React.ReactNode;
}

export default function PopupFrame({
  isOpen,
  onClose,
  width = 'md',
  onBackdropClose,
  cardClassName = '',
  children,
}: PopupFrameProps) {
  const side = useAppStore((s) => s.popupStyle) !== 'center';
  const wide = useMinWidth(SIDE_DOCK_MIN_WIDTH);
  const docked = isOpen && side && wide;

  // 옆에 붙은 칸은 왼쪽 화면과 함께 쓰므로 본문 스크롤을 잠그지 않는다
  useBodyScrollLock(isOpen && !docked);
  const vv = useVisualViewport(isOpen);
  const zIndex = useModalLayer(isOpen, onClose);
  const backdrop = useBackdropClose(onBackdropClose);
  const slot = useSideSlot(docked, sidePopupWidth(width));

  if (!isOpen) return null;

  if (docked) {
    return (
      <aside
        role="dialog"
        data-popup-frame="side"
        className={`fixed right-0 bg-white border-l border-slate-200 shadow-xl flex flex-col overflow-y-auto overscroll-contain animate-fade-in ${sideSlotClass(slot)}`}
        style={{ ...sideSlotStyle(slot), width: sidePopupWidth(width), zIndex }}
      >
        <div className="flex flex-col shrink-0" style={sideSlotInnerStyle(slot)}>
          {children}
        </div>
      </aside>
    );
  }

  if (side) {
    return (
      <div
        className="fixed inset-0 flex justify-end"
        style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }}
        data-popup-frame="banner"
      >
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs animate-fade-in" {...backdrop} />
        <div
          role="dialog"
          className={`relative bg-white h-full w-full ${BANNER_WIDTH[width]} shadow-2xl flex flex-col overflow-y-auto overscroll-contain`}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 flex items-start justify-center overflow-y-auto p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
      style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }}
      data-popup-frame="center"
      {...backdrop}
    >
      <div
        role="dialog"
        className={`bg-white w-full ${CENTER_WIDTH[width]} max-h-full rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden ${cardClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
