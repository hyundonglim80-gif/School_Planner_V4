// src/components/NoticeModal.tsx
//
// 알림장. '쓰기' 탭에서 그날 알림장을 적고, '모아 보기' 탭에서 날짜별로 훑는다.
// 저장하면 그날 기록 칸에도 '알림장' 라벨 항목이 생긴다 (lib/notices → lib/autoJournal).
import React, { useCallback, useEffect, useState } from 'react';
import ModalShell from './ModalShell';
import AutoTextarea from './AutoTextarea';
import { closeAllModals } from '../hooks/useModalLayer';
import { useAppStore } from '../store/useAppStore';
import { useTimetableTemplate } from '../hooks/useTimetableTemplate';
import { loadHolidayYears } from '../hooks/useGovHolidays';
import { isVacationDay } from '../lib/semester';
import { addDays, formatDateStr, parseDateStr, getAcademicYear } from '../lib/dateUtils';
import {
  listNotices,
  loadDraftLines,
  loadNotice,
  nextClassDay,
  numberedNotice,
  saveNotice,
  shortDateLabel,
  splitNoticeLines,
  type NoticeDoc,
} from '../lib/notices';
import { showToast, showErrorToast } from '../utils/toast';

type Tab = 'write' | 'list';
type ListRange = 'month' | '30days' | 'year';

interface NoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 처음 열 날짜 */
  dateStr: string;
  initialTab?: Tab;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('📋 복사했습니다. 붙여 넣을 곳에서 Ctrl+V');
  } catch {
    showErrorToast('복사하지 못했습니다. 글을 직접 골라 복사해 주세요.');
  }
}

