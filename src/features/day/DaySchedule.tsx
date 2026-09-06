import React, { useState } from 'react';
import type { PeriodSchedule } from '../../hooks/useDayData';
import { useTimetableTemplate } from '../../hooks/useTimetableTemplate';
import { useAppStore } from '../../store/useAppStore';
import { parseDateStr } from '../../lib/dateUtils';
import TimetableTemplateModal from '../../components/TimetableTemplateModal';

interface DayScheduleProps {
  schedules: Record<number, PeriodSchedule>;
  onSavePeriod: (period: number, data: PeriodSchedule) => Promise<void>;
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
  dateStr,
  maxPeriods = 6,
}: DayScheduleProps) {
  const [editingPeriod, setEditingPeriod] = useState<number | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);

  const { getDayTemplate } = useTimetableTemplate();
  const { mode } = useAppStore();

  const startEdit = (period: number) => {
    if (mode === 'viewer') return; // 수업 모드에서는 편집창 방지
    const current = schedules[period] || { subject: '', content: '' };
    setEditSubject(current.subject || '');
    setEditContent(current.content || '');
    setEditingPeriod(period);
  };

  const handleSave = async (period: number) => {
    try {
      setSaving(true);
      await onSavePeriod(period, {
        subject: editSubject.trim(),
        content: editContent.trim(),
      });
      setEditingPeriod(null);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingPeriod(null);
    setEditSubject('');
    setEditContent('');
  };

  // 기본 시간표 불러와서 현재 일자에 일괄 적용
  const handleApplyTemplate = async () => {
    if (!dateStr) return;
    const dateObj = parseDateStr(dateStr);
    const dayOfWeek = dateObj.getDay(); // 1: 월 ~ 5: 금

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
          const currentContent = schedules[p]?.content || '';
          await onSavePeriod(p, { subject: sub, content: currentContent });
        }
      }
    }
  };

  const periods = Array.from({ length: maxPeriods }, (_, i) => i + 1);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">⏰</span>
          <h3 className="text-base font-extrabold text-slate-800">수업</h3>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleApplyTemplate}
            className="px-2.5 py-1 text-xs font-bold bg-blue-50 text-primary border border-blue-200/80 rounded-xl hover:bg-blue-100 transition-colors flex items-center gap-1"
            title="오늘 요일의 기본 시간표 과목들을 자동으로 채웁니다"
          >
            <span>📋</span> 기본 시간표 불러오기
          </button>
          {mode === 'editor' && (
            <button
              onClick={() => setIsTemplateModalOpen(true)}
              className="px-2 py-1 text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
              title="기본 주간 시간표 템플릿 설정"
            >
              ⚙️ 설정
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {periods.map((period) => {
          const item = schedules[period] || { subject: '', content: '' };
          const isEditing = editingPeriod === period;
          const colorClass = PERIOD_COLORS[(period - 1) % PERIOD_COLORS.length];

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

                <input
                  type="text"
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  placeholder="과목명 (예: 국어, 수학)"
                  className="w-full px-3 py-1.5 text-xs font-bold bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />

                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="수업 내용 및 준비물 입력..."
                  rows={2}
                  className="w-full p-2.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none placeholder-slate-400 leading-relaxed"
                />
              </div>
            );
          }

          return (
            <div
              key={period}
              onClick={() => startEdit(period)}
              className={`group p-3.5 rounded-xl border border-slate-200/70 transition-all flex flex-col justify-between min-h-[90px] ${
                mode === 'editor'
                  ? 'hover:border-primary/50 hover:bg-slate-50/50 cursor-pointer'
                  : 'bg-white shadow-2xs'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold border ${colorClass}`}>
                      {period}교시
                    </span>
                    <span className="font-bold text-sm text-slate-800">
                      {item.subject || <span className="text-slate-300 font-normal">과목 미등록</span>}
                    </span>
                  </div>

                  {mode === 'editor' && (
                    <span className="text-xs text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      ✏️ 편집
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-600 whitespace-pre-wrap line-clamp-2 leading-relaxed pl-1">
                  {item.content || <span className="text-slate-300">수업 계획이 없습니다.</span>}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* 템플릿 설정 모달 */}
      <TimetableTemplateModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
      />
    </div>
  );
}
