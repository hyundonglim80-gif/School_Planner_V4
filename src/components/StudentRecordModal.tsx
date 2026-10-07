// src/components/StudentRecordModal.tsx
//
// 학생 누가기록. 기록에 적힌 학생 태그(#26040305)와 출석부를 모아 한 학생의
// 한 해를 날짜 차례로 보여 준다. 생활기록부를 쓸 때 근거를 한눈에 보려는 것이다.
//
// 학생 카드(ROADMAP 9-1): 위에 사진·특이사항·출결 누계·기록·평가 수, 아래 '기록·출결'과 '평가' 두 갈래.
// 평가는 그 학년도에 이 학급으로 만든 조사표 중 이 학생이 명단에 있는 것(lib/evalArchive, 값은 lib/evalSummary).
// 관찰 한 줄·관찰 문구 단추(ROADMAP 10-2): 개인 공간 오늘 기록에 학생 태그를 붙여 한 줄(자리표 학생 칸과 같은 저장 길).
import React, { useEffect, useMemo, useState } from 'react';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import ModalShell, { ModalCloseButton } from './ModalShell';
import { db, auth } from '../lib/firebase';
import { useRoster } from '../hooks/useRoster';
import { useAppStore } from '../store/useAppStore';
import { useGroups } from '../hooks/useGroups';
import { focusKey } from '../lib/searchFocus';
import { parseDateStr } from '../lib/dateUtils';
import { findStudentTags, makeStudentTag, sameStudent, tagOfStudent, type StudentTag } from '../lib/studentTag';
import { classKeyOf, historyOf, recordText, tallyByStudent, KINDS, KIND_LABEL, REASONS, REASON_LABEL } from '../lib/attendance';
import { loadAttendanceForClass } from '../lib/attendanceStore';
import { shortDateLabel } from '../lib/notices';
import { loadClassEvals, type ArchivedEval } from '../lib/evalArchive';
import { evalHasStudent } from '../lib/classHub';
import { EVAL_TYPE_LABEL, evalCellText, isEmptyCell, sortEvals, studentEvalCell } from '../lib/evalSummary';
import { useStudentPhotos } from '../hooks/useStudentPhotos';
import StudentPhoto from './roster/StudentPhoto';
import ObservationPhrases from './ObservationPhrases';
import { observationContent } from '../lib/classHub';
import { addJournalLine, removeJournalLine } from '../lib/classHubStore';
import { formatDateStr } from '../lib/dateUtils';
import { openEntryPanel } from './EntryPanelHost';
import { showUndoToast } from '../lib/undoToast';
import { showToast, showErrorToast } from '../utils/toast';
import { useTeachingMode } from '../hooks/useTeachingMode';
import { loadSubjectAttendanceForClass } from '../lib/subjectAttendanceStore';
import { subjectHistoryOf, subjectHistoryText } from '../lib/subjectAttendance';

interface StudentRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 처음 보일 학급·학생 (자리표 학생 칸의 '누가기록'). 없으면 마지막에 본 학급 */
  initialClassKey?: string;
  initialNum?: number;
}

interface TimelineItem {
  date: string;
  /** subjectAttendance: 교과 출결 (교과 모드, ROADMAP-SUBJECT S7) */
  kind: 'journal' | 'memo' | 'attendance' | 'subjectAttendance';
  text: string;
  /** 기록일 때: 어느 공간의 어느 항목인가 (눌러서 그 자리로 간다) */
  journalId?: string;
  /** 메모일 때: 메모 문서 id (눌러서 메모 쓰는 칸을 연다, 2026-10-07) */
  memoId?: string;
  space?: string | null;
  spaceName?: string;
  label?: string;
}

const MEMORY_KEY = 'sp4-student-record';
/** 명렬표 창의 '사진 보기' (켜 두었을 때만 드라이브에서 사진을 읽는다) */
const PHOTOS_KEY = 'sp4-roster-photos';

