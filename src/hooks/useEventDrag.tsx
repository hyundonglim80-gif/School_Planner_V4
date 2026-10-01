// src/hooks/useEventDrag.tsx
//
// 주간·월간·년간에서 일정을 끌어 다른 날짜 칸에 놓아 옮긴다 (docs/ROADMAP.md 1-4).
//
// - 마우스로 쓰는 화면에서만 끈다. 휴대폰에서 길게 누르기는 스크롤·글자 고르기와 겹친다 -
//   휴대폰은 일정 칸의 날짜 칸으로 옮긴다.
// - 놓으면 쓰는 칸과 같은 길(hooks/useEventMove)로 옮긴다. 기간·반복 묶음이면 같은 범위 창이 뜬다.
// - 끌고 있는 동안 놓을 수 있는 날짜 칸을 파랗게 짚어 준다.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useEventMove, moveMessage, movesForwardIntoPast } from './useEventMove';
import { useLabels } from './useLabels';
import { useAppStore } from '../store/useAppStore';
import { showToast, showErrorToastOnce } from '../utils/toast';
import { showMovedToast } from '../lib/undoToast';

/** 끌기 자료의 종류. 다른 곳(글자 칸 등)에 놓이면 일정 내용 글자로 들어간다. */
export const EVENT_DRAG_MIME = 'application/x-sp4-event';

/** 끄는 일정 - 옮기기와 안내에 필요한 것만 담는다 (옮기기는 서버의 지금 모습을 다시 읽는다) */
export interface DraggedEvent {
  fromDate: string;
  id: string;
  content: string;
  groupId?: string | null;
  completed?: boolean;
  label?: string;
  labelIds?: string[];
  forward?: boolean;
  forwardOptOut?: boolean;
  forwardChainId?: string;
  originalDate?: string;
}

/** 마우스(정밀한 포인터)로 쓰는 화면인가 */
export function canDragEvents(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches;
  } catch {
    return false;
  }
}

/** 일정 하나에 붙이는 끌기 속성. enabled가 아니면 아무것도 붙이지 않는다. onEnd: 끌기가 끝났을 때(놓지 않았어도) */
export function eventDragSourceProps(dateStr: string, ev: any, enabled: boolean, onEnd?: () => void) {
  if (!enabled) return {};
  return {
    draggable: true,
    onDragEnd: () => onEnd?.(),
    onDragStart: (e: DragEvent) => {
      e.stopPropagation();
      const payload: DraggedEvent = {
        fromDate: dateStr,
        id: String(ev.id),
        content: String(ev.content ?? ev.text ?? ''),
        groupId: ev.groupId || null,
        completed: !!ev.completed,
        label: ev.label,
        labelIds: ev.labelIds,
        forward: ev.forward,
        forwardOptOut: ev.forwardOptOut,
        forwardChainId: ev.forwardChainId,
        originalDate: ev.originalDate,
      };
      e.dataTransfer.setData(EVENT_DRAG_MIME, JSON.stringify(payload));
      e.dataTransfer.setData('text/plain', payload.content);
      e.dataTransfer.effectAllowed = 'move';
    },
  };
}

const isEventDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes(EVENT_DRAG_MIME);

/**
 * 날짜 칸을 놓을 자리로 만든다.
 * - targetProps(dateStr): 날짜 칸에 붙이는 속성
 * - overDate: 지금 끌고 있는 일정이 올라와 있는 날짜 (짚어 주기용)
 * - dragEnabled: 일정에 끌기를 붙일지 (마우스 화면이고 다중 선택 중이 아닐 때)
 * - groupMoveModal: 묶음 범위 창. 화면이 그려 둔다.
 */
