import React, { useState, useEffect, useCallback } from 'react';
import { useEvaluation } from '../hooks/useEvaluation';
import type { EvaluationItem } from '../hooks/useEvaluation';
import { useRoster } from '../hooks/useRoster';
import { useTimetableTemplate } from '../hooks/useTimetableTemplate';
import { useAppStore } from '../store/useAppStore';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer, closeAllModals } from '../hooks/useModalLayer';
import { useBackdropClose } from '../hooks/useBackdropClose';
import { showToast, showErrorToast } from '../utils/toast';
import { auth } from '../lib/firebase';

interface EvaluationModalProps {
  isOpen: boolean;
  onClose: () => void;
  dateStr: string;
  defaultSource?: string;
  defaultPeriod?: number | string;
  defaultSubject?: string;
}

const SUBJECTS = ['국어','도덕','사회','수학','과학','실과','체육','음악','미술','영어','창체'];
const DEFAULT_STEPS = ['우수', '보통', '노력요함', '미흡', '매우미흡'];

export default function EvaluationModal({ isOpen, onClose, dateStr, defaultSource = 'schedule', defaultPeriod = 1, defaultSubject = '' }: EvaluationModalProps) {
  useBodyScrollLock(isOpen);

  const vv = useVisualViewport(isOpen);

  const zIndex = useModalLayer(isOpen, onClose);

  const backdrop = useBackdropClose();
  const { selectedGroupId, openEvaluationModal } = useAppStore();
  const { templates, currentTemplateName } = useTimetableTemplate();
  const periodNames = templates[currentTemplateName]?.names || ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시'];
  const { loadEvaluations, saveEvaluations, deleteEvaluation } = useEvaluation(selectedGroupId);
  const { rosterList: rosters } = useRoster();

  // 모드: 'create' | 'view'
  // 그날 조사표를 모두 늘어놓는 목록 화면은 두지 않는다. 어느 교시의 표식을
  // 눌러서 들어왔는지가 이미 답이라, 다시 고르게 하면 그것이 없던 일이 된다.
  const [viewMode, setViewMode] = useState<'create' | 'view'>('create');
  const [evalList, setEvalList] = useState<EvaluationItem[]>([]);
  const [currentEval, setCurrentEval] = useState<EvaluationItem | null>(null);
  const [loading, setLoading] = useState(false);

  // 생성 폼 상태
  const [title, setTitle] = useState('');
  const [evalType, setEvalType] = useState<'eval' | 'check' | 'memo'>('eval');
  const [subject, setSubject] = useState(defaultSubject);
  const [evalDate, setEvalDate] = useState(dateStr);
  const [period, setPeriod] = useState<string>(String(defaultPeriod));
  const [rosterIdx, setRosterIdx] = useState('0');
  const [useIndiv, setUseIndiv] = useState(true);
  const [useGroup, setUseGroup] = useState(false);
  const [groupCount, setGroupCount] = useState(4);
  const [stepCount, setStepCount] = useState(3);
  const [stepNames, setStepNames] = useState<string[]>(DEFAULT_STEPS.slice(0, 3));

  // 뷰어 상태
  const [records, setRecords] = useState<Record<number, Record<string, any>>>({});

  // ⚙️ 기본 정보 수정 패널. V3와 같이 접어 두었다가 눌러서 편다.
  const [metaOpen, setMetaOpen] = useState(false);
  const [metaTitle, setMetaTitle] = useState('');
  const [metaRosterIdx, setMetaRosterIdx] = useState('');
  const [metaDate, setMetaDate] = useState('');
  const [metaPeriod, setMetaPeriod] = useState('');
  const [metaSubject, setMetaSubject] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadList();
      setEvalDate(dateStr);
      setPeriod(String(defaultPeriod));
      setSubject(defaultSubject);
    }
  }, [isOpen, dateStr]);

  // 명렬표는 구독으로 들어와서, 조사표를 열 때 아직 비어 있을 수 있다. 그때는
  // 맞출 것이 없어 그냥 지나가므로, 명렬표가 도착하면 한 번 더 맞춘다.
  // 맞출 것이 없으면 아무 일도 하지 않아 여기서 멈춘다.
  useEffect(() => {
    if (viewMode !== 'view' || !currentEval || rosters.length === 0) return;
    const { next, changed } = syncSnapshotWithRoster(currentEval);
    if (!changed) return;

    setCurrentEval(next);
    const updatedList = evalList.map((e) => (e.id === next.id ? next : e));
    setEvalList(updatedList);
    saveEvaluations(next.dateStr, updatedList).catch((e) =>
      console.error('명렬표 동기화 저장 실패:', e)
    );
  }, [rosters, viewMode, currentEval?.id]);

  /**
   * 내가 고쳐도 되는 조사표인지. (V3 evaluation.js의 isAuthor와 같다)
   *
   * 개인 공간에서는 늘 내 것이다. 공유 공간에서는 만든 사람만 고칠 수 있다.
   * 만든 사람이 적혀 있지 않은 옛 조사표는 막지 않는다. 그것까지 잠그면
   * 예전에 만든 것을 아무도 못 고치게 된다.
   */
  const isSharedScope = !!selectedGroupId && selectedGroupId !== 'personal';
  const canEdit =
    !isSharedScope || !currentEval?.authorId || currentEval.authorId === auth.currentUser?.uid;

  /** 조사표가 어느 교시(또는 기록 칸)에 달려 있는지 */
  const locationOf = (ev: EvaluationItem) =>
    ev.context?.source === 'journal' ? 'journal' : String(ev.periodStr ?? '');

  /** 이 팝업이 맡고 있는 자리. 표식을 누른 그 교시(또는 기록 칸)다. */
  const wantedLocation = defaultSource === 'journal' ? 'journal' : String(defaultPeriod ?? '');
  const locationLabel =
    wantedLocation === 'journal'
      ? '기록'
      : periodNames[Number(wantedLocation) - 1] || `${wantedLocation}교시`;
  const evalsHere = evalList.filter((ev) => locationOf(ev) === wantedLocation);

  const loadList = async () => {
    setLoading(true);
    const list = await loadEvaluations(dateStr);
    setEvalList(list);
    setLoading(false);

    if (list.length === 0) {
      setViewMode('create');
      return;
    }

    // 2교시 표식을 눌렀으면 2교시 조사표가 바로 뜬다. 여럿이면 첫 번째를 열고,
    // 나머지는 위쪽 줄에서 눌러 옮겨 간다.
    const here = list.filter((ev) => locationOf(ev) === wantedLocation);
    if (here.length > 0) {
      await openViewer(here[0], list);
      return;
    }
    setViewMode('create');
  };

  const handleCreate = async () => {
    if (!title.trim()) return showToast('제목을 입력하세요.');
    if (!rosters || rosters.length === 0) return showErrorToast('명렬표를 먼저 등록해주세요.');
    const selectedRoster = rosters[parseInt(rosterIdx, 10)];
    if (!selectedRoster) return showErrorToast('명렬표를 선택해주세요.');

    const activeStudents = (selectedRoster.students || []).filter((s: any) => s.isActive !== false);
    const studentsSnapshot = activeStudents.map((s: any) => ({ num: s.num, name: s.name, gender: s.gender || '' }));

    let steps: string[] = [];
    let groups: { name: string; members: number[] }[] = [];

    if (evalType === 'eval') {
      steps = stepNames.filter(s => s.trim());
      if (useGroup) {
        const totalStudents = activeStudents.length;
        let currentIdx = 0;
        for (let i = 0; i < groupCount; i++) {
          const gName = String.fromCharCode(65 + i) + '조';
          const groupSize = Math.floor(totalStudents / groupCount) + (i < (totalStudents % groupCount) ? 1 : 0);
          const members: number[] = [];
          for (let j = 0; j < groupSize; j++) {
            if (currentIdx < totalStudents) members.push(activeStudents[currentIdx++].num);
          }
          groups.push({ name: gName, members });
        }
      }
    }

    const newEval: EvaluationItem = {
      id: 'eval_' + Date.now().toString(36),
      // 누가 만든 것인지 적어 둔다. 공유 공간에서 남의 조사표를 고치지
      // 못하게 하려면 이것이 있어야 한다. (V3도 같이 적는다)
      authorId: auth.currentUser?.uid,
      title: title.trim(),
      subject,
      type: evalType,
      methodObj: { indiv: useIndiv, group: useGroup },
      steps,
      groups,
      dateStr: evalDate,
      periodStr: period === 'journal' ? '' : parseInt(period, 10),
      context: { source: period === 'journal' ? 'journal' : 'schedule', period: period === 'journal' ? '' : parseInt(period, 10) },
      rosterMeta: { year: selectedRoster.year, grade: selectedRoster.grade, classNum: selectedRoster.classNum },
      studentsSnapshot: studentsSnapshot as { num: number; name: string; gender: string }[],
      records: {}
    };

    const updatedList = [...evalList, newEval];
    await saveEvaluations(evalDate, updatedList);
    setEvalList(updatedList);
    setTitle('');
    void openViewer(newEval);
  };

  /**
   * 조사표를 열 때 명렬표를 다시 맞춘다. (V3 evaluation.js의 openViewer와 같다)
   *
   * 조사표는 만들 때의 명단을 복사해 들고 있다. 그 뒤에 전입한 학생은 명단에
   * 없어 점수를 줄 수가 없었고, 이름을 고쳐도 옛 이름이 그대로 남았다.
   * 열 때마다 지금 명렬표와 맞춰 두면 그 자리에서 해결된다.
   *
   * 전출한 학생은 지우지 않는다. 그때 준 점수가 함께 사라지기 때문이다.
   * 이름 뒤에 '(전출/삭제됨)'을 붙여 두어 흐리게 보이게만 한다.
   */
  const syncSnapshotWithRoster = (ev: EvaluationItem): { next: EvaluationItem; changed: boolean } => {
    if (!ev.rosterMeta || rosters.length === 0) return { next: ev, changed: false };

    const matched = rosters.find(
      (r) =>
        String(r.year) === String(ev.rosterMeta.year) &&
        String(r.grade) === String(ev.rosterMeta.grade) &&
        String(r.classNum) === String(ev.rosterMeta.classNum)
    );
    if (!matched) return { next: ev, changed: false };

    const snapshot = (ev.studentsSnapshot || []).map((s) => ({ ...s }));
    const current = matched.students || [];
    let changed = false;

    // 1. 새로 온 학생을 더하고, 바뀐 이름을 반영한다
    for (const st of current) {
      if (st.isActive === false) continue;
      const existing = snapshot.find((s) => s.num === st.num);
      if (!existing) {
        snapshot.push({ num: st.num, name: st.name, gender: st.gender || '' });
        changed = true;
      } else if (existing.name !== st.name) {
        existing.name = st.name;
        changed = true;
      }
    }

    // 2. 명단에서 사라졌거나 전출한 학생에 표를 달아 둔다
    for (const snapSt of snapshot) {
      const stillHere = current.find((s) => s.num === snapSt.num && s.name === snapSt.name && s.isActive !== false);
      if (!stillHere && !snapSt.name.includes('(전출/삭제됨)')) {
        snapSt.name = `${snapSt.name} (전출/삭제됨)`;
        changed = true;
      }
    }

    if (!changed) return { next: ev, changed: false };
    snapshot.sort((a, b) => a.num - b.num);
    return { next: { ...ev, studentsSnapshot: snapshot }, changed: true };
  };

  /**
   * `list`는 아직 state에 들어가지 않은 목록을 넘길 때 쓴다. 불러오자마자 바로
   * 열 때는 setEvalList가 반영되기 전이라, 그 목록을 직접 받아야 한다.
   */
  const openViewer = async (ev: EvaluationItem, list?: EvaluationItem[]) => {
    const source = list ?? evalList;
    const { next, changed } = syncSnapshotWithRoster(ev);

    if (changed) {
      const updatedList = source.map((e) => (e.id === next.id ? next : e));
      setEvalList(updatedList);
      try {
        await saveEvaluations(next.dateStr, updatedList);
      } catch (e) {
        console.error('명렬표 동기화 저장 실패:', e);
      }
    }

    setCurrentEval(next);
    setRecords(next.records || {});
    // 기본 정보 칸을 지금 값으로 채운다
    setMetaTitle(next.title || '');
    setMetaDate(next.dateStr || dateStr);
    setMetaPeriod(next.context?.source === 'journal' ? 'journal' : String(next.periodStr ?? ''));
    setMetaSubject(next.subject || '');
    setMetaRosterIdx(
      String(
        rosters.findIndex(
          (r) =>
            String(r.year) === String(next.rosterMeta?.year) &&
            String(r.grade) === String(next.rosterMeta?.grade) &&
            String(r.classNum) === String(next.rosterMeta?.classNum)
        )
      )
    );
    setMetaOpen(false);
    setViewMode('view');
  };

  /**
   * 제목·학급·날짜·위치·교과를 고친다. (V3의 saveMetaData와 같다)
   *
   * 위치나 날짜가 바뀌면 조사표가 다른 자리로 옮겨 간다. 옛 날짜 문서에서 빼고
   * 새 날짜 문서에 넣는 두 번의 저장이 필요하다.
   */
  const handleSaveMeta = async () => {
    if (!currentEval) return;
    if (!metaTitle.trim()) return showErrorToast('제목을 입력하세요.');

    const idx = parseInt(metaRosterIdx, 10);
    const selectedRoster = rosters[idx];
    if (!selectedRoster) return showErrorToast('대상 학급을 선택해 주세요.');

    let next: EvaluationItem = { ...currentEval, title: metaTitle.trim(), subject: metaSubject };

    const rosterChanged =
      !currentEval.rosterMeta ||
      String(currentEval.rosterMeta.year) !== String(selectedRoster.year) ||
      String(currentEval.rosterMeta.grade) !== String(selectedRoster.grade) ||
      String(currentEval.rosterMeta.classNum) !== String(selectedRoster.classNum);

    if (rosterChanged) {
      if (!confirm('대상 학급을 바꾸면 새 학급의 학생 명단으로 갈아 끼웁니다.\n지금까지 적은 결과는 남지만 학생이 달라집니다.\n정말 바꾸시겠습니까?')) {
        return;
      }
      next.rosterMeta = { year: selectedRoster.year, grade: selectedRoster.grade, classNum: selectedRoster.classNum };
      next.studentsSnapshot = (selectedRoster.students || [])
        .filter((s) => s.isActive !== false)
        .map((s) => ({ num: s.num, name: s.name, gender: s.gender || '' }));
    }

    const oldPeriodVal = currentEval.context?.source === 'journal' ? 'journal' : String(currentEval.periodStr ?? '');
    const moved = currentEval.dateStr !== metaDate || oldPeriodVal !== metaPeriod;

    next.dateStr = metaDate;
    next.periodStr = metaPeriod === 'journal' ? '' : parseInt(metaPeriod, 10);
    next.context = {
      source: metaPeriod === 'journal' ? 'journal' : 'schedule',
      period: metaPeriod === 'journal' ? '' : parseInt(metaPeriod, 10),
    };

    try {
      if (moved && currentEval.dateStr !== metaDate) {
        // 옛 날짜에서 빼고
        const remaining = evalList.filter((e) => e.id !== currentEval.id);
        await saveEvaluations(currentEval.dateStr, remaining);
        // 새 날짜에 넣는다
        const targetList = await loadEvaluations(metaDate);
        await saveEvaluations(metaDate, [...targetList.filter((e) => e.id !== next.id), next]);

        setCurrentEval(next);
        showToast('✅ 조사표를 옮겼습니다.');
        // 팝업이 보고 있는 날짜를 새 날짜로 돌린다
        openEvaluationModal(metaDate, next.context.source as 'schedule' | 'journal', next.periodStr as number);
        return;
      }

      const updatedList = evalList.map((e) => (e.id === next.id ? next : e));
      await saveEvaluations(next.dateStr, updatedList);
      setEvalList(updatedList);
      setCurrentEval(next);
      showToast(moved ? '✅ 위치와 기본 정보를 바꿨습니다.' : '✅ 기본 정보를 바꿨습니다.');
    } catch (e) {
      showErrorToast('기본 정보를 저장하지 못했습니다.', e);
    }
  };

  const handleSaveRecords = async () => {
    if (!currentEval) return;
    const updatedEval = { ...currentEval, records };
    const updatedList = evalList.map(e => e.id === currentEval.id ? updatedEval : e);
    await saveEvaluations(currentEval.dateStr, updatedList);
    setEvalList(updatedList);
    setCurrentEval(updatedEval);
    showToast('✅ 조사표를 저장했습니다.');
  };

  const handleDelete = async () => {
    if (!currentEval) return;
    const remaining = await deleteEvaluation(currentEval.dateStr, currentEval.id);
    setEvalList(remaining);
    showToast('🗑️ 조사표를 삭제했습니다. 휴지통에서 복원할 수 있습니다.');

    // 같은 자리에 남은 것이 있으면 그것을 열고, 없으면 새로 만드는 칸을 연다.
    const left = remaining.filter((ev) => locationOf(ev) === wantedLocation);
    if (left.length > 0) {
      await openViewer(left[0], remaining);
      return;
    }
    setCurrentEval(null);
    setViewMode('create');
  };

  const updateRecord = (sNum: number, field: string, value: any) => {
    setRecords(prev => ({
      ...prev,
      [sNum]: { ...(prev[sNum] || {}), [field]: value }
    }));
  };

  const applyToAll = (field: string, value: any) => {
    if (!currentEval) return;
    const updated = { ...records };
    currentEval.studentsSnapshot.forEach(st => {
      if (!updated[st.num]) updated[st.num] = {};
      updated[st.num][field] = value;
    });
    setRecords(updated);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto p-4 bg-black/40 backdrop-blur-sm animate-fade-in" style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }} {...backdrop}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-full flex flex-col border border-slate-200" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-black text-slate-800">📋 조사표</h3>
            {/* 어느 날 어느 자리의 조사표인지 머리에 적는다 */}
            <span className="text-xs text-slate-400">{dateStr} · {locationLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            {viewMode !== 'create' && (
              <button onClick={() => setViewMode('create')} className="px-3 py-1 bg-primary text-white rounded-lg text-xs font-bold">+ 새 조사표</button>
            )}
            <button
            title="닫기" onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
          </div>
        </div>

        {/* 한 자리에 조사표가 여럿일 때만 나오는 줄. 그날 조사표를 모두
            늘어놓던 목록 화면을 대신한다. 어디를 눌러서 들어왔는지가
            남아 있어야, 고르는 수고가 한 번으로 끝난다. */}
        {viewMode === 'view' && evalsHere.length > 1 && (
          <div className="flex items-center gap-1 px-6 py-2 border-b border-slate-100 bg-slate-50 overflow-x-auto">
            <span className="text-xs font-bold text-slate-500 shrink-0 mr-1">{locationLabel}</span>
            {evalsHere.map((ev) => (
              <button
                key={ev.id}
                onClick={() => void openViewer(ev)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold shrink-0 transition-colors ${
                  ev.id === currentEval?.id
                    ? 'bg-primary text-white'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {ev.title}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-4" data-scroll-lock>
          {loading && <p className="text-center text-slate-400 text-xs py-8">불러오는 중...</p>}

          {/* 생성 모드 */}
          {viewMode === 'create' && (
            <div className="space-y-4">
              {/* 명렬표 선택 */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">적용할 명렬표</label>
                <select value={rosterIdx} onChange={e => setRosterIdx(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none">
                  {rosters && rosters.length > 0 ? rosters.map((r: any, i: number) => (
                    <option key={i} value={i}>{r.year}학년도 {r.grade}학년 {r.classNum}반 ({(r.students || []).length}명)</option>
                  )) : (
                    <option value="">등록된 명렬표 없음</option>
                  )}
                </select>
              </div>

              {/* 제목 */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">조사표 제목</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 1단원 평가, 준비물 체크" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none" />
              </div>

              {/* 유형 */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">유형 선택</label>
                <div className="flex gap-4 bg-slate-50 p-3 rounded-lg">
                  {(['eval', 'check', 'memo'] as const).map(t => (
                    <label key={t} className="flex items-center gap-1.5 text-xs font-bold cursor-pointer">
                      <input type="radio" name="eval-type" checked={evalType === t} onChange={() => setEvalType(t)} className="accent-primary" />
                      {t === 'eval' ? '평가' : t === 'check' ? '체크(O/X)' : '메모'}
                    </label>
                  ))}
                </div>
              </div>

              {/* 교과/날짜/위치 */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">교과</label>
                  <select value={subject} onChange={e => setSubject(e.target.value)} className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none">
                    <option value="">선택 안함</option>
                    {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">날짜</label>
                  <input type="date" value={evalDate} onChange={e => setEvalDate(e.target.value)} className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">위치</label>
                  <select value={period} onChange={e => setPeriod(e.target.value)} className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none">
                    {[1,2,3,4,5,6].map(p => <option key={p} value={String(p)}>{p}교시</option>)}
                    <option value="journal">기록 (오늘 기록 칸)</option>
                  </select>
                </div>
              </div>

              {/* 평가 세부설정 */}
              {evalType === 'eval' && (
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-3">
                  <div className="flex gap-4">
                    <label className="flex items-center gap-1.5 text-xs font-bold cursor-pointer">
                      <input type="checkbox" checked={useIndiv} onChange={e => setUseIndiv(e.target.checked)} className="accent-primary" /> 개인 평가
                    </label>
                    <label className="flex items-center gap-1.5 text-xs font-bold cursor-pointer">
                      <input type="checkbox" checked={useGroup} onChange={e => setUseGroup(e.target.checked)} className="accent-primary" /> 조별 평가
                    </label>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-1">평가 단계 수: {stepCount}단계</label>
                    <select value={stepCount} onChange={e => { const c = parseInt(e.target.value); setStepCount(c); setStepNames(DEFAULT_STEPS.slice(0, c)); }} className="px-2 py-1 border border-slate-200 rounded text-xs">
                      {[2,3,4,5].map(n => <option key={n} value={n}>{n}단계</option>)}
                    </select>
                    <div className="flex gap-2 mt-2">
                      {stepNames.map((s, i) => (
                        <input key={i} value={s} onChange={e => { const u = [...stepNames]; u[i] = e.target.value; setStepNames(u); }} className="px-2 py-1 border border-slate-200 rounded text-xs flex-1" />
                      ))}
                    </div>
                  </div>
                  {useGroup && (
                    <div>
                      <label className="text-xs font-bold text-slate-500 block mb-1">조 갯수: {groupCount}조</label>
                      <input type="number" value={groupCount} min={1} max={20} onChange={e => setGroupCount(parseInt(e.target.value) || 4)} className="px-2 py-1 border border-slate-200 rounded text-xs w-16" />
                    </div>
                  )}
                </div>
              )}

              <button onClick={handleCreate} className="w-full py-2.5 bg-primary text-white rounded-xl font-bold text-sm shadow-xs hover:bg-primary/90 transition-all">생성</button>
            </div>
          )}

          {/* 뷰어 모드 */}
          {viewMode === 'view' && currentEval && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h4 className="font-black text-slate-800">
                    {currentEval.title}
                    {isSharedScope && (
                      <span className="ml-1.5 text-xs font-bold text-slate-400">
                        {canEdit ? '(공유됨)' : '(공유됨 - 읽기전용)'}
                      </span>
                    )}
                  </h4>
                  <p className="text-xs text-slate-400">
                    {/* 어느 학급 것인지가 제일 먼저 보여야 한다. 같은 제목의
                        조사표를 학급마다 만드는 일이 흔하다. */}
                    {currentEval.rosterMeta?.year
                      ? `${currentEval.rosterMeta.year}학년도 ${currentEval.rosterMeta.grade}학년 ${currentEval.rosterMeta.classNum}반 · `
                      : ''}
                    {currentEval.type === 'eval' ? '평가' : currentEval.type === 'check' ? '체크' : '메모'}
                    {currentEval.subject ? ` · ${currentEval.subject}` : ''} ·{' '}
                    {currentEval.context?.source === 'journal'
                      ? '기록'
                      : periodNames[Number(currentEval.periodStr) - 1] || `${currentEval.periodStr}교시`}
                    {' · '}
                    {currentEval.studentsSnapshot.length}명
                  </p>
                </div>
              </div>

              {/* ⚙️ 기본 정보 수정 (V3와 같이 접어 두었다가 눌러서 편다).
                  남의 조사표는 고칠 수 없으므로 아예 내보내지 않는다. */}
              <div className={`mb-3 border border-slate-300 rounded-xl bg-slate-50 p-3 ${canEdit ? '' : 'hidden'}`}>
                <button
                  type="button"
                  onClick={() => setMetaOpen((v) => !v)}
                  className="w-full flex items-center justify-between cursor-pointer"
                >
                  <span className="font-bold text-blue-800 text-xs">⚙️ 기본 정보 수정</span>
                  <span className="text-slate-500 text-xs">{metaOpen ? '▲ 접기' : '▼ 펼치기'}</span>
                </button>

                {metaOpen && (
                  <div className="flex flex-col gap-2.5 mt-3 pt-3 border-t border-dashed border-slate-300">
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <div className="flex-1">
                        <label className="block text-xs font-bold text-slate-600 mb-1">조사표 제목</label>
                        <input
                          type="text"
                          value={metaTitle}
                          onChange={(e) => setMetaTitle(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-bold text-slate-600 mb-1">대상 학급(명렬표)</label>
                        <select
                          value={metaRosterIdx}
                          onChange={(e) => setMetaRosterIdx(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                        >
                          <option value="-1">명렬표 선택</option>
                          {rosters.map((r, i) => (
                            <option key={i} value={i}>
                              {r.year}학년도 {r.grade}학년 {r.classNum}반 ({(r.students || []).length}명)
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <div className="flex-1">
                        <label className="block text-xs font-bold text-slate-600 mb-1">날짜</label>
                        <input
                          type="date"
                          value={metaDate}
                          onChange={(e) => setMetaDate(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-bold text-slate-600 mb-1">위치</label>
                        <select
                          value={metaPeriod}
                          onChange={(e) => setMetaPeriod(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                        >
                          {periodNames.map((name, i) => (
                            <option key={i} value={String(i + 1)}>
                              {name || `${i + 1}교시`}
                            </option>
                          ))}
                          <option value="journal">기록 (오늘 기록 칸)</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-bold text-slate-600 mb-1">교과</label>
                        <select
                          value={metaSubject}
                          onChange={(e) => setMetaSubject(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                        >
                          <option value="">선택 안함</option>
                          {SUBJECTS.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="text-right">
                      <button
                        type="button"
                        onClick={handleSaveMeta}
                        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors"
                      >
                        정보 업데이트
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="max-h-[60vh] overflow-x-auto overflow-y-auto">
                  {/* 칸 차례와 이름은 V3와 같게 둔다. 같은 표를 두 앱에서 보고,
                      구글 시트로 내보낸 표의 머리말도 이것과 짝이 맞는다. */}
                  <table className="w-full text-xs border-collapse text-center">
                    <thead className="bg-slate-100 sticky top-0 z-10">
                      <tr>
                        <th className="p-2 text-center w-11 border-b-2 border-slate-300 font-normal text-slate-700">번호</th>
                        <th className="p-2 text-center w-20 border-b-2 border-slate-300 font-normal text-slate-700">이름</th>
                        {currentEval.type === 'eval' && currentEval.methodObj.group && (
                          <>
                            <th className="p-2 text-center border-b-2 border-slate-300 font-normal text-slate-700">조이름</th>
                            <th className="p-2 text-center border-b-2 border-slate-300 font-normal text-slate-700">조별 결과</th>
                          </>
                        )}
                        {currentEval.type === 'eval' && currentEval.methodObj.indiv && (
                          <th className="p-2 text-center border-b-2 border-slate-300 font-normal text-slate-700">개별 결과</th>
                        )}
                        {currentEval.type === 'check' && (
                          <th className="p-2 text-center border-b-2 border-slate-300 font-normal text-slate-700">체크(O/X)</th>
                        )}
                        <th className="p-2 text-center border-b-2 border-slate-300 font-normal text-slate-700">
                          {currentEval.type === 'memo' ? '개별 메모내용' : '사유 / 메모'}
                        </th>
                      </tr>
                      {/* 전체 일괄 적용 행. 남의 조사표에서는 내보내지 않는다. */}
                      <tr className={`bg-slate-50 border-b-2 border-slate-300 ${canEdit ? '' : 'hidden'}`}>
                        <td colSpan={2} className="p-1.5 text-center text-slate-500 font-bold">전체 일괄 적용</td>
                        {currentEval.type === 'eval' && currentEval.methodObj.group && (
                          <>
                            <td className="p-1"><input className="w-full px-1 py-0.5 border rounded text-center text-xs" placeholder="조" onChange={e => applyToAll('groupName', e.target.value)} /></td>
                            <td className="p-1">
                              <select className="w-full border rounded text-xs py-0.5" onChange={e => applyToAll('groupScore', e.target.value)}>
                                <option value="">선택</option>
                                {currentEval.steps.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </td>
                          </>
                        )}
                        {currentEval.type === 'eval' && currentEval.methodObj.indiv && (
                          <td className="p-1">
                            <select className="w-full border rounded text-xs py-0.5" onChange={e => applyToAll('indivScore', e.target.value)}>
                              <option value="">선택</option>
                              {currentEval.steps.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                        )}
                        {currentEval.type === 'check' && (
                          <td className="p-1 text-center">
                            <button onClick={() => applyToAll('checked', true)} className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-bold mr-1">전체 O</button>
                            <button onClick={() => applyToAll('checked', false)} className="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-xs font-bold">전체 X</button>
                          </td>
                        )}
                        <td className="p-1">
                          <input className="w-full px-1 py-0.5 border rounded text-xs" placeholder="일괄입력" onChange={e => applyToAll(currentEval.type === 'memo' ? 'memo' : 'reason', e.target.value)} />
                        </td>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {currentEval.studentsSnapshot.map(st => {
                        const rec = records[st.num] || {};
                        const isExited = st.name.includes('(전출');
                        // 조를 나눠 두었으면 조 이름을 미리 채워 준다. 조마다
                        // 손으로 다시 적게 하면 나눠 둔 것이 쓸모가 없다.
                        const assignedGroup = currentEval.groups?.find((g) => g.members?.includes(st.num));
                        const lockCls = canEdit ? '' : 'bg-slate-100 text-slate-400 cursor-not-allowed';
                        return (
                          <tr key={st.num} className={isExited ? 'bg-slate-50 opacity-50' : 'hover:bg-slate-50'}>
                            <td className="p-1.5 text-center font-bold text-slate-500 bg-slate-50/70">{st.num}</td>
                            <td className={`p-1.5 font-bold ${isExited ? 'text-slate-400' : 'text-slate-800'}`}>{st.name}</td>
                            {currentEval.type === 'eval' && currentEval.methodObj.group && (
                              <>
                                <td className="p-1">
                                  <input
                                    value={rec.groupName ?? assignedGroup?.name ?? ''}
                                    onChange={e => updateRecord(st.num, 'groupName', e.target.value)}
                                    readOnly={!canEdit}
                                    className={`w-full px-1 py-0.5 border rounded text-center text-xs ${lockCls}`}
                                  />
                                </td>
                                <td className="p-1">
                                  <select value={rec.groupScore || ''} onChange={e => updateRecord(st.num, 'groupScore', e.target.value)} disabled={!canEdit} className={`w-full border rounded text-xs py-0.5 ${lockCls}`}>
                                    <option value=""></option>
                                    {currentEval.steps.map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                </td>
                              </>
                            )}
                            {currentEval.type === 'eval' && currentEval.methodObj.indiv && (
                              <td className="p-1">
                                <select value={rec.indivScore || ''} onChange={e => updateRecord(st.num, 'indivScore', e.target.value)} disabled={!canEdit} className={`w-full border rounded text-xs py-0.5 ${lockCls}`}>
                                  <option value=""></option>
                                  {currentEval.steps.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                              </td>
                            )}
                            {currentEval.type === 'check' && (
                              <td className="p-1 text-center">
                                <input type="checkbox" checked={!!rec.checked} onChange={e => updateRecord(st.num, 'checked', e.target.checked)} disabled={!canEdit} className="w-5 h-5 accent-slate-600" />
                              </td>
                            )}
                            <td className="p-1">
                              <input
                                value={rec[currentEval.type === 'memo' ? 'memo' : 'reason'] || ''}
                                onChange={e => updateRecord(st.num, currentEval.type === 'memo' ? 'memo' : 'reason', e.target.value)}
                                readOnly={!canEdit}
                                className={`w-full px-1 py-0.5 border rounded text-xs ${lockCls}`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        {viewMode === 'view' && currentEval && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50">
            {/* 남의 조사표는 지우지도 저장하지도 못한다. 자리는 비워 둔다. */}
            {canEdit ? (
              <button onClick={handleDelete} className="px-3 py-2 text-red-500 hover:bg-red-50 border border-red-200 rounded-xl text-xs font-bold transition-all">삭제</button>
            ) : (
              <span className="text-xs text-slate-400 font-bold">다른 사람이 만든 조사표입니다</span>
            )}
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold">닫기</button>
              {canEdit && (
                <button onClick={handleSaveRecords} className="px-5 py-2 bg-primary text-white rounded-xl text-xs font-bold shadow-xs">저장</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
