import React, { useState, useEffect } from 'react';
import { showToast, showErrorToast } from '../utils/toast';
import {
  useTimetableTemplate,
  getSemesterRanges,
  type WeekDayKey,
  type WeekTimetable,
  type TimetableTemplateItem,
} from '../hooks/useTimetableTemplate';
import { formatDate } from '../lib/dateUtils';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer, closeAllModals } from '../hooks/useModalLayer';

interface TimetableTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DAYS: { key: WeekDayKey; label: string; color: string }[] = [
  { key: 'mon', label: '월요일', color: 'text-blue-600' },
  { key: 'tue', label: '화요일', color: 'text-indigo-600' },
  { key: 'wed', label: '수요일', color: 'text-emerald-600' },
  { key: 'thu', label: '목요일', color: 'text-amber-600' },
  { key: 'fri', label: '금요일', color: 'text-rose-600' },
];

export default function TimetableTemplateModal({ isOpen, onClose }: TimetableTemplateModalProps) {
  useBodyScrollLock(isOpen);

  const vv = useVisualViewport(isOpen);

  const zIndex = useModalLayer(isOpen, onClose);
  const {
    templates,
    currentTemplateName,
    setCurrentTemplateName,
    semesterConfig,
    setSemesterConfig,
    loading,
    syncToCloud,
    applyTimetableToCalendar,
  } = useTimetableTemplate();

  // 현재 편집 중인 템플릿의 로컬 상태
  const [editingTemplates, setEditingTemplates] = useState<Record<string, TimetableTemplateItem>>({});
  const [selectedTemplate, setSelectedTemplate] = useState<string>('1학기 시간표');

  // 방학 기간 로컬 상태 (학기는 여기서 계산한다)
  const [summerStart, setSummerStart] = useState('');
  const [summerEnd, setSummerEnd] = useState('');
  const [winterStart, setWinterStart] = useState('');
  const [winterEnd, setWinterEnd] = useState('');

  // 캘린더 적용 기간 상태
  const [applyStart, setApplyStart] = useState('');
  const [applyEnd, setApplyEnd] = useState('');

  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  // 💡 입력칸을 클라우드 값으로 채우는 것은 "한 번 열 때 한 번"만 한다.
  // 예전에는 templates/semesterConfig가 바뀔 때마다 이 효과가 다시 돌았다. 구독이
  // 스냅샷을 한 번 더 주는 것만으로도 입력 중이던 시간표와 방학 날짜가 클라우드 값으로
  // 되돌아갔고, 그 상태로 저장하면 방금 입력한 내용이 그대로 사라졌다.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setHydrated(false);
      return;
    }
    // 아직 클라우드에서 못 읽었으면 기다린다. 기본값으로 채워두면 저장할 때
    // 저장돼 있던 시간표를 기본값으로 덮어쓴다.
    if (loading || hydrated) return;

    if (templates && Object.keys(templates).length > 0) {
      setEditingTemplates(JSON.parse(JSON.stringify(templates)));
      setSelectedTemplate(currentTemplateName || Object.keys(templates)[0]);
    }

    setSummerStart(semesterConfig.summerStart || '');
    setSummerEnd(semesterConfig.summerEnd || '');
    setWinterStart(semesterConfig.winterStart || '');
    setWinterEnd(semesterConfig.winterEnd || '');

    // 기본 적용 기간을 1학기(계산값)로 설정
    const ranges = getSemesterRanges(semesterConfig);
    setApplyStart(ranges.sem1.start || formatDate(new Date()));
    setApplyEnd(ranges.sem1.end || formatDate(new Date()));

    setHydrated(true);
  }, [isOpen, loading, hydrated, templates, currentTemplateName, semesterConfig]);

  if (!isOpen) return null;

  const currentTpl = editingTemplates[selectedTemplate] || {
    names: ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시'],
    data: { mon: {}, tue: {}, wed: {}, thu: {}, fri: {} },
  };

  const periodNames = currentTpl.names || ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시'];
  const gridData = currentTpl.data || { mon: {}, tue: {}, wed: {}, thu: {}, fri: {} };

  // 템플릿 변경
  const handleSelectTemplate = (name: string) => {
    setSelectedTemplate(name);
    setCurrentTemplateName(name);
  };

  // 새 템플릿으로 저장
  const handleSaveAsNewTemplate = () => {
    const newName = prompt('저장할 새 시간표의 이름을 입력하세요.\n(예: 1학기 지필평가, 단축수업 시간표 등)', selectedTemplate);
    if (!newName || !newName.trim()) return;

    const clean = newName.trim();
    const updated = {
      ...editingTemplates,
      [clean]: {
        names: [...periodNames],
        data: JSON.parse(JSON.stringify(gridData)),
      },
    };
    setEditingTemplates(updated);
    setSelectedTemplate(clean);
    setCurrentTemplateName(clean);
  };

  // 템플릿 삭제
  const handleDeleteTemplate = () => {
    if (Object.keys(editingTemplates).length <= 1) {
      alert('최소 1개의 시간표 템플릿은 남아있어야 합니다.');
      return;
    }
    if (confirm(`현재 표시된 [${selectedTemplate}] 시간표를 삭제하시겠습니까?`)) {
      const updated = { ...editingTemplates };
      delete updated[selectedTemplate];
      const remainingName = Object.keys(updated)[0];
      setEditingTemplates(updated);
      setSelectedTemplate(remainingName);
      setCurrentTemplateName(remainingName);
    }
  };

  // 교시명 수정
  const handleUpdatePeriodName = (idx: number, name: string) => {
    const updated = { ...editingTemplates };
    const newNames = [...periodNames];
    newNames[idx] = name;
    updated[selectedTemplate] = {
      ...currentTpl,
      names: newNames,
    };
    setEditingTemplates(updated);
  };

  // 교시 추가
  const handleAddPeriod = () => {
    const nextNum = periodNames.length + 1;
    const updated = { ...editingTemplates };
    const newNames = [...periodNames, `${nextNum}교시`];
    updated[selectedTemplate] = {
      ...currentTpl,
      names: newNames,
    };
    setEditingTemplates(updated);
  };

  // 교시 삭제
  const handleRemovePeriod = () => {
    if (periodNames.length <= 1) return;
    const updated = { ...editingTemplates };
    const newNames = periodNames.slice(0, -1);
    updated[selectedTemplate] = {
      ...currentTpl,
      names: newNames,
    };
    setEditingTemplates(updated);
  };

  // 과목 입력 수정
  const handleUpdateSubject = (day: WeekDayKey, period: number, subject: string) => {
    const updated = { ...editingTemplates };
    const curData = { ...(updated[selectedTemplate].data || {}) };
    curData[day] = {
      ...(curData[day] || {}),
      [period]: subject,
    };
    updated[selectedTemplate] = {
      ...currentTpl,
      data: curData,
    };
    setEditingTemplates(updated);
  };

  // 저장이 안전한 시점인지. 클라우드 값을 아직 못 읽었으면 저장하면 안 된다.
  // (기본값으로 채워진 화면을 그대로 쓰면 저장돼 있던 시간표/방학이 날아간다)
  const canSave = !loading && hydrated;

  // 방학 기간 저장 (학기는 여기서 계산된다)
  const handleSaveSemesterDates = async () => {
    if (!canSave) return;
    if (!summerStart || !summerEnd || !winterStart || !winterEnd) {
      return alert('여름 방학과 겨울 방학의 시작일·종료일을 모두 입력해주세요.');
    }
    if (summerStart > summerEnd) return alert('여름 방학의 시작일이 종료일보다 늦습니다.');
    if (winterStart > winterEnd) return alert('겨울 방학의 시작일이 종료일보다 늦습니다.');

    const newConf = { ...semesterConfig, summerStart, summerEnd, winterStart, winterEnd };
    setSemesterConfig(newConf);
    await syncToCloud(editingTemplates, newConf);
    showToast('✅ 방학 기간이 저장되었습니다.');
  };

  // 입력한 방학 기간으로 계산한 학기 (화면 표시 및 빠른 채우기에 사용)
  const derivedRanges = getSemesterRanges({
    ...semesterConfig,
    summerStart,
    summerEnd,
    winterStart,
    winterEnd,
  });

  // 기간 빠른 채우기 버튼
  const handleFillApplyDates = (type: 'sem1' | 'sem2' | 'week') => {
    if (type === 'sem1') {
      if (!derivedRanges.sem1.start || !derivedRanges.sem1.end) {
        return alert('여름 방학 시작일을 먼저 지정해주세요. 1학기는 3월 1일부터 여름 방학 전날까지입니다.');
      }
      setApplyStart(derivedRanges.sem1.start);
      setApplyEnd(derivedRanges.sem1.end);
    } else if (type === 'sem2') {
      if (!derivedRanges.sem2.start || !derivedRanges.sem2.end) {
        return alert('여름 방학 종료일과 겨울 방학 시작일을 먼저 지정해주세요.');
      }
      setApplyStart(derivedRanges.sem2.start);
      setApplyEnd(derivedRanges.sem2.end);
    } else if (type === 'week') {
      const now = new Date();
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const mon = new Date(now.setDate(diff));
      const fri = new Date(now.setDate(diff + 4));
      setApplyStart(formatDate(mon));
      setApplyEnd(formatDate(fri));
    }
  };

  // 캘린더에 일괄 덮어쓰기 (핵심 기능)
  const handleApplyToCalendar = async () => {
    if (!applyStart || !applyEnd) {
      return alert('적용할 기간의 시작일과 종료일을 모두 선택해주세요.');
    }
    if (applyStart > applyEnd) {
      return alert('시작일이 종료일보다 늦을 수 없습니다.');
    }

    if (!confirm(`지정한 기간(${applyStart} ~ ${applyEnd})에\n현재 화면의 [${selectedTemplate}] 시간표를 일괄 적용하시겠습니까?\n\n(※ 공휴일 및 행사 휴업일은 자동으로 제외되며, 기존 메모/준비물은 보존됩니다.)`)) {
      return;
    }

    if (!canSave) return;
    setApplying(true);
    try {
      // 먼저 최신 템플릿을 저장
      await syncToCloud(editingTemplates);

      const res = await applyTimetableToCalendar(applyStart, applyEnd, gridData, periodNames);
      showToast(`✅ 시간표 적용 완료 - 수업일 ${res.appliedCount}일, 제외 ${res.skippedCount}일`);
    } catch (e) {
      showErrorToast('시간표 적용 중 오류가 발생했습니다.', e);
    } finally {
      setApplying(false);
    }
  };

  // 전체 템플릿 저장
  const handleSaveAll = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await syncToCloud(editingTemplates);
      showToast('✅ 시간표 템플릿이 클라우드에 저장되었습니다.');
    } catch (e) {
      showErrorToast('저장 중 오류가 발생했습니다.', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-black/50 p-4 animate-fade-in backdrop-blur-xs" style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }} onClick={closeAllModals}>
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-full" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="text-xl">⏰</span>
            <h2 className="text-base font-extrabold text-slate-800">시간표 마스터 모듈 & 템플릿 설정</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-black text-lg p-1 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 상단 템플릿 선택 및 관리 바 */}
        <div className="flex items-center justify-between px-6 py-3 bg-blue-50 border-b border-blue-100 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-blue-900">시간표 선택:</span>
            <select
              value={selectedTemplate}
              onChange={(e) => handleSelectTemplate(e.target.value)}
              className="bg-white border border-blue-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs focus:outline-none"
            >
              {Object.keys(editingTemplates).map((name) => (
                <option key={name} value={name}>
                  📅 {name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveAsNewTemplate}
              className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-all"
            >
              + 새 시간표로 저장
            </button>
            <button
              onClick={handleDeleteTemplate}
              className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg text-xs font-bold transition-all"
            >
              선택 삭제
            </button>
          </div>
        </div>

        {/* 스크롤 컨텐츠 */}
        <div className="p-6 overflow-y-auto overscroll-contain space-y-5 flex-1 min-h-0" data-scroll-lock>
          {/* 1. 시간표 테이블 (교시 관리 포함) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">과목 시간표 매트릭스</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleAddPeriod}
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-bold border border-slate-200"
                >
                  + 교시 추가
                </button>
                <button
                  onClick={handleRemovePeriod}
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-bold border border-slate-200"
                >
                  - 교시 삭제
                </button>
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-center border-collapse">
                  <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5 w-24">교시명</th>
                      {DAYS.map((d) => (
                        <th key={d.key} className={`p-2.5 ${d.color}`}>
                          {d.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {periodNames.map((name, pIdx) => {
                      const periodNum = pIdx + 1;
                      return (
                        <tr key={periodNum} className="hover:bg-slate-50/50">
                          <td className="p-1.5 bg-slate-50 border-r border-slate-200">
                            <input
                              type="text"
                              value={name}
                              onChange={(e) => handleUpdatePeriodName(pIdx, e.target.value)}
                              className="w-full text-center bg-transparent font-bold text-slate-700 focus:outline-none focus:bg-white focus:border focus:border-blue-400 rounded px-1 py-0.5"
                            />
                          </td>
                          {DAYS.map((d) => {
                            const val = (gridData[d.key] || {})[periodNum] || '';
                            return (
                              <td key={d.key} className="p-1 border-r border-slate-100 last:border-r-0">
                                <input
                                  type="text"
                                  value={val}
                                  onChange={(e) => handleUpdateSubject(d.key, periodNum, e.target.value)}
                                  placeholder="과목"
                                  className="w-full text-center bg-white border border-transparent hover:border-slate-200 focus:border-blue-500 rounded px-1 py-1 font-bold text-slate-800 focus:outline-none"
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* 2. 학사일정(학기 기간) 설정 */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-slate-800">📅 학사일정(학기) 기간 설정</span>
              <button
                onClick={handleSaveSemesterDates}
                disabled={!canSave}
                title={!canSave ? '저장된 설정을 불러오는 중입니다' : undefined}
                className="px-3 py-1 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-xs font-bold rounded-lg transition-colors"
              >
                방학 기간 저장
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5">
                <span className="font-bold text-orange-700">☀️ 여름 방학 기간</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={summerStart}
                    onChange={(e) => setSummerStart(e.target.value)}
                    className="flex-1 border border-slate-200 rounded px-2 py-1 text-slate-700 font-bold"
                  />
                  <span>~</span>
                  <input
                    type="date"
                    value={summerEnd}
                    onChange={(e) => setSummerEnd(e.target.value)}
                    className="flex-1 border border-slate-200 rounded px-2 py-1 text-slate-700 font-bold"
                  />
                </div>
              </div>

              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5">
                <span className="font-bold text-sky-700">❄️ 겨울 방학 기간</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={winterStart}
                    onChange={(e) => setWinterStart(e.target.value)}
                    className="flex-1 border border-slate-200 rounded px-2 py-1 text-slate-700 font-bold"
                  />
                  <span>~</span>
                  <input
                    type="date"
                    value={winterEnd}
                    onChange={(e) => setWinterEnd(e.target.value)}
                    className="flex-1 border border-slate-200 rounded px-2 py-1 text-slate-700 font-bold"
                  />
                </div>
              </div>
            </div>

            {/* 방학 기간에서 계산된 학기 */}
            <div className="mt-3 bg-white/70 border border-slate-200 rounded-lg px-3 py-2 text-[16.5px] text-slate-600 space-y-0.5">
              <div>
                <span className="font-bold text-blue-700">1학기</span>{' '}
                {derivedRanges.sem1.start && derivedRanges.sem1.end
                  ? `${derivedRanges.sem1.start} ~ ${derivedRanges.sem1.end}`
                  : '여름 방학 시작일을 입력하면 계산됩니다'}
                <span className="text-slate-400"> (3월 1일 ~ 여름 방학 전날)</span>
              </div>
              <div>
                <span className="font-bold text-indigo-700">2학기</span>{' '}
                {derivedRanges.sem2.start && derivedRanges.sem2.end
                  ? `${derivedRanges.sem2.start} ~ ${derivedRanges.sem2.end}`
                  : '여름 방학 종료일과 겨울 방학 시작일을 입력하면 계산됩니다'}
                <span className="text-slate-400"> (여름 방학 다음 날 ~ 겨울 방학 전날)</span>
              </div>
              <div className="text-slate-500 pt-0.5">
                방학 기간에는 시간표 수업이 채워지지 않습니다.
              </div>
            </div>
          </div>

          {/* 3. 시간표 캘린더 일괄 적용 섹션 (V3 핵심 기능) */}
          <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <span className="text-xs font-extrabold text-emerald-900 block">
                  🚀 캘린더(하루/주간) 시간표 일괄 적용
                </span>
                <span className="text-[16.5px] text-emerald-700">
                  지정한 기간의 모든 평일(월~금)에 현재 시간표를 채웁니다. (방학·공휴일은 자동 제외)
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleFillApplyDates('sem1')}
                  className="px-2 py-1 bg-white hover:bg-emerald-100 text-emerald-800 text-[16.5px] font-bold rounded border border-emerald-300"
                >
                  1학기 기간 채우기
                </button>
                <button
                  onClick={() => handleFillApplyDates('sem2')}
                  className="px-2 py-1 bg-white hover:bg-emerald-100 text-emerald-800 text-[16.5px] font-bold rounded border border-emerald-300"
                >
                  2학기 기간 채우기
                </button>
                <button
                  onClick={() => handleFillApplyDates('week')}
                  className="px-2 py-1 bg-white hover:bg-emerald-100 text-emerald-800 text-[16.5px] font-bold rounded border border-emerald-300"
                >
                  이번 주 기간 채우기
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap pt-1">
              <div className="flex items-center gap-1.5 bg-white border border-emerald-300 rounded-lg px-2.5 py-1 text-xs">
                <span className="text-emerald-700 font-bold">적용 기간:</span>
                <input
                  type="date"
                  value={applyStart}
                  onChange={(e) => setApplyStart(e.target.value)}
                  className="text-slate-700 font-bold focus:outline-none"
                />
                <span>~</span>
                <input
                  type="date"
                  value={applyEnd}
                  onChange={(e) => setApplyEnd(e.target.value)}
                  className="text-slate-700 font-bold focus:outline-none"
                />
              </div>

              <button
                onClick={handleApplyToCalendar}
                disabled={applying || !canSave}
                title={!canSave ? '저장된 설정을 불러오는 중입니다' : undefined}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold shadow-xs transition-all flex items-center gap-1.5"
              >
                <span>⚡</span>
                {applying ? '적용 중...' : '이 기간에 시간표 일괄 덮어쓰기'}
              </button>
            </div>
          </div>
        </div>

        {/* 푸터 영역 */}
        <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-slate-100 bg-slate-50">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all"
          >
            닫기
          </button>
          <button
            onClick={handleSaveAll}
            disabled={saving || !canSave}
            title={!canSave ? '저장된 설정을 불러오는 중입니다' : undefined}
            className="px-5 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            <span>💾</span> {saving ? '저장 중...' : canSave ? '템플릿 클라우드 저장' : '불러오는 중...'}
          </button>
        </div>
      </div>
    </div>
  );
}
