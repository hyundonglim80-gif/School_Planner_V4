// src/components/WeeklyGuideModal.tsx
//
// 주간학습안내 (ROADMAP 12-2). 한 주(월~금)의 요일 × 교시 표 + 준비물·알림장 → 인쇄(A4 세로)·표 복사.
// 셈은 lib/weeklyGuide, 읽기는 lib/weeklyGuideStore(지금 보는 공간의 수업·알림장 - 읽기만), 인쇄는 lib/print.
//
// 제목·넣을 것(수업 메모·준비물·알림장)·주마다 알리는 말은 이 기기에만 남긴다(학교·반마다 쓰는 말이 다르다).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ModalShell, { ModalCloseButton } from './ModalShell';
import { auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { useTimetableTemplate } from '../hooks/useTimetableTemplate';
import { formatDateStr } from '../lib/dateUtils';
import { printNode } from '../lib/print';
import {
  guideHtml,
  guideTable,
  guideTsv,
  nextWeekMonday,
  schoolWeekOf,
  shiftWeek,
  weekRangeText,
  type GuideDay,
  type GuideOptions,
} from '../lib/weeklyGuide';
import { loadGuideWeek } from '../lib/weeklyGuideStore';
import { showErrorToast, showToast } from '../utils/toast';

interface WeeklyGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 처음 보일 주의 아무 날 (없으면 다음 주) */
  startDate?: string | null;
}

const OPTS_KEY = 'sp4-weekly-guide-opts';
const TITLE_KEY = 'sp4-weekly-guide-title';
const NOTES_KEY = 'sp4-weekly-guide-notes';
const DEFAULT_OPTS: GuideOptions = { memo: true, supplies: true, notices: true };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 이 기기에서 기억하지 못할 뿐 */
  }
}

