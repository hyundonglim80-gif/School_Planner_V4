// src/components/EntryTableView.tsx
//
// 메모·기록에 붙인 표를 그린다 (lib/entryTable).
//   - 쓰는 칸(EntryDrawer)에서는 칸을 눌러 글자를 고치고, 줄·열을 더하고 뺀다.
//     Enter = 고치고 아래 칸, Tab / Shift+Tab = 옆 칸, Alt+Enter = 칸 안 줄 바꿈, ESC = 고치기 취소.
//   - 카드(메모·기록 목록)에서는 작게 보기만 한다.
// 테두리가 없는 칸은 엑셀의 눈금선처럼 옅은 선을 긋는다 (엑셀은 눈금선을 복사하지 않는다).
import React, { useEffect, useRef, useState } from 'react';
import {
  cellCss,
  deleteCol,
  deleteRow,
  insertCol,
  insertRow,
  setCellText,
  tableSize,
  type EntryTable,
} from '../lib/entryTable';

const GRID_LINE = '1px solid #e2e8f0';

interface Props {
  table: EntryTable;
  /** 주면 고칠 수 있다 */
  onChange?: (next: EntryTable) => void;
  onRemove?: () => void;
  /** 카드에 넣는 작은 보기 */
  compact?: boolean;
  /**
   * compact에서 높이를 자르지 않고 표 전체를 펼친다 (세로 스크롤은 바깥 칸 하나만).
   * 링크 배너처럼 칸 전체가 스크롤되는 곳에서 쓴다. 넓은 표는 가로로만 스크롤한다.
   */
  fullHeight?: boolean;
  /** 제목 줄에 보일 이름 (예: '표 1') */
  title?: string;
}

