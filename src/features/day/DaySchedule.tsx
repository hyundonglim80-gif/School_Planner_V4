import React, { useState, useEffect, Suspense, lazy } from 'react';
import type { PeriodSchedule } from '../../hooks/useDayData';
import { useTimetableTemplate } from '../../hooks/useTimetableTemplate';
import { useAppStore } from '../../store/useAppStore';
import { focusKey } from '../../lib/searchFocus';
import { parseDateStr } from '../../lib/dateUtils';
import AutoTextarea from '../../components/AutoTextarea';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useDayEvalCounts } from '../../hooks/useDayEvalCounts';
import { showToast } from '../../utils/toast';
const TimetableTemplateModal = lazy(() => import('../../components/TimetableTemplateModal'));

interface DayScheduleProps {
  schedules: Record<number, PeriodSchedule>;
  onSavePeriod: (period: number, data: PeriodSchedule) => Promise<void>;
  onReorderPeriods: (source: number, target: number) => Promise<void>;
  dateStr?: string;
  maxPeriods?: number;
}

const PERIOD_COLORS = [
  'bg-blue-50 text-blue-700 border-blue-200',
  'bg-emerald-50 text-emerald-700 border-emerald-200',
  'bg-amber-50 text-amber-700 border-amber-200',
  'bg-purple-50 text-purple-700 border-purple-200',
  'bg-rose-50 text-rose-700 border-rose-200',
  'bg-indigo-50 text-indigo-700 border-indigo-200',
  'bg-slate-50 text-slate-700 border-slate-200',
];

