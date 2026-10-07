// src/components/PopupFrame.tsx
//
// 모든 팝업의 바깥 틀. 환경설정 > 창 위치(popupStyle)에 따라 세 가지로 그린다.
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
// ── 오른쪽 줄 (넓은 화면) ──
// 오른쪽에 붙는 칸은 모두 한 줄(getSideColumn)에 세운다. 메모·기록·일정 쓰는 칸
// (SidePanelFrame)도 같은 줄이다.
//   - 폭은 모두 같다 (RIGHT_COLUMN_WIDTH). 팝업마다 폭이 달라 오갈 때 화면이 들썩였다.
//   - 칸이 하나면 줄을 꽉 채운다 (안쪽 목록이 스스로 스크롤하고 저장 줄은 바닥에 붙는다).
//   - 칸 위에서 또 칸을 열면 나중에 연 것(하위)이 위, 먼저 연 것(상위)이 아래에
//     제 길이대로 쌓이고, 줄 전체가 한 덩어리로 스크롤한다. 왼쪽 화면과는 따로 돈다.
//   - 새 칸을 열면 줄을 맨 위로 올려 방금 연 칸이 보이게 한다.
// 휴대폰 배너는 줄에 세우지 않는다 - 화면이 작아 쌓아 두면 쓸 수 없다. 위에 덮는다.
import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
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

/**
 * 오른쪽 줄의 폭. 모든 칸(팝업·메모·기록·일정 쓰는 칸)이 이 폭 하나를 쓴다.
 * 모니터 절반(약 940px)에서도 왼쪽 화면이 반 넘게 남도록 36vw로 두고, 너무 좁거나 넓지 않게 묶는다.
 */
export const RIGHT_COLUMN_WIDTH = 'clamp(340px, 36vw, 512px)';

/**
 * 지금 오른쪽 줄의 폭. 경계선을 끌어 바꾼 폭(Layout이 --right-column-w 로 건다)이 있으면 그것,
 * 없으면 기본 폭. 창을 좁혀도 왼쪽 화면이 320px은 남도록 묶는다.
 */
export const RIGHT_COLUMN_CSS_WIDTH = `min(var(--right-column-w, ${RIGHT_COLUMN_WIDTH}), calc(100vw - 320px))`;

const CENTER_WIDTH: Record<ModalWidth, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
};

/** 지금 오른쪽 줄에 선 칸들. 연 순서(먼저 연 것이 앞). Layout은 하나라도 있으면 화면을 줄인다. */
export const useSidePopups = create<{ order: string[] }>(() => ({ order: [] }));

let columnEl: HTMLElement | null = null;

/** 오른쪽 줄. 칸들이 여기에 그려진다(createPortal). 비어 있으면 보이지 않는다. */
export function getSideColumn(): HTMLElement {
  if (columnEl && columnEl.isConnected) return columnEl;
  columnEl = document.createElement('div');
  columnEl.id = 'side-column';
  columnEl.setAttribute('data-side-column', '');
  columnEl.className =
    'fixed top-0 right-0 bottom-0 z-[45] flex flex-col bg-white border-l border-slate-200 shadow-xl overflow-y-auto overscroll-contain empty:hidden';
  columnEl.style.width = RIGHT_COLUMN_CSS_WIDTH;
  document.body.appendChild(columnEl);
  return columnEl;
}

export interface SideSlot {
  /** 위에서부터 몇 번째 칸인가 (0이 맨 위 = 가장 나중에 연 것) */
  row: number;
  /** 줄에 선 칸 수 */
  rows: number;
}

/**
 * 오른쪽 줄에 선다. 켜져 있는 동안 줄에 서고, 위에서 몇 번째인지 돌려준다.
 * raise가 바뀌면 줄에서 빠졌다가 다시 서서 맨 위로 간다 (이미 열린 쓰는 칸을 다시 열 때).
 */
export function useSideSlot(active: boolean, raise?: number): SideSlot {
  const id = useId();
  useEffect(() => {
    if (!active) return;
    useSidePopups.setState((s) => ({ order: [...s.order, id] }));
    // 방금 연 칸은 맨 위에 선다. 줄을 아래로 굴려 둔 채였으면 올려서 보이게 한다.
    getSideColumn().scrollTop = 0;
    return () => {
      useSidePopups.setState((s) => ({ order: s.order.filter((x) => x !== id) }));
    };
  }, [active, id, raise]);

  const order = useSidePopups((s) => s.order);
  const index = order.indexOf(id);
  if (!active || index < 0) return { row: 0, rows: 1 };
  return { row: order.length - 1 - index, rows: order.length };
}

/**
 * 줄 안에서 한 칸의 자리. 혼자면 줄을 꽉 채우고, 여럿이면 제 길이대로 쌓인다
 * (나중에 연 것이 위 - order). 칸 사이에는 굵은 줄을 둔다.
 */
export function sideSlotProps({ row, rows }: SideSlot): { className: string; style: React.CSSProperties } {
  return {
    className: `flex flex-col bg-white shrink-0 ${row > 0 ? 'border-t-4 border-t-slate-300' : ''}`,
    style: rows > 1 ? { order: row } : { order: row, height: '100%' },
  };
}

