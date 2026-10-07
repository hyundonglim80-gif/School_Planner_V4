// src/components/SeatStudentCard.tsx
//
// 자리표에서 학생 자리를 누르면 뜨는 학생 칸 (ROADMAP 8-2, 학급 허브).
//   - 오늘 출결: 출석부와 같은 저장(그날 기록의 '출결' 항목도 맞춘다). 누를 때마다 바로 저장
//   - 오늘 조사표: 지금 보는 공간의 오늘 조사표 중 이 학급 것 - 이 학생 값만 고친다
//   - 관찰 한 줄: 개인 공간 오늘 기록에 학생 태그(#26040305)를 붙여 한 줄 - 학생 기록(누가기록)이 모은다
//     관찰 문구 단추(ROADMAP 10-2, ObservationPhrases)를 누르면 그 문구로 곧바로 한 줄
// 저장은 lib/classHubStore, 셈은 lib/classHub. 저장은 하나씩 차례로 한다(빨리 여러 번 눌러도 앞의 것을 덮지 않게).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ObservationPhrases from './ObservationPhrases';
import type { ClassRoster, Student } from '../hooks/useRoster';
import type { EvaluationItem } from '../hooks/useEvaluation';
import { useAppStore } from '../store/useAppStore';
import {
  KINDS,
  KIND_HAS_PERIODS,
  KIND_LABEL,
  REASONS,
  REASON_LABEL,
  classKeyOf,
  type AttendanceRecord,
} from '../lib/attendance';
import {
  changeAttendance,
  entriesForStudent,
  evalHasStudent,
  evalStudentValue,
  isClassEval,
  observationContent,
  type AttendanceChange,
  type EvalStudentPatch,
} from '../lib/classHub';
import {
  addJournalLine,
  removeJournalLine,
  saveStudentAttendance,
  saveStudentEval,
  subscribeEvalDay,
  subscribeJournalDay,
} from '../lib/classHubStore';
import { makeStudentTag, tagOfStudent } from '../lib/studentTag';
import { shortDateLabel } from '../lib/notices';
import { showUndoToast } from '../lib/undoToast';
import { showErrorToast } from '../utils/toast';

interface SeatStudentCardProps {
  uid: string;
  cls: ClassRoster;
  student: Student;
  /** 오늘 (YYYY-MM-DD) */
  date: string;
  /** 자리표가 구독하는 오늘 출결의 이 학생 기록 (없으면 출석) */
  record: AttendanceRecord | undefined;
  maxPeriods: number;
  onClose: () => void;
  onOpenRecord: () => void;
  onOpenAttendance: () => void;
}

const EVAL_TYPE_LABEL: Record<string, string> = { eval: '평가', check: '체크', memo: '메모' };

