// src/components/EntryCard.tsx
//
// 메모 카드와 기록 카드를 하나로 (19번 U6, docs/ROADMAP-REFINE.md). 메모 화면(MemoCard가 감싼다)과 하루 화면 기록 칸(DayJournal)이 쓴다.
//   머리줄: ▶ ▲▼ ☐완료 ★ 라벨칩… 날짜 🔗 (접혔을 때 🖼️·📎·▦)  ……  ✏️ 삭제
//   - 라벨 칩은 위(머리줄)에. 예전 메모 카드 아래의 '#라벨'은 없앴다. 칩 색은 메모·기록 라벨 한 목록(useLabels.entryLabels)의 색.
//   - 목록에 없는 라벨(지운 라벨)은 그리지 않는다.
//   - 완료는 줄 긋기, ★ 즐겨찾기. 기록의 completed·favorite는 V4 전용 칸(V3는 기록 항목을 통째로 들고 다녀 지우지 않는다 - U6에서 V3 코드로 확인).
// 메모·기록이 다른 것(차례 단추의 뜻, 삭제 단추의 이름, 날짜 모양)은 props로 받는다.
import React from 'react';
import { renderFormattedText } from '../lib/textUtils';
import { useLabels } from '../hooks/useLabels';
import { showErrorToastOnce } from '../utils/toast';
import ImageViewerModal, { type ViewerImage } from './ImageViewerModal';
import { isLongEntry, previewLine } from '../lib/entryCollapse';
import { attachmentImageSrc } from '../lib/driveApi';
import { isImageAttachment } from '../lib/attachments';
import { normalizeTables } from '../lib/entryTable';
import EntryTableView from './EntryTableView';
import { showDeletedToast } from '../lib/undoToast';
import { checkCount, checkLineState, hasCheckLines } from '../lib/checkLines';
import { labelPath } from '../lib/labelTree';

export interface EntryCardProps {
  kind: 'memo' | 'journal';
  /** data-focus-key (검색에서 이동해 올 자리) */
  focusKey: string;
  /** 본문 (기록의 표만 있는 '[표]'는 부르는 쪽이 빈 글로) */
  content: string;
  /** 붙은 라벨 이름 (차례대로) */
  labels: string[];
  /** 라벨 상위/하위 - 칩에 마우스를 올리면 '상위 › 하위' */
  labelParents?: Record<string, string>;
  completed?: boolean;
  favorite?: boolean;
  /** 머리줄의 날짜·시각 글 */
  dateText: string;
  /** 날짜 옆에 작게 (메모: 기록에서 왔으면 '📅 10/6에서') */
  note?: string;
  attachments?: unknown[];
  /** 옛 단일 그림 */
  imageUrl?: string;
  tables?: unknown[];
  linkCount?: number;
  onOpenLinks?: () => void;
  /** 카드를 누르면 (쓰는 칸 열기) */
  onOpen?: () => void;
  onToggleComplete?: () => void;
  onToggleFavorite?: () => void;
  /** 앞(▲)·뒤(▼)와 차례 바꾸기. 바꿀 상대가 없으면 주지 않는다 */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** 휴지통 문서 id를 돌려주면 안내에 '되돌리기'가 붙는다 */
  onDelete?: () => Promise<string | void> | string | void;
  /** '☐ 우유' 줄을 누르면 그 줄의 체크 글자만 바꾼다 (lib/checkLines). 주지 않으면 그냥 글로 보인다 */
  onToggleCheckLine?: (lineIndex: number, line: string) => Promise<boolean> | void;
  /** 접기 상태를 밖에서 들고 있으면 (기록 칸). 주지 않으면 카드가 든다 */
  collapsed?: boolean;
  onToggleCollapse?: (current: boolean) => void;
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

/** 라벨 칩 색 (라벨 관리의 색 이름 → 칩) */
const CHIP_COLOR: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  green: 'bg-green-50 text-green-700 border-green-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  orange: 'bg-orange-50 text-orange-700 border-orange-200',
  yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
  pink: 'bg-pink-50 text-pink-700 border-pink-200',
  gray: 'bg-slate-50 text-slate-700 border-slate-200',
};

const NOUN = { memo: '메모', journal: '기록' } as const;