export function useEventDropMove() {
  const selectedGroupId = useAppStore((s) => s.selectedGroupId);
  const isMultiSelectMode = useAppStore((s) => s.isMultiSelectMode);
  const retargetEventPanels = useAppStore((s) => s.retargetEventPanels);
  const { eventLabels } = useLabels();
  const { requestMove, groupMoveModal } = useEventMove(selectedGroupId);
  const [overDate, setOverDate] = useState<string | null>(null);

  const dropOn = useCallback(
    async (dragged: DraggedEvent, toDate: string) => {
      try {
        const bounces = movesForwardIntoPast(dragged, toDate, eventLabels);
        const result = await requestMove({ fromDate: dragged.fromDate, toDate, item: dragged });
        if (result === 'cancelled') return;
        if (result === 'missing') {
          showToast('옮길 일정을 찾지 못했습니다. 그 사이 지워졌거나 다른 날로 옮겨졌을 수 있습니다.');
          return;
        }
        retargetEventPanels(selectedGroupId, dragged.fromDate, dragged.id, toDate, result.current.id);
        showMovedToast(moveMessage(result, dragged.fromDate, toDate, bounces), selectedGroupId, result.trail);
      } catch (err) {
        showErrorToastOnce('일정을 옮기지 못했습니다. 네트워크를 확인해 주세요.', err);
      }
    },
    [eventLabels, requestMove, retargetEventPanels, selectedGroupId]
  );

  // 처리 함수는 늘 같은 것을 준다 - 년간 달 카드(React.memo)가 끌 때마다 열두 달을 다시 그리지 않게
  const overRef = useRef<string | null>(null);
  const setOver = useCallback((d: string | null) => {
    overRef.current = d;
    setOverDate(d);
  }, []);
  const dropOnRef = useRef(dropOn);
  useEffect(() => {
    dropOnRef.current = dropOn;
  }, [dropOn]);
  const handlers: DropHandlers = useMemo(
    () => ({
      over: (e, dateStr) => {
        if (!isEventDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (overRef.current !== dateStr) setOver(dateStr);
      },
      leave: (e, dateStr) => {
        // 칸 안의 다른 요소로 넘어가는 것은 떠난 것이 아니다
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        if (overRef.current === dateStr) setOver(null);
      },
      drop: (e, dateStr) => {
        if (!isEventDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(null);
        let dragged: DraggedEvent;
        try {
          dragged = JSON.parse(e.dataTransfer.getData(EVENT_DRAG_MIME));
        } catch {
          return;
        }
        if (!dragged?.id || dragged.fromDate === dateStr) return;
        void dropOnRef.current(dragged, dateStr);
      },
    }),
    [setOver]
  );
  const targetProps = (dateStr: string) => dropTargetProps(handlers, dateStr);

  const dragEnabled = canDragEvents() && !isMultiSelectMode;
  /** 끌기가 끝나면(놓지 않고 그만두어도) 짚은 칸을 지운다 - 일정 쪽 onDragEnd에 붙인다 */
  const clearOver = useCallback(() => setOver(null), [setOver]);
  const modal: ReactNode = groupMoveModal;
  return { targetProps, handlers, overDate, dragEnabled, clearOver, groupMoveModal: modal };
}

/** 날짜 칸에 붙이는 놓기 처리 (늘 같은 함수) */
export interface DropHandlers {
  over: (e: DragEvent, dateStr: string) => void;
  leave: (e: DragEvent, dateStr: string) => void;
  drop: (e: DragEvent, dateStr: string) => void;
}

/** 날짜 칸에 붙이는 속성. 년간 달 카드처럼 memo로 감싼 곳은 handlers만 받아 이것으로 만든다. */
export function dropTargetProps(handlers: DropHandlers, dateStr: string) {
  return {
    onDragOver: (e: DragEvent) => handlers.over(e, dateStr),
    onDragLeave: (e: DragEvent) => handlers.leave(e, dateStr),
    onDrop: (e: DragEvent) => handlers.drop(e, dateStr),
  };
}

/** 놓을 수 있는 칸으로 짚었을 때 덧붙이는 모양 */
export const DROP_TARGET_CLASS = 'ring-2 ring-primary ring-offset-1 bg-blue-50/70';
