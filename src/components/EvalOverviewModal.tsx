// src/components/EvalOverviewModal.tsx
//
// 조사표 모아 보기 (ROADMAP 9-2). 한 학급의 한 학년도 조사표를 학생 × 조사표 표로. 읽기만 한다.
// 읽기는 lib/evalArchive(개인 + 지금 고른 그룹), 칸 값·거르기·CSV는 lib/evalSummary.
//
// - 교과·학기·유형으로 거른다. 학기는 시간표 설정의 방학으로 가른다(그 학년도 설정이 없으면 3~8월이 1학기).
// - 조사표 머리를 누르면 그 조사표가 열린다. 조사표 창을 닫으면 다시 읽는다(거기서 고친 값이 보이게).
// - CSV 내려받기(값·사유 두 칸)·표 복사(엑셀·시트에 붙여넣기).
// - 교과 모드는 위에 '학급별' / '과정별' 탭 - 과정별은 CourseEvalOverview (docs/ROADMAP-SUBJECT.md S9).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ModalShell, { ModalCloseButton } from './ModalShell';
import { auth } from '../lib/firebase';
import { useRoster } from '../hooks/useRoster';
import { useGroups } from '../hooks/useGroups';
import { useTimetableTemplate } from '../hooks/useTimetableTemplate';
import { useAppStore } from '../store/useAppStore';
import { classKeyOf } from '../lib/attendance';
import { describeClass } from '../lib/classPicker';
import { getAcademicYear } from '../lib/dateUtils';
import { downloadCsv } from '../lib/csv';
import { loadClassEvals, type ArchivedEval } from '../lib/evalArchive';
import {
  EVAL_TYPE_LABEL,
  evalCellText,
  evalColumnTitle,
  filterEvals,
  isEmptyCell,
  overviewCsvRows,
  sortEvals,
  stepCounts,
  studentEvalCell,
  type OverviewFilter,
} from '../lib/evalSummary';
import { showErrorToast, showToast } from '../utils/toast';
import { printNode } from '../lib/print';
import { useTeachingMode } from '../hooks/useTeachingMode';
import CourseEvalOverview from './CourseEvalOverview';

