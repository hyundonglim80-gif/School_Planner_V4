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
//   - 칸이 둘 이상이면 줄 위에 **탭**이 선다 (2026-10-07 사용자 요청 - 예전에는 나중에 연 것이 위, 먼저 연 것이
//     아래로 쌓였다). 새 칸을 열면 탭이 하나 더해지고 그 칸이 보인다. 다른 탭을 누르면 그 칸으로 바뀐다.
//     안 보이는 칸도 그대로 살아 있어 적던 글이 남는다(display:none). 탭의 ×는 그 칸의 '닫기'를 누른다.
// 휴대폰 배너는 줄에 세우지 않는다 - 화면이 작아 쌓아 두면 쓸 수 없다. 위에 덮는다.
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
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

/**
 * 지금 오른쪽 줄에 선 칸들. 연 순서(먼저 연 것이 앞). Layout은 하나라도 있으면 화면을 줄인다.
 * active: 탭에서 보이는 칸 (없으면 맨 나중에 연 것)
 */
export const useSidePopups = create<{ order: string[]; active?: string | null }>(() => ({ order: [], active: null }));

/** 지금 보이는 칸 id (active가 줄에 없으면 맨 나중에 연 것) */
const activeOf = (s: { order: string[]; active?: string | null }) =>
  s.active && s.order.includes(s.active) ? s.active : s.order[s.order.length - 1] ?? null;

/** 탭을 눌러 그 칸을 보인다 */
export function activateSideSlot(id: string) {
  useSidePopups.setState({ active: id });
  getSideColumn().scrollTop = 0;
}

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
  /** 줄 안의 이름 (탭이 칸을 찾는다) */
  id?: string;
  /** 탭에서 지금 보이는 칸인가 */
  shown?: boolean;
}

/**
 * 오른쪽 줄에 선다. 켜져 있는 동안 줄에 서고, 위에서 몇 번째인지 돌려준다.
 * raise가 바뀌면 줄에서 빠졌다가 다시 서서 맨 위로 간다 (이미 열린 쓰는 칸을 다시 열 때).
 */
export function useSideSlot(active: boolean, raise?: number): SideSlot {
  const id = useId();
  useEffect(() => {
    if (!active) return;
    // 방금 연(다시 연) 칸이 보이는 탭이 된다
    useSidePopups.setState((s) => ({ order: [...s.order.filter((x) => x !== id), id], active: id }));
    getSideColumn().scrollTop = 0;
    return () => {
      useSidePopups.setState((s) => {
        const order = s.order.filter((x) => x !== id);
        return { order, active: s.active === id ? order[order.length - 1] ?? null : s.active };
      });
    };
  }, [active, id, raise]);

  const order = useSidePopups((s) => s.order);
  const shownId = useSidePopups(activeOf);
  const index = order.indexOf(id);
  if (!active || index < 0) return { row: 0, rows: 1, id, shown: true };
  return { row: order.length - 1 - index, rows: order.length, id, shown: shownId === id };
}

/**
 * 줄 안에서 한 칸의 자리. 혼자면 줄을 꽉 채우고, 여럿이면 제 길이대로 쌓인다
 * (나중에 연 것이 위 - order). 칸 사이에는 굵은 줄을 둔다.
 */
export function sideSlotProps({ rows, id, shown }: SideSlot): { className: string; style: React.CSSProperties; 'data-side-slot'?: string } {
  // 탭 방식: 보이는 칸 하나만 줄을 채우고(order 0 = 맨 위 칸 - isTopSideItem), 나머지는 숨겨 둔다(적던 것은 그대로)
  if (rows > 1 && !shown) return { className: 'flex flex-col bg-white', style: { display: 'none', order: 1 }, 'data-side-slot': id };
  return {
    className: 'flex flex-col bg-white shrink-0',
    style: rows > 1 ? { order: 0, flex: '1 1 0%', minHeight: 0 } : { order: 0, height: '100%' },
    'data-side-slot': id,
  };
}