interface PopupFrameProps {
  isOpen: boolean;
  onClose: () => void;
  /** 바뀌면 오른쪽 줄의 맨 위로 올라간다 (이미 열린 배너를 다시 열 때) */
  raise?: number;
  /** 가운데 창의 폭. 오른쪽 칸·휴대폰 배너는 폭이 모두 같다. */
  width?: ModalWidth;
  /** 배경을 눌렀을 때 할 일. 주지 않으면 열린 팝업을 모두 닫는다. (옆에 붙은 칸에는 배경이 없다) */
  onBackdropClose?: () => void;
  /** 가운데 창의 판에 더할 class (예: 모서리·그림자를 조금 다르게) */
  cardClassName?: string;
  /**
   * Ctrl+S로 할 저장. 주지 않으면 글을 쓰던 입력칸이 든 <form>을 제출한다(D-Day·그룹 등).
   * 이 팝업 안에 커서가 있을 때(또는 아무 데도 없고 이 팝업이 맨 위일 때)만 받는다 - 겹쳐 연
   * 팝업에서 누른 Ctrl+S가 아래 팝업·쓰는 칸까지 저장하지 않게.
   */
  onSave?: () => void;
  children: React.ReactNode;
}

const isSaveKey = (e: KeyboardEvent) =>
  (e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyS' || e.key.toLowerCase() === 's');

/**
 * 오른쪽 줄(화면 옆에 붙은 팝업·쓰는 칸)에서 맨 위 칸인가. 줄 안의 차례는 CSS order로
 * 정해진다(0이 맨 위 = 가장 나중에 연 것). 줄 밖이면 false.
 * 커서가 아무 데도 없을 때(칸의 빈 곳이나 왼쪽 화면을 누른 뒤) Ctrl+S를 누가 받을지 정한다.
 */
export function isTopSideItem(el: Element | null | undefined): boolean {
  const item = el?.closest('#side-column > *') as HTMLElement | null;
  return !!item && item.style.order === '0';
}

/** 열려 있는 팝업 판 가운데 맨 위인가 (오른쪽 줄 안이면 줄의 맨 위, 밖이면 나중에 그려진 것) */
function isTopDialog(el: HTMLElement) {
  if (el.closest('#side-column')) return isTopSideItem(el);
  const all = [...document.querySelectorAll('[data-popup-card]')].filter((c) => !c.closest('#side-column'));
  return all[all.length - 1] === el;
}

/**
 * 팝업 안에서 누른 Ctrl+S. 예전에는 일정·메모·기록·조사표 칸만 받고, 저장 단추가 있는
 * 나머지 팝업(환경설정·라벨·시간표·D-Day 등)에서는 브라우저 '다른 이름으로 저장'만 막고 아무 일도 없었다.
 */
function useSaveKey(isOpen: boolean, cardRef: React.RefObject<HTMLElement | null>, onSave?: () => void) {
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isSaveKey(e)) return;
      const card = cardRef.current;
      if (!card) return;
      const active = document.activeElement;
      const inside = !!active && card.contains(active);
      const nowhere = !active || active === document.body;
      if (!inside && !(nowhere && isTopDialog(card))) return;
      e.preventDefault();
      // 아래에 깔린 쓰는 칸(일정·기록 등)이 같은 키로 또 저장하지 않게 여기서 멈춘다
      e.stopPropagation();
      if (e.repeat) return;
      if (saveRef.current) {
        saveRef.current();
        return;
      }
      const form = active instanceof Element ? active.closest('form') : null;
      if (form && card.contains(form)) form.requestSubmit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, cardRef]);
}

export default function PopupFrame({
  isOpen,
  onClose,
  width = 'md',
  onBackdropClose,
  cardClassName = '',
  onSave,
  raise,
  children,
}: PopupFrameProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  useSaveKey(isOpen, cardRef, onSave);
  const side = useAppStore((s) => s.popupStyle) !== 'center';
  const wide = useMinWidth(SIDE_DOCK_MIN_WIDTH);
  const docked = isOpen && side && wide;

  // 옆에 붙은 칸은 왼쪽 화면과 함께 쓰므로 본문 스크롤을 잠그지 않는다
  useBodyScrollLock(isOpen && !docked);
  const vv = useVisualViewport(isOpen);
  const zIndex = useModalLayer(isOpen, onClose, raise);
  const backdrop = useBackdropClose(onBackdropClose);
  const slot = useSideSlot(docked, raise);

  if (!isOpen) return null;

  if (docked) {
    const { className, style } = sideSlotProps(slot);
    return createPortal(
      <section
        ref={cardRef}
        role="dialog"
        data-popup-card
        data-popup-frame="side"
        className={`${className} animate-fade-in`}
        style={style}
      >
        {children}
      </section>,
      getSideColumn()
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
          ref={cardRef as React.RefObject<HTMLDivElement>}
          role="dialog"
          data-popup-card
          className="relative bg-white h-full w-full max-w-lg shadow-2xl flex flex-col overflow-y-auto overscroll-contain"
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
        ref={cardRef as React.RefObject<HTMLDivElement>}
        role="dialog"
        data-popup-card
        className={`bg-white w-full ${CENTER_WIDTH[width]} max-h-full rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden ${cardClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