interface EvalOverviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CLASS_MEMORY_KEY = 'sp4-eval-overview-class';
/** 출석부·자리표에서 마지막에 연 학급 - 처음 열 때 그 학급으로 */
const OTHER_CLASS_KEYS = ['sp4-seating-class', 'sp4-attendance-class'];
const NO_SUBJECT = '(없음)';

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export default function EvalOverviewModal({ isOpen, onClose }: EvalOverviewModalProps) {
  const { rosterList, loading: rosterLoading } = useRoster();
  const { groups } = useGroups();
  const { semesterConfig } = useTimetableTemplate();
  const { selectedGroupId, setSelectedGroupId, openEvaluationModal, isEvaluationModalOpen } = useAppStore();

  const [classKey, setClassKey] = useState<string | null>(null);
  const [evals, setEvals] = useState<ArchivedEval[] | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [filter, setFilter] = useState<OverviewFilter>({ subject: '', semester: null, type: '' });
  const { isClassUnit } = useTeachingMode();
  const [view, setView] = useState<'class' | 'course'>('class');
  const showCourse = isClassUnit && view === 'course';

  // 학급: 여기서 마지막에 본 학급 → 자리표·출석부에서 마지막에 연 학급 → 올해 학년도의, 학생이 있는 첫 학급
  useEffect(() => {
    if (rosterLoading || classKey || rosterList.length === 0) return;
    const wanted = [CLASS_MEMORY_KEY, ...OTHER_CLASS_KEYS].map(readKey);
    const ay = getAcademicYear();
    const withStudents = rosterList.filter((c) => (c.students || []).length > 0);
    const pick =
      wanted.map((k) => rosterList.find((c) => classKeyOf(c) === k)).find(Boolean) ||
      withStudents.find((c) => Number(c.year) === ay) ||
      withStudents[0] ||
      rosterList[0];
    setClassKey(classKeyOf(pick));
  }, [rosterLoading, rosterList, classKey]);

  const chooseClass = (key: string) => {
    setClassKey(key);
    setFilter({ subject: '', semester: null, type: '' });
    try {
      localStorage.setItem(CLASS_MEMORY_KEY, key);
    } catch {
      /* 무시 */
    }
  };

  const cls = rosterList.find((c) => classKeyOf(c) === classKey) || null;

  const spaces = useMemo(() => {
    const out: Array<{ id: string | null; name: string }> = [{ id: null, name: '개인' }];
    if (selectedGroupId) out.push({ id: selectedGroupId, name: groups.find((g) => g.id === selectedGroupId)?.name || '그룹' });
    return out;
  }, [selectedGroupId, groups]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!isOpen || !cls || !uid || showCourse) return;
    let alive = true;
    loadClassEvals(uid, spaces, cls)
      .then((list) => alive && setEvals(sortEvals(list)))
      .catch((err) => {
        if (!alive) return;
        setEvals([]);
        showErrorToast('조사표를 모으지 못했습니다. 네트워크를 확인해 주세요.', err);
      });
    return () => {
      alive = false;
    };
    // cls는 classKey에서 나온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, classKey, selectedGroupId, reloadTick, showCourse]);

  // 학급·공간을 바꾸면 '불러오는 중'으로 (다시 읽기는 표를 그대로 둔 채 바꾼다)
  useEffect(() => setEvals(null), [classKey, selectedGroupId]);

  // 이 창에서 연 조사표 창을 닫으면 다시 읽는다 - 거기서 고친 값이 보이게
  const wasEvalOpen = useRef(false);
  useEffect(() => {
    if (wasEvalOpen.current && !isEvaluationModalOpen) setReloadTick((n) => n + 1);
    wasEvalOpen.current = isEvaluationModalOpen;
  }, [isEvaluationModalOpen]);

  const schoolYear = Number(cls?.year) || getAcademicYear();
  const subjects = useMemo(() => {
    const set = new Set((evals || []).map((e) => String(e.subject || '')));
    const named = [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
    return set.has('') ? [...named, NO_SUBJECT] : named;
  }, [evals]);
  const shown = useMemo(
    () => (evals ? filterEvals(evals, filter, schoolYear, semesterConfig) : []),
    [evals, filter, schoolYear, semesterConfig]
  );
  const students = useMemo(
    () =>
      [...(cls?.students || [])]
        .map((s) => ({ num: Number(s.num), name: s.name, isActive: s.isActive }))
        .sort((a, b) => a.num - b.num),
    [cls]
  );

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

  const fileStem = () => {
    if (!cls) return '평가모아보기';
    const parts = [`${cls.year}학년도 ${cls.grade}-${cls.classNum}`];
    if (filter.subject) parts.push(filter.subject === NO_SUBJECT ? '교과없음' : filter.subject);
    if (filter.semester) parts.push(`${filter.semester}학기`);
    if (filter.type) parts.push(EVAL_TYPE_LABEL[filter.type] || filter.type);
    return `평가모아보기_${parts.join('_')}`.replace(/[\\/:*?"<>|\s]+/g, '_');
  };

  const downloadShown = () => {
    if (shown.length === 0) return showToast('내려받을 조사표가 없습니다.');
    downloadCsv(overviewCsvRows(shown, students), `${fileStem()}.csv`);
  };

  const copyShown = async () => {
    if (shown.length === 0) return showToast('복사할 조사표가 없습니다.');
    // 칸 안의 탭·줄바꿈은 붙여넣을 때 칸을 흩뜨린다 - 빈칸으로
    const tsv = overviewCsvRows(shown, students)
      .map((row) => row.map((c) => String(c).replace(/[\t\r\n]+/g, ' ')).join('\t'))
      .join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      showToast('📋 표를 복사했습니다. 엑셀·구글 시트에 붙여 넣으세요.');
    } catch (e) {
      showErrorToast('복사하지 못했습니다.', e);
    }
  };

  const select = 'px-2 py-1.5 border border-slate-200 rounded-lg font-bold text-xs bg-white';
  /** 인쇄할 표 (ROADMAP 12-3) */
  const tableRef = useRef<HTMLDivElement>(null);
  const printTable = () => {
    if (!tableRef.current || !cls) return;
    const parts = [
      filter.subject ? (filter.subject === NO_SUBJECT ? '교과 없음' : filter.subject) : '모든 교과',
      filter.semester ? `${filter.semester}학기` : '학년 전체',
      filter.type ? EVAL_TYPE_LABEL[filter.type] : '',
    ].filter(Boolean);
    printNode(tableRef.current, {
      title: `${describeClass(cls)} 조사표 모아 보기`,
      subtitle: `${parts.join(' · ')} · 조사표 ${shown.length}개 · ✎ 사유 있음 · · 명단에 없음`,
      landscape: shown.length > 5,
    });
  };

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} width="2xl" title="📊 조사표 모아 보기" footer={<ModalCloseButton onClose={onClose} />}>
      {!rosterLoading && rosterList.length === 0 ? (
        <p className="text-center text-slate-400 py-8 text-sm">
          명렬표가 없습니다. ⋮ 메뉴 → 학급 정보(명렬표) 관리에서 학급과 학생을 먼저 넣어 주세요.
        </p>
      ) : (
        <div className="flex flex-col gap-3 text-xs text-slate-700">
          {isClassUnit && (
            <div className="inline-flex self-start bg-slate-100 p-1 rounded-xl gap-1" role="tablist" aria-label="모아 보기 방식">
              {(
                [
                  ['class', '학급별'],
                  ['course', '과정별'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={view === id}
                  data-overview-course={id === 'course' ? true : undefined}
                  onClick={() => setView(id)}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                    view === id ? 'bg-white text-primary shadow-xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {showCourse ? (
            <CourseEvalOverview rosterList={rosterList} spaces={spaces} reloadTick={reloadTick} openEval={openEval} />
          ) : (
          <>
          <div className="flex flex-wrap items-center gap-1.5">
            <select value={classKey || ''} onChange={(e) => chooseClass(e.target.value)} aria-label="학급" className={select}>
              {rosterList.map((c) => (
                <option key={classKeyOf(c)} value={classKeyOf(c)}>
                  {describeClass(c)}
                </option>
              ))}
            </select>
            <select
              value={filter.subject || ''}
              onChange={(e) => setFilter({ ...filter, subject: e.target.value })}
              aria-label="교과"
              className={select}
            >
              <option value="">모든 교과</option>
              {subjects.map((s) => (
                <option key={s} value={s}>
                  {s === NO_SUBJECT ? '교과 없음' : s}
                </option>
              ))}
            </select>
            <select
              value={filter.semester || ''}
              onChange={(e) => setFilter({ ...filter, semester: e.target.value ? (Number(e.target.value) as 1 | 2) : null })}
              aria-label="학기"
              className={select}
            >
              <option value="">학년 전체</option>
              <option value="1">1학기</option>
              <option value="2">2학기</option>
            </select>
            <select
              value={filter.type || ''}
              onChange={(e) => setFilter({ ...filter, type: e.target.value })}
              aria-label="유형"
              className={select}
            >
              <option value="">모든 유형</option>
              <option value="eval">평가</option>
              <option value="check">체크</option>
              <option value="memo">메모</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold text-slate-500 mr-auto" data-eval-overview-count>
              {evals === null ? '모으는 중…' : `조사표 ${shown.length}개${shown.length !== evals.length ? ` (전체 ${evals.length})` : ''} · 학생 ${students.length}명`}
            </span>
            <button type="button" onClick={() => void copyShown()} disabled={shown.length === 0} className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 font-bold disabled:opacity-40">
              📋 표 복사
            </button>
            <button type="button" onClick={downloadShown} disabled={shown.length === 0} className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 font-bold disabled:opacity-40">
              📥 CSV
            </button>
            <button type="button" onClick={printTable} disabled={shown.length === 0} className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 font-bold disabled:opacity-40">
              🖨️ 인쇄
            </button>
          </div>

          {evals === null ? (
            <p className="text-center text-slate-400 py-8">불러오는 중…</p>
          ) : evals.length === 0 ? (
            <p className="text-center text-slate-400 py-8">
              {cls ? `${cls.year}학년도에 이 학급으로 만든 조사표가 없습니다.` : ''} 조사표는 수업 칸·기록 칸의 📊에서 만듭니다.
            </p>
          ) : shown.length === 0 ? (
            <p className="text-center text-slate-400 py-8">고른 교과·학기·유형에 맞는 조사표가 없습니다.</p>
          ) : (
            <div ref={tableRef} className="border border-slate-200 rounded-xl overflow-auto max-h-[65vh]" data-eval-overview>
              <table className="text-xs border-collapse min-w-full">
                <thead className="bg-slate-100 sticky top-0 z-20">
                  <tr>
                    <th className="sticky left-0 z-10 bg-slate-100 p-1.5 w-10 min-w-10 whitespace-nowrap border-b border-r border-slate-200">번호</th>
                    <th className="sticky left-10 z-10 bg-slate-100 p-1.5 min-w-16 text-left border-b border-r border-slate-200">이름</th>
                    {shown.map((ev) => (
                      <th key={`${ev.space || 'me'}:${ev.id}`} className="p-1 border-b border-r border-slate-200 align-top min-w-24 max-w-40 font-normal">
                        <button
                          type="button"
                          onClick={() => openEval(ev)}
                          title={`${ev.dateStr} ${ev.title} - 눌러서 열기${ev.space ? ` (👥 ${ev.spaceName})` : ''}`}
                          data-eval-col={ev.id}
                          className="w-full text-left rounded-md px-1 py-0.5 hover:bg-white"
                        >
                          <span className="block text-2xs font-bold text-slate-400">
                            {EVAL_TYPE_LABEL[ev.type] || ''}
                            {ev.space ? ' 👥' : ''}
                          </span>
                          <span className="block font-black text-slate-700 leading-tight line-clamp-2">{evalColumnTitle(ev)}</span>
                          {stepCounts(ev, students.map((s) => s.num)) && (
                            <span className="block text-2xs text-slate-400 leading-tight" data-eval-steps>
                              {stepCounts(ev, students.map((s) => s.num))}
                            </span>
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students.map((st) => (
                    <tr key={st.num} className={st.isActive === false ? 'text-slate-300' : 'hover:bg-slate-50'} data-eval-row={st.num}>
                      <td className="sticky left-0 bg-white p-1.5 w-10 min-w-10 text-center font-bold text-slate-400 border-b border-r border-slate-100">{st.num}</td>
                      <td className="sticky left-10 bg-white p-1.5 font-bold border-b border-r border-slate-100 whitespace-nowrap">
                        {st.name}
                        {st.isActive === false && <span className="ml-1 text-2xs">(전출)</span>}
                      </td>
                      {shown.map((ev) => {
                        const inList = (ev.studentsSnapshot || []).some((s) => Number(s.num) === st.num);
                        const cell = studentEvalCell(ev, st.num);
                        return (
                          <td
                            key={`${ev.space || 'me'}:${ev.id}`}
                            className="p-1.5 text-center border-b border-r border-slate-100"
                            title={inList ? evalCellText(cell) || undefined : '이 조사표 명단에 없습니다'}
                            data-eval-cell={`${ev.id}:${st.num}`}
                          >
                            {!inList ? (
                              <span className="text-slate-200">·</span>
                            ) : isEmptyCell(cell) ? (
                              ''
                            ) : (
                              <span className="font-bold">
                                {cell.main || '…'}
                                {cell.note && <span className="ml-0.5 text-slate-400" aria-label="사유 있음">✎</span>}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-2xs text-slate-400">
            {cls?.year}학년도에 이 학급으로 만든 조사표를 개인 공간{selectedGroupId ? '과 지금 고른 공유 그룹' : ''}에서 모았습니다. 읽기만 합니다 - 값은 조사표 머리를 눌러 연 조사표에서 고칩니다. ✎는 사유·근거가 있다는 표시(칸에 마우스를 올리면 보임)입니다.
          </p>
          </>
          )}
        </div>
      )}
    </ModalShell>
  );
}