export default function EntryCard(props: EntryCardProps) {
  const {
    kind,
    focusKey,
    content: body,
    labels,
    labelParents = {},
    completed = false,
    favorite = false,
    dateText,
    linkCount = 0,
    onOpenLinks,
    onOpen,
    onToggleComplete,
    onToggleFavorite,
    onMoveUp,
    onMoveDown,
    onDelete,
    onToggleCheckLine,
  } = props;
  const noun = NOUN[kind];
  const { entryLabels, memoLabels } = useLabels();
  // 한 목록(useLabels.entryLabels)이 없으면(오래된 목·테스트) 메모 라벨 이름으로
  const knownLabels = entryLabels ?? (memoLabels || []).map((name) => ({ name, color: 'gray' }));

  const normalizedAttachments = React.useMemo<NormalizedAttachment[]>(() => {
    if (!props.attachments || !Array.isArray(props.attachments)) return [];
    return props.attachments.map(normalizeAttachment).filter((a): a is NormalizedAttachment => a !== null);
  }, [props.attachments]);
  const imageAttachments = React.useMemo(() => normalizedAttachments.filter(isImageAttachment), [normalizedAttachments]);
  const fileAttachments = React.useMemo(
    () => normalizedAttachments.filter((a) => !isImageAttachment(a)),
    [normalizedAttachments]
  );
  // 첨부 이미지 + 구버전 단일 imageUrl 을 합쳐 뷰어에 넘긴다.
  const viewerImages = React.useMemo<ViewerImage[]>(() => {
    const list: ViewerImage[] = [];
    if (props.imageUrl && !imageAttachments.some((a) => a.url === props.imageUrl)) {
      list.push({ url: attachmentImageSrc({ url: props.imageUrl }), name: '첨부 이미지' });
    }
    imageAttachments.forEach((a) => list.push({ url: attachmentImageSrc(a), name: a.name }));
    return list;
  }, [imageAttachments, props.imageUrl]);
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);
  const openViewer = (idx: number) => {
    setViewerIndex(idx);
    setViewerOpen(true);
  };

  // 지운 라벨은 칩을 그리지 않는다. 색은 한 목록에서.
  const chips = labels
    .map((name) => knownLabels.find((l) => l.name === name))
    .filter((l): l is NonNullable<typeof l> => !!l);

  const tables = normalizeTables(props.tables);

  // 접기/펼치기 - 직접 누르기 전에는 길이를 보고 정한다(긴 것은 접은 채로 시작)
  const [ownCollapsed, setOwnCollapsed] = React.useState<boolean | null>(null);
  const isCollapsed = props.collapsed ?? ownCollapsed ?? isLongEntry(body);
  const toggleCollapse = () => {
    if (props.onToggleCollapse) props.onToggleCollapse(isCollapsed);
    else setOwnCollapsed(!isCollapsed);
  };
  const preview = previewLine(body);
  // 체크 목록 셈 (19번 U9) - 체크 줄이 있을 때만 머리줄에 '☑ 2/5'
  const checks = checkCount(body);

  // 체크 줄(☐/☑)은 누르면 체크한다. 저장하는 동안은 그 줄을 다시 받지 않는다 (두 번 눌러 되돌아가지 않게).
  const [pendingLine, setPendingLine] = React.useState<number | null>(null);
  const toggleLine = async (idx: number, line: string) => {
    if (!onToggleCheckLine || pendingLine !== null) return;
    setPendingLine(idx);
    try {
      await onToggleCheckLine(idx, line);
    } finally {
      setPendingLine(null);
    }
  };
  /**
   * 본문. 체크 줄(☐/☑)은 누르면 체크한다. 체크한 줄(☑)은 카드 아래쪽에 모아 줄을 긋고 바탕을 칠한다(구글 Keep처럼, 2026-10-07 사용자 요청) -
   * 보이는 차례만 바꾼다. 저장된 글의 차례는 그대로이고, 누를 때는 원래 줄 번호로 고친다(toggleCheckLine).
   */
  const renderBody = () => {
    if (!onToggleCheckLine || !hasCheckLines(body)) return renderFormattedText(body);
    const lines = body.split('\n').map((line, idx) => ({ line, idx, state: checkLineState(line) }));
    const open = lines.filter((l) => l.state !== 'done');
    const done = lines.filter((l) => l.state === 'done');
    // 위쪽의 끝 빈 줄은 뺀다 (체크한 줄이 빠진 자리)
    while (open.length > 0 && !open[open.length - 1].line.trim()) open.pop();
    const checkSpan = (line: string, idx: number, state: 'open' | 'done', extra: string) => {
      // 들여쓰기는 누르는 칸 밖에 둔다 (체크한 줄의 줄긋기가 빈칸까지 긋지 않게)
      const indent = line.length - line.trimStart().length;
      return (
        <>
          {state === 'open' && indent > 0 && line.slice(0, indent)}
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
            className={`rounded px-0.5 -mx-0.5 cursor-pointer hover:bg-slate-100 ${extra} ${pendingLine === idx ? 'opacity-50' : ''}`}
          >
            {renderFormattedText(line.slice(indent))}
          </span>
        </>
      );
    };
    return (
      <>
        {open.map(({ line, idx, state }, i) => (
          <React.Fragment key={idx}>
            {i > 0 && '\n'}
            {state ? checkSpan(line, idx, state, '') : renderFormattedText(line)}
          </React.Fragment>
        ))}
        {done.length > 0 && (
          <span data-check-done-section className={`block space-y-0.5 ${open.length > 0 ? 'mt-1.5 pt-1.5 border-t border-dashed border-slate-200' : ''}`}>
            {done.map(({ line, idx }) => (
              <span key={idx} className="block" data-check-done={idx}>
                {checkSpan(line, idx, 'done', `block !mx-0 px-1.5 py-0.5 bg-slate-100 text-slate-400 line-through`)}
              </span>
            ))}
          </span>
        )}
      </>
    );
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDelete) return;
    // 지운 뒤에 알린다 (예전엔 지우기를 기다리지 않고 '삭제했습니다'부터 띄웠다)
    let trashId: string | void;
    try {
      trashId = await onDelete();
    } catch (err) {
      showErrorToastOnce(`${noun}를 지우지 못했습니다.`, err);
      return;
    }
    showDeletedToast(`🗑️ ${noun}를 삭제했습니다. 휴지통에서 복원할 수 있습니다.`, trashId || undefined);
  };

  return (
    <div
      data-focus-key={focusKey}
      data-entry-card={kind}
      data-completed={completed ? 'true' : undefined}
      data-favorite={favorite ? 'true' : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.();
      }}
      className={`relative w-full rounded-2xl p-3 sm:p-4 min-w-0 transition-all duration-200 border flex flex-col gap-2 group shadow-sm hover:shadow-md hover:border-slate-300 cursor-pointer ${
        completed ? 'bg-slate-50 border-slate-200 opacity-70' : 'bg-white border-slate-200/80'
      }`}
      title="클릭하여 수정"
    >
      {/* 머리줄 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-x-1.5 gap-y-1 flex-wrap min-w-0">
          {/* 단추·라벨 칩은 한 줄에 (라벨이 여럿이어도 첫 줄에 - 2026-10-07 사용자 요청). 날짜·표시는 넘치면 다음 줄로 */}
          <span className="flex items-center gap-1.5 flex-nowrap min-w-0 max-w-full">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapse();
            }}
            className="text-slate-400 hover:text-primary transition-colors p-0.5 text-xs cursor-pointer shrink-0"
            title={isCollapsed ? '펼치기' : '접기'}
          >
            {isCollapsed ? '▶' : '▼'}
          </button>
          {(onMoveUp !== undefined || onMoveDown !== undefined || kind === 'memo') && (
            <div className="flex flex-col items-center gap-0.5 shrink-0 px-0.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp?.();
                }}
                disabled={!onMoveUp}
                title="앞으로"
                aria-label="앞으로"
                className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-xs cursor-pointer"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown?.();
                }}
                disabled={!onMoveDown}
                title="뒤로"
                aria-label="뒤로"
                className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-xs cursor-pointer"
              >
                ▼
              </button>
            </div>
          )}
          {onToggleComplete && (
            <input
              type="checkbox"
              checked={completed}
              aria-label={`${noun} 완료`}
              data-entry-card-complete
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleComplete()}
              className="w-4 h-4 rounded text-primary focus:ring-primary border-slate-300 accent-primary cursor-pointer shrink-0"
            />
          )}
          {/* 즐겨찾기. 휴대폰에는 hover가 없어 늘 보인다 */}
          {onToggleFavorite && (
            <button
              type="button"
              data-entry-card-favorite
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              aria-pressed={favorite}
              className={`p-0.5 text-sm leading-none transition-colors cursor-pointer shrink-0 ${
                favorite ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'
              }`}
              title={favorite ? '즐겨찾기 해제' : '즐겨찾기'}
            >
              {favorite ? '★' : '☆'}
            </button>
          )}
          {chips.map((l) => (
            <span
              key={l.name}
              data-entry-card-label={l.name}
              title={labelPath(l.name, labelParents)}
              className={`px-2 py-0.5 rounded-md text-xs font-bold border whitespace-nowrap truncate min-w-0 max-w-[10rem] ${CHIP_COLOR[l.color] || CHIP_COLOR.gray}`}
            >
              {l.name}
            </span>
          ))}
          </span>
          <span className="text-xs text-slate-400">{dateText}</span>
          {props.note && (
            <span className="text-2xs font-bold text-slate-400" data-entry-card-note>
              {props.note}
            </span>
          )}
          {checks.total > 0 && (
            <span
              data-entry-card-checks
              title={`체크 목록 ${checks.total}개 가운데 ${checks.done}개 체크`}
              className={`text-xs font-bold px-1.5 py-0.5 rounded border ${
                checks.done === checks.total ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}
            >
              ☑ {checks.done}/{checks.total}
            </span>
          )}
          {linkCount > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenLinks?.();
              }}
              className="bg-yellow-100 text-yellow-800 text-xs px-1.5 py-0.5 rounded font-bold border border-yellow-300 hover:bg-yellow-200 transition-colors cursor-pointer flex items-center gap-1"
              title={`링크된 항목 ${linkCount}개`}
            >
              🔗 {linkCount}
            </button>
          )}
          {/* 접혀 있을 때는 그림이 있다는 표시만 */}
          {isCollapsed && viewerImages.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openViewer(0);
              }}
              className="bg-indigo-50 text-indigo-700 text-xs px-1.5 py-0.5 rounded font-bold border border-indigo-200 hover:bg-indigo-100 transition-colors cursor-pointer"
              title="첨부 이미지 보기"
            >
              🖼️ {viewerImages.length}
            </button>
          )}
          {/* 파일·표 표시는 늘 (기록 카드가 예전부터 그랬다), 그림은 접혔을 때만 (펼치면 그림이 보인다) */}
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
        {/* 마우스를 올렸을 때만 - 자리를 차지하지 않게 위에 띄운다 (칩이 밀려 줄바꿈되지 않게) */}
        <div className="hidden sm:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 absolute top-2 right-2 bg-white/95 rounded-lg shadow-xs">
          {onOpen && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
              className="p-1 text-slate-400 hover:text-primary hover:bg-slate-100 rounded-lg text-xs font-semibold transition-all cursor-pointer"
              title={`${noun} 수정`}
            >
              ✏️
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={handleDelete}
              className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-bold transition-all cursor-pointer"
              // 메모는 예전부터 '삭제', 기록은 '기록 삭제' (점검 스크립트가 이 이름으로 찾는다)
              title={kind === 'memo' ? '삭제' : '기록 삭제'}
            >
              {kind === 'memo' ? '✕' : '🗑️'}
            </button>
          )}
        </div>
      </div>

      {isCollapsed && preview && (
        <p className={`text-sm truncate leading-relaxed ${completed ? 'line-through text-slate-400' : 'text-slate-500'}`}>{preview}</p>
      )}

      {!isCollapsed && (
        <>
          {viewerImages.length > 0 && (
            <div className="space-y-2">
              {viewerImages.map((img, idx) => (
                <div
                  key={`${img.url}-${idx}`}
                  className="rounded-xl overflow-hidden border border-slate-100 bg-slate-50 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    openViewer(idx);
                  }}
                  title="클릭하여 크게 보기"
                >
                  <img src={img.url} alt={img.name || '첨부 이미지'} className="w-full max-h-48 object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          )}
          {fileAttachments.length > 0 && (
            <div className="space-y-2">
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
                    <span className="font-semibold text-slate-700 group-hover/file:text-primary truncate flex-1" title={name}>
                      📎 {name}
                    </span>
                    <span className="text-xs text-slate-400 shrink-0 font-medium group-hover/file:text-primary">다운로드</span>
                  </a>
                );
              })}
            </div>
          )}
          {body && (
            <p
              className={`text-sm whitespace-pre-wrap break-words leading-relaxed ${
                completed ? 'line-through text-slate-400' : 'text-slate-800'
              }`}
            >
              {renderBody()}
            </p>
          )}
          {/* 붙인 표 - 작게 보기만 (고치기는 카드를 눌러 연 칸에서) */}
          {tables.map((t) => (
            <EntryTableView key={t.id} table={t} compact />
          ))}
        </>
      )}

      <ImageViewerModal isOpen={viewerOpen} onClose={() => setViewerOpen(false)} images={viewerImages} startIndex={viewerIndex} />
    </div>
  );
}
