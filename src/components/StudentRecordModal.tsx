// src/components/StudentRecordModal.tsx
//
// 학생 누가기록. 기록에 적힌 학생 태그(#26040305)와 출석부를 모아 한 학생의
// 한 해를 날짜 차례로 보여 준다. 생활기록부를 쓸 때 근거를 한눈에 보려는 것이다.
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
import { showToast, showErrorToast } from '../utils/toast';

interface StudentRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TimelineItem {
  date: string;
  kind: 'journal' | 'attendance';
  text: string;
  /** 기록일 때: 어느 공간의 어느 항목인가 (눌러서 그 자리로 간다) */
  journalId?: string;
  space?: string | null;
  spaceName?: string;
  label?: string;
}

const MEMORY_KEY = 'sp4-student-record';

export default function StudentRecordModal({ isOpen, onClose }: StudentRecordModalProps) {
  const { rosterList, loading: rosterLoading } = useRoster();
  const { groups } = useGroups();
  const { selectedGroupId, setCurrentDate, setScope, setSelectedGroupId, requestFocus } = useAppStore();

  const [classKey, setClassKey] = useState<string | null>(null);
  const [num, setNum] = useState<number | null>(null);
  const [tagInput, setTagInput] = useState('');

  // 처음에는 마지막에 본 학급을 연다
  useEffect(() => {
    if (rosterLoading || classKey || rosterList.length === 0) return;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(MEMORY_KEY);
    } catch {
      /* 무시 */
    }
    const pick =
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

    Promise.all([...spaces.map(readJournals), loadAttendanceForClass(classKeyOf(cls))])
      .then((results) => {
        if (!alive) return;
        const days = results.pop() as Awaited<ReturnType<typeof loadAttendanceForClass>>;
        const journals = (results as TimelineItem[][]).flat();
        const att = historyOf(days, num).map((h) => ({
          date: h.date,
          kind: 'attendance' as const,
          text: recordText(h.record),
        }));
        setAttendanceDays(days);
        setItems([...journals, ...att].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'attendance' ? -1 : 1)));
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
  }, [isOpen, classKey, num, selectedGroupId]);

  const tally = useMemo(() => (num === null ? null : tallyByStudent(attendanceDays)[String(num)] || null), [attendanceDays, num]);

  const tagText = tag ? makeStudentTag(tag) : '';

  const goTo = (it: TimelineItem) => {
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
    const body = items.map((it) => `${it.date} [${it.kind === 'attendance' ? '출결' : '기록'}] ${it.text.replace(/\n+/g, ' / ')}`);
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

  const journalCount = items?.filter((i) => i.kind === 'journal').length || 0;

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
                <div className="flex items-center justify-between gap-2 flex-wrap p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div>
                    <div className="text-sm font-black text-slate-800">
                      {student?.name || `${num}번`} <span className="font-mono font-bold text-amber-700">{tagText}</span>
                    </div>
                    <div className="text-slate-500 mt-0.5">
                      기록 {journalCount}건
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
                      disabled={!items || items.length === 0}
                      className="px-2 py-1 bg-white border border-slate-200 rounded-lg font-bold hover:bg-slate-100 disabled:opacity-40"
                    >
                      📋 전체 복사
                    </button>
                  </div>
                </div>

                {items === null ? (
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
                            it.kind === 'attendance' ? 'bg-rose-500' : 'bg-primary'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => goTo(it)}
                          disabled={it.kind !== 'journal'}
                          title={it.kind === 'journal' ? '그 날 하루 화면으로 가서 짚어 줍니다' : undefined}
                          className="w-full text-left p-2.5 bg-white border border-slate-200 rounded-xl hover:border-primary/40 disabled:hover:border-slate-200 disabled:cursor-default"
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <b className="text-slate-800">{it.date}</b>
                            <span className="text-slate-400">{shortDateLabel(it.date).replace(/^\d+\/\d+/, '')}</span>
                            <span
                              className={`px-1.5 py-px rounded-md font-bold border ${
                                it.kind === 'attendance'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : 'bg-blue-50 text-blue-700 border-blue-200'
                              }`}
                            >
                              {it.kind === 'attendance' ? '출결' : it.label || '기록'}
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
