// src/components/AttendanceDrawer.tsx
//
// 출석부. 메모·기록·일정처럼 오른쪽 칸에서 쓴다 (예전에는 화면을 덮는 팝업이었다).
// 칸 폭은 다른 칸과 같다. 넓은 누계 표(17칸)는 칸 안에서 가로로 밀어 본다.
//
// '출석 체크' 탭은 하루치를 적고, '누계' 탭은 학생별 합계와 날짜별 내역을 본다.
// 분류는 나이스와 같다 (결석·지각·조퇴·결과 × 질병·미인정·기타·출석인정).
// 저장하면 그날 기록 칸에도 '출결' 항목이 생긴다. 모두 출석이면 생기지 않는다.
// 거꾸로 기록에서 그 항목을 고치거나 지우면 출석부도 따라간다 (lib/autoJournalSync).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SidePanelFrame, { sidePanelClass } from './SidePanelFrame';
import { isTopSideItem } from './PopupFrame';
import { useRoster, type ClassRoster } from '../hooks/useRoster';
import { useTimetableTemplate } from '../hooks/useTimetableTemplate';
import { semesterSpan } from '../lib/semester';
import { addDays, getAcademicYear, parseDateStr } from '../lib/dateUtils';
import {
  KINDS,
  KIND_HAS_PERIODS,
  KIND_LABEL,
  REASONS,
  REASON_LABEL,
  classKeyOf,
  historyOf,
  recordText,
  tallyByStudent,
  type AttendanceDay,
  type AttendanceKind,
  type AttendanceRecord,
} from '../lib/attendance';
import { loadAttendanceDay, loadAttendanceForClass, saveAttendanceDay, type ClassInfo } from '../lib/attendanceStore';
import { SOURCE_CHANGED_EVENT, type SourceChangedDetail } from '../lib/autoJournalSync';
import { shortDateLabel } from '../lib/notices';
import { showToast, showErrorToast } from '../utils/toast';
import { printNode } from '../lib/print';
import { useTeachingMode } from '../hooks/useTeachingMode';
import { rosterForSlot } from '../lib/teachingSlot';

type Tab = 'check' | 'summary';
type SummaryRange = 'year' | 'sem1' | 'sem2' | 'month';

const CLASS_MEMORY_KEY = 'sp4-attendance-class';

interface AttendanceDrawerProps {
  dateStr: string;
  initialTab?: Tab;
  /** 처음 고를 학급 (자리표 학생 칸에서 열 때). 없으면 마지막에 연 학급 */
  initialClassKey?: string;
  docked: boolean;
  onClose: () => void;
  /** 다른 항목을 열기 전에 '고친 것 있으면 저장'을 부를 수 있게 넘겨준다 */
  flushRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  /** 저장 안 한 것이 있나. ESC로 칸을 모두 닫기 전에 묻는다. */
  unsavedRef?: React.MutableRefObject<(() => boolean) | null>;
}

const classLabel = (c: ClassRoster) => `${c.year}학년도 ${c.grade}학년 ${c.classNum}반`;

/** 고친 뒤 이만큼 손을 떼면 저장 */
const AUTO_SAVE_MS = 2500;

