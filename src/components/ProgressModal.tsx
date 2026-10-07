// src/components/ProgressModal.tsx
//
// 진도 관리 창 (docs/ROADMAP.md 5-2, 사용 설명서 '진도 관리'). ⋮ 메뉴 '📘 진도 관리'와 시간표 설정 창에서 연다.
//
// 수업 칸의 과목(예: '국어', 교과 모드 '3-2 국어')마다 차시 목록을 둔다. 엑셀·한셀의 표를 붙여 넣고 칸에서 고친다.
// 시작일부터 수업 문서에 적힌 그 글자의 교시를 차례로 세어 어느 날 몇 교시에 몇 차시인지 미리 본다(lib/progress).
// 저장은 V4 전용 v4_progress - 수업 문서(V3와 함께 씀)에는 쓰지 않는다. 진도는 개인 공간의 수업으로 센다.
// 교과 모드에서는 과정을 만든다(docs/ROADMAP-SUBJECT.md S4): 과목 하나 + 반(하나든 여럿이든), 차시 목록은 하나이고
// 반마다 제 수업 칸에서 따로 센다. 미리보기·밀기는 반 탭을 골라 그 반으로 본다.
// 19번 U2: 교과 모드의 '+ 진도'·'+ 과정'을 하나로 - 늘 과목 + 반 칩. 옛 '칸 글자 하나' 진도('5-2 과학')는 '과목 + 반 하나'로
// 보이되 반을 하나만 두면 그 모양 그대로 저장한다(과정으로 바꾸면 칸 견주기가 정규화로 바뀌어 옛 결과가 달라질 수 있다).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ModalShell, { ModalCloseButton } from './ModalShell';
import { auth } from '../lib/firebase';
import { formatDate } from '../lib/dateUtils';
import { isSingleCell, nextCell, parseClipboardGrid, type CellPos } from '../lib/gridNav';
import { shortDateLabel } from '../lib/notices';
import { getSemesterRanges } from '../lib/semester';
import {
  computeProgress,
  courseStatus,
  courseTitle,
  deleteProgressPlan,
  isCourse,
  NEW_COURSE_PLAN_ID,
  NEW_PLAN_ID,
  parseLessonCsv,
  parseLessonTable,
  progressKey,
  planKeys,
  planLabel,
  progressUntil,
  saveProgressPlan,
  schoolYearEnd,
  setProgressBump,
  type ProgressLesson,
  type ProgressTimeline,
} from '../lib/progress';
import { useProgressInputs, useProgressPlans } from '../hooks/useProgress';
import {
  cleanLessons,
  draftForSlot,
  draftTarget,
  emptyLesson,
  hasText,
  insertRowAfter,
  newCourseDraft,
  newDraft,
  sameAsSaved,
  squeeze,
  toDraft,
  trimLesson,
  withKey,
  type Draft,
} from '../lib/progressDraft';
import { decodeTextBytes } from '../lib/csv';
import { downloadProgressSample, PROGRESS_SAMPLE_FILENAME } from '../lib/progressSample';
import { useTimetableTemplate } from '../hooks/useTimetableTemplate';
import { useTeachingMode } from '../hooks/useTeachingMode';
import { useRoster } from '../hooks/useRoster';
import { schoolYearOf } from '../lib/schoolSetting';
import { formatSlot, normalizeSlotText, teachingClasses } from '../lib/teachingSlot';
import { useAppStore } from '../store/useAppStore';
import { showErrorToast, showToast } from '../utils/toast';
import { showDeletedToast } from '../lib/undoToast';

interface ProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FIELDS: Array<{ key: keyof ProgressLesson; label: string; title?: string }> = [
  { key: 'unit', label: '단원' },
  { key: 'no', label: '차시' },
  { key: 'content', label: '내용' },
  { key: 'page', label: '교과서', title: '교과서 쪽 (예: 12~15)' },
  { key: 'supplies', label: '준비물' },
];
const isDay = (s: string) => /^(20\d\d)-\d\d-\d\d$/.test(s);
// 단원 | 차시 | 내용 | 교과서 | 준비물 | 삭제 - 오른쪽 칸(340~512px)에서도 내용 칸이 가장 넓게(비율로 나눈다)
const ROW_GRID =
  'grid grid-cols-[minmax(0,0.9fr)_2.25rem_minmax(0,2fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_1.25rem] gap-1';

