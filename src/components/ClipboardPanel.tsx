// src/components/ClipboardPanel.tsx
//
// 왼쪽 클립보드 칸. 화면 왼쪽 가장자리의 작은 📋 단추로 열고 닫는다.
//   - 복사한 것(글자·캡처 그림)을 최신 것이 위로 오게 보여 준다. 모으는 규칙은 lib/clipboardHistory.
//   - 칸은 스스로 스크롤한다. 왼쪽 화면과 따로 돈다.
//   - 항목을 누르면 마지막으로 글을 쓰던 칸에 붙여넣는다. 누르는 순간 그 칸의 커서를
//     빼앗지 않도록(mousedown 기본 동작을 막는다) 한다.
//   - 넓은 화면(768px~)에서는 화면 옆에 붙어 화면을 오른쪽으로 민다. 휴대폰은 위에 덮는다.
//   - 폭은 오른쪽 경계선을 끌어 바꾼다 (ColumnResizer).
import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useMinWidth } from '../hooks/useMinWidth';
import { useBackLayer } from '../hooks/useModalLayer';
import {
  addCopiedText,
  clearClips,
  loadClipboardHistory,
  pasteClip,
  readSystemClipboard,
  rememberEditable,
  removeClip,
  selectedTextForCopy,
  useClipboardHistory,
  clipboardReadGranted,
  type ClipItem,
} from '../lib/clipboardHistory';
import { showToast, showErrorToast } from '../utils/toast';
import { SHORTCUT_ACTIONS, formatActionBinding, resolveBindings } from '../lib/shortcuts';

/** 이 폭 이상이면 화면 옆에 붙인다 (오른쪽 칸과 같은 경계) */
const DOCK_MIN_WIDTH = 768;

/** 왼쪽 칸의 기본 폭 */
export const LEFT_COLUMN_WIDTH = 'clamp(260px, 24vw, 380px)';
/** 경계선을 끌어 바꾼 폭(--left-column-w)이 있으면 그것. 오른쪽 화면이 320px은 남게 묶는다. */
export const LEFT_COLUMN_CSS_WIDTH = `min(var(--left-column-w, ${LEFT_COLUMN_WIDTH}), calc(100vw - 320px))`;

/** 칸이 열려 있는 동안 시스템 클립보드를 다시 보는 간격 (읽기를 허락해 둔 경우만) */
const POLL_MS = 2000;

/** 복사한 것을 모은다. 칸이 닫혀 있어도 모은다 (Layout이 늘 부른다). */
export function useClipboardCapture() {
  const open = useAppStore((s) => s.clipboardOpen);

  useEffect(() => {
    void loadClipboardHistory();

    const onCopy = () => {
      const text = selectedTextForCopy();
      if (text) void addCopiedText(text);
    };
    const onFocusIn = (e: FocusEvent) => rememberEditable(e.target as Element);
    // 다른 프로그램에서 복사·캡처하고 돌아왔을 때 (읽기를 허락해 둔 경우만)
    const onReturn = () => {
      if (document.visibilityState === 'visible') void readSystemClipboard(false);
    };
    document.addEventListener('copy', onCopy, true);
    document.addEventListener('cut', onCopy, true);
    document.addEventListener('focusin', onFocusIn, true);
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      document.removeEventListener('copy', onCopy, true);
      document.removeEventListener('cut', onCopy, true);
      document.removeEventListener('focusin', onFocusIn, true);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, []);

  // 칸이 열려 있는 동안은 가끔 다시 본다. 앱의 '복사' 단추(태그 복사 등)처럼
  // copy 이벤트 없이 클립보드에 쓰는 것도 잡힌다.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setInterval(() => {
      if (alive) void readSystemClipboard(false);
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open]);
}

