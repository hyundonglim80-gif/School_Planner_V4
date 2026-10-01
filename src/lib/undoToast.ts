// src/lib/undoToast.ts
//
// 한 일을 알리는 안내에 '되돌리기' 단추를 붙인다 (로드맵 6번, 2026-10-01).
// 예전에는 지우면 "휴지통에서 복원할 수 있습니다"만 떠서, 잘못 누른 한 번을 되돌리려면 휴지통을 열어 찾아야 했다.
//
// - 지우기: 휴지통 문서 id로 그 자리에 되살린다(lib/trashRestore - 휴지통 창의 '복원'과 같은 길).
//   지운 항목을 다시 써 넣지 않는다 - 그 사이 그날 목록이 바뀌었어도 휴지통 복원처럼 한 건만 더한다.
// - 옮기기·다중 선택의 완료·라벨·메모 완료: 부르는 쪽이 이전 모습으로 돌리는 함수를 넘긴다.
import { showToast, showErrorToastOnce } from '../utils/toast';
import { restoreTrashIds } from './trashRestore';
import { undoMoves, restoreEventFields, type MoveTrail, type EventFieldSnapshot } from './eventDocOps';
import { shortDateLabel } from './notices';
import { useAppStore } from '../store/useAppStore';

/** 되돌리기 단추가 있는 안내는 조금 더 오래 둔다 (마우스를 올려 둔 동안은 사라지지 않는다) */
export const UNDO_TOAST_MS = 7000;
export const UNDO_LABEL = '되돌리기';

/**
 * 안내에 '되돌리기' 단추를 붙인다. 누르면 undo를 부르고, 돌려준 글(없으면 '되돌렸습니다')을 띄운다.
 * undo가 던지면 실패를 알린다(이미 안내한 실패는 다시 띄우지 않는다).
 */
export function showUndoToast(message: string, undo: () => Promise<string | void>): void {
  showToast(message, UNDO_TOAST_MS, 'info', {
    label: UNDO_LABEL,
    run: () => {
      void (async () => {
        try {
          const done = await undo();
          showToast(done || '↩️ 되돌렸습니다.');
        } catch (e) {
          showErrorToastOnce('되돌리지 못했습니다. 네트워크를 확인하고 휴지통이나 그 날짜에서 직접 고쳐 주세요.', e);
        }
      })();
    },
  });
}

/** 되살린 결과를 사람 말로 */
export function restoredMessage(restored: number, missing: number): string {
  if (restored === 0) return '되살릴 항목이 휴지통에 없습니다. 이미 되살렸거나 휴지통을 비웠습니다.';
  const head = restored > 1 ? `↩️ ${restored}건을 되살렸습니다.` : '↩️ 되살렸습니다.';
  return missing > 0 ? `${head} ${missing}건은 휴지통에 없어 그대로입니다.` : head;
}

/**
 * 지운 뒤의 안내. 휴지통에 넣은 id가 있으면 '되돌리기'로 그 자리에 되살린다.
 * id가 하나도 없으면(휴지통을 거치지 않은 항목) 단추 없이 알리기만 한다.
 */
export function showDeletedToast(
  message: string,
  trashIds: string | null | undefined | Array<string | null | undefined>,
  /** 되살린 뒤 부른다 - 목록을 구독하지 않고 들고 있는 창이 다시 읽게 */
  afterRestore?: () => void
): void {
  const ids = (Array.isArray(trashIds) ? trashIds : [trashIds]).filter((x): x is string => !!x);
  if (ids.length === 0) {
    showToast(message);
    return;
  }
  showUndoToast(message, async () => {
    const r = await restoreTrashIds(ids);
    if (r.restored > 0) afterRestore?.();
    return restoredMessage(r.restored, r.missing);
  });
}

/**
 * 옮긴 뒤의 안내. '되돌리기'는 옮긴 것을 원래 날짜로 되옮기고, 그 일정을 고치던 칸도 따라간다.
 * groupId: 공유 그룹 id (개인 공간이면 null)
 */
export function showMovedToast(message: string, groupId: string | null, trail: MoveTrail[]): void {
  if (trail.length === 0) {
    showToast(message);
    return;
  }
  showUndoToast(message, async () => {
    const r = await undoMoves(groupId || 'personal', trail);
    const retarget = useAppStore.getState().retargetEventPanels;
    for (const b of r.back) retarget(groupId, b.trail.toDate, b.trail.id, b.trail.fromDate, b.id);
    if (r.back.length === 0) return '되돌릴 일정을 찾지 못했습니다. 그 사이 지워졌거나 다른 날로 옮겨졌습니다.';
    const head =
      r.back.length === 1
        ? `↩️ ${shortDateLabel(r.back[0].trail.fromDate)}로 되돌렸습니다.`
        : `↩️ 일정 ${r.back.length}건을 원래 날짜로 되돌렸습니다.`;
    return r.missing > 0 ? `${head} ${r.missing}건은 찾지 못해 그대로입니다.` : head;
  });
}

/**
 * 다중 선택의 완료·라벨 바꾸기 뒤의 안내. '되돌리기'는 고치기 전 칸 값으로 돌린다.
 * groupId: 공유 그룹 id (개인 공간이면 null)
 */
export function showFieldsChangedToast(message: string, groupId: string | null, snaps: EventFieldSnapshot[]): void {
  if (snaps.length === 0) {
    showToast(message);
    return;
  }
  showUndoToast(message, async () => {
    const n = await restoreEventFields(groupId || 'personal', snaps);
    return n > 0 ? `↩️ 일정 ${n}건을 되돌렸습니다.` : '되돌릴 일정을 찾지 못했습니다. 그 사이 지워졌거나 다른 날로 옮겨졌습니다.';
  });
}
