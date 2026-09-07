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

          <div className="flex items-center gap-1">
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(memo)}
                className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-primary hover:bg-slate-100 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                title="수정"
              >
                ✏️
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm('이 메모를 삭제하시겠습니까?')) {
                    onDelete(memo.firestoreId);
                  }
                }}
                className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-bold transition-all cursor-pointer"
                title="메모 삭제"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* 첨부 파일 및 이미지 영역 */}
        {memo.attachments && memo.attachments.length > 0 ? (
          <div className="mb-3 space-y-2">
            {/* 1. 이미지 첨부파일들 */}
            {memo.attachments.filter(
              (a) => a.type?.startsWith('image/') || a.url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)
            ).map((imgAtt, idx) => (
              <div key={`${imgAtt.url}-${idx}`} className="rounded-xl overflow-hidden border border-slate-100 bg-slate-50">
                <a href={imgAtt.url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={imgAtt.url}
                    alt={imgAtt.name || '첨부 이미지'}
                    className="w-full max-h-48 object-cover hover:scale-102 transition-transform duration-200"
                  />
                </a>
              </div>
            ))}

            {/* 2. 일반 첨부파일들 (문서, PDF 등) */}
            {memo.attachments.filter(
              (a) => !a.type?.startsWith('image/') && !a.url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)
            ).map((fileAtt, idx) => {
              let icon = '📎';
              if (fileAtt.name.match(/\.(pdf)$/i)) icon = '📕';
              else if (fileAtt.name.match(/\.(doc|docx|hwp|hwpx|txt)$/i)) icon = '📄';
              else if (fileAtt.name.match(/\.(xls|xlsx|csv)$/i)) icon = '📊';
              else if (fileAtt.name.match(/\.(zip|7z|rar)$/i)) icon = '📦';

              return (
                <a
                  key={`${fileAtt.url}-${idx}`}
                  href={fileAtt.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  className="flex items-center gap-2 p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-xl transition-all group/file text-xs"
                >
                  <span className="text-base shrink-0">{icon}</span>
                  <span className="font-semibold text-slate-700 group-hover/file:text-primary truncate flex-1" title={fileAtt.name}>
                    {fileAtt.name}
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0 font-medium group-hover/file:text-primary">
                    다운로드 ⬇
                  </span>
                </a>
              );
            })}
          </div>
        ) : memo.imageUrl ? (
          <div className="mb-3 rounded-xl overflow-hidden border border-slate-100 bg-slate-50">
            <a href={memo.imageUrl} target="_blank" rel="noopener noreferrer">
              <img src={memo.imageUrl} alt="메모 첨부 이미지" className="w-full max-h-48 object-cover hover:scale-102 transition-transform duration-200" />
            </a>
          </div>
        ) : null}

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
