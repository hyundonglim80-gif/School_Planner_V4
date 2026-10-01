//src/features/memo/MemoCard.tsx

import React from 'react';
import type { Memo } from '../../hooks/useMemos';
import { renderFormattedText } from '../../lib/textUtils';
import { useAppStore } from '../../store/useAppStore';
import { useLabels } from '../../hooks/useLabels';
import { showErrorToastOnce } from '../../utils/toast';
import ImageViewerModal, { type ViewerImage } from '../../components/ImageViewerModal';
import { isLongEntry, previewLine } from '../../lib/entryCollapse';
import { attachmentImageSrc } from '../../lib/driveApi';
import { isImageAttachment } from '../../lib/attachments';
import { focusKey } from '../../lib/searchFocus';
import { normalizeTables } from '../../lib/entryTable';
import EntryTableView from '../../components/EntryTableView';
import { showDeletedToast } from '../../lib/undoToast';
import { checkLineState, hasCheckLines } from '../../lib/checkLines';

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

// ⚠️ 그림인지 가리는 규칙을 여기서 따로 만들지 않는다. 예전에는 이 카드가
//    제 것을 들고 있었는데, 기록이 쓰는 type: 'image' 를 못 알아보고
//    확장자도 몇 개 빠져 있어서 '어떤 그림은 미리보기가 되고 어떤 것은 안 되는'
//    일이 생겼다. 규칙은 lib/attachments 한 곳에만 둔다.
const isImageFile = isImageAttachment;