export default function EntryTableView({ table, onChange, onRemove, compact, fullHeight, title }: Props) {
  const editable = !!onChange && !compact;
  const { rows: nRows, cols: nCols } = tableSize(table);
  /** 고른 칸 (줄·열 더하기/빼기의 기준) */
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  /** 글자를 고치는 칸 */
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEdit = (r: number, c: number) => {
    setSel({ r, c });
    setEditing({ r, c });
    setDraft(table.rows[r].cells[c].v);
  };

  /** 다음으로 옮길 칸 (가려진 칸은 건너뛴다) */
  const nextCell = (r: number, c: number, dr: number, dc: number) => {
    let nr = r;
    let nc = c;
    for (let i = 0; i < nRows * nCols; i++) {
      nc += dc;
      nr += dr;
      if (nc >= nCols) {
        nc = 0;
        nr++;
      } else if (nc < 0) {
        nc = nCols - 1;
        nr--;
      }
      if (nr < 0 || nr >= nRows) return null;
      if (!table.rows[nr].cells[nc]?.x) return { r: nr, c: nc };
    }
    return null;
  };

  const commit = (move?: { dr: number; dc: number }) => {
    if (!editing || !onChange) return;
    const { r, c } = editing;
    let next = table;
    if (draft !== table.rows[r].cells[c].v) next = setCellText(table, r, c, draft);
    if (next !== table) onChange(next);
    const target = move ? nextCell(r, c, move.dr, move.dc) : null;
    if (target) {
      setSel(target);
      setEditing(target);
      setDraft(next.rows[target.r].cells[target.c].v);
    } else {
      setEditing(null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      // 칸 고치기만 멈춘다. 쓰는 칸 전체가 닫히면(전역 ESC) 적던 것이 사라진다.
      e.stopPropagation();
      e.preventDefault();
      setEditing(null);
      return;
    }
    if (e.key === 'Enter' && !e.altKey && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      commit({ dr: 1, dc: 0 });
      return;
    }
    if (e.key === 'Enter' && e.altKey) {
      // 엑셀처럼 Alt+Enter는 칸 안 줄 바꿈
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: a, selectionEnd: b } = el;
      setDraft((d) => d.slice(0, a) + '\n' + d.slice(b));
      requestAnimationFrame(() => el.setSelectionRange(a + 1, a + 1));
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      commit({ dr: 0, dc: e.shiftKey ? -1 : 1 });
    }
  };

  const change = (fn: (t: EntryTable, at: number) => EntryTable, at: number) => {
    if (!onChange) return;
    // 고치던 칸이 있으면 그 글을 먼저 넣고 줄·열을 바꾼다 (고친 글이 사라지지 않게)
    const base =
      editing && draft !== table.rows[editing.r].cells[editing.c].v ? setCellText(table, editing.r, editing.c, draft) : table;
    setEditing(null);
    onChange(fn(base, at));
    setSel(null);
  };

  const hasWidths = !!table.cols?.some((w) => w > 0);

  const grid = (
    <table
      className="border-collapse"
      style={{ fontSize: '10pt', lineHeight: 1.35, color: '#1e293b', backgroundColor: '#ffffff' }}
    >
      {hasWidths && (
        <colgroup>
          {table.cols!.map((w, i) => (
            <col key={i} style={w > 0 ? { width: w, minWidth: w } : undefined} />
          ))}
        </colgroup>
      )}
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r} style={row.h ? { height: row.h } : undefined}>
            {row.cells.map((cell, c) => {
              if (cell.x) return null;
              const style = table.styles?.[cell.s ?? -1];
              const isEditing = editing?.r === r && editing?.c === c;
              const isSel = editable && sel?.r === r && sel?.c === c;
              const css: React.CSSProperties = {
                border: GRID_LINE,
                padding: '2px 6px',
                verticalAlign: 'bottom',
                whiteSpace: style?.wrap ? 'pre-wrap' : 'pre',
                ...(cellCss(style) as React.CSSProperties),
                ...(isSel ? { outline: '2px solid #2563eb', outlineOffset: -2 } : {}),
                ...(editable ? { cursor: 'text' } : {}),
                position: isEditing ? 'relative' : undefined,
              };
              return (
                <td
                  key={c}
                  colSpan={cell.cs}
                  rowSpan={cell.rs}
                  style={css}
                  data-cell={`${r}-${c}`}
                  onClick={editable ? () => !isEditing && startEdit(r, c) : undefined}
                >
                  {isEditing ? (
                    <textarea
                      ref={inputRef}
                      value={draft}
                      aria-label={`${r + 1}줄 ${c + 1}열 칸`}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onKeyDown}
                      onBlur={() => commit()}
                      rows={Math.max(1, draft.split('\n').length)}
                      className="block w-full min-w-16 resize-none bg-blue-50/60 outline-none p-0 m-0"
                      style={{ font: 'inherit', color: 'inherit', textAlign: 'inherit' }}
                    />
                  ) : (
                    cell.v
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (compact) {
    // 카드에서는 작게 보기만. 넘치는 것은 칸 안에서만 스크롤.
    return (
      <div
        className={`${fullHeight ? 'overflow-x-auto overflow-y-hidden' : 'max-h-48 overflow-auto overscroll-contain'} rounded-md border border-slate-200 bg-white`}
        style={{ zoom: 0.8 }}
        data-entry-table
      >
        {grid}
      </div>
    );
  }

  const btn =
    'px-2 py-1 rounded-md text-2xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white cursor-pointer disabled:cursor-default';

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden" data-entry-table>
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-slate-200">
        <span className="text-xs font-bold text-slate-600">
          ▦ {title || '표'} <span className="font-normal text-slate-400">· {nRows}줄 × {nCols}열</span>
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0"
            title="표 삭제"
            aria-label={`${title || '표'} 삭제`}
          >
            ✕
          </button>
        )}
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-1 px-2.5 py-1.5 border-b border-slate-200 bg-white/60">
          <span className="text-2xs text-slate-400 mr-1">{sel ? `${sel.r + 1}줄 ${sel.c + 1}열` : '칸을 누르면 고칩니다'}</span>
          <button type="button" onMouseDown={(e) => e.preventDefault()} className={btn} disabled={!sel} onClick={() => sel && change(insertRow, sel.r)} title="고른 칸 위에 줄 넣기">
            ↑ 줄
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} className={btn} disabled={!sel} onClick={() => sel && change(insertRow, sel.r + 1)} title="고른 칸 아래에 줄 넣기">
            ↓ 줄
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} className={btn} disabled={!sel || nRows <= 1} onClick={() => sel && change(deleteRow, sel.r)} title="고른 칸의 줄 빼기">
            줄 빼기
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} className={btn} disabled={!sel} onClick={() => sel && change(insertCol, sel.c)} title="고른 칸 왼쪽에 열 넣기">
            ← 열
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} className={btn} disabled={!sel} onClick={() => sel && change(insertCol, sel.c + 1)} title="고른 칸 오른쪽에 열 넣기">
            → 열
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} className={btn} disabled={!sel || nCols <= 1} onClick={() => sel && change(deleteCol, sel.c)} title="고른 칸의 열 빼기">
            열 빼기
          </button>
        </div>
      )}
      <div className="overflow-auto max-h-[60vh] overscroll-contain p-2">{grid}</div>
    </div>
  );
}
