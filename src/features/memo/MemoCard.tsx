import React from 'react';
import type { Memo } from '../../hooks/useMemos';
import { renderFormattedText } from '../../lib/textUtils';

interface MemoCardProps {
  memo: Memo;
  onEdit?: (memo: Memo) => void;
  onToggleComplete?: (memo: Memo) => void;
  onDelete?: (firestoreId: string) => void;
}

export default function MemoCard({ memo, onEdit, onToggleComplete, onDelete }: MemoCardProps) {
  const isCompleted = !!memo.completed;
  const isSensitive = memo.labels?.some(l => ['학생상담', '상담', '비공개', '개인'].includes(l));

  return (
    <div className={`bg-white rounded-2xl p-4 transition-all duration-200 border flex flex-col group shadow-sm hover:shadow-md hover:border-slate-300 ${
      isCompleted ? 'bg-slate-50 border-slate-200 opacity-70' : 'border-slate-200/80'
    }`}>
      <div>
        {/* 상단 체크 및 라벨 영역 */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isCompleted}
              onChange={() => onToggleComplete?.(memo)}
              className="w-4 h-4 rounded text-primary focus:ring-primary border-slate-300 accent-primary cursor-pointer"
            />
            <span className="text-[11px] text-slate-400">
              {new Date(memo.createdAt).toLocaleDateString('ko-KR', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
          </div>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onEdit && (
              <button
                onClick={() => onEdit(memo)}
                className="p-1 text-slate-400 hover:text-blue-600 rounded-md hover:bg-slate-100 text-xs font-semibold transition-colors"
                title="수정"
              >
                ✏️
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => {
                  if (window.confirm('이 메모를 삭제하시겠습니까?')) {
                    onDelete(memo.firestoreId);
                  }
                }}
                className="p-1 text-slate-400 hover:text-red-600 rounded-md hover:bg-slate-100 text-xs font-semibold transition-colors"
                title="삭제"
              >
                🗑️
              </button>
            )}
          </div>
        </div>

        {/* 첨부 이미지 (있을 경우) */}
        {memo.imageUrl && (
          <div className="mb-3 rounded-xl overflow-hidden border border-slate-100">
            <img src={memo.imageUrl} alt="메모 첨부 이미지" className="w-full h-36 object-cover hover:scale-105 transition-transform" />
          </div>
        )}

        {/* 본문 내용 */}
          <p className={`text-sm whitespace-pre-wrap leading-relaxed ${
            isCompleted ? 'line-through text-slate-400' : 'text-slate-800'
          }`}>
            {renderFormattedText(memo.content || memo.text || "")}
          </p>
      </div>

      {/* 하단 태그 라벨 */}
      {memo.labels && memo.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-4 pt-3 border-t border-slate-50">
          {memo.labels.map((label) => (
            <span
              key={label}
              className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-600"
            >
              #{label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
