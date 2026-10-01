// src/components/CommandPaletteModal.tsx
//
// 명령 창 (기본 Ctrl+K, ROADMAP 6-2). 글을 적으면 아래에 할 수 있는 일이 줄줄이 나온다.
//   - 날짜로 읽히면('다음 주 목', '10/15') 그 날짜로 가는 줄이 맨 위
//   - 기능 이름·찾을 말에 맞는 기능('출석' → 출석부)
//   - 맨 아래는 늘 '통합 검색'
// ↑↓로 고르고 Enter. 무엇으로 알아듣는지는 lib/commandPalette, 기능이 하는 일은 Layout의 runShortcut이 맡는다.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import PopupFrame from './PopupFrame';
import { useAppStore } from '../store/useAppStore';
import { buildPaletteItems, relativeDayText, type PaletteItem, type PaletteScope } from '../lib/commandPalette';
import { formatDateStr, formatDisplayDate, parseDateStr } from '../lib/dateUtils';
import type { ShortcutId } from '../lib/shortcuts';

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 기능 하나를 한다 (단축키를 누른 것과 같다) */
  onCommand: (id: ShortcutId) => void;
  /** 통합 검색을 이 글로 연다 */
  onSearch: (text: string) => void;
  /** 그 기능에 걸린 단축키 글 (없으면 빈 글) */
  keyHint: (id: ShortcutId) => string;
}

const SCOPE_NAME: Record<PaletteScope, string> = {
  day: '하루',
  week: '주간',
  month: '월간',
  year: '년간',
  memo: '메모',
};

export default function CommandPaletteModal({ isOpen, onClose, onCommand, onSearch, keyHint }: CommandPaletteModalProps) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const scope = useAppStore((s) => s.scope);
  const todayStr = formatDateStr(new Date());

  const items = useMemo(() => buildPaletteItems(text, todayStr, scope), [text, todayStr, scope]);

  // 글을 바꾸면 맨 위 줄부터
  useEffect(() => setActive(0), [text]);

  // 고른 줄이 늘 보이게
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    if (item.kind === 'date') {
      const s = useAppStore.getState();
      s.setCurrentDate(parseDateStr(item.dateStr));
      s.setScope(item.scope);
    } else if (item.kind === 'command') {
      onCommand(item.command.id);
    } else {
      onSearch(item.text);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 한글을 조합하는 중의 Enter·화살표는 조합을 끝내는 키다. 끝난 뒤 한 번 더 온다.
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(items[active]);
    }
  };

  const describe = (item: PaletteItem) => {
    if (item.kind === 'date') {
      const d = formatDisplayDate(item.dateStr);
      return {
        icon: '📆',
        title: `${d.fullString} · ${relativeDayText(item.dateStr, todayStr)}`,
        side: item.scope === scope ? `${SCOPE_NAME[item.scope]} 화면에서` : `${SCOPE_NAME[item.scope]} 화면으로`,
      };
    }
    if (item.kind === 'command') {
      return { icon: item.command.icon, title: item.command.title, side: keyHint(item.command.id) };
    }
    return { icon: '🔍', title: `"${item.text}" 통합 검색`, side: '검색' };
  };

  return (
    <PopupFrame isOpen={isOpen} onClose={onClose} width="lg">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/60 shrink-0">
        <span className="text-base shrink-0" aria-hidden>
          ⚡
        </span>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="기능·날짜·검색어 (예: 출석, 다음 주 목, 10/15)"
          aria-label="명령 창"
          role="combobox"
          aria-expanded
          aria-controls="command-palette-list"
          className="flex-1 min-w-0 bg-transparent text-sm font-bold text-slate-800 focus:outline-none placeholder-slate-400"
          autoFocus
        />
        <button
          type="button"
          onClick={onClose}
          title="닫기"
          className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 font-bold transition-colors cursor-pointer shrink-0"
        >
          ✕
        </button>
      </div>

      <ul
        ref={listRef}
        id="command-palette-list"
        role="listbox"
        aria-label="명령 창 목록"
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-1.5"
        data-scroll-lock
      >
        {items.map((item, i) => {
          const { icon, title, side } = describe(item);
          const on = i === active;
          return (
            <li
              key={`${item.kind}-${item.kind === 'command' ? item.command.id : item.kind === 'date' ? item.scope : 'q'}`}
              role="option"
              aria-selected={on}
              data-palette-kind={item.kind}
              onMouseMove={() => !on && setActive(i)}
              onClick={() => run(item)}
              className={`mx-1.5 px-3 py-2 rounded-xl flex items-center gap-2.5 cursor-pointer text-sm ${
                on ? 'bg-primary/10 text-primary' : 'text-slate-700'
              } ${item.kind === 'search' ? 'border-t border-dashed border-slate-100 mt-1' : ''}`}
            >
              <span className="w-5 text-center shrink-0" aria-hidden>
                {icon}
              </span>
              <span className="flex-1 min-w-0 truncate font-bold">{title}</span>
              {side && (
                <kbd className="shrink-0 text-2xs font-mono font-bold text-slate-400 whitespace-nowrap">{side}</kbd>
              )}
            </li>
          );
        })}
      </ul>

      <div className="px-4 py-2 border-t border-slate-100 text-2xs font-bold text-slate-400 shrink-0">
        ↑↓ 고르기 · Enter 하기 · ESC 닫기
      </div>
    </PopupFrame>
  );
}
