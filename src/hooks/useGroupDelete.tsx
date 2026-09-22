// src/hooks/useGroupDelete.tsx
//
// 일정을 지울 때, 그것이 기간·반복 묶음의 일부라면 어디까지 지울지 먼저 묻는다.
//
// 지우는 자리가 네 곳(하루·주간·월간·년간)이라 판단과 팝업을 각 화면에 복사하면
// 한 곳만 고쳐지고 나머지는 그대로 남는다. 실제로 수정 팝업의 '삭제'만 범위를
// 물어보고, 항목을 가리켰을 때 나오는 🗑 는 묻지 않고 한 건만 지웠다.
import { useCallback, useState, type ReactNode } from 'react';
import { groupIdOf } from '../lib/eventGroups';
import GroupDeleteModal from '../components/GroupDeleteModal';

interface Target {
  dateStr: string;
  id: string;
  item: any;
}

export interface UseGroupDeleteOptions {
  /** 'personal' 또는 공유 그룹 id */
  fId: string | null;
  /** 묶이지 않은 한 건을 지우는 기존 경로. 안내 토스트도 여기서 띄운다. */
  deleteOne: (dateStr: string, id: string, item?: any) => Promise<void> | void;
  /** 무엇이든 지운 뒤 (열려 있던 수정 칸을 닫는 등) */
  onDeleted?: () => void;
}

export function useGroupDelete({ fId, deleteOne, onDeleted }: UseGroupDeleteOptions) {
  const [target, setTarget] = useState<Target | null>(null);

  /**
   * 삭제 단추가 부른다. 묶음이면 범위를 묻고, 아니면 곧바로 지운다.
   *
   * 년간은 달 카드를 React.memo로 감싸 두었다. 판마다 새 함수를 넘기면 memo가
   * 아무 일도 못 하므로, 넘겨받은 deleteOne이 그대로면 이것도 그대로여야 한다.
   */
  const requestDelete = useCallback(
    (dateStr: string, id: string, item?: any) => {
      if (item && groupIdOf(item)) {
        setTarget({ dateStr, id, item });
        return;
      }
      void deleteOne(dateStr, id, item);
    },
    [deleteOne]
  );

  const groupDeleteModal: ReactNode = target ? (
    <GroupDeleteModal
      isOpen
      dateStr={target.dateStr}
      fId={fId || 'personal'}
      groupId={groupIdOf(target.item) || ''}
      content={String(target.item?.content || '')}
      onDeleteThisOnly={() => deleteOne(target.dateStr, target.id, target.item)}
      onDeleted={onDeleted}
      onClose={() => setTarget(null)}
    />
  ) : null;

  return { requestDelete, groupDeleteModal };
}
