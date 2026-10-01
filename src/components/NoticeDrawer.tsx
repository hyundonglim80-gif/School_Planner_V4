// src/components/NoticeDrawer.tsx
//
// 알림장. 메모·기록·일정처럼 오른쪽 칸에서 쓴다 (예전에는 화면을 덮는 팝업이었다).
// 칸은 화면 옆에 붙어 있어서, 왼쪽의 수업·일정을 보면서 적을 수 있다.
//
// '쓰기' 탭에서 그날 알림장을 적고, '모아 보기' 탭에서 날짜별로 훑는다.
// 저장하면 그날 기록 칸에도 '알림장' 항목이 생긴다 (lib/notices → lib/autoJournal).
// 거꾸로 기록에서 그 항목을 고치거나 지우면 알림장도 따라간다 (lib/autoJournalSync).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import AutoTextarea from './AutoTextarea';
import SidePanelFrame, { sidePanelClass } from './SidePanelFrame';
import { isTopSideItem } from './PopupFrame';
import { useTimetableTemplate } from '../hooks/useTimetableTemplate';
import { loadHolidayYears } from '../hooks/useGovHolidays';
import { isVacationDay } from '../lib/semester';
import { addDays, formatDateStr, parseDateStr, getAcademicYear } from '../lib/dateUtils';
import {
  listNotices,
  loadDraftLines,
  loadNotice,
  mealNoticeLines,
  nextClassDay,
  numberedNotice,
  saveNotice,
  shortDateLabel,
  splitNoticeLines,
  type NoticeDoc,
} from '../lib/notices';
import { SOURCE_CHANGED_EVENT, type SourceChangedDetail } from '../lib/autoJournalSync';
import { showToast, showErrorToast } from '../utils/toast';
import { useSchool } from '../hooks/useSchool';
import { loadMonthMeals } from '../lib/neis';
import { useProgressMarks } from '../hooks/useProgress';
import { suppliesByPeriod } from '../lib/progress';

type Tab = 'write' | 'list';
type ListRange = 'month' | '30days' | 'year';

interface NoticeDrawerProps {
  /** 처음 열 날짜 */
  dateStr: string;
  /** 어느 공간의 알림장인가 (null = 개인). 칸을 열 때의 공간을 붙든다. */
  groupId: string | null;
  /** 제목 아래에 적을 공간 이름 (예: '🔒 개인') */
  spaceName: string;
  initialTab?: Tab;
  docked: boolean;
  onClose: () => void;
  /** 다른 항목을 열기 전에 '고친 것 있으면 저장'을 부를 수 있게 넘겨준다 */
  flushRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  /** 저장 안 한 것이 있나. ESC로 칸을 모두 닫기 전에 묻는다. */
  unsavedRef?: React.MutableRefObject<(() => boolean) | null>;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('📋 복사했습니다. 붙여 넣을 곳에서 Ctrl+V');
  } catch {
    showErrorToast('복사하지 못했습니다. 글을 직접 골라 복사해 주세요.');
  }
}

