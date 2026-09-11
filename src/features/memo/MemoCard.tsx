//src/features/memo/MemoCard.tsx

import React from 'react';
import type { Memo } from '../../hooks/useMemos';
import { renderFormattedText } from '../../lib/textUtils';
import { useAppStore } from '../../store/useAppStore';
import { useLabels } from '../../hooks/useLabels';

interface MemoCardProps {
  memo: Memo;
  onEdit?: (memo: Memo) => void;
  onToggleComplete?: (memo: Memo) => void;
  onDelete?: (firestoreId: string) => void;
}

interface NormalizedAttachment {
  name: string;
  url: string;
  type?: string;
  size?: number;
}

const normalizeAttachment = (att: any): NormalizedAttachment | null => {
  if (!att) return null;
  if (typeof att === 'string') {
    const url = att.trim();
    if (!url) return null;
    const name = url.split('/').pop()?.split('?')[0] || '첨부파일';
    return { name, url, type: '' };
  }
  const url = att.url || att.downloadUrl || att.fileUrl || '';
  if (!url || typeof url !== 'string') return null;
  const name = att.name || url.split('/').pop()?.split('?')[0] || '첨부파일';
  return {
    name,
    url,
    type: typeof att.type === 'string' ? att.type : '',
    size: typeof att.size === 'number' ? att.size : undefined,
  };
};

const isImageFile = (att: NormalizedAttachment): boolean => {
  if (att.type && typeof att.type === 'string' && att.type.startsWith('image/')) {
    return true;
  }
  if (att.url && typeof att.url === 'string' && att.url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)) {
    return true;
  }
  if (att.name && typeof att.name === 'string' && att.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
    return true;
  }
  return false;
};

export default function MemoCard({ memo, onEdit, onToggleComplete, onDelete }: MemoCardProps) {
  const { openLinkerModal, openLinkViewerModal } = useAppStore();
  const { memoLabels } = useLabels();

  const isCompleted = !!memo.completed;
  const linkCount = (memo.linkedItems || []).length;

  const memoDate = new Date(memo.createdAt);
  const memoDateStr = `${memoDate.getFullYear()}-${String(memoDate.getMonth() + 1).padStart(2, '0')}-${String(memoDate.getDate()).padStart(2, '0')}`;

  const normalizedAttachments = React.useMemo<NormalizedAttachment[]>(() => {
    if (!memo.attachments || !Array.isArray(memo.attachments)) return [];
    return memo.attachments
      .map(normalizeAttachment)
      .filter((a): a is NormalizedAttachment => a !== null);
  }, [memo.attachments]);

  const imageAttachments = React.useMemo(() => {
    return normalizedAttachments.filter(isImageFile);
  }, [normalizedAttachments]);

  const fileAttachments = React.useMemo(() => {
    return normalizedAttachments.filter((a) => !isImageFile(a));
  }, [normalizedAttachments]);

  // 💡 등록된 라벨인지 확인하여 삭제된 라벨 거르기
  const validLabels = (memo.labels || []).filter(label => memoLabels.includes(label));

  return (
    <div
      onDoubleClick={(e) => { 
        e.stopPropagation();
        if (onEdit) onEdit(memo); 
      }}
      className={`bg-white rounded-2xl p-4 transition-all duration-200 border flex flex-col group shadow-sm hover:shadow-md hover:border-slate-300 cursor-pointer ${
        isCompleted ? 'bg-slate-50 border-slate-200 opacity-70' : 'border-slate-200/80'
      }`}
      title="더블클릭하여 수정"
    >
      <div>
        {/* 상단 액션 바 */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isCompleted}
              onChange={() => onToggleComplete?.(memo)}
              className="w-4 h-4 rounded text-primary focus:ring-primary border-slate-300 accent-primary cursor-pointer"
            />
            <span className="text-[16.5px] text-slate-400">
              {new Date(memo.createdAt).toLocaleDateString('ko-KR', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {linkCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openLinkViewerModal('memo', memoDateStr, memo.firestoreId, undefined, memo.groupId || 'personal');
                }}
                className="bg-yellow-100 text-yellow-800 text-[15px] px-1.5 py-0.5 rounded font-bold border border-yellow-300 hover:bg-yellow-200 transition-colors cursor-pointer flex items-center gap-1"
                title={`링크된 항목 ${linkCount}개`}
              >
                🔗 {linkCount}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openLinkerModal('memo', memoDateStr, memo.firestoreId, undefined, undefined, memo.groupId || 'personal');
              }}
              className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-lg text-xs font-semibold transition-all cursor-pointer"
              title="링크 추가"
            >
              🔗
            </button>
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(memo)}
                className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-primary hover:bg-slate-100 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                title="메모 수정"
              >
                ✏️
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm('정말 삭제하시겠습니까?')) {
                    onDelete(memo.firestoreId);
                  }
                }}
                className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-bold transition-all cursor-pointer"
                title="삭제"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* 미디어 / 파일 영역 */}
        {normalizedAttachments.length > 0 ? (
          <div className="mb-3 space-y-2">
            {/* 1. 이미지 렌더링 */}
            {imageAttachments.map((imgAtt, idx) => (
              <div
                key={`${imgAtt.url}-${idx}`}
                className="rounded-xl overflow-hidden border border-slate-100 bg-slate-50"
              >
                <a href={imgAtt.url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={imgAtt.url}
                    alt={imgAtt.name || '첨부 이미지'}
                    className="w-full max-h-48 object-cover hover:scale-102 transition-transform duration-200"
                  />
                </a>
              </div>
            ))}
            {/* 2. 일반 파일 렌더링 */}
            {fileAttachments.map((fileAtt, idx) => {
              let icon = '📁';
              const name = fileAtt.name || '';
              if (name.match(/\.(pdf)$/i)) icon = '📄';
              else if (name.match(/\.(doc|docx|hwp|hwpx|txt)$/i)) icon = '📝';
              else if (name.match(/\.(xls|xlsx|csv)$/i)) icon = '📊';
              else if (name.match(/\.(zip|7z|rar)$/i)) icon = '🗜️';

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
                  <span
                    className="font-semibold text-slate-700 group-hover/file:text-primary truncate flex-1"
                    title={name}
                  >
                    {name}
                  </span>
                  <span className="text-[15px] text-slate-400 shrink-0 font-medium group-hover/file:text-primary">
                    다운로드
                  </span>
                </a>
              );
            })}
          </div>
        ) : memo.imageUrl ? (
          <div className="mb-3 rounded-xl overflow-hidden border border-slate-100 bg-slate-50">
            <a href={memo.imageUrl} target="_blank" rel="noopener noreferrer">
              <img
                src={memo.imageUrl}
                alt="첨부된 이미지"
                className="w-full max-h-48 object-cover hover:scale-102 transition-transform duration-200"
              />
            </a>
          </div>
        ) : null}

        {/* 본문 텍스트 */}
        <p
          className={`text-sm whitespace-pre-wrap leading-relaxed ${
            isCompleted ? 'line-through text-slate-400' : 'text-slate-800'
          }`}
        >
          {renderFormattedText(memo.content || memo.text || '')}
        </p>
      </div>

      {/* 💡 하단 라벨 (필터링된 validLabels만 렌더링) */}
      {validLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-4 pt-3 border-t border-slate-50">
          {validLabels.map((label) => (
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