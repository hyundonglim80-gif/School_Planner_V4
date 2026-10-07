// src/components/SeatingModal.tsx
//
// 자리표 (ROADMAP 8-1). 학급마다 여러 장. 셈은 lib/seating, 저장은 lib/seatingStore(V4 전용, 개인 공간만).
//
// - 바꾸기: PC는 끌어다 놓기. 휴대폰은 '✏️ 자리 고치기'를 켜고 두 자리를 차례로 누른다(그 모드에서 고정·책상 없음도).
// - 섞기: 떨어뜨릴 학생(학급마다) · 지난 짝 피하기 · 남녀 짝. 고정 칸은 그대로. 안내의 되돌리기로 섞기 전으로.
// - 고칠 때마다 곧바로 저장한다(저장 단추 없음). 화면은 구독으로 늘 최신 자리표를 들고 있다.
// - 학급 허브(8-2): '자리 고치기'가 꺼진 채 학생 자리를 누르면 학생 칸(SeatStudentCard) - 오늘 출결·조사표·관찰 한 줄.
//   자리에는 오늘 출결(결석·지각…)을 적어 보인다(출석부 문서를 구독).
// - 발표자 뽑기(8-3): '🎯 발표자 뽑기' 칸 - 이번 판에 안 뽑힌 학생 먼저, 오늘 결석은 빼고, 뽑힌 자리를 짚는다, 크게 보기.
//   이번 판은 학급 허브(draw)에 - 다른 기기에서 이어 뽑는다. 자리표가 없어도 명렬표로 뽑는다.
// - 모둠(8-4): '👥 모둠' 칸 - 무작위·자리대로 나눠 이름 붙여 저장(학급 허브 groupSets), 이 칸이 열린 동안 자리에 모둠 색.
//   조사표 '조별 평가'를 만들 때 저장한 모둠을 불러 쓴다(EvaluationModal).
import React, { useEffect, useMemo, useState } from 'react';
import ModalShell, { ModalCloseButton } from './ModalShell';
import SeatStudentCard from './SeatStudentCard';
import SeatDrawPanel, { drawStatusLine } from './SeatDrawPanel';
import DrawBigView from './DrawBigView';
import SeatGroupsPanel from './SeatGroupsPanel';
import { groupColor, groupIndexByNum, type StudentGroup } from '../lib/groups';
import { useStudentDraw } from '../hooks/useStudentDraw';
import { auth } from '../lib/firebase';
import { useRoster, type Student } from '../hooks/useRoster';
import { useTimetableTemplate } from '../hooks/useTimetableTemplate';
import { KIND_LABEL, classKeyOf, type AttendanceRecord } from '../lib/attendance';
import { subscribeAttendanceDay } from '../lib/classHubStore';
import { describeClass } from '../lib/classPicker';
import { formatDateStr, getAcademicYear } from '../lib/dateUtils';
import {
  GROUP_COL_CHOICES,
  MAX_COLS,
  MAX_ROWS,
  aisleAfter,
  clearSeat,
  displayOrder,
  initialChart,
  nearApartSeats,
  numberOrderSeats,
  pairKey,
  parsePairKey,
  placeStudent,
  pushHistory,
  resizeChart,
  seatKey,
  shuffleSeats,
  shuffleSummary,
  swapSeats,
  toggleKey,
  unseatedNums,
  type SeatingChart,
} from '../lib/seating';
import {
  createSeatingChart,
  deleteSeatingChart,
  sanitizeHub,
  setApartPair,
  subscribeClassHub,
  subscribeSeatingCharts,
  updateSeatingChart,
  type ClassHub,
} from '../lib/seatingStore';
import { showDeletedToast, showUndoToast } from '../lib/undoToast';
import { showErrorToast, showToast } from '../utils/toast';

interface SeatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 학생 칸의 '누가기록' - 그 학생으로 학생 기록(누가기록)을 연다 */
  onOpenStudentRecord?: (classKey: string, num: number) => void;
  /** 학생 칸의 '출석부' - 그 학급·날짜로 출석부 칸을 연다 */
  onOpenAttendance?: (classKey: string, dateStr: string) => void;
  /** 늘 때마다 발표자 뽑기 칸을 편다 (⋮ 메뉴·단축키 '발표자 뽑기') */
  drawRequest?: number;
}

const CLASS_MEMORY_KEY = 'sp4-seating-class';
/** 출석부에서 마지막에 연 학급 - 자리표를 처음 열 때 그 학급으로 */
const ATTENDANCE_CLASS_KEY = 'sp4-attendance-class';
const CHART_MEMORY_KEY = 'sp4-seating-chart';
const SHUFFLE_MEMORY_KEY = 'sp4-seating-shuffle';

const GROUP_COL_LABEL: Record<number, string> = { 0: '통로 없음', 1: '한 칸씩', 2: '두 칸 (짝)', 3: '세 칸' };

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
    /* 무시 - 이 기기에서 기억하지 못할 뿐 */
  }
}