export default function NoticeDrawer({
  dateStr: initialDate,
  groupId,
  spaceName,
  initialTab = 'write',
  docked,
  onClose,
  flushRef,
  unsavedRef,
}: NoticeDrawerProps) {
  const { semesterConfig } = useTimetableTemplate();
  const panelRef = useRef<HTMLElement>(null);

  const [tab, setTab] = useState<Tab>(initialTab);
  const [date, setDate] = useState(initialDate);
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  // 우리 학교를 골랐으면 '🍚 급식'으로 다음 수업일 급식을 한 줄 더한다 (나이스, ROADMAP 4-3)
  const { school } = useSchool();
  /** 불러왔을 때(또는 마지막으로 저장했을 때)의 글. 바뀌었는지 가른다. */
  const [savedText, setSavedText] = useState('');
  /** 다시 읽기 신호 (기록 쪽에서 이 알림장을 고쳤을 때) */
  const [reloadTick, setReloadTick] = useState(0);

  const dirty = loaded && splitNoticeLines(text).join('\n') !== splitNoticeLines(savedText).join('\n');

  // 날짜가 바뀌면 그날 알림장을 읽는다
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    loadNotice(groupId, date)
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
  }, [date, groupId, reloadTick]);

  // 기록 칸에서 이 날 알림장 항목을 고치거나 지우면 다시 읽는다.
  // 적던 것이 있으면 덮지 않는다 (저장하면 적던 것이 이긴다).
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const onChanged = (e: Event) => {
      const d = (e as CustomEvent<SourceChangedDetail>).detail;
      if (d.kind !== 'notice' || d.dateStr !== date || (d.groupId || null) !== (groupId || null)) return;
      if (dirtyRef.current) return;
      setReloadTick((t) => t + 1);
    };
    window.addEventListener(SOURCE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(SOURCE_CHANGED_EVENT, onChanged);
  }, [date, groupId]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!loaded || saving) return false;
    setSaving(true);
    try {
      const lines = splitNoticeLines(text);
      await saveNotice(groupId, date, lines);
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
  }, [loaded, saving, text, groupId, date]);

  // 다른 항목을 열기 전·바깥을 눌러 닫기 전에: 적던 것이 있으면 저장한다
  const saveIfChanged = async () => (dirty ? handleSave() : true);
  if (flushRef) flushRef.current = saveIfChanged;
  if (unsavedRef) unsavedRef.current = () => dirty;

  // 다른 날짜로 가기 전에 적던 것을 저장한다
  const moveDate = async (next: string) => {
    if (dirty && !(await handleSave())) return;
    setDate(next);
  };

  // Ctrl+S. 옆에 붙은 칸은 왼쪽 화면과 함께 쓰므로, 이 칸 안에 있을 때만 받는다.
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 커서가 이 칸 안에 있을 때. 쓰는 칸이 여럿 쌓이면(휴대폰도) 커서가 든 칸만 저장한다.
      // 커서가 아무 데도 없으면(칸의 빈 곳·왼쪽 화면을 누른 뒤) 오른쪽 줄 맨 위 칸이 받는다 -
      // 예전에는 이때 아무 칸도 받지 않아 'Ctrl+S가 가끔 안 먹는' 것처럼 보였다.
      const active = document.activeElement;
      const inside = !!panelRef.current?.contains(active);
      const nowhere = !active || active === document.body;
      if (!inside && !(nowhere && isTopSideItem(panelRef.current))) return;
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
        e.preventDefault();
        if (!e.repeat) void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docked]);

  // 진도 관리 - 다음 수업일 차시의 준비물도 불러온다 (개인 공간 알림장만, ROADMAP 5-4)
  const { marks: progressMarks } = useProgressMarks(date, groupId);

  /** 다음 수업일 (주말·공휴일·방학은 건너뜀). 2주 안에 없으면 null */
  const findNextClassDay = async () => {
    const y = parseDateStr(date).getFullYear();
    const holidays = await loadHolidayYears([y, y + 1]).catch(() => ({} as Record<string, string>));
    return nextClassDay(date, (d) => !!holidays[d] || isVacationDay(d, semesterConfig));
  };

  const handleMeal = async () => {
    if (!school) return;
    setDrafting(true);
    try {
      const target = await findNextClassDay();
      if (!target) {
        showToast('2주 안에 수업일이 없습니다.');
        return;
      }
      const lines = mealNoticeLines(await loadMonthMeals(school, target.slice(0, 7)), target);
      if (lines.length === 0) {
        showToast(`${shortDateLabel(target)} 급식이 나이스에 아직 없습니다.`);
        return;
      }
      const current = splitNoticeLines(text);
      const fresh = lines.filter((l) => !current.includes(l));
      if (fresh.length === 0) {
        showToast('이미 적혀 있습니다.');
        return;
      }
      setText([...current, ...fresh].join('\n'));
      showToast(`🍚 ${shortDateLabel(target)} 급식을 넣었습니다.`);
    } catch (err) {
      showErrorToast('급식을 불러오지 못했습니다.', err);
    } finally {
      setDrafting(false);
    }
  };

  const handleDraft = async () => {
    setDrafting(true);
    try {
      const target = await findNextClassDay();
      if (!target) {
        showToast('2주 안에 수업일이 없습니다.');
        return;
      }
      const draft = await loadDraftLines(groupId, target, groupId ? undefined : suppliesByPeriod(progressMarks, target));
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
    if (tab !== 'list') return;
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
    listNotices(groupId, start, end)
      .then((l) => alive && setList(l))
      .catch((err) => {
        if (!alive) return;
        setList([]);
        showErrorToast('알림장 목록을 불러오지 못했습니다.', err);
      });
    return () => {
      alive = false;
    };
  }, [tab, range, date, groupId, reloadTick]);

  // 좁은 화면에서 배경을 누르면 적던 것을 저장하고 닫는다. 닫기·✕·ESC는 저장 없이 닫는다.
  const closeByBackdrop = async () => {
    if (!(await saveIfChanged())) return;
    onClose();
  };

  const lines = splitNoticeLines(text);

  const panel = (
    <div className={sidePanelClass(docked)}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-slate-800">📢 알림장</h3>
          <p className="text-xs font-bold text-primary mt-0.5 truncate">
            {shortDateLabel(date)} 알림장 · {spaceName}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            빠른 저장 단축키: Ctrl + S{docked ? ' · 다른 화면으로 옮겨도 이 칸은 남습니다' : ''}
          </p>
        </div>
        <button
          title="닫기"
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 space-y-4 text-xs text-slate-700" data-scroll-lock>
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
              {school && (
                <button
                  type="button"
                  onClick={handleMeal}
                  disabled={drafting || !loaded}
                  title="다음 수업일 급식을 한 줄로 더합니다 (나이스 - 환경설정 '우리 학교')"
                  className="px-3 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-200 rounded-xl font-bold disabled:opacity-50"
                >
                  🍚 급식
                </button>
              )}
            </div>

            <div>
              <label className="block font-bold text-slate-500 mb-1">한 줄에 한 항목 (번호는 저절로 붙습니다)</label>
              <AutoTextarea
                value={text}
                onChange={(e) => setText(e.target.value)}
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
            <p className="text-slate-400">
              저장하면 그날 기록 칸에도 '알림장' 항목으로 남습니다. 기록에서 그 항목을 고치거나 지우면 알림장도 따라 바뀝니다.
            </p>
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
                        onClick={async () => {
                          await moveDate(n.date);
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

      <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50/50">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
        >
          닫기
        </button>
        {tab === 'write' && (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!loaded || saving}
            title="Ctrl + S 로도 저장합니다"
            className="px-5 py-2 text-sm font-bold text-white bg-primary hover:bg-blue-600 rounded-xl shadow-md disabled:opacity-50 cursor-pointer"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <SidePanelFrame
      docked={docked}
      onClose={onClose}
      onBackdropClose={() => void closeByBackdrop()}
      ariaLabel="알림장 쓰기"
      panelRef={panelRef}
    >
      {panel}
    </SidePanelFrame>
  );
}
