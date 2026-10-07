// src/components/MoveEntryModal.tsx
//
// 메모 ↔ 기록 옮기기 창 (lib/moveEntry).
//   메모 → 기록: 날짜를 고른다(처음에는 지금 보는 날).
//   기록 → 메모: 원래 날짜를 첫 줄에 남긴다고 알려 준다.
//   라벨: 메모·기록 라벨은 한 목록(19번 U5)이라 그대로 간다 - 고르는 단계가 없다. 목록에서 지운 라벨만 빠진다.
import { useEffect, useState } from 'react';
import ModalShell, { ModalCloseButton } from './ModalShell';
import {
  initialLabelChoices,
  journalDateLine,
  type LabelChoice,
} from '../lib/moveEntry';

interface MoveEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 옮기는 쪽 */
  from: 'memo' | 'journal';
  /** 지금 붙어 있는 라벨 이름들 */
  fromLabels: string[];
  /** 옮겨 갈 쪽의 라벨 이름들 */
  targetLabelNames: string[];
  /** 메모 → 기록: 처음 골라 둘 날짜 / 기록 → 메모: 그 기록의 날짜 */
  dateStr: string;
  /** 기록 → 메모일 때 학생 태그가 든 기록인가 (누가기록에서 빠진다고 알린다) */
  hasStudentTag?: boolean;
  onConfirm: (result: { dateStr: string; labelChoices: LabelChoice[] }) => Promise<void>;
}


export default function MoveEntryModal({
  isOpen,
  onClose,
  from,
  fromLabels,
  targetLabelNames,
  dateStr,
  hasStudentTag,
  onConfirm,
}: MoveEntryModalProps) {
  // 받침에 따라 '기록으로' / '메모로'
  const toWith = from === 'memo' ? '기록으로' : '메모로';
  const [date, setDate] = useState(dateStr);
  const [choices, setChoices] = useState<LabelChoice[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDate(dateStr);
    setChoices(initialLabelChoices(fromLabels, targetLabelNames));
    setBusy(false);
    // 열 때마다 처음부터
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const canMove = !busy && (from === 'journal' || /^\d{4}-\d{2}-\d{2}$/.test(date));

  const doMove = async () => {
    if (!canMove) return;
    setBusy(true);
    try {
      await onConfirm({ dateStr: date, labelChoices: choices });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="md"
      title={from === 'memo' ? '📔 기록으로 옮기기' : '🗒️ 메모로 옮기기'}
      // Ctrl+S = 옮기기
      onSave={() => void doMove()}
      footer={
        <>
          <ModalCloseButton onClose={onClose} />
          <button
            type="button"
            onClick={() => void doMove()}
            disabled={!canMove}
            className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
          >
            {busy ? '옮기는 중...' : `${toWith} 옮기기`}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {from === 'memo' ? (
          <label className="block">
            <span className="block text-xs font-bold text-slate-600 mb-1">어느 날의 기록으로 옮길까요?</span>
            <input
              type="date"
              aria-label="옮길 날짜"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-primary"
            />
          </label>
        ) : (
          <p className="text-xs text-slate-600">
            메모에는 날짜가 없어서, 첫 줄에 <b className="text-slate-800">{journalDateLine(dateStr)}</b>을 남깁니다.
          </p>
        )}

        <div>
          <p className="text-xs font-bold text-slate-600 mb-1.5">라벨</p>
          {/* 메모·기록 라벨은 한 목록(19번 U5) - 고를 것 없이 그대로 간다. 목록에서 지운 라벨만 빠진다 */}
          {choices.length === 0 ? (
            <p className="text-xs text-slate-400">붙은 라벨이 없습니다. 옮긴 뒤 칸에서 고를 수 있습니다.</p>
          ) : (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600" data-move-labels>
              {choices.map((c) => (
                <span
                  key={c.from}
                  className={`px-2 py-0.5 rounded-md font-bold ${
                    c.action === 'keep' ? 'bg-slate-100 text-slate-700' : 'bg-slate-50 text-slate-400 line-through'
                  }`}
                  title={c.action === 'keep' ? '그대로 갑니다' : '라벨 목록에 없는 라벨이라 빠집니다'}
                >
                  {c.from}
                </span>
              ))}
              <span>그대로 옮겨 갑니다 (메모·기록 라벨은 한 목록).</span>
            </p>
          )}
        </div>

        {from === 'journal' && hasStudentTag && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            학생 태그가 든 기록입니다. 메모로 옮기면 <b>학생 누가기록</b>에 더 이상 모이지 않습니다.
          </p>
        )}

        <p className="text-2xs text-slate-400">
          원본 {from === 'memo' ? '메모는' : '기록은'} 휴지통에 "({toWith} 옮김)"으로 남아 되살릴 수 있습니다.
          링크로 이어진 항목은 옮긴 {from === 'memo' ? '기록을' : '메모를'} 가리키도록 고쳐집니다. 첨부 파일은 그대로 따라갑니다.
        </p>
      </div>
    </ModalShell>
  );
}
