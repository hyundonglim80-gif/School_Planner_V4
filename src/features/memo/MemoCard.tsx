//src/features/memo/MemoCard.tsx
//
// 메모 카드 - 19번 U6부터 기록 카드와 같은 components/EntryCard를 쓴다. 여기서는 메모의 칸을 카드에 맞춰 넘긴다.
import type { Memo } from '../../hooks/useMemos';
import { useAppStore } from '../../store/useAppStore';
import { focusKey } from '../../lib/searchFocus';
import EntryCard from '../../components/EntryCard';

interface MemoCardProps {
  memo: Memo;
  onEdit?: (memo: Memo) => void;
  onToggleComplete?: (memo: Memo) => void;
  onToggleFavorite?: (memo: Memo) => void;
  /** 휴지통 문서 id를 돌려주면 안내에 '되돌리기'가 붙는다 */
  onDelete?: (firestoreId: string) => void | Promise<string | void>;
  /** 앞(▲)·뒤(▼)의 메모와 차례를 바꾼다. 바꿀 상대가 없으면 주지 않는다. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** '☐ 우유' 줄을 누르면 그 줄의 체크 글자만 바꾼다 (lib/checkLines). 주지 않으면 그냥 글로 보인다. */
  onToggleCheckLine?: (memo: Memo, lineIndex: number, line: string) => Promise<boolean> | void;
  /** 라벨 상위/하위 (칩에 마우스를 올리면 '상위 › 하위') */
  labelParents?: Record<string, string>;
}

export default function MemoCard({ memo, onEdit, onToggleComplete, onToggleFavorite, onDelete, onMoveUp, onMoveDown, onToggleCheckLine, labelParents }: MemoCardProps) {
  const { openLinkViewerModal } = useAppStore();
  const created = new Date(memo.createdAt);
  const memoDateStr = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`;
  return (
    <EntryCard
      kind="memo"
      focusKey={focusKey.memo(memo.firestoreId)}
      content={memo.content || memo.text || ''}
      labels={memo.labels || []}
      labelParents={labelParents}
      completed={!!memo.completed}
      favorite={!!memo.favorite}
      dateText={created.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      attachments={memo.attachments as unknown[] | undefined}
      imageUrl={memo.imageUrl}
      tables={memo.tables as unknown[] | undefined}
      linkCount={(memo.linkedItems || []).length}
      onOpenLinks={() => openLinkViewerModal('memo', memoDateStr, memo.firestoreId, undefined, memo.groupId || 'personal')}
      onOpen={onEdit ? () => onEdit(memo) : undefined}
      onToggleComplete={onToggleComplete ? () => onToggleComplete(memo) : undefined}
      onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(memo) : undefined}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onDelete={onDelete ? () => onDelete(memo.firestoreId) : undefined}
      onToggleCheckLine={onToggleCheckLine ? (idx, line) => onToggleCheckLine(memo, idx, line) : undefined}
    />
  );
}