export default function ProgressModal({ isOpen, onClose }: ProgressModalProps) {
  const uid = auth.currentUser?.uid;
  const { plans, loaded } = useProgressPlans();
  const { templates, semesterConfig } = useTimetableTemplate();
  const inGroup = useAppStore((s) => !!s.selectedGroupId);
  // 수업 칸의 진도 줄을 눌러 열면 그 진도부터 (열려 있을 때 다른 줄을 눌러도 그리로)
  const wantedId = useAppStore((s) => s.progressModalPlanId);
  const wantedClass = useAppStore((s) => s.progressModalClass);
  const wantedPreset = useAppStore((s) => s.progressModalPreset);
  const { mode, isClassUnit } = useTeachingMode();
  // 과정의 반 고르기는 명렬표의 반 - 교과 모드에서만 읽는다(초등 담임은 읽기가 늘지 않게)
  const { rosterList } = useRoster(isClassUnit);
  const [draft, setDraft] = useState<Draft | null>(null);
  // 과정 미리보기에서 보는 반
  const [previewClass, setPreviewClass] = useState<string>(wantedClass || '');
  const [saving, setSaving] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLOListElement>(null);
  const today = formatDate(new Date());

  /** 새 진도: 교과 모드는 과목 + 반, 초등 담임은 과목 하나 */
  const freshDraft = () => (isClassUnit ? newCourseDraft(mode.subjects[0] || '') : newDraft());

  // 처음: 고른 진도 → 첫 진도 → 새 진도 (교과 모드면 옛 진도도 과목 + 반으로 연다)
  useEffect(() => {
    if (!loaded || draft) return;
    if (wantedId === NEW_COURSE_PLAN_ID) return setDraft(newCourseDraft(mode.subjects[0] || ''));
    if (wantedId === NEW_PLAN_ID) return setDraft(draftForSlot(wantedPreset || '', isClassUnit));
    const first = plans.find((p) => p.id === wantedId) || plans[0];
    setDraft(first ? toDraft(first, isClassUnit) : freshDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, plans, draft, wantedId, isClassUnit, mode.subjects]);

  const saved = draft ? plans.find((p) => p.id === draft.id) : undefined;
  // 과목 + 반 칩으로 고치나 (교과 모드, 또는 초등 담임이 연 과정)
  const courseDraft = !!draft?.classes;
  const target = draft ? draftTarget(draft) : null;
  // 과정으로 저장되나 (반마다 따로 센다)
  const courseTarget = !!target?.classes;
  const dirty =
    !!draft &&
    (saved
      ? !sameAsSaved(draft, saved)
      : courseDraft
        ? draft.classes!.length > 0 || draft.lessons.some(hasText)
        : !!draft.key.trim() || draft.lessons.some(hasText));

  const draftClasses = draft?.classes || [];
  const viewClass = draftClasses.includes(previewClass) ? previewClass : draftClasses[0] || '';
  const subjectOptions = useMemo(() => {
    const set = new Set(mode.subjects.map((x) => x.trim()).filter(Boolean));
    if (draft?.subject.trim()) set.add(draft.subject.trim());
    return [...set];
  }, [mode.subjects, draft?.subject]);

  const from = draft && isDay(draft.startDate) ? draft.startDate : '';
  const { inputs, isOffDay } = useProgressInputs(from, from ? schoolYearEnd(from) : '', semesterConfig);

  // 과정: 고를 수 있는 반 (시작일이 든 학년도에 가르치는 반 - 시간표·수업 칸·명렬표·설정 '가르치는 반', 19번 U1)
  // + 이미 고른 반 가운데 거기에 없는 것
  const classOptions = useMemo(() => {
    if (!courseDraft) return [];
    const year = schoolYearOf(isDay(draft!.startDate) ? draft!.startDate : formatDate(new Date()));
    const labels = teachingClasses({
      rosters: rosterList,
      templates,
      subjectsByDate: inputs?.subjectsByDate,
      settingClasses: mode.classes,
      schoolYear: year,
    });
    for (const c of draft!.classes!) if (!labels.includes(c)) labels.push(c);
    return labels;
  }, [courseDraft, draft, rosterList, templates, inputs, mode.classes]);
  // 칸 글자 고르기: 시간표 템플릿과, 시작일부터 수업 문서에 실제로 적힌 글자
  const keyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of Object.values(templates || {})) {
      for (const day of Object.values(t?.data || {})) {
        for (const v of Object.values(day || {})) {
          const k = progressKey(v);
          if (k) set.add(k);
        }
      }
    }
    for (const day of Object.values(inputs?.subjectsByDate || {})) for (const v of Object.values(day)) set.add(v);
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [templates, inputs]);

  const lessons = useMemo(() => cleanLessons(draft?.lessons || []), [draft?.lessons]);
  // 세는 열쇠: 과목(칸 글자), 과정이면 보는 반의 '5-2 과학' (과목·반이 없으면 '')
  const key = !target
    ? ''
    : courseTarget
      ? viewClass && target.subject
        ? formatSlot(viewClass, target.subject)
        : ''
      : target.key;
  const planRef =
    draft && target
      ? {
          id: draft.id,
          key: target.key,
          startDate: draft.startDate,
          ...(courseTarget ? { subject: target.subject, classes: target.classes } : {}),
        }
      : null;
  const until = planRef && key ? progressUntil(planRef, plans, key) : undefined;
  const timeline = useMemo(() => {
    if (!planRef || !inputs || !key || !from) return null;
    return computeProgress(
      { ...planRef, startDate: from, lessons, bumps: saved?.bumps || [] },
      inputs.subjectsByDate,
      isOffDay,
      until,
      key
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, key, inputs, from, lessons, saved?.bumps, isOffDay, until]);

  // 과정: 반별 현황 (S5) - 반마다 따로 센 것을 한 표로. 오늘까지 한 차시, 다음 수업, 가장 앞선 반과의 차이
  const statusRows = useMemo(() => {
    if (!planRef || !courseTarget || !inputs || !from || lessons.length === 0 || !target!.subject) return [];
    const plan = { ...planRef, startDate: from, lessons, bumps: saved?.bumps || [] };
    const timelines: Record<string, ProgressTimeline> = {};
    for (const k of planKeys(plan)) {
      timelines[k] = computeProgress(plan, inputs.subjectsByDate, isOffDay, progressUntil(plan, plans, k), k);
    }
    return courseStatus(plan, timelines, today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, courseTarget, inputs, from, lessons, saved?.bumps, isOffDay, plans, today]);

  const bumpNext = async (cls: string, date: string, period: string) => {
    if (!uid || !saved) return;
    try {
      await setProgressBump(uid, saved.id, date, period, true);
      showToast(`⏭ ${cls} ${shortDateLabel(date)} ${period}교시를 밀었습니다. 뒤 차시가 한 칸씩 밀립니다.`);
    } catch (e) {
      showErrorToast('이 교시를 밀지 못했습니다.', e);
    }
  };

  // 미리보기는 마지막 차시까지 (민 교시 포함). 목록이 안 끝나면 읽은 데까지
  const rows = useMemo(() => {
    if (!timeline) return [];
    const end = timeline.last ? timeline.slots.indexOf(timeline.last) : timeline.slots.length - 1;
    return timeline.slots.slice(0, end + 1);
  }, [timeline]);
  const doneCount = rows.filter((s) => s.lesson !== null && s.date <= today).length;
  const nextRow = rows.find((s) => s.lesson !== null && s.date > today);

  // 미리보기를 오늘 언저리로 내려 둔다 (진도를 바꿀 때마다)
  useEffect(() => {
    const list = previewRef.current;
    const target = list?.querySelector<HTMLElement>('[data-upcoming="true"]');
    if (list && target) list.scrollTop = Math.max(0, target.offsetTop - list.offsetTop - 48);
  }, [draft?.id, rows.length > 0]);

  const update = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  // 교사 유형이 창을 연 뒤에 바뀌거나 늦게 읽히면 손대지 않은 진도를 그 모양으로 다시 연다
  const shapedFor = useRef(isClassUnit);
  useEffect(() => {
    if (shapedFor.current === isClassUnit || !draft) return;
    shapedFor.current = isClassUnit;
    if (dirty) return;
    setDraft(saved ? toDraft(saved, isClassUnit) : freshDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClassUnit, draft]);

  // 고치던 것을 버리고 다른 진도로 옮길 때만 묻는다
  const switchTo = (next: Draft) => {
    if (dirty && !window.confirm('고치던 진도를 저장하지 않고 옮길까요?')) return;
    setDraft(next);
  };

  // 열린 채로 다른 교시의 진도 줄을 누르면 그 진도로 (과정이면 그 반 탭으로)
  const wantedToken = `${wantedId || ''}|${wantedClass || ''}|${wantedPreset || ''}`;
  const handledWanted = useRef(wantedToken);
  useEffect(() => {
    if (!draft || !wantedId || handledWanted.current === wantedToken) return;
    handledWanted.current = wantedToken;
    if (wantedId === NEW_COURSE_PLAN_ID) return startNew();
    if (wantedId === NEW_PLAN_ID) return switchTo(draftForSlot(wantedPreset || '', isClassUnit));
    const plan = plans.find((p) => p.id === wantedId);
    if (plan && plan.id !== draft.id) switchTo(toDraft(plan, isClassUnit));
    if (wantedClass) setPreviewClass(wantedClass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedToken, draft, plans]);

  /** 새 진도: 저장한 진도를 보고 있으면 새로 연다 (아직 저장 안 한 새 진도면 그대로) */
  const startNew = () => {
    if (draft && saved) switchTo(freshDraft());
  };

  const toggleClass = (cls: string) => {
    if (!draft?.classes) return;
    const on = draft.classes.includes(cls);
    const next = on ? draft.classes.filter((c) => c !== cls) : [...draft.classes, cls];
    // 명렬표 차례(학년·반 숫자)로 둔다
    next.sort((a, b) => {
      const ia = classOptions.indexOf(a);
      const ib = classOptions.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    update({ classes: next });
    if (!on) setPreviewClass(cls);
  };

  // ── 표 붙여넣기·칸 고치기 ──────────────────────────────────────────

  /** 읽어 온 차시 목록으로 바꾼다 (붙여넣기·CSV 불러오기). 이미 목록이 있으면 먼저 묻는다 */
  const replaceLessons = (parsed: ProgressLesson[], how: '붙여 넣은' | '불러온') => {
    if (!draft) return;
    const cur = cleanLessons(draft.lessons).length;
    if (cur > 0 && !window.confirm(`지금 차시 목록 ${cur}개를 ${how} ${parsed.length}개로 바꿀까요?`)) return;
    update({ lessons: parsed.map(withKey) });
    showToast(`✅ ${parsed.length}차시를 ${how === '붙여 넣은' ? '붙여 넣었습니다' : '불러왔습니다'}. 미리보기를 보고 💾 저장을 누르세요.`);
  };

  const handleTablePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    if (!draft) return;
    const parsed = parseLessonTable(e.clipboardData.getData('text/plain'));
    if (parsed.length === 0) {
      showErrorToast('붙여 넣은 것에서 차시를 찾지 못했습니다. 엑셀·한셀에서 표를 복사해 주세요.');
      return;
    }
    replaceLessons(parsed, '붙여 넣은');
  };

  // CSV 파일로 불러오기 - 예시 CSV를 엑셀에서 고쳐 저장한 것 (엑셀이 CP949로 저장해도 읽는다)
  const csvInputRef = useRef<HTMLInputElement>(null);
  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일을 다시 골라도 불러오게
    if (!file || !draft) return;
    try {
      const parsed = parseLessonCsv(decodeTextBytes(await file.arrayBuffer()));
      if (parsed.length === 0) {
        showErrorToast(`'${file.name}'에서 차시를 찾지 못했습니다. 예시 CSV처럼 '단원, 차시, 내용, 교과서, 준비물' 칸으로 적어 주세요.`);
        return;
      }
      replaceLessons(parsed, '불러온');
    } catch (err) {
      showErrorToast('CSV 파일을 읽지 못했습니다.', err);
    }
  };

  const setCell = (row: number, field: keyof ProgressLesson, value: string) =>
    setDraft((d) => {
      if (!d) return d;
      const next = d.lessons.map((l, i) => (i === row ? { ...l, [field]: value } : l));
      return { ...d, lessons: next };
    });

  const focusCell = (pos: CellPos) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-cell="${pos.row}-${pos.col}"]`);
    if (!el) return;
    el.focus();
    el.select();
  };

  // 마지막으로 커서가 있던 칸 - '+ 행 추가'는 그 행 바로 아래에 넣는다 (19번 U2). 다른 진도로 옮기면 잊는다
  const lastFocus = useRef<CellPos | null>(null);
  useEffect(() => {
    lastFocus.current = null;
  }, [draft?.id]);

  /** after 행 바로 아래에 빈 행을 넣고 그 행의 col 칸에 커서. after가 없으면 마지막으로 커서가 있던 행(없었으면 맨 아래) */
  const addRow = (after?: number, col?: number) => {
    if (!draft) return;
    const len = draft.lessons.length;
    const last = lastFocus.current;
    const { lessons: next, at } = insertRowAfter(draft.lessons, after ?? (last && last.row < len ? last.row : len - 1));
    const focusCol = col ?? last?.col ?? 2;
    update({ lessons: next });
    requestAnimationFrame(() => focusCell({ row: at, col: focusCol }));
  };

  const removeRow = (row: number) => {
    const last = lastFocus.current;
    if (last && last.row > row) lastFocus.current = { ...last, row: last.row - 1 };
    update({ lessons: (draft?.lessons || []).filter((_, i) => i !== row) });
  };

  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    if (e.nativeEvent.isComposing) return; // 한글 조합 중 Enter - 글자가 다음 칸으로 넘어가지 않게
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      // Ctrl + Enter: 어느 행에서나 그 아래에 행 추가
      e.preventDefault();
      addRow(row, col);
      return;
    }
    const el = e.currentTarget;
    const rowsCount = draft?.lessons.length || 0;
    const target = nextCell(
      { row, col },
      { rows: rowsCount, cols: FIELDS.length },
      { key: e.key, shift: e.shiftKey, atStart: el.selectionStart === 0, atEnd: el.selectionEnd === el.value.length }
    );
    if (target) {
      e.preventDefault();
      focusCell(target);
    } else if (e.key === 'Enter' && !e.shiftKey && row === rowsCount - 1) {
      // 마지막 행에서 Enter - 행을 하나 더해 이어 적는다
      e.preventDefault();
      addRow(row, col);
    }
  };

  /** 칸 위에 여러 칸을 붙여 넣으면 그 칸부터 엑셀처럼 채운다 (모자라는 행은 더한다) */
  const handleCellPaste = (e: React.ClipboardEvent<HTMLInputElement>, row: number, col: number) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text || isSingleCell(text) || !draft) return;
    e.preventDefault();
    const grid = parseClipboardGrid(text);
    const next = draft.lessons.map((l) => ({ ...l }));
    let last: CellPos = { row, col };
    grid.forEach((line, r) => {
      const i = row + r;
      while (next.length <= i) next.push(emptyLesson());
      line.forEach((v, c) => {
        const f = FIELDS[col + c];
        if (!f) return;
        next[i][f.key] = v;
        last = { row: i, col: col + c };
      });
    });
    update({ lessons: next });
    requestAnimationFrame(() => focusCell(last));
  };

  // ── 저장·지우기·밀기 ──────────────────────────────────────────────

  const handleSave = async () => {
    if (!uid || !draft || saving) return;
    const clean = cleanLessons(draft.lessons);
    const t = draftTarget(draft);
    if (courseDraft && !squeeze(draft.subject)) return showErrorToast('과목을 고르거나 적어 주세요.');
    if (!t.key && !t.classes) return showErrorToast('과목을 고르거나 적어 주세요.');
    // 과정을 반 없는 진도로 바꾸지 않는다 (저장은 합쳐 쓰기라 반 목록이 남는다)
    if (!t.classes && saved && isCourse(saved)) return showErrorToast('이 과정을 배우는 반을 하나 이상 골라 주세요.');
    if (!isDay(draft.startDate)) return showErrorToast('시작일을 정해 주세요.');
    if (clean.length === 0) return showErrorToast('차시 목록을 붙여 넣거나 적어 주세요.');
    const next = t.classes
      ? { id: draft.id, key: '', startDate: draft.startDate, lessons: clean, subject: t.subject!, classes: t.classes }
      : { id: draft.id, key: t.key, startDate: draft.startDate, lessons: clean };
    // 같은 열쇠(과정이면 반마다)에 같은 시작일의 진도가 이미 있으면 둘이 같은 교시를 다툰다
    const mine = planKeys(next).map(normalizeSlotText);
    const clash = plans.find(
      (p) =>
        p.id !== draft.id &&
        p.startDate === draft.startDate &&
        (t.classes || isCourse(p)
          ? planKeys(p).some((k) => mine.includes(normalizeSlotText(k)))
          : p.key === next.key)
    );
    if (clash) return showErrorToast(`'${planLabel(clash)}' 진도가 같은 반·시작일로 이미 있습니다.`);
    const label = planLabel(next);
    setSaving(true);
    try {
      await saveProgressPlan(uid, next);
      setDraft({
        ...draft,
        key: planKeys(next)[0],
        subject: t.subject ?? draft.subject,
        lessons: draft.lessons.filter(hasText).map((l) => ({ ...trimLesson(l), _k: l._k })),
        // 반 없이(또는 옛 모양 그대로) 저장했으면 다음에도 그 글자로, 과정이 되었으면 과정으로
        legacyKey: draft.classes && !t.classes ? t.key : null,
      });
      showToast(`✅ '${label}' 진도를 저장했습니다.`);
    } catch (e) {
      showErrorToast('진도를 저장하지 못했습니다.', e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!uid || !saved) return;
    try {
      const trashId = await deleteProgressPlan(uid, saved);
      showDeletedToast(`🗑️ '${planLabel(saved)}' 진도를 지웠습니다. 휴지통에서 복원할 수 있습니다.`, trashId);
      const rest = plans.filter((p) => p.id !== saved.id);
      setDraft(rest[0] ? toDraft(rest[0], isClassUnit) : freshDraft());
    } catch (e) {
      showErrorToast('진도를 지우지 못했습니다.', e);
    }
  };

  const toggleBump = async (date: string, period: string, on: boolean) => {
    if (!uid || !saved) return;
    try {
      await setProgressBump(uid, saved.id, date, period, on);
    } catch (e) {
      showErrorToast(on ? '이 교시를 밀지 못했습니다.' : '밀기를 되돌리지 못했습니다.', e);
    }
  };

  // ── 그리기 ──────────────────────────────────────────────────────

  const ranges = getSemesterRanges(semesterConfig);

  let summary: React.ReactNode = null;
  if (draft) {
    if (!key)
      summary = courseDraft
        ? '과목과 반을 고르면 반마다 시간표를 따라 몇 차시인지 보입니다.'
        : '과목을 고르면 시간표를 따라 몇 차시인지 보입니다.';
    else if (!from) summary = '시작일을 정해 주세요.';
    else if (!inputs) summary = '수업을 세는 중...';
    else if (lessons.length === 0) summary = '차시 목록을 붙여 넣으면 어느 날 몇 교시에 몇 차시인지 보입니다.';
    else if (rows.length === 0)
      summary = `${shortDateLabel(from)}부터 수업 칸에 '${key}'이(가) 없습니다. 시간표 설정에서 이 기간에 시간표를 적용했는지 확인하세요.`;
    else if (timeline?.last)
      summary = (
        <>
          마지막 <b>{lessons.length}차시</b>: <b>{shortDateLabel(timeline.last.date)} {timeline.last.period}교시</b>
          {' · '}오늘까지 <b>{Math.min(doneCount, lessons.length)}차시</b>
        </>
      );
    else {
      const taught = rows.filter((s) => s.lesson !== null).length;
      summary = (
        <>
          {until ? `${shortDateLabel(until)} 전까지` : '이 학년도 안에'} '{key}' 수업이 <b>{taught}번</b>뿐이라{' '}
          <b className="text-rose-600">{lessons.length - taught}차시가 남습니다</b>
          {' · '}오늘까지 <b>{doneCount}차시</b>
        </>
      );
    }
  }

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="2xl"
      title="📘 진도 관리"
      onSave={handleSave}
      footer={
        <div className="flex items-center gap-2 w-full">
          {saved && (
            <button
              type="button"
              onClick={handleDelete}
              className="px-3 py-2 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl"
              title="이 진도를 지웁니다 (휴지통에서 복원 가능)"
            >
              🗑️ 지우기
            </button>
          )}
          <div className="flex-1" />
          <ModalCloseButton onClose={onClose} />
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-4 py-2 bg-primary hover:bg-blue-600 text-white rounded-xl text-xs font-bold shadow-xs disabled:opacity-40"
          >
            {saving ? '저장 중...' : '💾 저장'}
          </button>
        </div>
      }
    >
      {!draft ? (
        <div className="py-10 text-center text-xs text-slate-400">진도를 불러오는 중...</div>
      ) : (
        <div className="space-y-4">
          {/* 진도 목록 */}
          <div className="flex flex-wrap items-center gap-1.5" data-progress-plans>
            {plans.map((p) => (
              <button
                key={p.id}
                type="button"
                data-progress-plan={p.id}
                onClick={() => p.id !== draft.id && switchTo(toDraft(p, isClassUnit))}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                  p.id === draft.id
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300'
                }`}
                title={`${p.startDate}부터 · ${p.lessons.length}차시`}
              >
                {isCourse(p) ? (
                  <>
                    {courseTitle(p)} <span className="font-medium opacity-75">· {p.classes!.join(', ')}</span>
                  </>
                ) : (
                  p.key
                )}{' '}
                <span className="font-medium opacity-75">{p.lessons.length}차시</span>
              </button>
            ))}
            <button
              type="button"
              data-new-course={isClassUnit ? '' : undefined}
              onClick={startNew}
              title={
                isClassUnit
                  ? '과목과 반(하나든 여럿이든)을 골라 진도를 만듭니다 - 차시 목록 하나를 반마다 제 수업 칸에서 따로 셉니다'
                  : undefined
              }
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border border-dashed ${
                saved
                  ? 'text-indigo-700 border-indigo-300 hover:bg-indigo-50'
                  : 'bg-indigo-50 text-indigo-700 border-indigo-400'
              }`}
            >
              {saved ? '+ 새 진도' : '✏️ 새 진도'}
            </button>
          </div>

          {inGroup && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              지금은 그룹 공간입니다. 진도는 <b>개인 공간</b>의 수업 칸으로 셉니다.
            </div>
          )}

          {courseDraft ? (
            /* 교과 모드(또는 과정): 과목 + 반 */
            <section className="space-y-2" data-course-form>
              <label className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600 shrink-0 w-14">과목</span>
                <input
                  value={draft.subject}
                  onChange={(e) => update({ subject: e.target.value })}
                  placeholder="예: 과학"
                  aria-label="과목"
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-sm font-bold bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              {subjectOptions.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-16">
                  {subjectOptions.map((sub) => (
                    <button
                      key={sub}
                      type="button"
                      data-course-subject={sub}
                      onClick={() => update({ subject: sub })}
                      className={`px-2 py-0.5 rounded-md text-xs border ${
                        draft.subject.trim() === sub
                          ? 'bg-indigo-100 text-indigo-800 border-indigo-300 font-bold'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-indigo-300'
                      }`}
                    >
                      {sub}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-start gap-2">
                <span className="text-xs font-bold text-slate-600 shrink-0 w-14 pt-1">반</span>
                {classOptions.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {classOptions.map((c) => {
                      const on = draftClasses.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          data-course-class-toggle={c}
                          aria-pressed={on}
                          onClick={() => toggleClass(c)}
                          className={`px-2.5 py-1 rounded-md text-xs font-bold border ${
                            on
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-400'
                          }`}
                        >
                          {on ? '✓ ' : ''}
                          {c}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 pt-1">시간표에 '5-2 과학'처럼 반을 적거나 환경설정 '가르치는 반'에 적으세요.</p>
                )}
              </div>
              {draft.subject.trim() && (
                <p className="pl-16 text-xs text-slate-400" data-course-hint>
                  {draftClasses.length > 0 ? (
                    <>
                      {courseTitle({ subject: draft.subject, classes: draftClasses })} - 반마다 수업 칸의 학년-반 과목 '
                      {formatSlot(draftClasses[0], draft.subject)}'을(를) 따로 셉니다.
                    </>
                  ) : (
                    <>반을 고르지 않으면 수업 칸에 반 없이 '{squeeze(draft.subject)}'(이)라고만 적힌 교시를 셉니다.</>
                  )}
                </p>
              )}
            </section>
          ) : (
            <>
            {/* 과목 (초등 담임 - 수업 칸에 적힌 글자 그대로) */}
            <section className="space-y-1.5">
              <label className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600 shrink-0 w-14">과목</span>
                <input
                  value={draft.key}
                  onChange={(e) => update({ key: e.target.value })}
                  placeholder="수업 칸에 적힌 과목 그대로 (예: 국어)"
                  aria-label="과목"
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-sm font-bold bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              {keyOptions.length > 0 ? (
                <div className="flex flex-wrap gap-1 pl-16" data-progress-keys>
                  {keyOptions.map((k) => {
                    const has = plans.some((p) => p.key === k);
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => update({ key: k })}
                        className={`px-2 py-0.5 rounded-md text-xs border ${
                          key === k
                            ? 'bg-indigo-100 text-indigo-800 border-indigo-300 font-bold'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-indigo-300'
                        }`}
                        title={has ? '이 과목의 진도가 이미 있습니다' : '이 과목으로 세기'}
                      >
                        {k}
                        {has && ' ✓'}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="pl-16 text-xs text-slate-400">
                  시간표 설정에서 시간표를 만들면 과목을 여기서 고를 수 있습니다.
                </p>
              )}
            </section>
            </>
          )}

          {/* 시작일 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-600 shrink-0 w-14">시작일</span>
            <input
              type="date"
              value={draft.startDate}
              onChange={(e) => update({ startDate: e.target.value })}
              aria-label="시작일"
              className="px-2.5 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {[
              ['오늘', today],
              ['1학기 시작', ranges.sem1.start],
              ['2학기 시작', ranges.sem2.start],
            ]
              .filter(([, d]) => isDay(d))
              .map(([label, d]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => update({ startDate: d })}
                  className="px-2 py-1 text-xs font-bold text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md"
                >
                  {label}
                </button>
              ))}
          </div>

          {/* 차시 목록 */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-xs font-black text-slate-700">
                차시 목록 {lessons.length > 0 && `(${lessons.length})`}
                <span className="ml-1.5 font-normal text-slate-400">한 행 = 한 차시</span>
              </h3>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  data-progress-sample
                  onClick={downloadProgressSample}
                  title={`'단원·차시·내용·교과서·준비물' 예시 표(${PROGRESS_SAMPLE_FILENAME})를 받습니다. 엑셀에서 열어 고친 뒤 불러오거나 표를 복사해 붙여 넣으세요.`}
                  className="px-2 py-1 text-xs font-bold text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-md"
                >
                  ⬇️ 예시 CSV 받기
                </button>
                <button
                  type="button"
                  data-progress-csv-open
                  onClick={() => csvInputRef.current?.click()}
                  title="CSV 파일의 차시 표를 불러옵니다 (예시 CSV와 같은 칸)"
                  className="px-2 py-1 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md"
                >
                  📂 CSV 불러오기
                </button>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv,.txt"
                  className="hidden"
                  data-progress-csv-input
                  onChange={(e) => void handleCsvFile(e)}
                />
              </div>
            </div>
            <textarea
              value=""
              onChange={() => {}}
              onPaste={handleTablePaste}
              rows={2}
              data-progress-paste
              aria-label="차시 표 붙여넣기"
              placeholder={"엑셀·한셀에서 '단원 | 차시 | 내용 | 교과서 | 준비물' 표를 복사해 여기를 누르고 Ctrl + V\n(머리줄이 있으면 그 이름으로 칸을 맞춥니다)"}
              className="w-full px-3 py-2 text-xs bg-indigo-50/40 border border-dashed border-indigo-300 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400 placeholder:text-indigo-400"
            />
            {draft.lessons.length > 0 && (
              <div ref={tableRef} className="space-y-1" data-progress-table>
                <div className={`${ROW_GRID} text-xs font-bold text-slate-500 px-0.5`}>
                  {FIELDS.map((f) => (
                    <span key={f.key} title={f.title} className="truncate">
                      {f.label}
                    </span>
                  ))}
                  <span />
                </div>
                <div className="max-h-72 overflow-y-auto space-y-1 pr-0.5">
                  {draft.lessons.map((l, r) => (
                    <div key={l._k} className={ROW_GRID}>
                      {FIELDS.map((f, c) => (
                        <input
                          key={f.key}
                          value={l[f.key]}
                          data-cell={`${r}-${c}`}
                          aria-label={`${r + 1}번째 행 ${f.label}`}
                          title={f.title}
                          onFocus={() => (lastFocus.current = { row: r, col: c })}
                          onChange={(e) => setCell(r, f.key, e.target.value)}
                          onKeyDown={(e) => handleCellKeyDown(e, r, c)}
                          onPaste={(e) => handleCellPaste(e, r, c)}
                          className="min-w-0 px-1.5 py-1 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      ))}
                      <button
                        type="button"
                        onClick={() => removeRow(r)}
                        className="text-slate-300 hover:text-rose-500 text-xs"
                        title="행 삭제"
                        aria-label={`${r + 1}번째 행 삭제`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button
              type="button"
              data-progress-add-row
              onClick={() => addRow()}
              title="마지막으로 커서가 있던 행 바로 아래에 행을 넣습니다 (칸에서 Ctrl + Enter)"
              className="px-2.5 py-1 text-xs font-bold text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-md"
            >
              + 행 추가
            </button>
          </section>

          {/* 미리보기 */}
          <section className="space-y-2 border-t border-slate-100 pt-3" data-progress-preview>
            <h3 className="text-xs font-black text-slate-700">미리보기</h3>
            {statusRows.length > 0 && (
              <div className="border border-slate-200 rounded-lg overflow-x-auto" data-course-status>
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2 py-1 text-left font-bold">반</th>
                      <th className="px-2 py-1 text-left font-bold">지난 수업</th>
                      <th className="px-2 py-1 text-left font-bold">다음 수업</th>
                      <th className="px-2 py-1 text-left font-bold">진도</th>
                      <th className="px-1 py-1" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {statusRows.map((r) => (
                      <tr
                        key={r.cls}
                        data-course-status-row={r.cls}
                        onClick={() => setPreviewClass(r.cls)}
                        className={`cursor-pointer hover:bg-slate-50 ${r.cls === viewClass ? 'bg-indigo-50/60' : ''}`}
                      >
                        <td className="px-2 py-1 font-black text-slate-800 whitespace-nowrap">{r.cls}</td>
                        <td className="px-2 py-1 text-slate-600 whitespace-nowrap">
                          {r.last ? `${shortDateLabel(r.last.date)} ${(r.last.lesson ?? 0) + 1}차시` : '-'}
                        </td>
                        <td className="px-2 py-1 text-slate-600 whitespace-nowrap">
                          {r.next
                            ? `${shortDateLabel(r.next.date)} ${r.next.period}교시 · ${(r.next.lesson ?? 0) + 1}차시`
                            : r.finished
                              ? '끝'
                              : '-'}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          <b className="tabular-nums text-slate-800">
                            {r.done}/{r.total}
                          </b>
                          {r.behind >= 2 && (
                            <span data-course-behind className="ml-1 font-bold text-rose-600">
                              {r.behind}차시 늦음
                            </span>
                          )}
                        </td>
                        <td className="px-1 py-1 text-right">
                          {saved && r.next && (
                            <button
                              type="button"
                              data-course-bump={r.cls}
                              onClick={(e) => {
                                e.stopPropagation();
                                void bumpNext(r.cls, r.next!.date, r.next!.period);
                              }}
                              title={`${r.cls}의 다음 수업(${shortDateLabel(r.next.date)} ${r.next.period}교시)을 밉니다 - 그 반 뒤 차시가 한 칸씩 밀립니다`}
                              className="px-1.5 py-0.5 rounded border text-xs font-bold text-slate-400 border-slate-200 hover:text-slate-600 hover:bg-slate-50 whitespace-nowrap"
                            >
                              다음 수업 밀기
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {courseDraft && draftClasses.length > 1 && (
              <div className="flex flex-wrap gap-1" role="tablist" aria-label="미리 볼 반">
                {draftClasses.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="tab"
                    aria-selected={c === viewClass}
                    data-course-preview={c}
                    onClick={() => setPreviewClass(c)}
                    className={`px-2 py-0.5 rounded-md text-xs font-bold border ${
                      c === viewClass
                        ? 'bg-slate-700 text-white border-slate-700'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-600 leading-relaxed" data-progress-summary>
              {summary}
            </p>
            {until && (
              <p className="text-xs text-slate-400">
                같은 '{key}' 진도가 {shortDateLabel(until)}부터 이어받습니다 - 이 진도는 그 전날까지 셉니다.
              </p>
            )}
            {rows.length > 0 && lessons.length > 0 && (
              <ol ref={previewRef} className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                {rows.map((s) => {
                  const lesson = s.lesson !== null ? lessons[s.lesson] : null;
                  const past = s.date < today;
                  const upcoming = s === nextRow || (s.date === today && s.lesson !== null);
                  return (
                    <li
                      key={`${s.date}#${s.period}`}
                      data-slot={`${s.date}#${s.period}`}
                      data-upcoming={s === nextRow ? 'true' : undefined}
                      className={`flex items-center gap-2 px-2.5 py-1.5 text-xs ${
                        s.date === today ? 'bg-amber-50' : ''
                      } ${past ? 'text-slate-400' : 'text-slate-700'}`}
                    >
                      <span className={`shrink-0 min-w-[6.75rem] whitespace-nowrap tabular-nums ${upcoming ? 'font-bold' : ''}`}>
                        {shortDateLabel(s.date)} {s.period}교시
                      </span>
                      {s.bumped ? (
                        <span className="flex-1 min-w-0 text-amber-700 font-bold">⏭ 밀림 (이 교시는 차시 없음)</span>
                      ) : (
                        <span className="flex-1 min-w-0 truncate">
                          <b className="tabular-nums">
                            {(s.lesson ?? 0) + 1}/{lessons.length}차시
                          </b>
                          {lesson?.content && ` · ${lesson.content}`}
                        </span>
                      )}
                      {saved && (
                        <button
                          type="button"
                          onClick={() => toggleBump(s.date, s.period, !s.bumped)}
                          className={`shrink-0 px-1.5 py-0.5 rounded border text-xs font-bold ${
                            s.bumped
                              ? 'text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100'
                              : 'text-slate-400 border-slate-200 hover:text-slate-600 hover:bg-slate-50'
                          }`}
                          title={
                            s.bumped
                              ? '밀기를 되돌립니다 - 뒤 차시가 한 칸씩 당겨집니다'
                              : '이 교시에 수업을 못 했으면 밉니다 - 뒤 차시가 한 칸씩 밀립니다'
                          }
                        >
                          {s.bumped ? '되돌리기' : '밀기'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            {!saved && rows.length > 0 && lessons.length > 0 && (
              <p className="text-xs text-slate-400">저장하면 교시마다 밀기·되돌리기를 할 수 있습니다.</p>
            )}
          </section>
        </div>
      )}
    </ModalShell>
  );
}
