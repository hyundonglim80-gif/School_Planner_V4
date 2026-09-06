import React, { useState } from 'react';
import type { PeriodSchedule } from '../../hooks/useDayData';
import { useTimetableTemplate } from '../../hooks/useTimetableTemplate';
import { useAppStore } from '../../store/useAppStore';
import { parseDateStr } from '../../lib/dateUtils';
import TimetableTemplateModal from '../../components/TimetableTemplateModal';

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
  
  const [draggedPeriod, setDraggedPeriod] = useState<number | null>(null);

  const { getDayTemplate } = useTimetableTemplate();
  const { mode, openLinkerModal, openEvaluationModal } = useAppStore();

  const startEdit = (period: number) => {
    if (mode === 'viewer') return;
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

  const handleApplyTemplate = async () => {
    if (!dateStr) return;
    const dateObj = parseDateStr(dateStr);
    const dayOfWeek = dateObj.getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      alert('주말에는 적용할 기본 시간표가 없습니다.');
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

  const handleDragStart = (e: React.DragEvent, period: number) => {
    if (mode === 'viewer') return;
    setDraggedPeriod(period);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (mode === 'viewer') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetPeriod: number) => {
    if (mode === 'viewer') return;
    e.preventDefault();
    if (draggedPeriod !== null && draggedPeriod !== targetPeriod) {
      await onReorderPeriods(draggedPeriod, targetPeriod);
    }
    setDraggedPeriod(null);
  };

  const [isCollapsed, setIsCollapsed] = useState(false);
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
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => dateStr && openEvaluationModal(dateStr, 'schedule', 1)}
              className="px-2 py-0.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-md text-[10px] font-bold hover:bg-blue-100"
            >
              +조사표
            </button>
            <button
              onClick={() => dateStr && openLinkerModal('schedule', dateStr)}
              className="px-2 py-0.5 bg-yellow-50 text-yellow-700 border border-yellow-300 rounded-md text-[10px] font-bold hover:bg-yellow-100"
            >
              +링크
            </button>
          </div>
        </div>

        {!isCollapsed && mode === 'editor' && (
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
                      취소
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

                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    placeholder="과목명 (예: 국어)"
                    className="col-span-1 px-3 py-1.5 text-xs font-bold bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                    autoFocus
                  />
                  <input
                    type="text"
                    value={editSupplies}
                    onChange={(e) => setEditSupplies(e.target.value)}
                    placeholder="비고 / 준비물"
                    className="col-span-2 px-3 py-1.5 text-xs font-bold bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <textarea
                  value={editMemo}
                  onChange={(e) => setEditMemo(e.target.value)}
                  placeholder="수업 내용 메모..."
                  rows={2}
                  className="w-full p-2.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none placeholder-slate-400 leading-relaxed"
                />
              </div>
            );
          }

          return (
            <div
              key={period}
              draggable={mode === 'editor'}
              onDragStart={(e) => handleDragStart(e, period)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, period)}
              className={`group p-3.5 rounded-xl border border-slate-200/70 transition-all flex flex-col justify-between min-h-[80px] ${
                mode === 'editor'
                  ? 'hover:border-primary/50 hover:bg-slate-50/50 cursor-grab active:cursor-grabbing'
                  : 'bg-white shadow-2xs'
              }`}
            >
              <div className="flex gap-3 h-full items-stretch">
                {mode === 'editor' && (
                  <div className="flex items-center justify-center text-slate-300 cursor-grab active:cursor-grabbing px-1 hover:text-slate-500">
                    <span className="text-xl">≡</span>
                  </div>
                )}
                <div className="flex-1 cursor-pointer" onClick={() => startEdit(period)}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold border ${colorClass}`}>
                        {period}교시
                      </span>
                      <span className="font-bold text-sm text-slate-800">
                        {item.subject || <span className="text-slate-300 font-normal">과목 미등록</span>}
                      </span>
                      {linkCount > 0 && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); dateStr && openLinkerModal('schedule', dateStr, undefined, period); }}
                          className="bg-yellow-100 text-yellow-800 text-[10px] px-1.5 py-0.5 rounded font-bold border border-yellow-300 ml-1 hover:bg-yellow-200"
                        >
                          📑 {linkCount}
                        </button>
                      )}
                    </div>
                    {mode === 'editor' && (
                      <span className="text-xs text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        ✏️ 편집
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="flex flex-col">
                      <span className="text-slate-400 text-[10px] mb-0.5">📝 수업 메모</span>
                      <p className="text-slate-600 whitespace-pre-wrap leading-relaxed">
                        {item.memo || item.content || <span className="text-slate-300">없음</span>}
                      </p>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-slate-400 text-[10px] mb-0.5">📌 비고 / 준비물</span>
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

      <TimetableTemplateModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
      />
    </div>
  );
}