/** 칸의 탭 이름: 칸 이름(aria-label·제목) + 쓰던 글 첫 줄 */
function slotTitle(el: Element | null): string {
  if (!el) return '…';
  const head = el.querySelector('h1, h2, h3');
  let label = (el.getAttribute('aria-label') || head?.textContent || '창').trim().replace(/\s+/g, ' ');
  label = label.replace(/ 쓰기$/, '');
  const ta = el.querySelector('textarea') as HTMLTextAreaElement | null;
  const first = (ta?.value || '').split('\n').find((l) => l.trim())?.trim() || '';
  const text = first ? `${label} · ${first}` : label;
  return text.length > 22 ? text.slice(0, 21) + '…' : text;
}

/** 칸 안의 닫기 단추를 누른다 (칸마다 닫는 일 - 저장 안 한 글 묻기 등 - 을 그대로 따른다) */
function closeSlot(id: string) {
  const el = getSideColumn().querySelector(`[data-side-slot="${CSS.escape(id)}"]`);
  const btn = [...(el?.querySelectorAll('button') || [])].find((b) => {
    const t = (b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent || '').trim();
    return /^(닫기|✕|×)$/.test(t) || /^닫기\b/.test(b.getAttribute('title') || '');
  }) as HTMLButtonElement | undefined;
  btn?.click();
}

/**
 * 오른쪽 줄 위의 탭 (칸이 둘 이상일 때만). Layout이 한 번 그린다.
 * 탭 이름은 칸의 이름표·제목과 쓰던 글 첫 줄에서 읽는다(칸이 이름을 따로 넘기지 않아도 되게).
 */
export function SideTabs() {
  const order = useSidePopups((s) => s.order);
  const shownId = useSidePopups(activeOf);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);
  // 글을 칠 때 탭 이름도 따라가게 (가볍게 - 1초에 한 번)
  useEffect(() => {
    if (order.length < 2) return;
    const col = getSideColumn();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const on = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setTick((t) => t + 1);
      }, 1000);
    };
    col.addEventListener('input', on);
    return () => {
      col.removeEventListener('input', on);
      if (timer) clearTimeout(timer);
    };
  }, [order.length]);
  useLayoutEffect(() => {
    const col = getSideColumn();
    const next: Record<string, string> = {};
    for (const id of order) next[id] = slotTitle(col.querySelector(`[data-side-slot="${CSS.escape(id)}"]`));
    if (JSON.stringify(next) !== JSON.stringify(titles)) setTitles(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, shownId, tick]);
  if (order.length < 2) return null;
  return createPortal(
    <div
      role="tablist"
      aria-label="오른쪽 칸"
      data-side-tabs
      className="sticky top-0 z-20 flex items-end gap-1 overflow-x-auto bg-slate-100 border-b border-slate-200 px-1.5 pt-1.5 shrink-0"
      style={{ order: -1 }}
    >
      {order.map((id) => {
        const on = id === shownId;
        return (
          <div
            key={id}
            role="tab"
            aria-selected={on}
            data-side-tab={id}
            className={`group flex items-center max-w-[11rem] shrink-0 rounded-t-lg border border-b-0 text-xs font-bold ${
              on ? 'bg-white text-slate-800 border-slate-200' : 'bg-slate-50 text-slate-500 border-transparent hover:bg-white/70'
            }`}
          >
            <button type="button" onClick={() => activateSideSlot(id)} title={titles[id]} className="pl-2.5 pr-1 py-1.5 truncate">
              {titles[id] || '…'}
            </button>
            <button
              type="button"
              aria-label="탭 닫기"
              title="이 칸 닫기"
              onClick={() => closeSlot(id)}
              className="px-1.5 py-1 text-slate-400 hover:text-rose-600"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>,
    getSideColumn()
  );
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
    const { className, style, 'data-side-slot': slotId } = sideSlotProps(slot);
    return createPortal(
      <section
        ref={cardRef}
        role="dialog"
        data-popup-card
        data-popup-frame="side"
        data-side-slot={slotId}
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