export default function DaySchedule({
  schedules,
  onSavePeriod,
  onReorderPeriods,
  dateStr,
  maxPeriods = 6,
}: DayScheduleProps) {
  const [editingPeriod, setEditingPeriod] = useState<number | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editMemo, setEditMemo] = useState('');
  const [editSupplies, setEditSupplies] = useState('');
  const [saving, setSaving] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);

  const { getDayTemplate } = useTimetableTemplate();
  const { openLinkerModal, openLinkViewerModal, openEvaluationModal, selectedGroupId } = useAppStore();
  // 어느 교시에 조사표를 만들어 두었는지 교시 옆에 숫자로 보여 준다
  const evalCounts = useDayEvalCounts(dateStr || '', selectedGroupId);

  const startEdit = (period: number) => {
    const current = schedules[period] || { subject: '', content: '' };
    setEditSubject(current.subject || '');
    setEditMemo(current.memo || current.content || '');
    setEditSupplies(current.supplies || '');
    setEditingPeriod(period);
  };

  const handleSave = async (period: number) => {
    try {
      setSaving(true);
      const current = schedules[period] || { linkedItems: [] };
      await onSavePeriod(period, {
        subject: editSubject.trim(),
        content: editMemo.trim(),
        memo: editMemo.trim(),
        supplies: editSupplies.trim(),
        linkedItems: current.linkedItems,
      });
      setEditingPeriod(null);
      showToast(`✅ ${period}교시 수업 내용을 저장했습니다.`);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingPeriod(null);
    setEditSubject('');
    setEditMemo('');
    setEditSupplies('');
  };

  // 페이지의 다른 곳을 누르면 '닫기'와 같게 수정 섹션을 닫는다
  const editRef = useClickOutside<HTMLDivElement>(editingPeriod !== null, handleCancel);

  const handleApplyTemplate = async () => {
    if (!dateStr) return;
    const dateObj = parseDateStr(dateStr);
    const dayOfWeek = dateObj.getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      showToast('주말에는 적용할 기본 시간표가 없습니다.');
      return;
    }

    const templateForToday = getDayTemplate(dayOfWeek);
    const hasAnySubject = Object.values(templateForToday).some(Boolean);

    if (!hasAnySubject) {
      if (window.confirm('등록된 기본 시간표가 없습니다. 지금 기본 시간표를 설정하시겠습니까?')) {
        setIsTemplateModalOpen(true);
      }
      return;
    }

    if (window.confirm('오늘 요일의 기본 시간표 과목을 불러와 적용하시겠습니까?\n(기존 수업 내용이나 준비물은 유지됩니다)')) {
      for (let p = 1; p <= maxPeriods; p++) {
        const sub = templateForToday[p];
        if (sub) {
          const current = schedules[p] || {};
          await onSavePeriod(p, {
            subject: sub,
            content: current.content || '',
            memo: current.memo || current.content || '',
            supplies: current.supplies || '',
            linkedItems: current.linkedItems,
          });
        }
      }
    }
  };

  const [isCollapsed, setIsCollapsed] = useState(false);

  // 검색에서 이 칸의 항목으로 '이동'해 오면 접혀 있던 칸을 펼친다.
  // 접힌 채로는 항목이 그려지지 않아 찾아 줄 수가 없다.
  const focusSection = useAppStore((s) => s.focusTarget?.section);
  useEffect(() => {
    if (focusSection === 'schedule') {
      setIsCollapsed(false);
    }
  }, [focusSection]);
  const periods = Array.from({ length: maxPeriods }, (_, i) => i + 1);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5">
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${isCollapsed ? '' : 'mb-4'}`}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-slate-400 hover:text-slate-700 text-xs px-1 py-0.5 rounded hover:bg-slate-100 transition-colors"
            title={isCollapsed ? '수업 펼치기' : '수업 접기'}
          >
            {isCollapsed ? '▶' : '▼'}
          </button>
          <span className="text-xl">⏰</span>
          <h3 className="text-base font-extrabold text-slate-800">수업</h3>
        </div>

        {!isCollapsed && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsTemplateModalOpen(true)}
              className="px-2 py-1 text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
            >
              ⚙️ 설정
            </button>
          </div>
        )}
      </div>

      {!isCollapsed && (
        <div className="grid grid-cols-1 gap-3">
        {periods.map((period) => {
          const item = schedules[period] || { subject: '', content: '' };
          const isEditing = editingPeriod === period;
          const colorClass = PERIOD_COLORS[(period - 1) % PERIOD_COLORS.length];
          const linkCount = (item.linkedItems || []).length;

          if (isEditing) {
            return (
              <div
                key={period}
                data-focus-key={dateStr ? focusKey.period(dateStr, period) : undefined}
                ref={editRef}
                className="p-4 rounded-xl border-2 border-primary bg-blue-50/20 shadow-xs flex flex-col gap-2"
              >
                <div className="flex items-center justify-between">
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-black border ${colorClass}`}>
                    {period}교시
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleCancel}
                      disabled={saving}
                      className="px-2.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-200/60 rounded-lg transition-colors"
                    >
                      닫기
                    </button>
                    <button
                      onClick={() => handleSave(period)}
                      disabled={saving}
                      className="px-3 py-1 bg-primary text-white text-xs font-bold rounded-lg hover:bg-blue-600 transition-colors shadow-xs"
                    >
                      {saving ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </div>

                {/* 링크·조사표는 팝업을 열지 않고도 이 자리에서 바로 붙일 수 있어야 한다 */}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => dateStr && openLinkerModal('schedule', dateStr, undefined, period)}
                    className="px-3 py-1.5 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    🔗 링크 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => dateStr && openEvaluationModal(dateStr, 'schedule', period, editSubject)}
                    className="px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    📊 조사표 추가
                  </button>
                  {linkCount > 0 && (
                    <button
                      type="button"
                      onClick={() => dateStr && openLinkViewerModal('schedule', dateStr, String(period), period)}
                      className="px-3 py-1.5 bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      📑 연결된 링크 ({linkCount})
                    </button>
                  )}
                </div>
                <div 
                  className="grid grid-cols-3 gap-2"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') handleCancel();
                    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
                      e.preventDefault();
                      handleSave(period);
                    }
                  }}
                >
                  <input
                    type="text"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    placeholder="과목"
                    className="col-span-1 px-3 py-1.5 text-xs font-bold bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                    autoFocus
                  />
                  <input
                    type="text"
                    value={editSupplies}
                    onChange={(e) => setEditSupplies(e.target.value)}
                    placeholder="준비물"
                    className="col-span-2 px-3 py-1.5 text-xs font-bold bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <AutoTextarea
                  value={editMemo}
                  onChange={(e) => setEditMemo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') handleCancel();
                    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
                      e.preventDefault();
                      handleSave(period);
                    }
                  }}
                  placeholder="수업 메모..."
                  className="w-full min-h-[40px] p-2.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary placeholder-slate-400 leading-relaxed"
                />
              </div>
            );
          }
          return (
            <div
              key={period}
              data-focus-key={dateStr ? focusKey.period(dateStr, period) : undefined}
              onClick={() => startEdit(period)}
              title="클릭하여 수정"
              className="group p-3.5 rounded-xl border border-slate-200/70 transition-all flex flex-col justify-between min-h-[40px] hover:border-primary/50 hover:bg-slate-50/50 cursor-pointer"
            >
              <div className="flex gap-3 h-full items-stretch">
                <div className="flex flex-col items-center justify-center gap-1 shrink-0 px-1">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); if (period > 1) onReorderPeriods(period, period - 1); }}
                    disabled={period <= 1}
                    className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-xs"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); if (period < maxPeriods) onReorderPeriods(period, period + 1); }}
                    disabled={period >= maxPeriods}
                    className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-xs"
                  >
                    ▼
                  </button>
                </div>
                <div className="flex-1 flex flex-col min-w-0">
                  {/* 과목 이름이 길어도 오른쪽 단추들을 밀어내지 않게, 줄어드는
                      쪽과 줄어들면 안 되는 쪽을 갈라 둔다. */}
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className={`px-2 py-0.5 shrink-0 rounded-lg text-xs font-bold border ${colorClass}`}>
                        {period}교시
                      </span>
                      <span className="font-bold text-sm text-slate-800 truncate">
                        {item.subject || <span className="text-slate-300 font-normal">과목 미등록</span>}
                      </span>
                      {linkCount > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); dateStr && openLinkViewerModal('schedule', dateStr, String(period), period); }}
                          className="bg-yellow-100 text-yellow-800 text-xs px-1.5 py-0.5 rounded font-bold border border-yellow-300 shrink-0 hover:bg-yellow-200 cursor-pointer"
                          title="연결된 항목 보기 및 수정"
                        >
                          📑 {linkCount}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); dateStr && openLinkerModal('schedule', dateStr, undefined, period); }}
                        className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 p-1 rounded hover:bg-slate-100 text-xs transition-all"
                        title="링크 추가"
                      >
                        🔗
                      </button>
                      {/* 조사표를 만들어 둔 교시는 마우스를 올리지 않아도 보여야
                          한다. 없을 때만 숨었다가 마우스를 올리면 나타난다. */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); dateStr && openEvaluationModal(dateStr, 'schedule', period); }}
                        className={`p-1 rounded hover:bg-slate-100 text-xs transition-all ${
                          evalCounts.byPeriod[String(period)]
                            ? 'text-blue-700 bg-blue-50 border border-blue-200 font-bold'
                            : 'opacity-0 group-hover:opacity-100 text-slate-400 hover:text-emerald-600'
                        }`}
                        title={
                          evalCounts.byPeriod[String(period)]
                            ? `조사표 ${evalCounts.byPeriod[String(period)]}건`
                            : '조사표 관리'
                        }
                      >
                        📊{evalCounts.byPeriod[String(period)] || ''}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); startEdit(period); }}
                        className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 p-1 rounded hover:bg-slate-100 text-xs transition-all"
                        title="수업 수정"
                      >
                        ✏️
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="flex flex-col">
                      <span className="text-slate-400 text-xs mb-0.5">📝 수업 메모</span>
                      <p className="text-slate-600 whitespace-pre-wrap leading-relaxed">
                        {item.memo || item.content || <span className="text-slate-300">없음</span>}
                      </p>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-slate-400 text-xs mb-0.5">📌 비고 / 준비물</span>
                      <p className="text-amber-600 font-medium whitespace-pre-wrap leading-relaxed">
                        {item.supplies || <span className="text-slate-300 font-normal">없음</span>}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {isTemplateModalOpen && (
        <Suspense fallback={null}>
          <TimetableTemplateModal isOpen onClose={() => setIsTemplateModalOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