function photosWanted(): boolean {
  try {
    return localStorage.getItem(PHOTOS_KEY) === '1';
  } catch {
    return false;
  }
}

export default function StudentRecordModal({ isOpen, onClose, initialClassKey, initialNum }: StudentRecordModalProps) {
  const { rosterList, loading: rosterLoading } = useRoster();
  const { isClassUnit } = useTeachingMode();
  const { groups } = useGroups();
  const { selectedGroupId, setCurrentDate, setScope, setSelectedGroupId, requestFocus, openEvaluationModal } = useAppStore();

  const [classKey, setClassKey] = useState<string | null>(null);
  const [num, setNum] = useState<number | null>(initialNum ?? null);
  const [tagInput, setTagInput] = useState('');

  // 처음에는 넘겨받은 학급, 없으면 마지막에 본 학급을 연다
  useEffect(() => {
    if (rosterLoading || classKey || rosterList.length === 0) return;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(MEMORY_KEY);
    } catch {
      /* 무시 */
    }
    const pick =
      (initialClassKey && rosterList.find((c) => classKeyOf(c) === initialClassKey)) ||
      rosterList.find((c) => classKeyOf(c) === remembered) ||
      rosterList.find((c) => (c.students || []).length > 0) ||
      rosterList[0];
    setClassKey(classKeyOf(pick));
  }, [rosterLoading, rosterList, classKey]);

  const cls = rosterList.find((c) => classKeyOf(c) === classKey) || null;
  const student = cls?.students?.find((s) => Number(s.num) === num) || null;
  const tag: StudentTag | null = cls && num !== null ? tagOfStudent(cls, { num }) : null;

  // 태그를 직접 적어 찾기: #26040305 → 그 학급·번호로
  const applyTagInput = () => {
    const t = findStudentTags(tagInput.startsWith('#') ? tagInput : `#${tagInput}`)[0];
    if (!t) return showToast('#26040305 처럼 여덟 자리로 적어 주세요.');
    const c = rosterList.find(
      (r) => Number(r.year) === t.year && Number(r.grade) === t.grade && Number(r.classNum) === t.classNum
    );
    if (!c) return showToast(`명렬표에 ${t.year}학년도 ${t.grade}학년 ${t.classNum}반이 없습니다.`);
    setClassKey(classKeyOf(c));
    setNum(t.num);
  };

  useEffect(() => {
    if (!classKey) return;
    try {
      localStorage.setItem(MEMORY_KEY, classKey);
    } catch {
      /* 무시 */
    }
  }, [classKey]);

  // ── 모으기 ──
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [attendanceDays, setAttendanceDays] = useState<Awaited<ReturnType<typeof loadAttendanceForClass>>>([]);
  /** 그 학년도 이 학급 조사표 (학생과 상관없이 학급마다 한 번 읽는다) */
  const [classEvals, setClassEvals] = useState<ArchivedEval[] | null>(null);
  const [tab, setTab] = useState<'timeline' | 'evals'>('timeline');
  const [photosOn] = useState(photosWanted);
  /** 관찰 한 줄을 남기면 늘려 누가기록을 다시 모은다 */
  const [reloadTick, setReloadTick] = useState(0);
  const [obs, setObs] = useState('');
  const [obsBusy, setObsBusy] = useState(false);
  const photoState = useStudentPhotos(isOpen && photosOn ? cls : null, cls?.students || [], photosOn);

  useEffect(() => {
    if (!isOpen || !cls || !tag || num === null) {
      setItems(null);
      return;
    }
    let alive = true;
    setItems(null);
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const start = `${cls.year}-03-01`;
    const end = `${Number(cls.year) + 1}-02-29`;

    // 기록은 개인 공간과 지금 고른 공유 그룹 둘 다 훑는다 (태그는 어느 쪽에나 적을 수 있다)
    const spaces: Array<{ id: string | null; name: string }> = [{ id: null, name: '개인' }];
    if (selectedGroupId) {
      spaces.push({ id: selectedGroupId, name: groups.find((g) => g.id === selectedGroupId)?.name || '그룹' });
    }

    const readJournals = async (space: { id: string | null; name: string }): Promise<TimelineItem[]> => {
      const col = space.id ? collection(db, 'groups', space.id, 'journals') : collection(db, 'users', uid, 'journals');
      const snap = await getDocs(query(col, where(documentId(), '>=', start), where(documentId(), '<=', end)));
      const out: TimelineItem[] = [];
      snap.forEach((d) => {
        for (const e of ((d.data() as any).entries || []) as any[]) {
          const content = String(e?.content || '');
          if (!findStudentTags(content).some((t) => sameStudent(t, tag))) continue;
          out.push({
            date: d.id,
            kind: 'journal',
            text: content,
            journalId: String(e.id),
            space: space.id,
            spaceName: space.name,
            label: e.label || '',
          });
        }
      });
      return out;
    };

    // 메모에 붙인 태그도 모은다 (2026-10-07 사용자 요청). 메모는 날짜가 없어 쓴 날(기록에서 옮겨 온 것은 그 날)에 둔다.
    // 태그에 학년도가 들어 있어 기간으로 거르지 않는다.
    const readMemos = async (space: { id: string | null; name: string }): Promise<TimelineItem[]> => {
      const col = space.id ? collection(db, 'groups', space.id, 'tasks') : collection(db, 'users', uid, 'tasks');
      const snap = await getDocs(col);
      const out: TimelineItem[] = [];
      snap.forEach((d) => {
        const m = d.data() as any;
        const content = String(m?.content ?? m?.text ?? '');
        if (!findStudentTags(content).some((t) => sameStudent(t, tag))) return;
        const created = typeof m.createdAt === 'number' ? formatDateStr(new Date(m.createdAt)) : '';
        out.push({
          date: /^\d{4}-\d{2}-\d{2}$/.test(m.fromDate || '') ? m.fromDate : created || start,
          kind: 'memo',
          text: content,
          memoId: d.id,
          space: space.id,
          spaceName: space.name,
          label: Array.isArray(m.labels) ? m.labels.join(', ') : '',
        });
      });
      return out;
    };

    // 교과 모드면 이 반의 교과 출결도 날짜 차례에 섞는다 (그 학년도 것만)
    const subjectDays = isClassUnit ? loadSubjectAttendanceForClass(classKeyOf(cls)).catch(() => []) : Promise.resolve([]);
    // 메모를 못 읽어도 기록·출결은 보인다
    const memoLists = Promise.all(spaces.map(readMemos)).catch((e) => {
      console.warn('누가기록: 메모를 읽지 못했습니다', e);
      return [] as TimelineItem[][];
    });
    Promise.all([Promise.all(spaces.map(readJournals)), loadAttendanceForClass(classKeyOf(cls)), subjectDays, memoLists])
      .then(([journalLists, days, sDays, memos]) => {
        if (!alive) return;
        const journals = [...journalLists.flat(), ...memos.flat()];
        const att = historyOf(days, num).map((h) => ({
          date: h.date,
          kind: 'attendance' as const,
          text: recordText(h.record),
        }));
        const subjectAtt = subjectHistoryOf(sDays, num)
          .filter((h) => h.date >= start && h.date <= end)
          .map((h) => ({
            date: h.date,
            kind: 'subjectAttendance' as const,
            text: subjectHistoryText(h, REASON_LABEL),
          }));
        const order = (k: TimelineItem['kind']) => (k === 'attendance' ? 0 : k === 'subjectAttendance' ? 1 : 2);
        setAttendanceDays(days);
        setItems([...journals, ...att, ...subjectAtt].sort((a, b) => a.date.localeCompare(b.date) || order(a.kind) - order(b.kind)));
      })
      .catch((err) => {
        if (!alive) return;
        setItems([]);
        showErrorToast('누가기록을 모으지 못했습니다.', err);
      });
    return () => {
      alive = false;
    };
    // tag는 cls·num에서 나온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, classKey, num, selectedGroupId, reloadTick, isClassUnit]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!isOpen || !cls || !uid) {
      setClassEvals(null);
      return;
    }
    let alive = true;
    setClassEvals(null);
    const spaces: Array<{ id: string | null; name: string }> = [{ id: null, name: '개인' }];
    if (selectedGroupId) {
      spaces.push({ id: selectedGroupId, name: groups.find((g) => g.id === selectedGroupId)?.name || '그룹' });
    }
    loadClassEvals(uid, spaces, cls)
      .then((list) => alive && setClassEvals(sortEvals(list)))
      .catch((err) => {
        if (!alive) return;
        setClassEvals([]);
        showErrorToast('조사표를 모으지 못했습니다.', err);
      });
    return () => {
      alive = false;
    };
    // cls는 classKey에서 나온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, classKey, selectedGroupId]);

  /** 이 학생이 명단에 있는 조사표와 그 값 */
  const studentEvals = useMemo(
    () =>
      num === null || !classEvals
        ? null
        : classEvals.filter((ev) => evalHasStudent(ev, num)).map((ev) => ({ ev, cell: studentEvalCell(ev, num) })),
    [classEvals, num]
  );
  const filledEvalCount = studentEvals?.filter((e) => !isEmptyCell(e.cell)).length || 0;

  /** 그 조사표를 연다 (다른 공간 것이면 그 공간으로) */
  const openEval = (ev: ArchivedEval) => {
    if ((ev.space || null) !== (selectedGroupId || null)) setSelectedGroupId(ev.space || null);
    const fromJournal = ev.context?.source === 'journal';
    openEvaluationModal(
      ev.dateStr,
      fromJournal ? 'journal' : 'schedule',
      fromJournal ? undefined : Number(ev.periodStr) || undefined,
      ev.subject || '',
      ev.id
    );
  };

  const tally = useMemo(() => (num === null ? null : tallyByStudent(attendanceDays)[String(num)] || null), [attendanceDays, num]);

  /** 관찰 한 줄 → 개인 공간 오늘 기록 (적은 글 또는 누른 관찰 문구) */
  const addObservation = async (text: string = obs) => {
    const uid = auth.currentUser?.uid;
    if (!uid || !tag || obsBusy) return;
    const content = observationContent(text, makeStudentTag(tag));
    if (!content) return;
    const date = formatDateStr(new Date());
    setObsBusy(true);
    try {
      const id = await addJournalLine(uid, date, content);
      if (text === obs) setObs('');
      setReloadTick((n) => n + 1);
      showUndoToast(`📝 오늘 기록에 남겼습니다: ${content}`, async () => {
        const removed = await removeJournalLine(uid, date, id, content);
        setReloadTick((n) => n + 1);
        return removed ? '↩️ 기록에서 뺐습니다.' : '그 사이 고친 기록이라 빼지 않았습니다. 하루 화면에서 지워 주세요.';
      });
    } catch (e) {
      showErrorToast('기록에 남기지 못했습니다. 네트워크를 확인해 주세요.', e);
    } finally {
      setObsBusy(false);
    }
  };

  const tagText = tag ? makeStudentTag(tag) : '';

  const goTo = (it: TimelineItem) => {
    if (it.kind === 'memo' && it.memoId) {
      openEntryPanel({ kind: 'memo', groupId: it.space || null, entryId: it.memoId });
      onClose();
      return;
    }
    if (it.kind !== 'journal' || !it.journalId) return;
    if ((it.space || null) !== (selectedGroupId || null)) setSelectedGroupId(it.space || null);
    setCurrentDate(parseDateStr(it.date));
    setScope('day');
    requestFocus({ key: focusKey.journal(it.date, it.journalId), section: 'journal' });
    onClose();
  };

  const copyAll = async () => {
    if (!items || !student) return;
    const head = `${student.name} (${tagText}) 누가기록`;
    // 평가도 적은 값이 있는 것만 날짜 차례로 섞어 넣는다
    const lines = [
      ...items.map((it) => ({
        date: it.date,
        line: `${it.date} [${it.kind === 'attendance' ? '출결' : it.kind === 'subjectAttendance' ? '교과 출결' : it.kind === 'memo' ? '메모' : '기록'}] ${it.text.replace(/\n+/g, ' / ')}`,
      })),
      ...(studentEvals || [])
        .filter((e) => !isEmptyCell(e.cell))
        .map(({ ev, cell }) => ({
          date: ev.dateStr,
          line: `${ev.dateStr} [${EVAL_TYPE_LABEL[ev.type] || '평가'}] ${ev.subject ? `${ev.subject} ` : ''}${ev.title}: ${evalCellText(cell).replace(/\n+/g, ' / ')}`,
        })),
    ];
    const body = lines.sort((a, b) => a.date.localeCompare(b.date)).map((l) => l.line);
    try {
      await navigator.clipboard.writeText([head, ...body].join('\n'));
      showToast('📋 복사했습니다.');
    } catch {
      showErrorToast('복사하지 못했습니다.');
    }
  };

  // 태그를 굵게 보여 준다
  const renderText = (text: string) =>
    text.split(/(#\d{8}(?!\d))/g).map((part, i) =>
      /^#\d{8}$/.test(part) ? (
        <b key={i} className={`px-1 rounded ${part === tagText ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>
          {part}
        </b>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      )
    );

  const journalCount = items?.filter((i) => i.kind === 'journal' || i.kind === 'memo').length || 0;

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} width="2xl" title="🧑‍🎓 학생 누가기록" footer={<ModalCloseButton onClose={onClose} />}>
      <div className="space-y-4 text-xs text-slate-700">
        {!rosterLoading && rosterList.length === 0 ? (
          <p className="text-center text-slate-400 py-8">
            명렬표가 없습니다. ⋮ 메뉴 → 학급 정보(명렬표) 관리에서 학급과 학생을 먼저 넣어 주세요.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={classKey || ''}
                onChange={(e) => {
                  setClassKey(e.target.value);
                  setNum(null);
                }}
                aria-label="학급"
                className="px-2 py-1.5 border border-slate-200 rounded-lg font-bold"
              >
                {rosterList.map((c) => (
                  <option key={classKeyOf(c)} value={classKeyOf(c)}>
                    {c.year}학년도 {c.grade}학년 {c.classNum}반
                  </option>
                ))}
              </select>
              <span className="text-slate-300">또는</span>
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyTagInput()}
                placeholder="#26040305"
                aria-label="학생 번호로 찾기"
                className="w-28 px-2 py-1.5 border border-slate-200 rounded-lg font-mono"
              />
              <button type="button" onClick={applyTagInput} className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold">
                찾기
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(cls?.students || []).map((s) => (
                <button
                  key={s.num}
                  type="button"
                  onClick={() => setNum(Number(s.num))}
                  aria-pressed={num === Number(s.num)}
                  className={`px-2 py-1 rounded-lg border font-bold ${
                    num === Number(s.num)
                      ? 'bg-primary text-white border-primary'
                      : `bg-white border-slate-200 hover:border-primary ${s.isActive === false ? 'text-slate-300' : 'text-slate-600'}`
                  }`}
                >
                  {s.num} {s.name}
                </button>
              ))}
            </div>

            {num === null ? (
              <p className="text-center text-slate-400 py-6">
                학생을 고르세요. 기록에 <b className="font-mono">#학년도학년반번호</b>(두 자리씩, 예: #26040305)를 적어 두면 여기에 모입니다.
              </p>
            ) : (
              <div className="space-y-3">
                <div
                  className="flex items-center justify-between gap-2 flex-wrap p-3 bg-slate-50 border border-slate-200 rounded-xl"
                  data-student-card={num}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {photosOn && (
                      <StudentPhoto
                        url={photoState.photos.get(num)?.url}
                        name={student?.name || `${num}번`}
                        size={56}
                        loose={photoState.photos.get(num)?.exact === false}
                      />
                    )}
                    <div className="min-w-0">
                    <div className="text-sm font-black text-slate-800">
                      {student?.name || `${num}번`} <span className="font-mono font-bold text-amber-700">{tagText}</span>
                      {student?.gender && (
                        <span className="ml-1 text-xs font-bold text-slate-400">
                          {student.gender === 'M' || student.gender === '남' ? '남' : '여'}
                        </span>
                      )}
                      {student?.isActive === false && <span className="ml-1 text-xs font-bold text-slate-400">(전출)</span>}
                    </div>
                    {student?.note && (
                      <div className="mt-0.5 text-slate-600" data-student-note>
                        <b className="text-slate-400">특이사항</b> {student.note}
                      </div>
                    )}
                    <div className="text-slate-500 mt-0.5" data-student-counts>
                      기록 {journalCount}건 · 평가 {filledEvalCount}건
                      {tally &&
                        KINDS.map((k) => {
                          const n = REASONS.reduce((s, r) => s + tally[k][r], 0);
                          if (!n) return null;
                          const detail = REASONS.filter((r) => tally[k][r]).map((r) => `${REASON_LABEL[r]} ${tally[k][r]}`).join(', ');
                          return (
                            <span key={k}>
                              {' '}· {KIND_LABEL[k]} {n} <span className="text-slate-400">({detail})</span>
                            </span>
                          );
                        })}
                    </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(tagText);
                          showToast(`📋 ${tagText} 를 복사했습니다. 기록에 붙여 넣으세요.`);
                        } catch {
                          showErrorToast('복사하지 못했습니다.');
                        }
                      }}
                      className="px-2 py-1 bg-white border border-slate-200 rounded-lg font-bold hover:bg-slate-100"
                    >
                      태그 복사
                    </button>
                    <button
                      type="button"
                      onClick={copyAll}
                      disabled={!items || (items.length === 0 && filledEvalCount === 0)}
                      className="px-2 py-1 bg-white border border-slate-200 rounded-lg font-bold hover:bg-slate-100 disabled:opacity-40"
                    >
                      📋 전체 복사
                    </button>
                  </div>
                </div>

                <div className="p-3 border border-amber-200 bg-amber-50/40 rounded-xl" data-student-observe>
                  <div className="text-2xs font-black text-slate-400 mb-1">관찰 한 줄 → 오늘 기록 (개인)</div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={obs}
                      onChange={(e) => setObs(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          void addObservation();
                        }
                      }}
                      placeholder="예: 모둠 활동에서 친구를 잘 도움"
                      aria-label="관찰 한 줄"
                      className="flex-1 min-w-0 px-2 py-1 border border-slate-200 rounded-lg bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => void addObservation()}
                      disabled={!obs.trim() || obsBusy}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 text-white font-bold disabled:opacity-40"
                    >
                      기록에 남기기
                    </button>
                  </div>
                  <ObservationPhrases onPick={(p) => void addObservation(p)} disabled={obsBusy} />
                </div>

                <div className="flex items-center gap-1" role="tablist" aria-label="누가기록 갈래">
                  {(
                    [
                      ['timeline', `🗓️ 기록·출결${items ? ` ${items.length}` : ''}`],
                      ['evals', `📊 평가${studentEvals ? ` ${studentEvals.length}` : ''}`],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={tab === key}
                      onClick={() => setTab(key)}
                      className={`px-3 py-1.5 rounded-lg font-black ${
                        tab === key ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {tab === 'evals' ? (
                  studentEvals === null ? (
                    <p className="text-center text-slate-400 py-6">모으는 중...</p>
                  ) : studentEvals.length === 0 ? (
                    <p className="text-center text-slate-400 py-6">
                      {cls?.year}학년도에 이 학급으로 만든 조사표 중 이 학생이 든 것이 없습니다.
                    </p>
                  ) : (
                    <ul className="space-y-1.5" data-student-evals>
                      {studentEvals.map(({ ev, cell }) => (
                        <li key={`${ev.space || 'me'}:${ev.id}`}>
                          <button
                            type="button"
                            onClick={() => openEval(ev)}
                            title="그 조사표를 엽니다"
                            data-student-eval={ev.id}
                            className="w-full text-left p-2.5 bg-white border border-slate-200 rounded-xl hover:border-primary/40 flex items-start gap-2"
                          >
                            <div className="shrink-0 w-28 whitespace-nowrap">
                              <b className="text-slate-800">{ev.dateStr}</b>
                              <span className="text-slate-400">{shortDateLabel(ev.dateStr).replace(/^\d+\/\d+/, '')}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="px-1.5 py-px rounded-md font-bold border bg-violet-50 text-violet-700 border-violet-200">
                                  {EVAL_TYPE_LABEL[ev.type] || '평가'}
                                </span>
                                {ev.subject && <span className="font-bold text-slate-500">{ev.subject}</span>}
                                <span className="font-bold text-slate-800 truncate">{ev.title}</span>
                                {ev.space && <span className="text-slate-400">👥 {ev.spaceName}</span>}
                              </div>
                              <p
                                className={`mt-0.5 text-sm ${isEmptyCell(cell) ? 'text-slate-300' : 'text-slate-700 font-bold'}`}
                                data-student-eval-value
                              >
                                {isEmptyCell(cell) ? '안 적음' : evalCellText(cell)}
                              </p>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                ) : items === null ? (
                  <p className="text-center text-slate-400 py-6">모으는 중...</p>
                ) : items.length === 0 ? (
                  <p className="text-center text-slate-400 py-6">
                    {cls?.year}학년도에 {tagText} 태그가 붙은 기록과 출결 기록이 없습니다.
                  </p>
                ) : (
                  <ol className="relative border-l-2 border-slate-200 ml-2 space-y-2">
                    {items.map((it, i) => (
                      <li key={i} className="pl-3 relative">
                        <span
                          className={`absolute -left-[7px] top-2 w-3 h-3 rounded-full border-2 border-white ${
                            it.kind === 'attendance' ? 'bg-rose-500' : it.kind === 'subjectAttendance' ? 'bg-orange-400' : 'bg-primary'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => goTo(it)}
                          disabled={it.kind !== 'journal' && it.kind !== 'memo'}
                          title={it.kind === 'journal' ? '그 날 하루 화면으로 가서 짚어 줍니다' : it.kind === 'memo' ? '메모를 엽니다' : undefined}
                          className="w-full text-left p-2.5 bg-white border border-slate-200 rounded-xl hover:border-primary/40 disabled:hover:border-slate-200 disabled:cursor-default"
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <b className="text-slate-800">{it.date}</b>
                            <span className="text-slate-400">{shortDateLabel(it.date).replace(/^\d+\/\d+/, '')}</span>
                            <span
                              data-timeline-kind={it.kind}
                              className={`px-1.5 py-px rounded-md font-bold border ${
                                it.kind === 'attendance'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : it.kind === 'subjectAttendance'
                                    ? 'bg-orange-50 text-orange-700 border-orange-200'
                                    : it.kind === 'memo'
                                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                                      : 'bg-blue-50 text-blue-700 border-blue-200'
                              }`}
                            >
                              {it.kind === 'attendance' ? '출결' : it.kind === 'subjectAttendance' ? '교과 출결' : it.kind === 'memo' ? `📝 메모${it.label ? ` · ${it.label}` : ''}` : it.label || '기록'}
                            </span>
                            {it.spaceName && it.space && <span className="text-slate-400">👥 {it.spaceName}</span>}
                          </div>
                          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{renderText(it.text)}</p>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}