export default function NoticeModal({ isOpen, onClose, dateStr: initialDate, initialTab = 'write' }: NoticeModalProps) {
  const selectedGroupId = useAppStore((s) => s.selectedGroupId);
  const { semesterConfig } = useTimetableTemplate();

  const [tab, setTab] = useState<Tab>(initialTab);
  const [date, setDate] = useState(initialDate);
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  /** 불러왔을 때(또는 마지막으로 저장했을 때)의 글. 바뀌었는지 가른다. */
  const [savedText, setSavedText] = useState('');

  const dirty = loaded && splitNoticeLines(text).join('\n') !== splitNoticeLines(savedText).join('\n');

  // 날짜가 바뀌면 그날 알림장을 읽는다
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    setLoaded(false);
    loadNotice(selectedGroupId, date)
      .then((n) => {
        if (!alive) return;
        const t = n ? n.lines.join('\n') : '';
        setText(t);
        setSavedText(t);
        setLoaded(true);
      })
      .catch((err) => {
        if (!alive) return;
        showErrorToast('알림장을 불러오지 못했습니다.', err);
      });
    return () => {
      alive = false;
    };
  }, [isOpen, date, selectedGroupId]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!loaded || saving) return false;
    setSaving(true);
    try {
      const lines = splitNoticeLines(text);
      await saveNotice(selectedGroupId, date, lines);
      setSavedText(lines.join('\n'));
      setText(lines.join('\n'));
      showToast(lines.length ? '✅ 알림장을 저장했습니다. 그날 기록에도 남겼습니다.' : '🗑️ 알림장을 비웠습니다.');
      return true;
    } catch (err) {
      showErrorToast('알림장을 저장하지 못했습니다.', err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [loaded, saving, text, selectedGroupId, date]);

  // 다른 날짜로 가기 전에 적던 것을 저장한다
  const moveDate = async (next: string) => {
    if (dirty && !(await handleSave())) return;
    setDate(next);
  };

  const handleDraft = async () => {
    setDrafting(true);
    try {
      const y = parseDateStr(date).getFullYear();
      const holidays = await loadHolidayYears([y, y + 1]).catch(() => ({} as Record<string, string>));
      const target = nextClassDay(date, (d) => !!holidays[d] || isVacationDay(d, semesterConfig));
      if (!target) {
        showToast('2주 안에 수업일이 없습니다.');
        return;
      }
      const draft = await loadDraftLines(selectedGroupId, target);
      if (draft.length === 0) {
        showToast(`${shortDateLabel(target)}에 적힌 준비물·일정이 없습니다.`);
        return;
      }
      const current = splitNoticeLines(text);
      const fresh = draft.filter((l) => !current.includes(l));
      if (fresh.length === 0) {
        showToast('불러올 새 항목이 없습니다. 이미 모두 적혀 있습니다.');
        return;
      }
      setText([...current, ...fresh].join('\n'));
      showToast(`📥 ${shortDateLabel(target)}의 준비물·일정 ${fresh.length}줄을 불러왔습니다.`);
    } catch (err) {
      showErrorToast('불러오지 못했습니다.', err);
    } finally {
      setDrafting(false);
    }
  };

  // ── 모아 보기 ──
  const [range, setRange] = useState<ListRange>('month');
  const [list, setList] = useState<NoticeDoc[] | null>(null);

  useEffect(() => {
    if (!isOpen || tab !== 'list') return;
    let alive = true;
    const today = formatDateStr(new Date());
    const base = parseDateStr(date);
    let start = today;
    let end = today;
    if (range === 'month') {
      start = formatDateStr(new Date(base.getFullYear(), base.getMonth(), 1));
      end = formatDateStr(new Date(base.getFullYear(), base.getMonth() + 1, 0));
    } else if (range === '30days') {
      start = addDays(today, -30);
      end = today;
    } else {
      const ay = getAcademicYear(base);
      start = `${ay}-03-01`;
      end = `${ay + 1}-02-29`;
    }
    setList(null);
    listNotices(selectedGroupId, start, end)
      .then((l) => alive && setList(l))
      .catch((err) => {
        if (!alive) return;
        setList([]);
        showErrorToast('알림장 목록을 불러오지 못했습니다.', err);
      });
    return () => {
      alive = false;
    };
  }, [isOpen, tab, range, date, selectedGroupId]);

  // 배경을 누르면 적던 것을 저장하고 닫는다. 닫기·✕·ESC는 저장 없이 닫는다.
  const closeByBackdrop = async () => {
    if (dirty && !(await handleSave())) return;
    closeAllModals();
  };

  const lines = splitNoticeLines(text);

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="lg"
      title="📢 알림장"
      onBackdropClose={closeByBackdrop}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            닫기
          </button>
          {tab === 'write' && (
            <button
              type="button"
              onClick={() => handleSave()}
              disabled={!loaded || saving}
              title="Ctrl + S 로도 저장합니다"
              className="px-5 py-2 bg-primary hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4 text-xs text-slate-700">
        <div className="inline-flex bg-slate-100 p-1 rounded-xl gap-1">
          {([['write', '✏️ 쓰기'], ['list', '📚 모아 보기']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                tab === id ? 'bg-white text-primary shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'write' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => moveDate(addDays(date, -1))}
                  className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-black"
                  title="전날"
                >
                  ◀
                </button>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => e.target.value && moveDate(e.target.value)}
                  aria-label="알림장 날짜"
                  className="px-2 py-1 border border-slate-200 rounded-lg font-bold"
                />
                <span className="font-bold text-slate-500">{shortDateLabel(date)}</span>
                <button
                  type="button"
                  onClick={() => moveDate(addDays(date, 1))}
                  className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-black"
                  title="다음 날"
                >
                  ▶
                </button>
              </div>
              <button
                type="button"
                onClick={handleDraft}
                disabled={drafting || !loaded}
                title="다음 수업일의 준비물과 일정을 줄로 더합니다 (주말·공휴일·방학은 건너뜁니다)"
                className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl font-bold disabled:opacity-50"
              >
                {drafting ? '불러오는 중...' : '📥 다음 수업일 불러오기'}
              </button>
            </div>

            <div>
              <label className="block font-bold text-slate-500 mb-1">한 줄에 한 항목 (번호는 저절로 붙습니다)</label>
              <AutoTextarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
                    e.preventDefault();
                    if (!e.repeat) handleSave();
                  }
                }}
                disabled={!loaded}
                placeholder={loaded ? '예:\n국어 준비물: 색연필\n현장체험학습 동의서 제출' : '불러오는 중...'}
                aria-label="알림장 내용"
                className="w-full min-h-[120px] p-3 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary leading-relaxed"
                autoFocus
              />
            </div>

            {lines.length > 0 && (
              <div className="p-3 bg-yellow-50/70 border border-yellow-200 rounded-xl">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-yellow-900">미리 보기</span>
                  <button
                    type="button"
                    onClick={() => copyText(`[${shortDateLabel(date)} 알림장]\n${numberedNotice(lines)}`)}
                    className="px-2 py-0.5 bg-white border border-yellow-300 rounded-lg font-bold text-yellow-900 hover:bg-yellow-100"
                  >
                    📋 복사
                  </button>
                </div>
                <ol className="space-y-0.5 text-sm text-slate-800">
                  {lines.map((l, i) => (
                    <li key={i}>
                      {i + 1}. {l}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <p className="text-slate-400">저장하면 그날 기록 칸에도 '알림장' 항목으로 남습니다. 다 지우고 저장하면 그 항목도 빠집니다.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-500">기간</span>
              <select
                value={range}
                onChange={(e) => setRange(e.target.value as ListRange)}
                aria-label="알림장 모아 보기 기간"
                className="px-2 py-1 border border-slate-200 rounded-lg font-bold"
              >
                <option value="month">{parseDateStr(date).getMonth() + 1}월</option>
                <option value="30days">지난 한 달</option>
                <option value="year">학년도 전체</option>
              </select>
              {list && <span className="text-slate-400">{list.length}일</span>}
            </div>
            {list === null ? (
              <p className="text-center text-slate-400 py-6">불러오는 중...</p>
            ) : list.length === 0 ? (
              <p className="text-center text-slate-400 py-6">이 기간에 적은 알림장이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {list.map((n) => (
                  <div key={n.date} className="p-3 bg-white border border-slate-200 rounded-xl">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <button
                        type="button"
                        onClick={() => {
                          setDate(n.date);
                          setTab('write');
                        }}
                        className="font-black text-slate-800 hover:text-primary"
                        title="이 날 알림장 고치기"
                      >
                        {shortDateLabel(n.date)} <span className="font-normal text-slate-400">{n.date.slice(0, 4)}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => copyText(`[${shortDateLabel(n.date)} 알림장]\n${numberedNotice(n.lines)}`)}
                        className="px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-600 hover:bg-slate-100"
                      >
                        📋 복사
                      </button>
                    </div>
                    <ol className="space-y-0.5 text-sm text-slate-700">
                      {n.lines.map((l, i) => (
                        <li key={i}>
                          {i + 1}. {l}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
