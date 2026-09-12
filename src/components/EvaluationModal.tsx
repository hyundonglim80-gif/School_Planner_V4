import React, { useState, useEffect, useCallback } from 'react';
import { useEvaluation } from '../hooks/useEvaluation';
import type { EvaluationItem } from '../hooks/useEvaluation';
import { useRoster } from '../hooks/useRoster';
import { useAppStore } from '../store/useAppStore';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';

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
  const { selectedGroupId } = useAppStore();
  const { loadEvaluations, saveEvaluations, deleteEvaluation } = useEvaluation(selectedGroupId);
  const { rosterList: rosters } = useRoster();

  // 모드: 'list' | 'create' | 'view'
  const [viewMode, setViewMode] = useState<'list' | 'create' | 'view'>('list');
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

  useEffect(() => {
    if (isOpen) {
      loadList();
      setEvalDate(dateStr);
      setPeriod(String(defaultPeriod));
      setSubject(defaultSubject);
    }
  }, [isOpen, dateStr]);

  const loadList = async () => {
    setLoading(true);
    const list = await loadEvaluations(dateStr);
    setEvalList(list);
    setLoading(false);
    if (list.length === 0) {
      setViewMode('create');
    } else {
      setViewMode('list');
    }
  };

  const handleCreate = async () => {
    if (!title.trim()) return alert('제목을 입력하세요.');
    if (!rosters || rosters.length === 0) return alert('명렬표를 먼저 등록해주세요.');
    const selectedRoster = rosters[parseInt(rosterIdx, 10)];
    if (!selectedRoster) return alert('명렬표를 선택해주세요.');

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
    openViewer(newEval);
  };

  const openViewer = (ev: EvaluationItem) => {
    setCurrentEval(ev);
    setRecords(ev.records || {});
    setViewMode('view');
  };

  const handleSaveRecords = async () => {
    if (!currentEval) return;
    const updatedEval = { ...currentEval, records };
    const updatedList = evalList.map(e => e.id === currentEval.id ? updatedEval : e);
    await saveEvaluations(currentEval.dateStr, updatedList);
    setEvalList(updatedList);
    setCurrentEval(updatedEval);
    alert('✅ 저장되었습니다.');
  };

  const handleDelete = async () => {
    if (!currentEval) return;
    if (!confirm('정말 이 조사표를 삭제하시겠습니까?')) return;
    const remaining = await deleteEvaluation(currentEval.dateStr, currentEval.id);
    setEvalList(remaining);
    setCurrentEval(null);
    setViewMode(remaining.length > 0 ? 'list' : 'create');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 backdrop-blur-sm animate-fade-in" style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height }} onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-full flex flex-col border border-slate-200" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-black text-slate-800">📋 조사표 관리</h3>
            <span className="text-xs text-slate-400">{dateStr}</span>
          </div>
          <div className="flex items-center gap-2">
            {viewMode !== 'create' && (
              <button onClick={() => setViewMode('create')} className="px-3 py-1 bg-primary text-white rounded-lg text-xs font-bold">+ 새 조사표</button>
            )}
            {viewMode !== 'list' && evalList.length > 0 && (
              <button onClick={() => setViewMode('list')} className="px-3 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold">목록</button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-4" data-scroll-lock>
          {/* 목록 모드 */}
          {viewMode === 'list' && (
            <div className="space-y-2">
              {loading ? (
                <p className="text-center text-slate-400 text-xs py-8">불러오는 중...</p>
              ) : evalList.length === 0 ? (
                <p className="text-center text-slate-400 text-xs py-8">등록된 조사표가 없습니다.</p>
              ) : (
                evalList.map(ev => (
                  <button
                    key={ev.id}
                    onClick={() => openViewer(ev)}
                    className="w-full text-left p-3 bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-primary/30 rounded-xl transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-sm text-slate-800">{ev.title}</span>
                        <span className="ml-2 text-xs text-slate-400">
                          {ev.type === 'eval' ? '평가' : ev.type === 'check' ? '체크' : '메모'}
                          {ev.subject ? ` · ${ev.subject}` : ''}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400">{ev.studentsSnapshot?.length || 0}명</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

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

              <button onClick={handleCreate} className="w-full py-2.5 bg-primary text-white rounded-xl font-bold text-sm shadow-xs hover:bg-primary/90 transition-all">생성 완료</button>
            </div>
          )}

          {/* 뷰어 모드 */}
          {viewMode === 'view' && currentEval && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h4 className="font-black text-slate-800">{currentEval.title}</h4>
                  <p className="text-xs text-slate-400">
                    {currentEval.type === 'eval' ? '평가' : currentEval.type === 'check' ? '체크' : '메모'}
                    {currentEval.subject ? ` · ${currentEval.subject}` : ''} · {currentEval.studentsSnapshot.length}명
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="max-h-[50vh] overflow-y-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead className="bg-slate-100 sticky top-0">
                      <tr>
                        <th className="p-2 text-center w-12 border-b border-slate-200">번호</th>
                        <th className="p-2 text-left w-20 border-b border-slate-200">이름</th>
                        {currentEval.type === 'eval' && currentEval.methodObj.group && (
                          <><th className="p-2 text-center border-b border-slate-200">조</th><th className="p-2 text-center border-b border-slate-200">조별</th></>
                        )}
                        {currentEval.type === 'eval' && currentEval.methodObj.indiv && (
                          <th className="p-2 text-center border-b border-slate-200">개별</th>
                        )}
                        {currentEval.type === 'check' && (
                          <th className="p-2 text-center border-b border-slate-200">체크</th>
                        )}
                        <th className="p-2 text-left border-b border-slate-200">{currentEval.type === 'memo' ? '메모' : '사유/메모'}</th>
                      </tr>
                      {/* 전체 일괄 적용 행 */}
                      <tr className="bg-slate-50 border-b-2 border-slate-300">
                        <td colSpan={2} className="p-1.5 text-center text-slate-500 font-bold">전체 적용</td>
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
                            <button onClick={() => applyToAll('checked', true)} className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-bold mr-1">전체O</button>
                            <button onClick={() => applyToAll('checked', false)} className="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-xs font-bold">전체X</button>
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
                        return (
                          <tr key={st.num} className={isExited ? 'bg-slate-50 opacity-50' : 'hover:bg-slate-50/50'}>
                            <td className="p-1.5 text-center font-bold text-slate-500">{st.num}</td>
                            <td className="p-1.5 font-bold text-slate-800">{st.name}</td>
                            {currentEval.type === 'eval' && currentEval.methodObj.group && (
                              <>
                                <td className="p-1"><input value={rec.groupName || ''} onChange={e => updateRecord(st.num, 'groupName', e.target.value)} className="w-full px-1 py-0.5 border rounded text-center text-xs" /></td>
                                <td className="p-1">
                                  <select value={rec.groupScore || ''} onChange={e => updateRecord(st.num, 'groupScore', e.target.value)} className="w-full border rounded text-xs py-0.5">
                                    <option value=""></option>
                                    {currentEval.steps.map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                </td>
                              </>
                            )}
                            {currentEval.type === 'eval' && currentEval.methodObj.indiv && (
                              <td className="p-1">
                                <select value={rec.indivScore || ''} onChange={e => updateRecord(st.num, 'indivScore', e.target.value)} className="w-full border rounded text-xs py-0.5">
                                  <option value=""></option>
                                  {currentEval.steps.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                              </td>
                            )}
                            {currentEval.type === 'check' && (
                              <td className="p-1 text-center">
                                <input type="checkbox" checked={!!rec.checked} onChange={e => updateRecord(st.num, 'checked', e.target.checked)} className="w-4 h-4 accent-primary" />
                              </td>
                            )}
                            <td className="p-1">
                              <input
                                value={rec[currentEval.type === 'memo' ? 'memo' : 'reason'] || ''}
                                onChange={e => updateRecord(st.num, currentEval.type === 'memo' ? 'memo' : 'reason', e.target.value)}
                                className="w-full px-1 py-0.5 border rounded text-xs"
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
            <button onClick={handleDelete} className="px-3 py-2 text-red-500 hover:bg-red-50 border border-red-200 rounded-xl text-xs font-bold transition-all">삭제</button>
            <div className="flex gap-2">
              <button onClick={() => setViewMode('list')} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold">닫기</button>
              <button onClick={handleSaveRecords} className="px-5 py-2 bg-primary text-white rounded-xl text-xs font-bold shadow-xs">저장</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