function timeLabel(ms: number) {
  const d = new Date(ms);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function ClipRow({ item }: { item: ClipItem }) {
  const url = useMemo(() => (item.blob ? URL.createObjectURL(item.blob) : null), [item.blob]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const paste = async () => {
    const r = await pasteClip(item);
    if (r === 'copied') showToast('📋 붙여넣을 칸이 없어 클립보드에 담았습니다. 원하는 곳에서 Ctrl+V 하세요.');
    if (r === 'failed') showErrorToast('붙여넣지 못했습니다. 글을 쓸 칸을 먼저 눌러 주세요.');
  };

  return (
    <li className="group relative">
      <button
        type="button"
        // 누르는 순간 글을 쓰던 칸의 커서를 빼앗지 않는다 (그래야 그 자리에 넣는다)
        onMouseDown={(e) => e.preventDefault()}
        onClick={paste}
        title="눌러서 붙여넣기"
        className="w-full text-left px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer"
      >
        <span className="block text-2xs font-bold text-slate-400 mb-1">
          {item.kind === 'image' ? '🖼️ 그림' : '📝 글자'} · {timeLabel(item.createdAt)}
        </span>
        {item.kind === 'image' && url ? (
          <img src={url} alt="복사한 그림" className="max-h-40 max-w-full rounded-lg border border-slate-100 object-contain" />
        ) : (
          <span className="block text-xs text-slate-700 whitespace-pre-wrap break-words line-clamp-6">{item.text}</span>
        )}
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void removeClip(item.id)}
        title="휴지통으로 (휴지통에서 되살릴 수 있다)"
        aria-label="이 항목 휴지통으로"
        className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      >
        ✕
      </button>
    </li>
  );
}

export default function ClipboardPanel() {
  const open = useAppStore((s) => s.clipboardOpen);
  const setOpen = useAppStore((s) => s.setClipboardOpen);
  const docked = useMinWidth(DOCK_MIN_WIDTH);
  const items = useClipboardHistory((s) => s.items);
  const [granted, setGranted] = useState(true);
  // 여닫는 단축키 (환경설정 > 단축키에서 정한 것이 있으면 단추 설명에 붙인다)
  const overrides = useAppStore((s) => s.shortcutOverrides);
  const key = resolveBindings(overrides).clipboard;
  const keyHint = key.key ? ` (단축키: ${formatActionBinding(SHORTCUT_ACTIONS.find((a) => a.id === 'clipboard')!, key)})` : '';

  // 휴대폰에서는 화면을 덮으므로, 열어 둔 채 앱을 다시 열었을 때 곧바로 덮지 않게 닫고 시작한다
  useEffect(() => {
    if (!docked && useAppStore.getState().clipboardOpen) setOpen(false);
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (open) void clipboardReadGranted().then(setGranted);
  }, [open]);

  // 휴대폰에서 덮은 칸은 뒤로가기로 닫는다 (화면 옆에 붙은 칸은 앱을 쓰는 중 그대로 둔다)
  useBackLayer(open && !docked, () => setOpen(false));

  const fetchNow = async () => {
    const r = await readSystemClipboard(true);
    setGranted(await clipboardReadGranted());
    if (r === 'denied') showErrorToast('클립보드를 읽지 못했습니다. 주소창 왼쪽의 사이트 설정에서 클립보드를 허용해 주세요.');
    if (r === 'unsupported') showErrorToast('이 브라우저는 클립보드 읽기를 지원하지 않습니다.');
  };

  const toggle = (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setOpen(!open)}
      title={(open ? '클립보드 닫기' : '클립보드 열기 (복사한 것 모아 보기)') + keyHint}
      aria-label={open ? '클립보드 닫기' : '클립보드 열기'}
      aria-expanded={open}
      className="fixed top-1/2 -translate-y-1/2 z-[46] w-6 h-14 flex items-center justify-center rounded-r-xl bg-white/90 border border-l-0 border-slate-200 shadow-md text-xs hover:bg-primary/10 hover:w-7 transition-all cursor-pointer"
      style={{ left: open && docked ? LEFT_COLUMN_CSS_WIDTH : 0 }}
    >
      {open ? '◀' : '📋'}
    </button>
  );

  if (!open) return toggle;

  const panel = (
    <aside
      data-clipboard-panel
      aria-label="클립보드"
      className="bg-white h-full flex flex-col overflow-y-auto overscroll-contain"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-black text-slate-800">📋 클립보드</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            title="닫기"
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
        <p className="text-2xs text-slate-400 mt-1">누르면 글을 쓰던 칸에 붙여넣습니다. 이 기기에만 남습니다.</p>
        <div className="flex items-center gap-1.5 mt-2">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={fetchNow}
            title="다른 프로그램에서 복사·캡처한 것을 지금 가져옵니다"
            className="px-2.5 py-1.5 rounded-lg bg-primary text-white text-2xs font-bold hover:bg-primary/90 cursor-pointer"
          >
            ⤓ 가져오기
          </button>
          {items.length > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (window.confirm(`클립보드 목록 ${items.length}개를 모두 휴지통으로 옮길까요?`)) void clearClips();
              }}
              className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-500 text-2xs font-bold hover:bg-slate-200 cursor-pointer"
            >
              모두 지우기
            </button>
          )}
        </div>
        {!granted && (
          <p className="text-2xs text-amber-600 mt-1.5">
            다른 프로그램에서 복사한 것과 캡처 그림은 '가져오기'를 눌러 한 번 허락하면 자동으로 모입니다.
          </p>
        )}
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-10 text-center text-xs text-slate-400">
          아직 복사한 것이 없습니다.
          <br />
          글자를 Ctrl+C 하거나 '가져오기'를 눌러 보세요.
        </p>
      ) : (
        <ul className="p-3 space-y-2">
          {items.map((it) => (
            <ClipRow key={it.id} item={it} />
          ))}
        </ul>
      )}
    </aside>
  );

  if (docked) {
    return (
      <>
        <div
          className="fixed top-0 left-0 bottom-0 z-[45] border-r border-slate-200 shadow-xl"
          style={{ width: LEFT_COLUMN_CSS_WIDTH }}
        >
          {panel}
        </div>
        {toggle}
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-[1000] flex">
      <div className="relative w-full max-w-sm h-full shadow-2xl">{panel}</div>
      <div className="flex-1 bg-slate-900/40 backdrop-blur-xs" onClick={() => setOpen(false)} />
    </div>
  );
}
