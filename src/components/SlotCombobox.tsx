// src/components/SlotCombobox.tsx
//
// 교과 모드의 수업 칸 입력 + ▼ 목록 (19번 U1). 예전 datalist(SlotOptionsList)는 크롬이 칸에 적힌 글자와 맞는 것만 보여 줘서
// '5-1 과학'이 적힌 칸에서 ▼를 눌러도 다른 반이 나오지 않았다. 이 칸은 ▼·칸에 들어갈 때 **전체** 목록, 글자를 칠 때만 거른다
// (초성도 - lib/hangul matchesName). ↑↓·Enter로 고르고 ESC는 목록만 닫는다(칸·오른쪽 줄은 그대로).
//
// 목록은 body에 붙인다(fixed) - 시간표 표처럼 overflow가 있는 칸 안에서도 잘리지 않게. 그래서 바깥 클릭 판정(useClickOutside)이
// 목록을 바깥으로 세지 않도록 `data-combobox-list`를 단다.
// 초등 담임 칸은 이것을 쓰지 않는다 (화면 쪽에서 isClassUnit일 때만).
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { matchesName } from '../lib/hangul';

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'list'>;

interface Props extends InputProps {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  /** 칸에 들어가면 바로 목록을 연다 (기본 켬). 화살표로 칸을 옮겨 다니는 표는 끈다 - ▼·Alt+↓·글자 치기로 연다 */
  openOnFocus?: boolean;
  /** 감싼 칸의 class (폭·격자 자리) */
  wrapperClassName?: string;
}

const LIST_MAX = 240;

export default function SlotCombobox({
  value,
  onValueChange,
  options,
  openOnFocus = true,
  wrapperClassName = '',
  className = '',
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  /** null = 전체 목록 (▼·칸에 들어갈 때), 글자 = 친 글자로 거른다 */
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  const shown = useMemo(() => (query ? options.filter((o) => matchesName(o, query)) : options), [options, query]);

  const openAll = useCallback(() => {
    setQuery(null);
    setActive(-1);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setActive(-1);
  }, []);

  const place = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 120 && above > below;
    const maxHeight = Math.max(80, Math.min(LIST_MAX, up ? above : below));
    const width = Math.max(r.width, 140);
    const left = Math.min(r.left, window.innerWidth - width - 4);
    setPos({ top: up ? r.top - 4 - Math.min(maxHeight, shownHeightGuess(shown.length)) : r.bottom + 4, left: Math.max(4, left), width, maxHeight });
  }, [shown.length]);
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    // 목록 자체의 스크롤은 빼고, 화면이 움직이면 자리를 다시 잡는다
    const onScroll = (e: Event) => {
      if (listRef.current && e.target instanceof Node && listRef.current.contains(e.target)) return;
      place();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  // 고른 줄이 보이게
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-combobox-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const choose = (o: string) => {
    onValueChange(o);
    close();
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return onKeyDown?.(e);
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        if (!shown.length) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => (i < 0 ? (step > 0 ? 0 : shown.length - 1) : (i + step + shown.length) % shown.length));
        return;
      }
      if (e.key === 'Enter' && active >= 0 && shown[active]) {
        e.preventDefault();
        e.stopPropagation();
        choose(shown[active]);
        return;
      }
      if (e.key === 'Escape') {
        // 목록만 닫는다 - 칸의 취소·오른쪽 줄 닫기(ESC)까지 가지 않게
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === 'Tab') close();
    } else if (e.key === 'ArrowDown' && (e.altKey || openOnFocus)) {
      e.preventDefault();
      e.stopPropagation();
      openAll();
      return;
    }
    onKeyDown?.(e);
  };

  return (
    <div className={`group relative ${wrapperClassName}`}>
      <input
        {...rest}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          setQuery(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={(e) => {
          if (openOnFocus) openAll();
          onFocus?.(e);
        }}
        onBlur={(e) => {
          close();
          onBlur?.(e);
        }}
        onKeyDown={handleKeyDown}
        className={`${className} pr-5`}
      />
      <button
        type="button"
        tabIndex={-1}
        data-combobox-toggle
        aria-label="반·과목 목록"
        title="반·과목 목록"
        // 칸의 커서를 빼앗지 않는다 (blur로 목록이 닫혔다가 다시 열리지 않게)
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          inputRef.current?.focus();
          if (open && query === null) close();
          else openAll();
        }}
        // 표(openOnFocus 끔)는 칸이 많아 ▼를 칸에 마우스를 올리거나 들어갔을 때만 보인다
        className={`absolute right-0.5 top-1/2 -translate-y-1/2 w-4 h-5 flex items-center justify-center text-2xs text-slate-400 hover:text-primary ${
          openOnFocus ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
        }`}
      >
        ▼
      </button>
      {open &&
        pos &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            data-combobox-list
            onMouseDown={(e) => e.preventDefault()}
            style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, maxHeight: pos.maxHeight, zIndex: 100000 }}
            className="overflow-y-auto overscroll-contain bg-white border border-slate-200 rounded-lg shadow-xl py-1 text-xs"
          >
            {shown.length === 0 ? (
              <li className="px-2.5 py-1.5 text-slate-400">{options.length ? '맞는 반·과목이 없습니다' : '환경설정에서 가르치는 반·과목을 적으세요'}</li>
            ) : (
              shown.map((o, i) => (
                <li
                  key={o}
                  role="option"
                  aria-selected={i === active}
                  data-combobox-index={i}
                  data-combobox-option={o}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={`px-2.5 py-1.5 font-bold whitespace-nowrap cursor-pointer ${
                    i === active ? 'bg-primary/10 text-primary' : o === value ? 'text-primary' : 'text-slate-700'
                  }`}
                >
                  {o}
                </li>
              ))
            )}
          </ul>,
          document.body
        )}
    </div>
  );
}

/** 위로 펼칠 때 목록 높이 짐작 (한 줄 약 28px + 위아래 8px) */
function shownHeightGuess(n: number): number {
  return Math.max(1, n) * 28 + 8;
}