export default function WeeklyGuideModal({ isOpen, onClose, startDate }: WeeklyGuideModalProps) {
  const { selectedGroupId } = useAppStore();
  const { templates, currentTemplateName } = useTimetableTemplate();
  const periodNames = templates[currentTemplateName]?.names || [];
  const today = formatDateStr(new Date());

  const [monday, setMonday] = useState(() => schoolWeekOf(startDate || nextWeekMonday(today))[0]);
  const dates = useMemo(() => schoolWeekOf(monday), [monday]);
  const [days, setDays] = useState<GuideDay[] | null>(null);
  const [opts, setOpts] = useState<GuideOptions>(() => readJson(OPTS_KEY, DEFAULT_OPTS));
  const [title, setTitle] = useState(() => {
    try {
      return localStorage.getItem(TITLE_KEY) || '주간학습안내';
    } catch {
      return '주간학습안내';
    }
  });
  const [note, setNote] = useState(() => readJson<Record<string, string>>(NOTES_KEY, {})[monday] || '');
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!isOpen || !uid) return;
    let alive = true;
    setDays(null);
    loadGuideWeek(uid, selectedGroupId || null, dates)
      .then((list) => alive && setDays(list))
      .catch((e) => {
        if (!alive) return;
        setDays(dates.map((date) => ({ date, periods: {}, notices: [] })));
        showErrorToast('그 주의 수업·알림장을 읽지 못했습니다. 네트워크를 확인해 주세요.', e);
      });
    return () => {
      alive = false;
    };
  }, [isOpen, dates, selectedGroupId]);

  const goWeek = (nextMonday: string) => {
    setMonday(nextMonday);
    setNote(readJson<Record<string, string>>(NOTES_KEY, {})[nextMonday] || '');
  };

  const saveNote = (text: string) => {
    setNote(text);
    const notes = readJson<Record<string, string>>(NOTES_KEY, {});
    if (text.trim()) notes[monday] = text;
    else delete notes[monday];
    writeJson(NOTES_KEY, notes);
  };

  const setOpt = (key: keyof GuideOptions, on: boolean) => {
    const next = { ...opts, [key]: on };
    setOpts(next);
    writeJson(OPTS_KEY, next);
  };

  const fullTitle = `${title.trim() || '주간학습안내'} (${weekRangeText(dates)})`;
  const table = useMemo(() => (days ? guideTable(days, periodNames, opts) : null), [days, periodNames, opts]);
  const emptyWeek = !!days && days.every((d) => Object.keys(d.periods).length === 0 && d.notices.length === 0);

  const print = () => {
    if (!previewRef.current || !table) return;
    printNode(previewRef.current, { landscape: false, marginMm: 10 });
  };

  const copy = async () => {
    if (!table) return;
    const html = guideHtml(fullTitle, note, table);
    const tsv = guideTsv(table);
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([tsv], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(tsv);
      }
      showToast('📋 표를 복사했습니다. 한글·워드·엑셀·구글 시트에 붙여 넣으세요.');
    } catch (e) {
      showErrorToast('복사하지 못했습니다.', e);
    }
  };

  const btn = 'px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 font-bold';
  const thisMonday = schoolWeekOf(today)[0];

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} width="2xl" title="📰 주간학습안내" footer={<ModalCloseButton onClose={onClose} />}>
      <div className="flex flex-col gap-3 text-xs text-slate-700">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => goWeek(shiftWeek(monday, -1))} className={btn} title="앞 주">
            ◀
          </button>
          <span className="px-2 font-black text-sm text-slate-800" data-guide-range>
            {weekRangeText(dates)}
          </span>
          <button type="button" onClick={() => goWeek(shiftWeek(monday, 1))} className={btn} title="다음 주">
            ▶
          </button>
          <button type="button" onClick={() => goWeek(thisMonday)} aria-pressed={monday === thisMonday} className={btn}>
            이번 주
          </button>
          <button type="button" onClick={() => goWeek(shiftWeek(thisMonday, 1))} aria-pressed={monday === shiftWeek(thisMonday, 1)} className={btn}>
            다음 주
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={() => void copy()} disabled={!table} className={`${btn} disabled:opacity-40`}>
              📋 표 복사
            </button>
            <button type="button" onClick={print} disabled={!table} className={`${btn} disabled:opacity-40`}>
              🖨️ 인쇄
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label className="flex items-center gap-1.5">
            <span className="font-bold text-slate-500">제목</span>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                try {
                  localStorage.setItem(TITLE_KEY, e.target.value);
                } catch {
                  /* 무시 */
                }
              }}
              aria-label="제목"
              placeholder="주간학습안내"
              className="w-48 px-2 py-1 border border-slate-200 rounded-lg font-bold"
            />
          </label>
          {(
            [
              ['memo', '수업 메모'],
              ['supplies', '준비물'],
              ['notices', '알림장'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={opts[key]} onChange={(e) => setOpt(key, e.target.checked)} />
              {label}
            </label>
          ))}
        </div>
        <textarea
          value={note}
          onChange={(e) => saveNote(e.target.value)}
          aria-label="알리는 말"
          placeholder="이번 주 알리는 말 (예: 10월 7일은 현장체험학습입니다. 도시락을 챙겨 주세요.) - 이 주에만, 이 기기에 남습니다"
          rows={2}
          className="w-full px-2.5 py-2 border border-slate-200 rounded-xl"
        />

        {/* 인쇄·미리 보기 - 이 칸이 그대로 찍힌다 */}
        <div ref={previewRef} className="border border-slate-200 rounded-xl p-3 bg-white" data-weekly-guide>
          <h2 className="text-base font-black text-slate-900 mb-1">{fullTitle}</h2>
          {note.trim() && <p className="whitespace-pre-wrap text-slate-700 mb-2" data-guide-note>{note.trim()}</p>}
          {!table ? (
            <p className="text-center text-slate-400 py-8" data-print-hide>
              불러오는 중…
            </p>
          ) : (
            <table className="w-full table-fixed border-collapse text-xs" data-guide-table>
              <thead>
                <tr>
                  {table.head.map((h, i) => (
                    <th key={i} className={`border border-slate-400 bg-slate-100 px-1.5 py-1 ${i === 0 ? 'w-14' : ''}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => (
                  <tr key={r} data-guide-row={row[0]}>
                    {row.map((cell, c) => {
                      if (c === 0) {
                        return (
                          <th key={c} className="border border-slate-400 bg-slate-50 px-1 py-1 font-bold text-slate-600">
                            {cell}
                          </th>
                        );
                      }
                      const [first, ...rest] = cell.split('\n');
                      const isPeriod = r < table.rows.length - (opts.supplies ? 1 : 0) - (opts.notices ? 1 : 0);
                      return (
                        <td key={c} className="border border-slate-400 px-1.5 py-1 align-top" data-guide-cell={`${row[0]}:${c}`}>
                          {isPeriod ? (
                            <>
                              <span className="font-black text-slate-900">{first}</span>
                              {rest.length > 0 && <span className="block text-2xs text-slate-500 whitespace-pre-line">{rest.join('\n')}</span>}
                            </>
                          ) : (
                            <span className="whitespace-pre-line">{cell}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {emptyWeek && (
          <p className="text-2xs text-amber-700 font-bold">이 주에 적힌 수업·알림장이 없습니다. 시간표 적용으로 수업을 채우거나 다른 주를 고릅니다.</p>
        )}
        <p className="text-2xs text-slate-400">
          지금 보는 공간의 수업 칸(과목·수업 메모·준비물)과 알림장을 읽기만 합니다. 고치려면 그날 하루 화면에서 고친 뒤 다시 엽니다.
          인쇄 창에서 'PDF로 저장'을 고르면 PDF가 됩니다.
        </p>
      </div>
    </ModalShell>
  );
}