export default function MemoCard({ memo, onEdit, onToggleComplete, onToggleFavorite, onDelete, onMoveUp, onMoveDown, onToggleCheckLine }: MemoCardProps) {
  const { openLinkViewerModal } = useAppStore();
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

  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);

  // 첨부 이미지 + 구버전 단일 imageUrl 을 합쳐 뷰어에 넘긴다.
  const viewerImages = React.useMemo<ViewerImage[]>(() => {
    const list: ViewerImage[] = imageAttachments.map((a) => ({ url: attachmentImageSrc(a), name: a.name }));
    if (list.length === 0 && memo.imageUrl) list.push({ url: attachmentImageSrc({ url: memo.imageUrl }), name: '첨부 이미지' });
    return list;
  }, [imageAttachments, memo.imageUrl]);

  const fileAttachments = React.useMemo(() => {
    return normalizedAttachments.filter((a) => !isImageFile(a));
  }, [normalizedAttachments]);

  // 💡 등록된 라벨인지 확인하여 삭제된 라벨 거르기
  const validLabels = (memo.labels || []).filter(label => memoLabels.includes(label));

  // 접기/펼치기. 기록 카드와 같은 삼각형 토글, 같은 기준을 쓴다.
  // 직접 누르기 전에는 길이를 보고 정한다(긴 것은 접은 채로 시작).
  // 처음 값을 state에 담아 두면 내용이 바뀌어도 그 값이 그대로 남는다.
  const body = memo.content || memo.text || '';
  const tables = normalizeTables(memo.tables);
  const [manualCollapsed, setManualCollapsed] = React.useState<boolean | null>(null);
  const isCollapsed = manualCollapsed ?? isLongEntry(body);
  const preview = previewLine(body);

  // 체크 줄(☐/☑)은 누르면 체크한다. 저장하는 동안은 그 줄을 다시 받지 않는다 (두 번 눌러 되돌아가지 않게).
  const [pendingLine, setPendingLine] = React.useState<number | null>(null);
  const toggleLine = async (idx: number, line: string) => {
    if (!onToggleCheckLine || pendingLine !== null) return;
    setPendingLine(idx);
    try {
      await onToggleCheckLine(memo, idx, line);
    } finally {
      setPendingLine(null);
    }
  };
  const renderBody = () => {
    if (!onToggleCheckLine || !hasCheckLines(body)) return renderFormattedText(body);
    return body.split('\n').map((line, idx) => {
      const state = checkLineState(line);
      // 들여쓰기는 누르는 칸 밖에 둔다 (체크한 줄의 줄긋기가 빈칸까지 긋지 않게)
      const indent = state ? line.length - line.trimStart().length : 0;
      return (
        <React.Fragment key={idx}>
          {idx > 0 && '\n'}
          {indent > 0 && line.slice(0, indent)}
          {state ? (
            <span
              role="checkbox"
              aria-checked={state === 'done'}
              tabIndex={0}
              title={state === 'done' ? '눌러서 체크 풀기' : '눌러서 체크'}
              data-check-line={idx}
              onClick={(e) => {
                e.stopPropagation();
                void toggleLine(idx, line);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                e.stopPropagation();
                void toggleLine(idx, line);
              }}
              className={`rounded px-0.5 -mx-0.5 cursor-pointer hover:bg-slate-100 ${
                state === 'done' && !isCompleted ? 'text-slate-400 line-through' : ''
              } ${pendingLine === idx ? 'opacity-50' : ''}`}
            >
              {renderFormattedText(line.slice(indent))}
            </span>
          ) : (
            renderFormattedText(line)
          )}
        </React.Fragment>
      );
    });
  };

  return (
    <div
      data-focus-key={focusKey.memo(memo.firestoreId)}
      onClick={(e) => {
        e.stopPropagation();
        if (onEdit) onEdit(memo);
      }}
      className={`bg-white rounded-2xl p-3 sm:p-4 min-w-0 transition-all duration-200 border flex flex-col group shadow-sm hover:shadow-md hover:border-slate-300 cursor-pointer ${
        isCompleted ? 'bg-slate-50 border-slate-200 opacity-70' : 'border-slate-200/80'
      }`}
      title="클릭하여 수정"
    >
      <div>
        {/* 상단 액션 바 */}
        <div className="flex items-start justify-between gap-2 mb-2 sm:mb-3">
          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
            {/* 항목 접기/펼치기 삼각형 토글 (기록 카드와 같은 모양) */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setManualCollapsed(!isCollapsed); }}
              className="text-slate-400 hover:text-primary transition-colors p-0.5 text-xs cursor-pointer shrink-0"
              title={isCollapsed ? '펼치기' : '접기'}
            >
              {isCollapsed ? '▶' : '▼'}
            </button>
            {/* 차례 바꾸기 (기록·일정·수업과 같은 모양) */}
            <div className="flex flex-col items-center gap-0.5 shrink-0 px-0.5">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onMoveUp?.(); }}
                disabled={!onMoveUp}
                title="앞으로"
                aria-label="앞으로"
                className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-xs cursor-pointer"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onMoveDown?.(); }}
                disabled={!onMoveDown}
                title="뒤로"
                aria-label="뒤로"
                className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-xs cursor-pointer"
              >
                ▼
              </button>
            </div>
            <input
              type="checkbox"
              checked={isCompleted}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleComplete?.(memo)}
              className="w-4 h-4 rounded text-primary focus:ring-primary border-slate-300 accent-primary cursor-pointer"
            />
            {/* 즐겨찾기. 켠 것은 목록 맨 위에 모이고 '⭐ 즐겨찾기'로 걸러 볼 수 있다.
                수정·삭제 단추처럼 가리켰을 때만 보이게 하면 휴대폰에서는 누를 길이
                없어진다(손가락에는 hover가 없다). 늘 보여 둔다. */}
            {onToggleFavorite && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(memo);
                }}
                aria-pressed={!!memo.favorite}
                className={`p-0.5 text-sm leading-none transition-colors cursor-pointer shrink-0 ${
                  memo.favorite ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'
                }`}
                title={memo.favorite ? '즐겨찾기 해제' : '즐겨찾기'}
              >
                {memo.favorite ? '★' : '☆'}
              </button>
            )}
            <span className="text-xs text-slate-400">
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
                className="bg-yellow-100 text-yellow-800 text-xs px-1.5 py-0.5 rounded font-bold border border-yellow-300 hover:bg-yellow-200 transition-colors cursor-pointer flex items-center gap-1"
                title={`링크된 항목 ${linkCount}개`}
              >
                🔗 {linkCount}
              </button>
            )}
          </div>
          {/* 링크 추가는 수정 배너 안에 있으므로 여기서는 수정/삭제만 노출한다 */}
          <div className="hidden sm:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onEdit && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(memo);
                }}
                className="p-1 text-slate-400 hover:text-primary hover:bg-slate-100 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                title="메모 수정"
              >
                ✏️
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  // 지운 뒤에 알린다 (예전엔 지우기를 기다리지 않고 '삭제했습니다'부터 띄웠다)
                  let trashId: string | void;
                  try {
                    trashId = await onDelete(memo.firestoreId);
                  } catch (err) {
                    showErrorToastOnce('메모를 지우지 못했습니다.', err);
                    return;
                  }
                  showDeletedToast('🗑️ 메모를 삭제했습니다. 휴지통에서 복원할 수 있습니다.', trashId || undefined);
                }}
                className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-bold transition-all cursor-pointer"
                title="삭제"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* 접혀 있을 때는 첨부가 있다는 표시만 남기고 한 줄로 줄인다.
            펼치면 아래의 그림·파일·본문이 그대로 나온다. */}
        {isCollapsed && (
          <>
            {(viewerImages.length > 0 || fileAttachments.length > 0 || tables.length > 0) && (
              <div className="flex items-center gap-1.5 mb-2">
                {viewerImages.length > 0 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setViewerIndex(0); setViewerOpen(true); }}
                    className="bg-indigo-50 text-indigo-700 text-xs px-1.5 py-0.5 rounded font-bold border border-indigo-200 hover:bg-indigo-100 transition-colors cursor-pointer"
                    title="첨부 이미지 보기"
                  >
                    🖼️ {viewerImages.length}
                  </button>
                )}
                {fileAttachments.length > 0 && (
                  <span className="bg-slate-100 text-slate-600 text-xs px-1.5 py-0.5 rounded font-bold border border-slate-200">
                    📎 {fileAttachments.length}
                  </span>
                )}
                {tables.length > 0 && (
                  <span className="bg-emerald-50 text-emerald-700 text-xs px-1.5 py-0.5 rounded font-bold border border-emerald-200" title="붙인 표">
                    ▦ {tables.length}
                  </span>
                )}
              </div>
            )}
            {preview && (
              <p className={`text-sm truncate leading-relaxed ${isCompleted ? 'line-through text-slate-400' : 'text-slate-500'}`}>
                {preview}
              </p>
            )}
          </>
        )}

        {/* 미디어 / 파일 영역 */}
        {!isCollapsed && normalizedAttachments.length > 0 ? (
          <div className="mb-3 space-y-2">
            {/* 1. 이미지 렌더링 */}
            {imageAttachments.map((imgAtt, idx) => (
              <div
                key={`${imgAtt.url}-${idx}`}
                className="rounded-xl overflow-hidden border border-slate-100 bg-slate-50 cursor-pointer"
                onClick={(e) => { e.stopPropagation(); setViewerIndex(idx); setViewerOpen(true); }}
                title="클릭하여 크게 보기"
              >
                <img
                  src={attachmentImageSrc(imgAtt)}
                  alt={imgAtt.name || '첨부 이미지'}
                  className="w-full max-h-48 object-cover hover:scale-102 transition-transform duration-200"
                />
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
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-2 p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-xl transition-all group/file text-xs"
                >
                  <span className="text-base shrink-0">{icon}</span>
                  <span
                    className="font-semibold text-slate-700 group-hover/file:text-primary truncate flex-1"
                    title={name}
                  >
                    {name}
                  </span>
                  <span className="text-xs text-slate-400 shrink-0 font-medium group-hover/file:text-primary">
                    다운로드
                  </span>
                </a>
              );
            })}
          </div>
        ) : !isCollapsed && memo.imageUrl ? (
          <div
            className="mb-3 rounded-xl overflow-hidden border border-slate-100 bg-slate-50 cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setViewerIndex(0); setViewerOpen(true); }}
            title="클릭하여 크게 보기"
          >
            <img
              src={attachmentImageSrc({ url: memo.imageUrl })}
              alt="첨부된 이미지"
              className="w-full max-h-48 object-cover hover:scale-102 transition-transform duration-200"
            />
          </div>
        ) : null}

        {/* 본문 텍스트 */}
        {!isCollapsed && (
          <p
            className={`text-sm whitespace-pre-wrap break-words leading-relaxed ${
              isCompleted ? 'line-through text-slate-400' : 'text-slate-800'
            }`}
          >
            {renderBody()}
          </p>
        )}
        {/* 붙인 표 - 작게 보기만 (고치기는 카드를 눌러 연 칸에서) */}
        {!isCollapsed &&
          tables.map((t) => (
            <div key={t.id} className="mt-2">
              <EntryTableView table={t} compact />
            </div>
          ))}
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

      <ImageViewerModal
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
        images={viewerImages}
        startIndex={viewerIndex}
      />
    </div>
  );
}