export default function AttendanceDrawer({
  dateStr: initialDate,
  initialTab = 'check',
  initialClassKey,
  docked,
  onClose,
  flushRef,
  unsavedRef,
}: AttendanceDrawerProps) {
  const { rosterList, loading: rosterLoading } = useRoster();
  // 교과 + 담임: 넘겨받은 학급이 없으면 담임반으로 연다 (마지막에 연 학급이 수업하는 다른 반이어도, S3)
  const { mode: teachingMode, preset: teacherPreset } = useTeachingMode();
  const { templates, currentTemplateName, semesterConfig } = useTimetableTemplate();
  const maxPeriods = templates[currentTemplateName]?.names.length || 6;
  const panelRef = useRef<HTMLElement>(null);

  const [tab, setTab] = useState<Tab>(initialTab);
  const [date, setDate] = useState(initialDate);
  const [classKey, setClassKey] = useState<string | null>(null);

  // 학급 고르기: 넘겨받은 학급 → (교과 + 담임) 담임반 → 마지막에 연 학급 → 그 날짜 학년도의, 학생이 있는 첫 학급 → 첫 학급
  useEffect(() => {
    if (rosterLoading || classKey || rosterList.length === 0) return;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(CLASS_MEMORY_KEY);
    } catch {
      /* 무시 */
    }
    const ay = getAcademicYear(parseDateStr(initialDate));
    // 학생이 있는 학급을 먼저 본다 (빈 학급을 열면 체크할 것이 없다)
    const withStudents = rosterList.filter((c) => (c.students || []).length > 0);
    const pick =
      (initialClassKey && rosterList.find((c) => classKeyOf(c) === initialClassKey)) ||
      (teacherPreset === 'subjectHomeroom' && teachingMode.homeroomClass
        ? rosterForSlot(rosterList, teachingMode.homeroomClass, ay)
        : null) ||
      rosterList.find((c) => classKeyOf(c) === remembered) ||
      withStudents.find((c) => Number(c.year) === ay) ||
      withStudents[0] ||
      rosterList[0];
    setClassKey(classKeyOf(pick));
  }, [rosterLoading, rosterList, classKey, initialDate, teacherPreset, teachingMode.homeroomClass]);

  const cls = rosterList.find((c) => classKeyOf(c) === classKey) || null;
  const info: ClassInfo | null = cls
    ? { classKey: classKeyOf(cls), year: Number(cls.year), grade: String(cls.grade), classNum: String(cls.classNum) }
    : null;

  // ── 출석 체크 ──
  const [records, setRecords] = useState<Record<string, AttendanceRecord>>({});
  const beforeRef = useRef<Record<string, AttendanceRecord>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openNote, setOpenNote] = useState<string | null>(null);
  /** 다시 읽기 신호 (기록 쪽에서 이 출결을 고쳤을 때) */
  const [reloadTick, setReloadTick] = useState(0);

  const dirty = loaded && JSON.stringify(records) !== JSON.stringify(beforeRef.current);

  useEffect(() => {
    if (!info) return;
    let alive = true;
    setLoaded(false);
    loadAttendanceDay(info, date)
      .then((day) => {
        if (!alive) return;
        beforeRef.current = day.records;
        setRecords(day.records);
        setLoaded(true);
      })
      .catch((err) => alive && showErrorToast('출석부를 불러오지 못했습니다.', err));
    return () => {
      alive = false;
    };
    // info는 classKey에서 나온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classKey, date, reloadTick]);

  // 기록 칸에서 이 날 출결 항목을 고치거나 지우면 다시 읽는다 (적던 것이 있으면 덮지 않는다)
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const onChanged = (e: Event) => {
      const d = (e as CustomEvent<SourceChangedDetail>).detail;
      if (d.kind !== 'attendance' || d.dateStr !== date || d.classKey !== classKey) return;
      if (dirtyRef.current) return;
      setReloadTick((t) => t + 1);
      setSummaryDays(null);
    };
    window.addEventListener(SOURCE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(SOURCE_CHANGED_EVENT, onChanged);
  }, [date, classKey]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!info || !loaded || saving) return false;
    setSaving(true);
    try {
      await saveAttendanceDay(info, date, beforeRef.current, records);
      beforeRef.current = records;
      const n = Object.keys(records).length;
      showToast(n ? `✅ 출결 ${n}건을 저장했습니다. 그날 기록에도 남겼습니다.` : '✅ 모두 출석으로 저장했습니다.');
      setSummaryDays(null); // 누계는 다시 읽는다
      return true;
    } catch (err) {
      showErrorToast('출석부를 저장하지 못했습니다.', err);
      return false;
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classKey, loaded, saving, date, records]);

  // 고친 뒤 잠시 손을 떼면 저절로 저장한다 (UX-AUDIT C4 - 결석 한 번 누르고 저장까지 3번이던 것을 2번으로).
  // 사유 메모를 치는 동안은 기다린다(칠 때마다 다시 센다).
  const autoSaveRef = useRef<() => Promise<boolean>>(async () => false);
  useEffect(() => {
    if (!dirty || !loaded) return;
    const t = setTimeout(() => void autoSaveRef.current(), AUTO_SAVE_MS);
    return () => clearTimeout(t);
  }, [records, dirty, loaded]);

  // 다른 항목을 열기 전·바깥을 눌러 닫기 전에: 적던 것이 있으면 저장한다
  const saveIfChanged = async () => (dirty ? handleSave() : true);
  if (flushRef) flushRef.current = saveIfChanged;
  if (unsavedRef) unsavedRef.current = () => dirty;

  const chooseClass = async (key: string) => {
    if (dirty && !(await handleSave())) return;
    setClassKey(key);
    try {
      localStorage.setItem(CLASS_MEMORY_KEY, key);
    } catch {
      /* 무시 */
    }
  };

  const moveDate = async (next: string) => {
    if (dirty && !(await handleSave())) return;
    setDate(next);
  };

  // Ctrl+S. 옆에 붙은 칸은 왼쪽 화면과 함께 쓰므로, 이 칸 안에 있을 때만 받는다.
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  autoSaveRef.current = handleSave;
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

  const setKind = (num: number, name: string, kind: AttendanceKind | null) => {
    setRecords((prev) => {
      const next = { ...prev };
      const key = String(num);
      if (!kind) {
        delete next[key];
        return next;
      }
      const old = prev[key];
      next[key] = {
        num,
        name,
        kind,
        // 사유는 고른 적이 있으면 이어받는다. 처음이면 질병 (초등에서 가장 흔하다)
        reason: old?.reason || 'sick',
        ...(KIND_HAS_PERIODS[kind] && old?.periods ? { periods: old.periods } : {}),
        ...(old?.note ? { note: old.note } : {}),
      };
      return next;
    });
  };
  const patch = (num: number, p: Partial<AttendanceRecord>) =>
    setRecords((prev) => ({ ...prev, [String(num)]: { ...prev[String(num)], ...p } }));
  const togglePeriod = (num: number, period: number) =>
    setRecords((prev) => {
      const r = prev[String(num)];
      const set = new Set(r.periods || []);
      if (set.has(period)) set.delete(period);
      else set.add(period);
      return { ...prev, [String(num)]: { ...r, periods: [...set].sort((a, b) => a - b) } };
    });

  // 전출한 학생은 빼되, 그날 기록이 이미 있으면 보여 준다
  const students = (cls?.students || []).filter((s) => s.isActive !== false || records[String(s.num)]);
  const markedCount = Object.keys(records).length;

  // ── 누계 ──
  /** 인쇄할 누계 표 (ROADMAP 12-3) */
  const summaryRef = useRef<HTMLDivElement>(null);
  const [summaryRange, setSummaryRange] = useState<SummaryRange>('year');
  const [summaryDays, setSummaryDays] = useState<AttendanceDay[] | null>(null);
  const [openStudent, setOpenStudent] = useState<number | null>(null);

  useEffect(() => {
    if (tab !== 'summary' || !classKey || summaryDays) return;
    let alive = true;
    loadAttendanceForClass(classKey)
      .then((d) => alive && setSummaryDays(d))
      .catch((err) => {
        if (!alive) return;
        setSummaryDays([]);
        showErrorToast('누계를 불러오지 못했습니다.', err);
      });
    return () => {
      alive = false;
    };
  }, [tab, classKey, summaryDays]);

  useEffect(() => setSummaryDays(null), [classKey]);

  const rangeOf = (r: SummaryRange): { start: string; end: string } => {
    const ay = cls ? Number(cls.year) : getAcademicYear(parseDateStr(date));
    if (r === 'month') {
      const d = parseDateStr(date);
      const m = String(d.getMonth() + 1).padStart(2, '0');
      return { start: `${d.getFullYear()}-${m}-01`, end: `${d.getFullYear()}-${m}-31` };
    }
    if (r === 'year') return { start: `${ay}-03-01`, end: `${ay + 1}-02-29` };
    // 학기는 그 학급 학년도로, 학년도를 빈틈없이 나눈다 (lib/semester.semesterSpan - 교과 출결 누계·조사표 모아 보기와 같다).
    // 예전에는 방학 설정의 해를 그대로 써서 다른 학년도 학급은 빈 표가 되고, 2학기가 겨울 방학 전날에 끝나 2월 출결이 빠졌다.
    return semesterSpan(ay, r === 'sem1' ? 1 : 2, semesterConfig);
  };

  const inRange = useMemo(() => {
    if (!summaryDays) return [];
    const { start, end } = rangeOf(summaryRange);
    return summaryDays.filter((d) => d.date >= start && d.date <= end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryDays, summaryRange, date, classKey]);
  const tally = useMemo(() => tallyByStudent(inRange), [inRange]);

  // 좁은 화면에서 배경을 누르면 적던 것을 저장하고 닫는다
  const closeByBackdrop = async () => {
    if (!(await saveIfChanged())) return;
    onClose();
  };

  const chip = (on: boolean, tone: string) =>
    `px-2 py-1 rounded-lg border font-bold transition-colors ${on ? tone : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`;

  const panel = (
    <div className={sidePanelClass(docked)}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-slate-800">📋 출석부</h3>
          <p className="text-xs font-bold text-primary mt-0.5 truncate">
            {shortDateLabel(date)} 출결{cls ? ` · ${cls.grade}학년 ${cls.classNum}반` : ''} · 🔒 개인
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
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="inline-flex bg-slate-100 p-1 rounded-xl gap-1">
            {([['check', '✔️ 출석 체크'], ['summary', '📊 누계']] as const).map(([id, label]) => (
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
          {rosterList.length > 0 && (
            <select
              value={classKey || ''}
              onChange={(e) => chooseClass(e.target.value)}
              aria-label="학급"
              className="px-2 py-1.5 border border-slate-200 rounded-lg font-bold max-w-full"
            >
              {rosterList.map((c) => (
                <option key={classKeyOf(c)} value={classKeyOf(c)}>
                  {classLabel(c)}
                </option>
              ))}
            </select>
          )}
        </div>

        {!rosterLoading && rosterList.length === 0 ? (
          <p className="text-center text-slate-400 py-8">
            명렬표가 없습니다. 학급 화면 → 🧑‍🤝‍🧑 명렬표에서 학급과 학생을 먼저 넣어 주세요.
          </p>
        ) : tab === 'check' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => moveDate(addDays(date, -1))} className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-black" title="전날">
                  ◀
                </button>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => e.target.value && moveDate(e.target.value)}
                  aria-label="출석 날짜"
                  className="px-2 py-1 border border-slate-200 rounded-lg font-bold"
                />
                <button type="button" onClick={() => moveDate(addDays(date, 1))} className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-black" title="다음 날">
                  ▶
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">
                  {students.length}명 중 <b className="text-slate-800">출석 {Math.max(0, students.length - markedCount)}</b>
                  {markedCount > 0 && <b className="text-rose-600"> · 그 밖 {markedCount}</b>}
                </span>
                <button
                  type="button"
                  onClick={() => setRecords({})}
                  disabled={markedCount === 0}
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold disabled:opacity-40"
                >
                  모두 출석
                </button>
              </div>
            </div>

            {!loaded ? (
              <p className="text-center text-slate-400 py-6">불러오는 중...</p>
            ) : (
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                {students.map((st) => {
                  const r = records[String(st.num)];
                  return (
                    <div key={st.num} data-attendance-num={st.num} className={`px-3 py-2 ${r ? 'bg-rose-50/40' : ''}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="w-24 shrink-0 font-bold text-slate-800 truncate">
                          <span className="text-slate-400 mr-1">{st.num}</span>
                          {st.name || '(이름 없음)'}
                        </span>
                        <div className="flex items-center gap-1 flex-wrap">
                          <button type="button" onClick={() => setKind(st.num, st.name, null)} className={chip(!r, 'bg-emerald-600 text-white border-emerald-600')}>
                            출석
                          </button>
                          {KINDS.map((k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => setKind(st.num, st.name, k)}
                              aria-pressed={r?.kind === k}
                              className={chip(r?.kind === k, 'bg-rose-600 text-white border-rose-600')}
                            >
                              {KIND_LABEL[k]}
                            </button>
                          ))}
                        </div>
                        {r && (
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-slate-300">|</span>
                            {REASONS.map((rs) => (
                              <button
                                key={rs}
                                type="button"
                                onClick={() => patch(st.num, { reason: rs })}
                                aria-pressed={r.reason === rs}
                                className={chip(r.reason === rs, 'bg-slate-800 text-white border-slate-800')}
                              >
                                {REASON_LABEL[rs]}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => setOpenNote(openNote === String(st.num) ? null : String(st.num))}
                              className="px-2 py-1 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-slate-500"
                            >
                              {r.note ? `📝 ${r.note}` : '＋ 사유 적기'}
                            </button>
                          </div>
                        )}
                      </div>
                      {r && KIND_HAS_PERIODS[r.kind] && (
                        <div className="flex items-center gap-1 mt-1.5 pl-24 flex-wrap">
                          <span className="text-slate-400 mr-1">교시</span>
                          {Array.from({ length: maxPeriods }, (_, i) => i + 1).map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => togglePeriod(st.num, p)}
                              aria-pressed={!!r.periods?.includes(p)}
                              className={`w-7 h-6 rounded-md border font-bold ${
                                r.periods?.includes(p) ? 'bg-rose-100 border-rose-300 text-rose-700' : 'bg-white border-slate-200 text-slate-400'
                              }`}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      )}
                      {r && openNote === String(st.num) && (
                        <div className="mt-1.5 pl-24">
                          <input
                            type="text"
                            value={r.note || ''}
                            onChange={(e) => patch(st.num, { note: e.target.value })}
                            placeholder="사유 (예: 감기, 가족 체험학습)"
                            aria-label={`${st.num}번 사유`}
                            className="w-full px-2 py-1 border border-slate-200 rounded-lg"
                            autoFocus
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                {students.length === 0 && <p className="text-center text-slate-400 py-6">이 학급에 학생이 없습니다.</p>}
              </div>
            )}
            <p className="text-slate-400">
              적지 않은 학생은 출석입니다. 고친 뒤 잠시 두면 저절로 저장되고(저장 단추·Ctrl+S도 됩니다), 그날 기록 칸에 '출결' 항목으로 남고, 학생 기록(누가기록)에도 모입니다.
              기록에서 그 항목을 고치거나 지우면 출석부도 따라 바뀝니다.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-slate-500">기간</span>
              <select
                value={summaryRange}
                onChange={(e) => setSummaryRange(e.target.value as SummaryRange)}
                aria-label="누계 기간"
                className="px-2 py-1 border border-slate-200 rounded-lg font-bold"
              >
                <option value="year">학년도 전체</option>
                <option value="sem1">1학기</option>
                <option value="sem2">2학기</option>
                <option value="month">{parseDateStr(date).getMonth() + 1}월</option>
              </select>
              <span className="text-slate-400">
                {rangeOf(summaryRange).start} ~ {rangeOf(summaryRange).end} · 결석은 날 수, 지각·조퇴·결과는 횟수 · 학생을 누르면 날짜별 내역
              </span>
              <button
                type="button"
                data-attendance-print
                disabled={summaryDays === null}
                onClick={() => {
                  if (!summaryRef.current || !cls) return;
                  const label = { year: '학년도 전체', sem1: '1학기', sem2: '2학기', month: `${parseDateStr(date).getMonth() + 1}월` }[summaryRange];
                  printNode(summaryRef.current, {
                    title: `${cls.year}학년도 ${cls.grade}학년 ${cls.classNum}반 출결 누계 (${label})`,
                    subtitle: `${rangeOf(summaryRange).start} ~ ${rangeOf(summaryRange).end} · 결석은 날 수, 지각·조퇴·결과는 횟수`,
                    landscape: true,
                  });
                }}
                className="ml-auto px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 font-bold disabled:opacity-40"
              >
                🖨️ 인쇄
              </button>
            </div>
            {summaryDays === null ? (
              <p className="text-center text-slate-400 py-6">불러오는 중...</p>
            ) : (
              <div ref={summaryRef} className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-center whitespace-nowrap">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th rowSpan={2} className="px-2 py-1.5 text-left">학생</th>
                      {KINDS.map((k) => (
                        <th key={k} colSpan={4} className="px-2 py-1 border-l border-slate-200">{KIND_LABEL[k]}</th>
                      ))}
                    </tr>
                    <tr>
                      {KINDS.map((k) =>
                        REASONS.map((rs) => (
                          <th key={`${k}-${rs}`} className={`px-1.5 py-1 font-normal ${rs === 'sick' ? 'border-l border-slate-200' : ''}`}>
                            {REASON_LABEL[rs].replace('출석인정', '인정')}
                          </th>
                        ))
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {(cls?.students || []).map((st) => {
                      const t = tally[String(st.num)];
                      const open = openStudent === st.num;
                      const hist = open ? historyOf(inRange, st.num) : [];
                      return (
                        <React.Fragment key={st.num}>
                          <tr
                            onClick={() => setOpenStudent(open ? null : st.num)}
                            className={`border-t border-slate-100 cursor-pointer hover:bg-blue-50/40 ${t ? '' : 'text-slate-300'}`}
                          >
                            <td className="px-2 py-1.5 text-left font-bold text-slate-800">
                              <span className="text-slate-400 mr-1">{st.num}</span>
                              {st.name}
                              {st.isActive === false && <span className="ml-1 text-slate-400 font-normal">(전출)</span>}
                            </td>
                            {KINDS.map((k) =>
                              REASONS.map((rs) => (
                                <td key={`${k}-${rs}`} className={`px-1.5 py-1.5 ${rs === 'sick' ? 'border-l border-slate-100' : ''} ${t?.[k][rs] ? 'font-bold text-rose-600' : ''}`}>
                                  {t?.[k][rs] || '·'}
                                </td>
                              ))
                            )}
                          </tr>
                          {open && (
                            <tr className="bg-slate-50/60">
                              <td colSpan={17} className="px-3 py-2 text-left">
                                {hist.length === 0 ? (
                                  <span className="text-slate-400">이 기간에 출결 기록이 없습니다 (모두 출석).</span>
                                ) : (
                                  <ul className="space-y-0.5">
                                    {hist.map((h) => (
                                      <li key={h.date}>
                                        <b className="text-slate-700">{h.date}</b> {shortDateLabel(h.date).replace(/^\d+\/\d+/, '')}{' '}
                                        <span className="text-rose-700">{recordText(h.record)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
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
        {tab === 'check' && (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!loaded || saving || !info}
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
      ariaLabel="출석부 쓰기"
      panelRef={panelRef}
    >
      {panel}
    </SidePanelFrame>
  );
}