export default function SeatStudentCard({
  uid,
  cls,
  student,
  date,
  record,
  maxPeriods,
  onClose,
  onOpenRecord,
  onOpenAttendance,
}: SeatStudentCardProps) {
  const selectedGroupId = useAppStore((s) => s.selectedGroupId);
  const groupId = selectedGroupId && selectedGroupId !== 'personal' ? selectedGroupId : null;
  const num = Number(student.num);
  const tag = useMemo(() => tagOfStudent(cls, student), [cls, student]);
  const tagText = makeStudentTag(tag);
  const active = student.isActive !== false;
  const info = {
    classKey: classKeyOf(cls),
    year: Number(cls.year),
    grade: String(cls.grade),
    classNum: String(cls.classNum),
  };

  // ── 저장은 하나씩 차례로 ──
  const chain = useRef<Promise<void>>(Promise.resolve());
  const [pending, setPending] = useState(0);
  const enqueue = (fail: string, op: () => Promise<void>) => {
    setPending((n) => n + 1);
    chain.current = chain.current
      .then(op)
      .catch((e) => showErrorToast(fail, e))
      .finally(() => setPending((n) => n - 1));
  };

  // 누른 값은 서버 답이 오기 전에 먼저 보인다(덧씌움). 출결은 저장이 끝나면(그 전에 구독이 새 값을 받는다),
  // 조사표는 구독이 같은 값을 받으면 걷는다 - 트랜잭션은 끝난 뒤에 구독이 올 수 있다. 실패하면 잠시 뒤 서버 값으로.
  const [attOverlay, setAttOverlay] = useState<{ rec: AttendanceRecord | null } | null>(null);
  const [evalOverlay, setEvalOverlay] = useState<Record<string, EvalStudentPatch>>({});
  useEffect(() => {
    if (pending > 0) return;
    setAttOverlay(null);
    const t = setTimeout(() => setEvalOverlay({}), 3000);
    return () => clearTimeout(t);
  }, [pending]);

  // ── 오늘 출결 ──
  const shownRecord = attOverlay ? attOverlay.rec ?? undefined : record;
  const changeAtt = (change: AttendanceChange) => {
    setAttOverlay({ rec: changeAttendance(shownRecord, num, student.name, change) });
    enqueue('출결을 저장하지 못했습니다. 네트워크를 확인해 주세요.', async () => {
      await saveStudentAttendance(info, date, num, student.name, change);
    });
  };
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const saveNote = () => {
    if (noteDraft === null) return;
    if (noteDraft.trim() !== (shownRecord?.note || '')) changeAtt({ note: noteDraft });
    setNoteDraft(null);
  };

  // ── 오늘 조사표 (지금 보는 공간) ──
  const [evals, setEvals] = useState<EvaluationItem[] | null>(null);
  useEffect(() => {
    setEvals(null);
    return subscribeEvalDay(uid, groupId, date, setEvals, (err) => {
      console.warn('오늘 조사표를 불러오지 못했습니다:', err);
      setEvals([]);
    });
  }, [uid, groupId, date]);
  const classEvals = (evals || []).filter((ev) => isClassEval(ev, cls));
  const canEditEval = (ev: EvaluationItem) => !groupId || !ev.authorId || ev.authorId === uid;
  // 서버가 같은 값을 받은 칸은 덧씌움에서 걷는다
  useEffect(() => {
    if (!evals) return;
    setEvalOverlay((prev) => {
      let changed = false;
      const next: Record<string, EvalStudentPatch> = {};
      for (const [id, patch] of Object.entries(prev)) {
        const ev = evals.find((e) => e.id === id);
        const server = ev ? evalStudentValue(ev, num) : {};
        const left = Object.fromEntries(
          Object.entries(patch).filter(([k, v]) => (server[k] ?? '') !== (v ?? ''))
        ) as EvalStudentPatch;
        if (Object.keys(left).length !== Object.keys(patch).length) changed = true;
        if (Object.keys(left).length) next[id] = left;
      }
      return changed ? next : prev;
    });
  }, [evals, num]);
  const shownEvalValue = (ev: EvaluationItem) => ({ ...evalStudentValue(ev, num), ...(evalOverlay[ev.id] || {}) });
  const patchEval = (ev: EvaluationItem, patch: EvalStudentPatch) => {
    setEvalOverlay((prev) => ({ ...prev, [ev.id]: { ...(prev[ev.id] || {}), ...patch } }));
    enqueue('조사표를 저장하지 못했습니다. 네트워크를 확인해 주세요.', () =>
      saveStudentEval(uid, groupId, date, ev.id, num, patch)
    );
  };
  /** 글 칸은 적는 동안 들고 있다가 칸을 떠날 때(Enter) 저장한다 */
  const [evalDrafts, setEvalDrafts] = useState<Record<string, string>>({});
  const saveEvalText = (ev: EvaluationItem, field: 'reason' | 'memo') => {
    const draft = evalDrafts[ev.id];
    if (draft === undefined) return;
    if (draft !== String(shownEvalValue(ev)[field] || '')) patchEval(ev, { [field]: draft });
    setEvalDrafts(({ [ev.id]: _done, ...rest }) => rest);
  };

  // ── 관찰 한 줄 (개인 공간 오늘 기록) ──
  const [journal, setJournal] = useState<any[]>([]);
  useEffect(
    () =>
      subscribeJournalDay(uid, date, setJournal, (err) => console.warn('오늘 기록을 불러오지 못했습니다:', err)),
    [uid, date]
  );
  const todayLines = entriesForStudent(journal, tag);
  const [obs, setObs] = useState('');
  /** 적은 글(또는 누른 관찰 문구)로 한 줄 */
  const addObservation = (text: string = obs) => {
    const content = observationContent(text, tagText);
    if (!content) return;
    if (text === obs) setObs('');
    enqueue('기록에 남기지 못했습니다. 네트워크를 확인해 주세요.', async () => {
      const id = await addJournalLine(uid, date, content);
      showUndoToast(`📝 오늘 기록에 남겼습니다: ${content}`, async () => {
        const removed = await removeJournalLine(uid, date, id, content);
        return removed ? '↩️ 기록에서 뺐습니다.' : '그 사이 고친 기록이라 빼지 않았습니다. 하루 화면에서 지워 주세요.';
      });
    });
  };

  const chip = (on: boolean, tone: string) =>
    `px-2 py-1 rounded-lg border font-bold transition-colors ${on ? tone : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`;
  const gender =
    student.gender === 'M' || student.gender === '남' ? 'M' : student.gender === 'F' || student.gender === '여' ? 'F' : '';
  const sectionTitle = 'text-2xs font-black text-slate-400 mb-1';

  return (
    <div className="rounded-xl border border-primary/30 bg-white shadow-sm p-3 flex flex-col gap-3 text-xs" data-seat-student={num}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`font-black ${gender === 'M' ? 'text-sky-600' : gender === 'F' ? 'text-rose-500' : 'text-slate-400'}`}>{num}번</span>
        <span className="text-base font-black text-slate-800">{student.name || '(이름 없음)'}</span>
        <span className="text-slate-400 font-bold" title="학생 태그 - 기록에 적으면 누가기록이 모읍니다">
          {tagText}
        </span>
        {pending > 0 && <span className="text-slate-400">저장 중…</span>}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onOpenRecord} className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold">
            🧑‍🎓 누가기록
          </button>
          <button type="button" onClick={onOpenAttendance} className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold">
            📋 출석부
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="학생 칸 닫기"
            className="w-7 h-7 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>
      </div>
      {student.note?.trim() && <p className="text-slate-500 -mt-2">📌 {student.note.trim()}</p>}

      {!active ? (
        <p className="text-slate-400">전출한 학생입니다. 지난 기록은 누가기록에서 봅니다.</p>
      ) : (
        <>
          <section data-seat-student-section="attendance">
            <div className={sectionTitle}>오늘 {shortDateLabel(date)} 출결</div>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => shownRecord && changeAtt({ kind: null })}
                aria-pressed={!shownRecord}
                className={chip(!shownRecord, 'bg-emerald-600 text-white border-emerald-600')}
              >
                출석
              </button>
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => shownRecord?.kind !== k && changeAtt({ kind: k })}
                  aria-pressed={shownRecord?.kind === k}
                  className={chip(shownRecord?.kind === k, 'bg-rose-600 text-white border-rose-600')}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            {shownRecord && (
              <div className="flex flex-col gap-1.5 mt-1.5">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-slate-400 mr-1">사유</span>
                  {REASONS.map((rs) => (
                    <button
                      key={rs}
                      type="button"
                      onClick={() => shownRecord.reason !== rs && changeAtt({ reason: rs })}
                      aria-pressed={shownRecord.reason === rs}
                      className={chip(shownRecord.reason === rs, 'bg-slate-800 text-white border-slate-800')}
                    >
                      {REASON_LABEL[rs]}
                    </button>
                  ))}
                </div>
                {KIND_HAS_PERIODS[shownRecord.kind] && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-slate-400 mr-1">교시</span>
                    {Array.from({ length: maxPeriods }, (_, i) => i + 1).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => changeAtt({ togglePeriod: p })}
                        aria-pressed={!!shownRecord.periods?.includes(p)}
                        aria-label={`${p}교시`}
                        className={`w-7 h-6 rounded-md border font-bold ${
                          shownRecord.periods?.includes(p) ? 'bg-rose-100 border-rose-300 text-rose-700' : 'bg-white border-slate-200 text-slate-400'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  type="text"
                  value={noteDraft ?? shownRecord.note ?? ''}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onBlur={saveNote}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      saveNote();
                    }
                  }}
                  placeholder="사유 (예: 감기, 가족 체험학습)"
                  aria-label="출결 사유"
                  className="w-full px-2 py-1 border border-slate-200 rounded-lg"
                />
              </div>
            )}
          </section>

          <section data-seat-student-section="eval">
            <div className={sectionTitle}>오늘 조사표{groupId ? ' (지금 보는 그룹)' : ''}</div>
            {evals === null ? (
              <p className="text-slate-400">불러오는 중…</p>
            ) : classEvals.length === 0 ? (
              <p className="text-slate-400">오늘 이 학급의 조사표가 없습니다.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {classEvals.map((ev) => {
                  const val = shownEvalValue(ev);
                  const editable = canEditEval(ev);
                  const inList = evalHasStudent(ev, num);
                  const textField = ev.type === 'memo' ? 'memo' : 'reason';
                  return (
                    <div key={ev.id} className="flex flex-wrap items-center gap-1.5" data-seat-eval={ev.id}>
                      <span className="font-bold text-slate-700 truncate max-w-[45%]" title={ev.title}>
                        {ev.subject ? `${ev.subject} · ` : ''}
                        {ev.title || '(제목 없음)'}
                      </span>
                      <span className="text-2xs text-slate-400">{EVAL_TYPE_LABEL[ev.type] || ''}</span>
                      {!inList ? (
                        <span className="text-slate-400">명단에 없는 학생</span>
                      ) : (
                        <>
                          {ev.type === 'eval' && ev.methodObj?.indiv && (
                            <select
                              value={val.indivScore || ''}
                              onChange={(e) => patchEval(ev, { indivScore: e.target.value })}
                              disabled={!editable}
                              aria-label={`${ev.title} 개인 평가`}
                              className="border border-slate-200 rounded-lg py-0.5 px-1"
                            >
                              <option value="">-</option>
                              {(ev.steps || []).map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          )}
                          {ev.type === 'eval' && ev.methodObj?.group && (
                            <select
                              value={val.groupScore || ''}
                              onChange={(e) => patchEval(ev, { groupScore: e.target.value })}
                              disabled={!editable}
                              aria-label={`${ev.title} 모둠 평가`}
                              className="border border-slate-200 rounded-lg py-0.5 px-1"
                            >
                              <option value="">모둠 -</option>
                              {(ev.steps || []).map((s) => (
                                <option key={s} value={s}>
                                  모둠 {s}
                                </option>
                              ))}
                            </select>
                          )}
                          {ev.type === 'check' && (
                            <input
                              type="checkbox"
                              checked={!!val.checked}
                              onChange={(e) => patchEval(ev, { checked: e.target.checked })}
                              disabled={!editable}
                              aria-label={`${ev.title} 체크`}
                              className="w-5 h-5 accent-slate-600"
                            />
                          )}
                          <input
                            type="text"
                            value={evalDrafts[ev.id] ?? String(val[textField] || '')}
                            onChange={(e) => setEvalDrafts((d) => ({ ...d, [ev.id]: e.target.value }))}
                            onBlur={() => saveEvalText(ev, textField)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                saveEvalText(ev, textField);
                              }
                            }}
                            readOnly={!editable}
                            placeholder={ev.type === 'memo' ? '메모' : '근거'}
                            aria-label={`${ev.title} ${ev.type === 'memo' ? '메모' : '근거'}`}
                            className="flex-1 min-w-24 px-2 py-0.5 border border-slate-200 rounded-lg"
                          />
                          {!editable && <span className="text-2xs text-slate-400">다른 사람이 만든 조사표</span>}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section data-seat-student-section="observe">
            <div className={sectionTitle}>관찰 한 줄 → 오늘 기록 (개인)</div>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    addObservation();
                  }
                }}
                placeholder="예: 모둠 활동에서 친구를 잘 도움"
                aria-label="관찰 한 줄"
                className="flex-1 min-w-0 px-2 py-1 border border-slate-200 rounded-lg"
              />
              <button
                type="button"
                onClick={() => addObservation()}
                disabled={!obs.trim()}
                className="px-2.5 py-1 rounded-lg bg-slate-800 text-white font-bold disabled:opacity-40"
              >
                기록에 남기기
              </button>
            </div>
            <ObservationPhrases onPick={(p) => addObservation(p)} />
            {todayLines.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-0.5 text-slate-600" data-seat-student-lines>
                {todayLines.map((e) => (
                  <li key={String(e.id)} className="truncate">
                    · {String(e.content || '').replace(tagText, '').replace(/\s+/g, ' ').trim()}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
