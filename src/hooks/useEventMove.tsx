// src/hooks/useEventMove.tsx
//
// 일정을 다른 날짜로 옮긴다. 기간·반복 묶음이면 어디까지 옮길지 먼저 묻는다(GroupMoveModal).
//
// 옮기는 자리가 여럿이다 - 일정 쓰는 칸의 날짜 칸, 주간·월간·년간에서 끌어 놓기, 다중 선택.
// 판단과 창을 자리마다 따로 두면 한 곳만 고쳐진다(지우기가 그랬다 - useGroupDelete 참고).
import { useCallback, useRef, useState, type ReactNode } from 'react';
import GroupMoveModal, { type GroupMoveScope } from '../components/GroupMoveModal';
import { groupIdOf } from '../lib/eventGroups';
import { moveEventToDate, moveGroupEvents, type MoveEventResult } from '../lib/eventDocOps';
import { daysBetween } from '../lib/dateUtils';

export interface MoveRequest {
  fromDate: string;
  toDate: string;
  /** 옮길 일정 (지금 모습) */
  item: any;
  /** 옮기면서 함께 고칠 것 (쓰는 칸에서 날짜와 내용을 같이 고쳐 저장할 때). 이 일정에만 쓴다. */
  patch?: Record<string, any>;
  /** 알림도 같은 날 수만큼 옮기나 (기본 true) */
  shiftAlarm?: boolean;
}

export interface MoveOutcome {
  /** 이 일정의 옮긴 결과 */
  current: MoveEventResult;
  /** 옮긴 건수 (이 일정 포함) */
  moved: number;
  /** 묶음 가운데 옮기지 못한 건수 */
  failed: number;
  scope: GroupMoveScope;
}

/** 옮겼으면 결과, 창을 닫아 그만두었으면 'cancelled', 옮길 일정을 못 찾았으면 'missing' */
export type MoveResult = MoveOutcome | 'cancelled' | 'missing';

interface Pending extends MoveRequest {
  resolve: (r: MoveResult) => void;
  reject: (e: unknown) => void;
}

/**
 * requestMove: 옮긴다. 묶음이면 범위를 묻는다.
 *   - 옮겼으면 결과, 창을 닫아 그만두었으면 'cancelled', 옮길 일정을 못 찾았으면(그 사이 지워짐 등) 'missing'
 *   - 옮기지 못했으면(서버가 답하지 않음 등) 던진다 - 부르는 쪽이 안내하고 칸을 그대로 둔다
 * groupMoveModal: 범위를 묻는 창. 부르는 쪽이 그려 둔다.
 */
export function useEventMove(fId: string | null) {
  const space = fId || 'personal';
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const requestMove = useCallback(
    (req: MoveRequest): Promise<MoveResult> =>
      new Promise((resolve, reject) => {
        if (req.fromDate === req.toDate) {
          resolve('cancelled');
          return;
        }
        if (groupIdOf(req.item)) {
          setPending({ ...req, resolve, reject });
          return;
        }
        moveEventToDate({
          fId: space,
          fromDate: req.fromDate,
          toDate: req.toDate,
          eventId: String(req.item.id),
          patch: req.patch,
          shiftAlarm: req.shiftAlarm,
        }).then((r) => resolve(r ? { current: r, moved: 1, failed: 0, scope: 'only' } : 'missing'), reject);
      }),
    [space]
  );

  const close = () => {
    pendingRef.current?.resolve('cancelled');
    setPending(null);
  };

  const groupMoveModal: ReactNode = pending ? (
    <GroupMoveModal
      dateStr={pending.fromDate}
      toDate={pending.toDate}
      days={daysBetween(pending.fromDate, pending.toDate)}
      fId={space}
      groupId={groupIdOf(pending.item) || ''}
      content={String(pending.item?.content || '')}
      onClose={close}
      onPick={async (scope, plan) => {
        const p = pending;
        try {
          if (scope === 'only') {
            const r = await moveEventToDate({
              fId: space,
              fromDate: p.fromDate,
              toDate: p.toDate,
              eventId: String(p.item.id),
              patch: p.patch,
              shiftAlarm: p.shiftAlarm,
            });
            p.resolve(r ? { current: r, moved: 1, failed: 0, scope } : 'missing');
          } else {
            const r = await moveGroupEvents({
              fId: space,
              items: plan.map((x) => ({ fromDate: x.fromDate, id: x.id })),
              days: daysBetween(p.fromDate, p.toDate),
              current: { fromDate: p.fromDate, id: String(p.item.id), patch: p.patch, shiftAlarm: p.shiftAlarm },
            });
            p.resolve({ ...r, scope });
          }
        } catch (e) {
          p.reject(e);
        }
        setPending(null);
      }}
    />
  ) : null;

  return { requestMove, groupMoveModal };
}
