// src/components/GroupDeleteModal.tsx
//
// 기간·반복으로 여러 날에 걸쳐 만들어진 일정을 지울 때 '어디까지' 지울지 고른다.
// V3의 showGroupDeleteModal(js/modules/multiEvent.js)을 옮긴 것이다.
//
// 이 팝업 자체가 확인 단계다. 고를 때 몇 건이 지워지는지 숫자로 보여 주고,
// 지운 것은 휴지통에서 되살릴 수 있으므로 확인창을 한 번 더 띄우지 않는다.
import { useEffect, useState } from 'react';
import { showToast, showErrorToast } from '../utils/toast';
import {
  findGroupEvents,
  hitsFrom,
  countGroupItems,
  deleteGroupEvents,
  type GroupHit,
} from '../lib/eventGroups';
import ModalShell, { ModalCloseButton } from './ModalShell';

export interface GroupDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 지우려는 일정이 있는 날짜 (YYYY-MM-DD) */
  dateStr: string;
  /** 'personal' 또는 공유 그룹 id */
  fId: string;
  /** 묶음 id */
  groupId: string;
  /** 표시용 일정 내용 */
  content?: string;
  /** 이 날짜의 한 건만 지우기. 기존 삭제 경로를 그대로 쓴다. */
  onDeleteThisOnly: () => Promise<void> | void;
  /** 지우고 난 뒤 (팝업은 스스로 닫는다) */
  onDeleted?: () => void;
}

type Scope = 'only' | 'after' | 'all';

export default function GroupDeleteModal({
  isOpen,
  onClose,
  dateStr,
  fId,
  groupId,
  content,
  onDeleteThisOnly,
  onDeleted,
}: GroupDeleteModalProps) {
  const [hits, setHits] = useState<GroupHit[] | null>(null);
  const [busy, setBusy] = useState<Scope | null>(null);

  // 어느 날짜에 몇 건이 있는지 먼저 세어 둔다. 숫자를 안 보여 주면
  // '이후 전부'를 고를 때 무엇이 사라지는지 모른 채 누르게 된다.
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    findGroupEvents(fId, groupId)
      .then((found) => { if (alive) setHits(found); })
      .catch((err) => {
        console.error(err);
        if (alive) setHits([]);
        showErrorToast('연결된 일정을 불러오지 못했습니다.', err);
      });
    return () => { alive = false; };
  }, [isOpen, fId, groupId]);

  const afterHits = hits ? hitsFrom(hits, dateStr) : [];
  const afterCount = countGroupItems(afterHits);
  const allCount = hits ? countGroupItems(hits) : 0;

  const runScope = async (scope: Scope) => {
    if (busy) return;
    setBusy(scope);
    try {
      if (scope === 'only') {
        // 안내 토스트는 부르는 쪽(기존 한 건 삭제 경로)이 띄운다. 여기서 또 띄우면
        // 화면에 따라 같은 말이 두 번 뜬다.
        await onDeleteThisOnly();
      } else {
        const target = scope === 'after' ? afterHits : hits || [];
        const removed = await deleteGroupEvents(fId, target);
        showToast(`🗑️ 연결된 일정 ${removed}건을 삭제했습니다. 휴지통에서 복원할 수 있습니다.`);
      }
      onDeleted?.();
      onClose();
    } catch (err) {
      console.error(err);
      showErrorToast('삭제하지 못했습니다.', err);
    } finally {
      setBusy(null);
    }
  };

  const countLabel = (n: number) => (hits === null ? '세는 중…' : `${n}건`);

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="sm"
      title="🗑️ 연결된 일정 삭제"
      footer={<ModalCloseButton onClose={onClose} />}
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-600 leading-relaxed">
          {content ? <b className="text-slate-800">{content}</b> : '이 일정'}
          {' '}은(는) <b>기간 또는 반복</b>으로 여러 날에 걸쳐 연결되어 있습니다. 어디까지 지울까요?
        </p>

        <button
          type="button"
          onClick={() => runScope('only')}
          disabled={busy !== null}
          className="w-full text-left px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 transition-colors cursor-pointer"
        >
          <span className="block text-xs font-bold text-slate-800">이 날짜의 일정만 삭제</span>
          <span className="block mt-0.5 text-xs text-slate-500">
            {dateStr} 의 1건. 나머지 날짜는 그대로 둡니다.
          </span>
        </button>

        <button
          type="button"
          onClick={() => runScope('after')}
          disabled={busy !== null || hits === null || afterCount === 0}
          className="w-full text-left px-3.5 py-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 disabled:opacity-40 transition-colors cursor-pointer"
        >
          <span className="block text-xs font-bold text-rose-700">
            이 날짜와 이후 일정 모두 삭제 ({countLabel(afterCount)})
          </span>
          <span className="block mt-0.5 text-xs text-rose-500">
            {dateStr} 부터 뒤쪽을 지웁니다. 지난 날짜는 그대로 둡니다.
          </span>
        </button>

        <button
          type="button"
          onClick={() => runScope('all')}
          disabled={busy !== null || hits === null || allCount === 0}
          className="w-full text-left px-3.5 py-3 rounded-xl border border-red-300 bg-red-100 hover:bg-red-200 disabled:opacity-40 transition-colors cursor-pointer"
        >
          <span className="block text-xs font-bold text-red-800">
            연결된 일정 전체 삭제 ({countLabel(allCount)})
          </span>
          <span className="block mt-0.5 text-xs text-red-600">지난 날짜까지 모두 지웁니다.</span>
        </button>

        <p className="text-xs text-slate-400">지운 일정은 휴지통에서 되살릴 수 있습니다.</p>
      </div>
    </ModalShell>
  );
}