type Selection = { kind: 'seat'; key: string } | { kind: 'student'; num: number } | null;

export default function SeatingModal({ isOpen, onClose, onOpenStudentRecord, onOpenAttendance, drawRequest }: SeatingModalProps) {
  const uid = auth.currentUser?.uid;
  const { rosterList, loading: rosterLoading } = useRoster();
  const { templates, currentTemplateName } = useTimetableTemplate();
  const maxPeriods = templates[currentTemplateName]?.names.length || 6;
  /** 학생 칸의 '오늘' - 창을 연 날 */
  const today = useMemo(() => formatDateStr(new Date()), []);

  const [classKey, setClassKey] = useState<string | null>(null);
  const [charts, setCharts] = useState<SeatingChart[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hub, setHub] = useState<ClassHub>(() => sanitizeHub(null));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<Selection>(null);
  const [panel, setPanel] = useState<'shape' | 'apart' | 'draw' | 'groups' | null>(drawRequest ? 'draw' : null);
  /** 모둠 칸이 보이는 모둠 (자리에 색) */
  const [groupsShown, setGroupsShown] = useState<StudentGroup[] | null>(null);
  const [drawBig, setDrawBig] = useState(false);
  const [shuffleOpts, setShuffleOpts] = useState(() =>
    readJson(SHUFFLE_MEMORY_KEY, { avoidPast: true, mixGender: false })
  );
  const [busy, setBusy] = useState(false);
  /** 학생 칸을 연 학생 번호 ('자리 고치기'가 꺼져 있을 때) */
  const [focusNum, setFocusNum] = useState<number | null>(null);
  const [todayRecords, setTodayRecords] = useState<Record<string, AttendanceRecord>>({});

  // 학급 고르기: 자리표에서 마지막에 본 학급 → 출석부에서 마지막에 연 학급 → 올해 학년도의, 학생이 있는 첫 학급
  useEffect(() => {
    if (rosterLoading || classKey || rosterList.length === 0) return;
    let remembered: string | null = null;
    let fromAttendance: string | null = null;
    try {
      remembered = localStorage.getItem(CLASS_MEMORY_KEY);
      fromAttendance = localStorage.getItem(ATTENDANCE_CLASS_KEY);
    } catch {
      /* 무시 */
    }
    const ay = getAcademicYear();
    const withStudents = rosterList.filter((c) => (c.students || []).length > 0);
    const pick =
      rosterList.find((c) => classKeyOf(c) === remembered) ||
      rosterList.find((c) => classKeyOf(c) === fromAttendance) ||
      withStudents.find((c) => Number(c.year) === ay) ||
      withStudents[0] ||
      rosterList[0];
    setClassKey(classKeyOf(pick));
  }, [rosterLoading, rosterList, classKey]);

  const chooseClass = (key: string) => {
    setClassKey(key);
    setSelected(null);
    setFocusNum(null);
    try {
      localStorage.setItem(CLASS_MEMORY_KEY, key);
    } catch {
      /* 무시 */
    }
  };

  useEffect(() => {
    if (!uid || !classKey) return;
    setCharts(null);
    setLoadFailed(false);
    setActiveId(readJson<Record<string, string>>(CHART_MEMORY_KEY, {})[classKey] || null);
    const stopCharts = subscribeSeatingCharts(uid, classKey, setCharts, (err) => {
      console.warn('자리표를 불러오지 못했습니다:', err);
      setLoadFailed(true);
    });
    setHub(sanitizeHub(null));
    const stopHub = subscribeClassHub(uid, classKey, setHub, (err) =>
      console.warn('떨어뜨릴 학생을 불러오지 못했습니다:', err)
    );
    return () => {
      stopCharts();
      stopHub();
    };
  }, [uid, classKey]);

  // 자리에 오늘 출결을 보인다 (출석부·학생 칸·다른 기기에서 고친 것이 바로 보이게 구독)
  useEffect(() => {
    if (!uid || !classKey) return;
    setTodayRecords({});
    return subscribeAttendanceDay(uid, classKey, today, setTodayRecords, (err) =>
      console.warn('오늘 출결을 불러오지 못했습니다:', err)
    );
  }, [uid, classKey, today]);

  const cls = rosterList.find((c) => classKeyOf(c) === classKey) || null;
  const students: Student[] = useMemo(() => cls?.students || [], [cls]);
  const active = useMemo(() => students.filter((s) => s.isActive !== false), [students]);
  const byNum = useMemo(() => new Map(students.map((s) => [Number(s.num), s])), [students]);
  const chart = charts?.find((c) => c.id === activeId) || charts?.[0] || null;
  const focusStudent = focusNum !== null ? byNum.get(focusNum) || null : null;

  // ── 발표자 뽑기 ──
  useEffect(() => {
    if (drawRequest) setPanel('draw');
  }, [drawRequest]);
  const activeNums = useMemo(() => active.map((s) => Number(s.num)), [active]);
  const absentNums = useMemo(
    () => Object.values(todayRecords).filter((r) => r?.kind === 'absent').map((r) => Number(r.num)),
    [todayRecords]
  );
  const nameFor = (num: number) => byNum.get(num)?.name || `${num}번`;
  const draw = useStudentDraw({
    uid,
    classKey,
    activeNums,
    absentNums,
    draw: hub.draw,
    nameOf: (num) => nameOf(num),
  });
  const drawOn = panel === 'draw';
  const groupsOn = panel === 'groups';
  const groupOf = useMemo(() => (groupsOn && groupsShown ? groupIndexByNum(groupsShown) : new Map<number, number>()), [groupsOn, groupsShown]);
  useEffect(() => {
    if (!drawOn) setDrawBig(false);
  }, [drawOn]);
  // 굴리는 동안은 방금 뽑힌 학생(판의 맨 끝)을 아직 짚지 않는다 - 멈추기 전에 답이 보이지 않게
  const drawnSet = useMemo(
    () => new Set(draw.rolling ? hub.draw.picked.slice(0, -1) : hub.draw.picked),
    [hub.draw.picked, draw.rolling]
  );

  const chooseChart = (id: string) => {
    setActiveId(id);
    setSelected(null);
    if (classKey) writeJson(CHART_MEMORY_KEY, { ...readJson<Record<string, string>>(CHART_MEMORY_KEY, {}), [classKey]: id });
  };

  const nameOf = (num: number) => {
    const s = byNum.get(num);
    return s?.name ? `${num}번 ${s.name}` : `${num}번`;
  };

  // ── 저장 ──
  const save = async (fields: Parameters<typeof updateSeatingChart>[2]): Promise<boolean> => {
    if (!uid || !chart) return false;
    try {
      await updateSeatingChart(uid, chart.id, fields);
      return true;
    } catch (e) {
      showErrorToast('자리표를 저장하지 못했습니다. 네트워크를 확인해 주세요.', e);
      return false;
    }
  };
  const saveSeats = (seats: Record<string, number>) => save({ seats });

  const createChart = async () => {
    if (!uid || !classKey || busy) return;
    const names = new Set((charts || []).map((c) => c.name));
    let n = (charts?.length || 0) + 1;
    while (names.has(`자리표 ${n}`)) n++;
    setBusy(true);
    try {
      const id = await createSeatingChart(uid, initialChart(classKey, active, `자리표 ${n}`));
      chooseChart(id);
    } catch (e) {
      showErrorToast('자리표를 만들지 못했습니다.', e);
    } finally {
      setBusy(false);
    }
  };

  const deleteChart = async () => {
    if (!uid || !chart || !cls || busy) return;
    setBusy(true);
    try {
      const trashId = await deleteSeatingChart(uid, chart, describeClass(cls));
      showDeletedToast(`🗑️ 자리표 '${chart.name}'를 지웠습니다. 휴지통에서 복원할 수 있습니다.`, trashId);
      setPanel(null);
    } catch (e) {
      showErrorToast('자리표를 지우지 못했습니다.', e);
    } finally {
      setBusy(false);
    }
  };

  const shuffle = async () => {
    if (!chart || busy) return;
    if (active.length === 0) return showToast('명렬표에 재학생이 없습니다.');
    const before = { seats: chart.seats, history: chart.history };
    const result = shuffleSeats(chart, active, { apart: hub.apart, ...shuffleOpts });
    setSelected(null);
    setBusy(true);
    const ok = await save({ seats: result.seats, history: pushHistory(chart, Date.now()) });
    setBusy(false);
    if (!ok) return;
    const chartId = chart.id;
    showUndoToast(shuffleSummary(result.cost, result.unseated.length, { apart: hub.apart, ...shuffleOpts }), async () => {
      if (!uid) return;
      await updateSeatingChart(uid, chartId, before);
      return '↩️ 섞기 전 자리로 되돌렸습니다.';
    });
  };

  const resetToNumberOrder = async () => {
    if (!chart || busy) return;
    const before = chart.seats;
    const { seats } = numberOrderSeats(chart, active);
    if (!(await saveSeats(seats))) return;
    const chartId = chart.id;
    showUndoToast('🔢 번호 차례로 앉혔습니다.', async () => {
      if (!uid) return;
      await updateSeatingChart(uid, chartId, { seats: before });
    });
  };

  const setShuffleOpt = (key: 'avoidPast' | 'mixGender', on: boolean) => {
    const next = { ...shuffleOpts, [key]: on };
    setShuffleOpts(next);
    writeJson(SHUFFLE_MEMORY_KEY, next);
  };

  // ── 바꾸기 (끌어다 놓기 / 눌러서) ──
  const dropOnSeat = (source: string, key: string) => {
    if (!chart || chart.off.includes(key)) return;
    if (source.startsWith('seat:')) {
      const from = source.slice(5);
      if (from !== key) void saveSeats(swapSeats(chart.seats, from, key));
    } else if (source.startsWith('student:')) {
      void saveSeats(placeStudent(chart.seats, key, Number(source.slice(8))));
    }
  };

  const dropOnUnseated = (source: string) => {
    if (!chart || !source.startsWith('seat:')) return;
    void saveSeats(clearSeat(chart.seats, source.slice(5)));
  };

  /** 학생 칸 열기·닫기 (같은 학생을 다시 누르면 닫는다) */
  const toggleFocus = (num: number) => {
    if (!byNum.has(num)) return showToast(`${num}번은 명렬표에 없는 번호입니다. 명렬표에서 학생을 넣거나 자리를 비워 주세요.`);
    setFocusNum(focusNum === num ? null : num);
  };

  const tapSeat = (key: string) => {
    if (!chart) return;
    if (!editMode) {
      const num = chart.seats[key];
      if (num !== undefined) return toggleFocus(num);
      showToast('자리를 바꾸려면 끌어다 놓거나, ✏️ 자리 고치기를 켜고 두 자리를 차례로 누릅니다.');
      return;
    }
    const isOff = chart.off.includes(key);
    if (!selected) return setSelected({ kind: 'seat', key });
    if (selected.kind === 'seat') {
      if (selected.key === key) return setSelected(null);
      if (isOff || chart.off.includes(selected.key)) return setSelected({ kind: 'seat', key });
      void saveSeats(swapSeats(chart.seats, selected.key, key));
      return setSelected(null);
    }
    if (isOff) return setSelected({ kind: 'seat', key });
    void saveSeats(placeStudent(chart.seats, key, selected.num));
    setSelected(null);
  };

  const tapUnseated = (num: number) => {
    if (!editMode) return toggleFocus(num);
    setSelected(selected?.kind === 'student' && selected.num === num ? null : { kind: 'student', num });
  };

  // ── 모양 ──
  const resize = (rows: number, cols: number) => {
    if (!chart) return;
    const next = resizeChart(chart, rows, cols);
    const lost = unseatedNums({ ...chart, ...next }, active).length - unseatedNums(chart, active).length;
    void save(next);
    if (lost > 0) showToast(`${lost}명이 자리 없음으로 갔습니다. 아래 '자리 없는 학생'에서 다시 앉힙니다.`);
    setSelected(null);
  };

  const [nameDraft, setNameDraft] = useState('');
  useEffect(() => setNameDraft(chart?.name || ''), [chart?.id, chart?.name]);
  const saveName = () => {
    const name = nameDraft.trim();
    if (!chart || !name || name === chart.name) return setNameDraft(chart?.name || '');
    void save({ name });
  };

  // ── 떨어뜨릴 학생 ──
  const [apartA, setApartA] = useState('');
  const [apartB, setApartB] = useState('');
  const addApart = async () => {
    const a = Number(apartA);
    const b = Number(apartB);
    if (!uid || !classKey || !a || !b) return showToast('학생 두 명을 고르세요.');
    if (a === b) return showToast('서로 다른 학생을 고르세요.');
    const key = pairKey(a, b);
    if (hub.apart.includes(key)) return showToast('이미 있는 쌍입니다.');
    try {
      await setApartPair(uid, classKey, key, true);
      setApartA('');
      setApartB('');
    } catch (e) {
      showErrorToast('떨어뜨릴 학생을 저장하지 못했습니다.', e);
    }
  };
  const removeApart = async (key: string) => {
    if (!uid || !classKey) return;
    try {
      await setApartPair(uid, classKey, key, false);
    } catch (e) {
      showErrorToast('떨어뜨릴 학생을 빼지 못했습니다.', e);
    }
  };

  // ── 그리기 ──
  const unseated = chart ? unseatedNums(chart, active) : [];
  const warn = chart ? nearApartSeats(chart.seats, hub.apart) : new Set<string>();
  const order = chart ? displayOrder(chart) : { rows: [], cols: [] };
  const columnsTemplate = chart
    ? order.cols
        .flatMap((c, i) => {
          const next = order.cols[i + 1];
          const gap = next !== undefined && aisleAfter(Math.min(c, next), chart.cols, chart.groupCols);
          return gap ? ['minmax(0,1fr)', '14px'] : ['minmax(0,1fr)'];
        })
        .join(' ')
    : '';
  const selectedSeat = selected?.kind === 'seat' && chart ? selected.key : null;

  const renderSeat = (r: number, c: number) => {
    if (!chart) return null;
    const key = seatKey(r, c);
    const isOff = chart.off.includes(key);
    const isSelected = selectedSeat === key;
    if (isOff) {
      if (!editMode) return <div key={key} aria-hidden className="h-14" />;
      return (
        <button
          key={key}
          type="button"
          data-seat={key}
          data-seat-off
          onClick={() => tapSeat(key)}
          title="책상 없음"
          className={`h-14 rounded-lg border-2 border-dashed text-slate-300 text-xs ${
            isSelected ? 'border-primary bg-indigo-50' : 'border-slate-200'
          }`}
        >
          ✕
        </button>
      );
    }
    const num = chart.seats[key];
    const st = num !== undefined ? byNum.get(num) : undefined;
    const gone = num !== undefined && (!st || st.isActive === false);
    const locked = chart.locked.includes(key);
    const att = num !== undefined ? todayRecords[String(num)] : undefined;
    const focused = !editMode && num !== undefined && focusNum === num;
    const drawnNow = drawOn && num !== undefined && draw.shown === num;
    const drawn = drawOn && num !== undefined && drawnSet.has(num);
    const groupIndex = num !== undefined ? groupOf.get(num) : undefined;
    const gender = st?.gender === 'M' || st?.gender === '남' ? 'M' : st?.gender === 'F' || st?.gender === '여' ? 'F' : '';
    return (
      <button
        key={key}
        type="button"
        data-seat={key}
        data-seat-num={num ?? ''}
        data-seat-drawn-now={drawnNow && !draw.rolling ? '' : undefined}
        data-seat-group={groupIndex}
        draggable={num !== undefined}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', `seat:${key}`);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(e) => {
          e.preventDefault();
          dropOnSeat(e.dataTransfer.getData('text/plain'), key);
        }}
        onClick={() => tapSeat(key)}
        aria-pressed={!editMode && num !== undefined ? focused : undefined}
        title={
          num === undefined
            ? '빈 자리'
            : `${nameOf(num)}${!st ? ' (명렬표에 없는 번호)' : st.isActive === false ? ' (전출)' : ''}${locked ? ' · 고정' : ''}${
                att ? ` · 오늘 ${KIND_LABEL[att.kind]}` : ''
              }`
        }
        className={`relative h-14 min-w-0 rounded-lg border px-1 flex flex-col items-center justify-center transition-colors ${
          drawnNow
            ? 'border-amber-400 ring-4 ring-amber-300 bg-amber-100'
            : isSelected || focused
            ? 'border-primary ring-2 ring-primary/40 bg-indigo-50'
            : groupIndex !== undefined
            ? `${groupColor(groupIndex).seat} border-2`
            : warn.has(key)
              ? 'border-amber-400 bg-amber-50'
              : num === undefined
                ? 'border-slate-200 bg-slate-50/60 hover:bg-slate-100'
                : att
                  ? 'border-rose-300 bg-rose-50 hover:border-primary/50 cursor-grab'
                  : 'border-slate-200 bg-white hover:border-primary/50 cursor-grab'
        }`}
      >
        {num === undefined ? (
          <span className="text-2xs text-slate-300 font-bold">빈 자리</span>
        ) : (
          <>
            <span
              className={`text-2xs font-black leading-none ${
                gender === 'M' ? 'text-sky-600' : gender === 'F' ? 'text-rose-500' : 'text-slate-400'
              }`}
            >
              {num}
              {att && (
                <span className="ml-1 text-rose-600" data-seat-att={att.kind}>
                  {KIND_LABEL[att.kind]}
                </span>
              )}
            </span>
            <span
              className={`w-full truncate text-center text-sm font-black leading-tight ${
                gone ? 'text-slate-300 line-through' : 'text-slate-800'
              }`}
            >
              {st?.name || `${num}번`}
            </span>
          </>
        )}
        {locked && <span className="absolute top-0.5 right-1 text-2xs" aria-label="고정">🔒</span>}
        {warn.has(key) && <span className="absolute top-0.5 left-1 text-2xs" aria-label="떨어뜨릴 학생이 붙어 있음">⚠️</span>}
        {drawn && (
          <span className="absolute bottom-0.5 right-1 text-2xs font-black text-amber-600" aria-label="이번 판에 뽑힘" data-seat-drawn>
            ✓
          </span>
        )}
      </button>
    );
  };

  const desk = (
    <div className="mx-auto w-1/3 min-w-24 text-center text-2xs font-black bg-amber-100 text-amber-700 rounded-md py-1 select-none">
      교탁
    </div>
  );

  const seatActions = () => {
    if (!chart || !editMode) return null;
    if (selected?.kind === 'student') {
      return (
        <div className="flex items-center gap-2 text-xs" data-seat-actions>
          <span className="font-bold text-primary">{nameOf(selected.num)}</span>
          <span className="text-slate-500">- 앉힐 자리를 누르세요.</span>
          <button type="button" onClick={() => setSelected(null)} className="ml-auto px-2 py-1 rounded-lg bg-slate-100 font-bold">
            선택 풀기
          </button>
        </div>
      );
    }
    if (!selectedSeat) {
      return <p className="text-xs text-slate-500">자리를 누른 뒤 다른 자리를 누르면 바꿉니다. 자리를 하나 누르면 고정·비우기·책상 없음도 고릅니다.</p>;
    }
    const key = selectedSeat;
    const isOff = chart.off.includes(key);
    const num = chart.seats[key];
    const locked = chart.locked.includes(key);
    const btn = 'px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold';
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs" data-seat-actions>
        <span className="font-bold text-primary mr-1">{isOff ? '책상 없음' : num === undefined ? '빈 자리' : nameOf(num)}</span>
        {isOff ? (
          <button type="button" className={btn} onClick={() => { void save({ off: toggleKey(chart.off, key, false) }); setSelected(null); }}>
            책상 놓기
          </button>
        ) : (
          <>
            <button
              type="button"
              className={btn}
              onClick={() => {
                // 고른 채로 두면 다음에 누른 자리와 바뀐다 - 다른 단추처럼 고르기를 푼다
                void save({ locked: toggleKey(chart.locked, key, !locked) });
                setSelected(null);
              }}
            >
              {locked ? '🔓 고정 풀기' : '🔒 고정'}
            </button>
            {num !== undefined && (
              <button type="button" className={btn} onClick={() => { void saveSeats(clearSeat(chart.seats, key)); setSelected(null); }}>
                자리 비우기
              </button>
            )}
            <button
              type="button"
              className={btn}
              onClick={() => {
                void save({
                  seats: clearSeat(chart.seats, key),
                  off: toggleKey(chart.off, key, true),
                  locked: toggleKey(chart.locked, key, false),
                });
                setSelected(null);
              }}
            >
              책상 없애기
            </button>
          </>
        )}
        <button type="button" onClick={() => setSelected(null)} className="ml-auto px-2 py-1 rounded-lg text-slate-500 font-bold">
          선택 풀기
        </button>
      </div>
    );
  };

  const toolBtn = (on: boolean) =>
    `px-3 py-1.5 rounded-xl text-xs font-black transition-colors ${
      on ? 'bg-primary text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
    }`;

  const studentOptions = active.map((s) => (
    <option key={s.num} value={s.num}>
      {nameOf(Number(s.num))}
    </option>
  ));

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} width="2xl" title="🪑 자리표" footer={<ModalCloseButton onClose={onClose} />}>
      {!rosterLoading && rosterList.length === 0 ? (
        <p className="text-center text-slate-400 py-8 text-sm">
          명렬표가 없습니다. 학급 화면 → 🧑‍🤝‍🧑 명렬표에서 학급과 학생을 먼저 넣어 주세요.
        </p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={classKey || ''}
              onChange={(e) => chooseClass(e.target.value)}
              aria-label="학급"
              className="px-2 py-1.5 border border-slate-200 rounded-lg font-bold max-w-full text-xs"
            >
              {rosterList.map((c) => (
                <option key={classKeyOf(c)} value={classKeyOf(c)}>
                  {describeClass(c)}
                </option>
              ))}
            </select>
            {charts && charts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="자리표">
                {charts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={c.id === chart?.id}
                    onClick={() => chooseChart(c.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                      c.id === chart?.id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void createChart()}
                  disabled={busy}
                  className="px-2 py-1 rounded-lg text-xs font-bold text-primary hover:bg-indigo-50"
                >
                  + 새 자리표
                </button>
              </div>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPanel(groupsOn ? null : 'groups')}
                aria-pressed={groupsOn}
                disabled={!classKey}
                className={toolBtn(groupsOn)}
              >
                👥 모둠
              </button>
              <button
                type="button"
                onClick={() => setPanel(drawOn ? null : 'draw')}
                aria-pressed={drawOn}
                disabled={!classKey}
                className={toolBtn(drawOn)}
              >
                🎯 발표자 뽑기
              </button>
            </div>
          </div>

          {groupsOn && uid && classKey && cls && (
            <SeatGroupsPanel
              key={classKey}
              uid={uid}
              classKey={classKey}
              className={describeClass(cls)}
              sets={hub.groupSets}
              activeNums={activeNums}
              apart={hub.apart}
              chart={chart}
              nameOf={nameOf}
              onShown={setGroupsShown}
            />
          )}

          {drawOn && classKey && (
            <SeatDrawPanel
              shown={draw.shown}
              rolling={draw.rolling}
              status={draw.status}
              draw={hub.draw}
              nameFor={nameFor}
              onPick={draw.pick}
              onUndo={() => void draw.undo()}
              onNewRound={() => void draw.newRound()}
              onBig={() => setDrawBig(true)}
            />
          )}
          <DrawBigView
            isOpen={drawOn && drawBig}
            onClose={() => setDrawBig(false)}
            num={draw.shown}
            name={draw.shown !== null ? nameFor(draw.shown) : ''}
            rolling={draw.rolling}
            statusLine={drawStatusLine(hub.draw, draw.status)}
            onPick={draw.pick}
          />

          {loadFailed ? (
            <p className="text-center text-red-500 py-8 text-xs">자리표를 불러오지 못했습니다. 네트워크를 확인하고 다시 열어 주세요.</p>
          ) : !charts || !classKey ? (
            <p className="text-center text-slate-400 py-8 text-xs">불러오는 중…</p>
          ) : !chart ? (
            <div className="text-center py-8 flex flex-col items-center gap-3">
              <p className="text-slate-500 text-xs">이 학급의 자리표가 아직 없습니다. 번호 차례로 앉힌 자리표를 만들고, 끌어 바꾸거나 섞습니다.</p>
              <button
                type="button"
                onClick={() => void createChart()}
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-primary text-white font-black text-xs"
              >
                + 자리표 만들기
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => void shuffle()} disabled={busy} className={toolBtn(false)}>
                  🎲 섞기
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditMode(!editMode);
                    setSelected(null);
                    setFocusNum(null);
                  }}
                  aria-pressed={editMode}
                  className={toolBtn(editMode)}
                >
                  ✏️ 자리 고치기
                </button>
                <button type="button" onClick={() => setPanel(panel === 'shape' ? null : 'shape')} aria-pressed={panel === 'shape'} className={toolBtn(panel === 'shape')}>
                  ⚙️ 모양
                </button>
                <button type="button" onClick={() => setPanel(panel === 'apart' ? null : 'apart')} aria-pressed={panel === 'apart'} className={toolBtn(panel === 'apart')}>
                  🚫 떨어뜨릴 학생 {hub.apart.length > 0 && hub.apart.length}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                <span className="font-bold text-slate-400">섞을 때</span>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={shuffleOpts.avoidPast} onChange={(e) => setShuffleOpt('avoidPast', e.target.checked)} />
                  지난 짝 피하기
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={shuffleOpts.mixGender} onChange={(e) => setShuffleOpt('mixGender', e.target.checked)} />
                  남녀 짝
                </label>
                <span className="text-slate-400">🔒 고정 칸은 그대로</span>
              </div>

              {panel === 'shape' && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 flex flex-col gap-2 text-xs" data-seating-panel="shape">
                  <label className="flex items-center gap-2">
                    <span className="w-12 font-bold text-slate-500">이름</span>
                    <input
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onBlur={saveName}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          saveName();
                        }
                      }}
                      aria-label="자리표 이름"
                      className="flex-1 min-w-0 px-2 py-1 border border-slate-200 rounded-lg font-bold"
                    />
                  </label>
                  {([['줄', 'rows', MAX_ROWS], ['열', 'cols', MAX_COLS]] as const).map(([label, field, max]) => (
                    <div key={field} className="flex items-center gap-2">
                      <span className="w-12 font-bold text-slate-500">{label}</span>
                      <button
                        type="button"
                        aria-label={`${label} 줄이기`}
                        disabled={chart[field] <= 1}
                        onClick={() => resize(field === 'rows' ? chart.rows - 1 : chart.rows, field === 'cols' ? chart.cols - 1 : chart.cols)}
                        className="w-7 h-7 rounded-lg bg-white border border-slate-200 font-black disabled:opacity-40"
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-black" data-seating-size={field}>
                        {chart[field]}
                      </span>
                      <button
                        type="button"
                        aria-label={`${label} 늘리기`}
                        disabled={chart[field] >= max}
                        onClick={() => resize(field === 'rows' ? chart.rows + 1 : chart.rows, field === 'cols' ? chart.cols + 1 : chart.cols)}
                        className="w-7 h-7 rounded-lg bg-white border border-slate-200 font-black disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="w-12 font-bold text-slate-500">분단</span>
                    {GROUP_COL_CHOICES.map((g) => (
                      <button
                        key={g}
                        type="button"
                        aria-pressed={chart.groupCols === g}
                        onClick={() => void save({ groupCols: g })}
                        className={`px-2 py-1 rounded-lg font-bold ${chart.groupCols === g ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200'}`}
                      >
                        {GROUP_COL_LABEL[g]}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="w-12 font-bold text-slate-500">교탁</span>
                    {(['top', 'bottom'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        aria-pressed={chart.front === f}
                        onClick={() => void save({ front: f })}
                        className={`px-2 py-1 rounded-lg font-bold ${chart.front === f ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200'}`}
                      >
                        {f === 'top' ? '위 (학생 쪽에서)' : '아래 (교탁에서)'}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-200">
                    <button type="button" onClick={() => void resetToNumberOrder()} className="px-2 py-1 rounded-lg bg-white border border-slate-200 font-bold">
                      🔢 번호 차례로 앉히기
                    </button>
                    <button type="button" onClick={() => void deleteChart()} disabled={busy} className="ml-auto px-2 py-1 rounded-lg text-red-600 hover:bg-red-50 font-bold">
                      🗑️ 이 자리표 지우기
                    </button>
                  </div>
                </div>
              )}

              {panel === 'apart' && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 flex flex-col gap-2 text-xs" data-seating-panel="apart">
                  <p className="text-slate-500">섞을 때 앞뒤옆(대각선 포함)으로 붙여 앉히지 않습니다. 이 학급의 자리표 모두에 쓰입니다.</p>
                  {hub.apart.length === 0 ? (
                    <p className="text-slate-400">아직 없습니다.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {hub.apart.map((key) => {
                        const pair = parsePairKey(key);
                        if (!pair) return null;
                        return (
                          <span key={key} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-white border border-slate-200 font-bold" data-apart={key}>
                            {nameOf(pair[0])} ↔ {nameOf(pair[1])}
                            <button type="button" onClick={() => void removeApart(key)} aria-label={`${key} 빼기`} className="w-5 h-5 rounded-full hover:bg-slate-100 text-slate-400">
                              ✕
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select value={apartA} onChange={(e) => setApartA(e.target.value)} aria-label="떨어뜨릴 학생 1" className="px-2 py-1 border border-slate-200 rounded-lg">
                      <option value="">학생</option>
                      {studentOptions}
                    </select>
                    <span>↔</span>
                    <select value={apartB} onChange={(e) => setApartB(e.target.value)} aria-label="떨어뜨릴 학생 2" className="px-2 py-1 border border-slate-200 rounded-lg">
                      <option value="">학생</option>
                      {studentOptions}
                    </select>
                    <button type="button" onClick={() => void addApart()} className="px-2.5 py-1 rounded-lg bg-slate-800 text-white font-bold">
                      ＋ 더하기
                    </button>
                  </div>
                </div>
              )}

              {editMode && <div className="rounded-lg bg-indigo-50/60 px-3 py-2">{seatActions()}</div>}
              {warn.size > 0 && (
                <p className="text-xs text-amber-700 font-bold">⚠️ 떨어뜨릴 학생이 붙어 앉아 있습니다. 섞거나 끌어서 떼어 주세요.</p>
              )}
              {!editMode && uid && cls && focusStudent && (
                <SeatStudentCard
                  key={`${classKey}:${focusStudent.num}`}
                  uid={uid}
                  cls={cls}
                  student={focusStudent}
                  date={today}
                  record={todayRecords[String(focusStudent.num)]}
                  maxPeriods={maxPeriods}
                  onClose={() => setFocusNum(null)}
                  onOpenRecord={() => classKey && onOpenStudentRecord?.(classKey, Number(focusStudent.num))}
                  onOpenAttendance={() => classKey && onOpenAttendance?.(classKey, today)}
                />
              )}

              <div className="flex flex-col gap-1.5 mx-auto w-full max-w-[560px]" data-seating-grid data-front={chart.front}>
                {chart.front === 'top' && desk}
                {order.rows.map((r) => (
                  <div key={r} className="grid gap-1" style={{ gridTemplateColumns: columnsTemplate }}>
                    {order.cols.flatMap((c, i) => {
                      const next = order.cols[i + 1];
                      const cell = renderSeat(r, c);
                      return next !== undefined && aisleAfter(Math.min(c, next), chart.cols, chart.groupCols)
                        ? [cell, <div key={`aisle-${r}-${c}`} aria-hidden />]
                        : [cell];
                    })}
                  </div>
                ))}
                {chart.front === 'bottom' && desk}
              </div>

              <div
                className="rounded-xl border border-dashed border-slate-200 p-2 min-h-12"
                data-unseated
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOnUnseated(e.dataTransfer.getData('text/plain'));
                }}
              >
                <div className="text-2xs font-black text-slate-400 mb-1">
                  자리 없는 학생 {unseated.length}명 <span className="font-bold">· 자리를 여기로 끌면 비웁니다</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {unseated.map((n) => (
                    <button
                      key={n}
                      type="button"
                      draggable
                      data-unseated-num={n}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', `student:${n}`);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onClick={() => tapUnseated(n)}
                      data-seat-drawn-now={drawOn && !draw.rolling && draw.shown === n ? '' : undefined}
                      data-seat-group={groupOf.get(n)}
                      className={`px-2 py-1 rounded-lg text-xs font-bold border cursor-grab ${
                        drawOn && draw.shown === n
                          ? 'border-amber-400 ring-2 ring-amber-300 bg-amber-100 text-slate-800'
                          : (selected?.kind === 'student' && selected.num === n) || (!editMode && focusNum === n)
                            ? 'border-primary bg-indigo-50 text-primary'
                            : groupOf.has(n)
                              ? `${groupColor(groupOf.get(n)!).seat} text-slate-700`
                              : 'border-slate-200 bg-white text-slate-700'
                      }`}
                    >
                      {drawOn && drawnSet.has(n) && <span className="mr-1 text-amber-600" data-seat-drawn>✓</span>}
                      {nameOf(n)}
                      {todayRecords[String(n)] && <span className="ml-1 text-rose-600">{KIND_LABEL[todayRecords[String(n)].kind]}</span>}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-2xs text-slate-400">
                재학 {active.length}명 · 번호 색 <span className="text-sky-600 font-bold">남</span>/<span className="text-rose-500 font-bold">여</span>
                {' '}· 전출한 학생은 회색으로 남고 섞을 때 빠집니다. 학생 자리를 누르면 오늘 출결·조사표·관찰 한 줄을 적습니다.
              </p>
            </>
          )}
        </div>
      )}
    </ModalShell>
  );
}
