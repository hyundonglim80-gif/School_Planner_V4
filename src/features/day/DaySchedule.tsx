import React, { useState, useEffect, Suspense, lazy } from 'react';
import type { PeriodSchedule } from '../../hooks/useDayData';
import { useAppStore } from '../../store/useAppStore';
import { focusKey } from '../../lib/searchFocus';
import AutoTextarea from '../../components/AutoTextarea';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useDayEvalCounts } from '../../hooks/useDayEvalCounts';
import { showToast, showErrorToastOnce } from '../../utils/toast';
import { openEntryPanel } from '../../components/EntryPanelHost';
import { usePeriodTimes } from '../../hooks/usePeriodTimes';
import { useClock } from '../../hooks/useClock';
import { periodStateAt, periodRangeLabel } from '../../lib/periodTimes';
import { formatDateStr, parseDateStr } from '../../lib/dateUtils';
import { shortDateLabel } from '../../lib/notices';
import DayMeals from './DayMeals';
import ProgressMarkLine from '../../components/ProgressMarkLine';
import { useProgressMarks } from '../../hooks/useProgress';
import { slotId } from '../../lib/progress';
import { useTeachingMode } from '../../hooks/useTeachingMode';
import { normalizeSlotText, parseSlot, previousSlotOf, rosterForSlot } from '../../lib/teachingSlot';
import { useRoster } from '../../hooks/useRoster';
import { schoolYearOf } from '../../lib/schoolSetting';
import { classKeyOf } from '../../lib/attendance';
import { periodSummary } from '../../lib/subjectAttendance';
import { useSubjectAttendanceDate } from '../../hooks/useSubjectAttendance';
import { useClassColorOf } from '../../hooks/useClassColor';
import SlotOptionsList from '../../components/SlotOptionsList';
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
/** 과목이 있는 교시 카드 왼쪽의 굵은 막대. 교시 칩과 같은 색 (차례도 PERIOD_COLORS와 같다) */
const PERIOD_ACCENTS = [
  'border-l-blue-400',
  'border-l-emerald-400',
  'border-l-amber-400',
  'border-l-purple-400',
  'border-l-rose-400',
  'border-l-indigo-400',
  'border-l-slate-400',
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
  const { openLinkerModal, openLinkViewerModal, openEvaluationModal, selectedGroupId } = useAppStore();
  // 진도 관리 - 교시마다 몇 차시인지 겹쳐 보인다 (수업 문서에는 쓰지 않는다, docs/ROADMAP.md 5-3)
  // 교과 모드는 같은 읽기에서 그 반의 '지난 시간' 메모도 꺼낸다 (ROADMAP-SUBJECT S5)
  const { marks: progressMarks, inputs: progressInputs, isOffDay } = useProgressMarks(dateStr || '');
  // 수업 옆 알림장·출석부. 그날 날짜로 오른쪽 칸에 연다 (출석부는 개인 공간에만 있다).
  const openNotice = () => dateStr && void openEntryPanel({ kind: 'notice', groupId: selectedGroupId, dateStr });
  const openAttendance = () => dateStr && void openEntryPanel({ kind: 'attendance', groupId: null, dateStr });
  // 어느 교시에 조사표를 만들어 두었는지 교시 옆에 숫자로 보여 준다
  const evalCounts = useDayEvalCounts(dateStr || '', selectedGroupId);
  // 교과 모드: 과목 칸에 '5-2 과학' 제안, 저장할 때 한 모양으로 (lib/teachingSlot). 초등 담임은 적은 그대로.
  // 교과 전담(담임반 없음)은 알림장·출석부 단추를 숨긴다. 교과 모드의 카드는 반을 크게, 반 색 막대 (S3).
  const { isClassUnit, showHomeroomTools } = useTeachingMode();
  const subjectToSave = (text: string) => (isClassUnit ? normalizeSlotText(text) : text.trim());
  const classColorOf = useClassColorOf(dateStr);
  // 교과 출결 (S6): 반의 명렬표가 있는 교시에 '출결' 단추와 적힌 것 요약. 교과 모드에서만 읽는다.
  const { rosterList } = useRoster(isClassUnit);
  const subjectAttendance = useSubjectAttendanceDate(dateStr || '', isClassUnit && !selectedGroupId);

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
        subject: subjectToSave(editSubject),
        content: editMemo.trim(),
        memo: editMemo.trim(),
        supplies: editSupplies.trim(),
        linkedItems: current.linkedItems,
      });
      setEditingPeriod(null);
      showToast(`✅ ${period}교시 수업 내용을 저장했습니다.`);
    } catch (e) {
      // 저장이 안 됐으면 고치던 칸을 그대로 둔다
      showErrorToastOnce('수업 내용을 저장하지 못했습니다.', e);
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

  // 페이지의 다른 곳을 누르면 수정 칸을 닫는다. 고친 것이 있으면 저장하고 닫는다.
  // ('닫기' 단추와 ESC는 저장 없이 닫는다 — 일부러 그만두는 길은 남겨 둔다.)
  const editRef = useClickOutside<HTMLDivElement>(editingPeriod !== null, () => {
    if (editingPeriod === null || saving) return;
    const cur = schedules[editingPeriod] || { subject: '', content: '' };
    const changed =
      subjectToSave(editSubject) !== (cur.subject || '').trim() ||
      editMemo.trim() !== (cur.memo || cur.content || '').trim() ||
      editSupplies.trim() !== (cur.supplies || '').trim();
    if (changed) handleSave(editingPeriod);
    else handleCancel();
  });

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

  // 교시 시각을 적어 두었으면(⚙️ 설정) 오늘은 지금 몇 교시인지 짚는다 (docs/ROADMAP.md 2-2)
  const { times: periodTimes } = usePeriodTimes();
  const isTodayView = !!dateStr && dateStr === formatDateStr(new Date());
  const now = useClock(isTodayView);
  const nowState = isTodayView ? periodStateAt(periodTimes, now, maxPeriods) : null;
  const subjectOf = (p: number) => (schedules[p]?.subject || '').trim();
  /** 머리줄에 적는 한 줄 - 지금 교시 / 다음 교시까지 */
  const nowLine = (() => {
    if (!nowState) return '';
    if (nowState.kind === 'during') {
      return `지금 ${nowState.period}교시${subjectOf(nowState.period) ? ' ' + subjectOf(nowState.period) : ''} · ${nowState.minutesLeft}분 남음`;
    }
    if (nowState.kind === 'break' || nowState.kind === 'before') {
      const p = nowState.next;
      const supplies = (schedules[p]?.supplies || '').trim();
      return (
        (nowState.kind === 'break' ? '쉬는 시간 · ' : '') +
        `다음 ${p}교시${subjectOf(p) ? ' ' + subjectOf(p) : ''} ${nowState.minutes}분 뒤` +
        (supplies ? ` · 준비물 ${supplies}` : '')
      );
    }
    return '';
  })();

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5">
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${isCollapsed ? '' : 'mb-4'}`}>
        {/* 제목·알림장·출석부는 줄어들지 않는다. 좁으면 오른쪽의 '지금' 안내만 줄어든다
            (오른쪽 칸이 열려 본문이 좁을 때 '수업'이 '수/업'으로 꺾였다) */}
        <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
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
          {/* 알림장·출석부는 수업과 함께 매일 쓰는 것이라 수업 제목 바로 옆에 둔다 (교과 전담은 숨긴다) */}
          {showHomeroomTools && (
          <>
          <button
            type="button"
            onClick={openNotice}
            className="ml-1 px-2 py-1 bg-yellow-50 hover:bg-yellow-100 text-yellow-800 border border-yellow-200 rounded-lg text-xs font-bold transition-colors"
            title="이 날 알림장 쓰기 / 날짜별로 모아 보기"
          >
            📢 알림장
          </button>
          <button
            type="button"
            onClick={openAttendance}
            className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-colors"
            title="이 날 출석 체크 / 누계 보기"
          >
            📋 출석부
          </button>
          </>
          )}
        </div>

        {!isCollapsed && (
          <div className="flex items-center justify-end gap-1.5 min-w-0 flex-1">
            {nowLine && (
              <span data-now-line className="min-w-0 truncate text-xs font-bold text-primary bg-blue-50 border border-blue-100 rounded-lg px-2 py-1" title={nowLine}>
                🕘 {nowLine}
              </span>
            )}
            <button
              onClick={() => setIsTemplateModalOpen(true)}
              className="shrink-0 whitespace-nowrap px-2 py-1 text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
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
          const accentClass = PERIOD_ACCENTS[(period - 1) % PERIOD_ACCENTS.length];
          const linkCount = (item.linkedItems || []).length;
          const mark = dateStr ? progressMarks[slotId(dateStr, period)] : undefined;

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
                {mark && dateStr && <ProgressMarkLine mark={mark} dateStr={dateStr} period={period} alwaysShowAction />}
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
                    list={isClassUnit ? 'sp4-slot-options-day' : undefined}
                    placeholder={isClassUnit ? '5-2 과학' : '과목'}
                    className="col-span-1 px-3 py-1.5 text-xs font-bold bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                    autoFocus
                  />
                  {isClassUnit && <SlotOptionsList id="sp4-slot-options-day" dateStr={dateStr} />}
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
          // 빈 수업 메모·준비물은 그리지 않는다. 예전에는 칸마다 '없음'이 두 번씩 서서, 6교시가 PC에서 약 600px,
          // 휴대폰에서는 일정 칸이 화면 1.3장 아래로 밀렸다(2026-10-01 재어 봄). 둘 다 비면 한 줄 카드가 된다.
          const memoText = item.memo || item.content || '';
          const suppliesText = item.supplies || '';
          const isNow = nowState?.kind === 'during' && nowState.period === period;
          const isNext = (nowState?.kind === 'break' || nowState?.kind === 'before') && nowState.next === period;
          const range = periodRangeLabel(periodTimes, period);
          // 교과 모드에서 칸 글자에 반이 있으면('5-2 과학') 반을 크게, 막대는 반 색. 반이 없는 칸('창체')은 그대로.
          const slot = isClassUnit && item.subject ? parseSlot(item.subject) : null;
          const slotColor = slot?.cls ? classColorOf(slot.cls) : null;
          // 교과 모드: 같은 반·과목의 바로 앞 수업에 적은 메모 한 줄 (메모가 없으면 줄도 없다)
          const prevSlot =
            slot?.cls && dateStr && progressInputs
              ? previousSlotOf(progressInputs.subjectsByDate, item.subject, dateStr, period, isOffDay)
              : null;
          const prevNote = prevSlot ? progressInputs?.notesByDate[prevSlot.date]?.[prevSlot.period] || '' : '';
          const hasDetails = !!(memoText || suppliesText || mark || prevNote);
          // 교과 출결: 개인 공간에서, 칸의 반이 그 학년도 명렬표에 있을 때만
          const slotRoster =
            slot?.cls && dateStr && !selectedGroupId ? rosterForSlot(rosterList, item.subject, schoolYearOf(dateStr)) : null;
          const slotClassKey = slotRoster ? classKeyOf(slotRoster) : '';
          const attSummary = slotClassKey ? periodSummary(subjectAttendance[slotClassKey]?.periods[String(period)]) : '';
          return (
            <div
              key={period}
              data-focus-key={dateStr ? focusKey.period(dateStr, period) : undefined}
              onClick={() => startEdit(period)}
              title="클릭하여 수정"
              // 과목이 눈에 띄게 (2026-09-30 사용자 요청): 과목이 있는 교시는 왼쪽에 교시 색 막대
              data-now={isNow ? 'true' : isNext ? 'next' : undefined}
              data-slot-color={slotColor?.name}
              className={`group ${hasDetails ? 'p-3.5' : 'px-3.5 py-2'} rounded-xl border border-slate-200/70 transition-all flex flex-col justify-between min-h-[40px] hover:border-primary/50 hover:bg-slate-50/50 cursor-pointer ${
                item.subject ? `border-l-4 ${slotColor ? slotColor.bar : accentClass}` : ''
              } ${isNow ? 'ring-2 ring-primary/60 bg-blue-50/40' : isNext ? 'ring-1 ring-primary/30' : ''}`}
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
                  <div className={`flex items-center justify-between gap-1 ${hasDetails ? 'mb-2' : ''}`}>
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className={`px-2 py-0.5 shrink-0 rounded-lg text-xs font-bold border ${colorClass}`}>
                        {period}교시
                      </span>
                      {range && <span className="shrink-0 text-2xs font-semibold text-slate-400 tabular-nums">{range}</span>}
                      {slot?.cls ? (
                        <span data-subject className="flex items-baseline gap-1.5 min-w-0 leading-tight">
                          <span data-slot-class className="shrink-0 font-black text-base sm:text-lg text-slate-900 tabular-nums">
                            {slot.cls}
                          </span>
                          {slot.subject && (
                            <span data-slot-subject className="truncate text-xs sm:text-sm font-bold text-slate-500">
                              {slot.subject}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span
                          data-subject
                          className={`truncate leading-tight ${
                            item.subject ? 'font-black text-base sm:text-lg text-slate-900' : 'text-sm'
                          }`}
                        >
                          {item.subject || <span className="text-slate-300 font-normal">과목 미등록</span>}
                        </span>
                      )}
                      {slotClassKey && (
                        <button
                          type="button"
                          data-subject-attendance
                          onClick={(e) => {
                            e.stopPropagation();
                            void openEntryPanel({
                              kind: 'subjectAttendance',
                              groupId: null,
                              dateStr,
                              classKey: slotClassKey,
                              period,
                              slotSubject: slot?.subject,
                              entryId: `sa:${slotClassKey}_${dateStr}#${period}`,
                            });
                          }}
                          title={`${slot?.cls} ${period}교시 교과 출결 (결과·지각·조퇴)`}
                          className={`shrink-0 text-2xs font-bold rounded-full px-1.5 py-0.5 border transition-colors ${
                            attSummary
                              ? 'text-rose-700 bg-rose-50 border-rose-200 hover:bg-rose-100'
                              : 'text-slate-400 bg-white border-slate-200 hover:text-slate-600 hover:border-slate-400'
                          }`}
                        >
                          {attSummary ? <span data-subject-att-summary>{attSummary}</span> : '🙋 출결'}
                        </button>
                      )}
                      {isNow && nowState?.kind === 'during' && (
                        <span className="shrink-0 text-2xs font-black text-white bg-primary rounded-full px-1.5 py-0.5">
                          지금 · {nowState.minutesLeft}분 남음
                        </span>
                      )}
                      {isNext && (nowState?.kind === 'break' || nowState?.kind === 'before') && (
                        <span className="shrink-0 text-2xs font-bold text-primary bg-blue-50 border border-blue-200 rounded-full px-1.5 py-0.5">
                          다음 · {nowState.minutes}분 뒤
                        </span>
                      )}
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

                  {prevNote && prevSlot && (
                    <button
                      type="button"
                      data-prev-note
                      onClick={(e) => {
                        e.stopPropagation();
                        useAppStore.getState().setCurrentDate(parseDateStr(prevSlot.date));
                      }}
                      title={`지난 시간 수업 메모 - 누르면 ${shortDateLabel(prevSlot.date)}로 갑니다`}
                      className={`self-start max-w-full truncate text-left text-xs text-slate-500 hover:text-primary hover:underline ${
                        mark || memoText || suppliesText ? 'mb-1.5' : ''
                      }`}
                    >
                      ⏪ 지난 시간 {shortDateLabel(prevSlot.date)} {prevSlot.period}교시: <span className="text-slate-700">{prevNote}</span>
                    </button>
                  )}

                  {mark && dateStr && (
                    <div className={memoText || suppliesText ? 'mb-2' : ''}>
                      <ProgressMarkLine mark={mark} dateStr={dateStr} period={period} />
                    </div>
                  )}

                  {(memoText || suppliesText) && (
                    <div className={`grid grid-cols-1 ${memoText && suppliesText ? 'sm:grid-cols-2' : ''} gap-3 text-xs`}>
                      {memoText && (
                        <div className="flex flex-col">
                          <span className="text-slate-400 text-xs mb-0.5">📝 수업 메모</span>
                          <p className="text-slate-600 whitespace-pre-wrap leading-relaxed">{memoText}</p>
                        </div>
                      )}
                      {suppliesText && (
                        <div className="flex flex-col">
                          <span className="text-slate-400 text-xs mb-0.5">📌 비고 / 준비물</span>
                          <p className="text-amber-600 font-medium whitespace-pre-wrap leading-relaxed">{suppliesText}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* 그날 급식 (환경설정 '우리 학교'를 골랐을 때만) */}
      {!isCollapsed && <DayMeals dateStr={dateStr} />}

      {isTemplateModalOpen && (
        <Suspense fallback={null}>
          <TimetableTemplateModal isOpen onClose={() => setIsTemplateModalOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
