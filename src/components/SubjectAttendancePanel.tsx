// src/components/SubjectAttendancePanel.tsx
//
// 교과 출결 칸 (docs/ROADMAP-SUBJECT.md S6, 사용 설명서 '교과 출결'). 교과 모드 하루 수업 칸의 '출결'로 연다.
// 그 반 그 교시에 결과·지각·조퇴를 적는다. 담임 출석부(AttendanceDrawer)와 따로 저장하고 기록 칸을 만들지 않는다.
//
// 저장 단추가 없다 - 누를 때마다 그 학생 한 칸만 바로 저장한다(lib/subjectAttendanceStore). 같은 날 다른 교시 칸을
// 함께 열어 두어도 서로 덮지 않는다. 사유 글은 칸을 떠날 때(또는 Enter) 저장한다.
// 교과 + 담임이고 이 반이 담임반이면 그날 담임 출석부의 결석 학생을 흐리게 알려 준다(읽기만).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import SidePanelFrame, { sidePanelClass } from './SidePanelFrame';
import { useRoster } from '../hooks/useRoster';
import { useTeachingMode } from '../hooks/useTeachingMode';
import { classKeyOf, REASONS, REASON_LABEL, type AttendanceRecord } from '../lib/attendance';
import { loadAttendanceDay, type ClassInfo } from '../lib/attendanceStore';
import {
  SUBJECT_KINDS,
  SUBJECT_KIND_LABEL,
  periodSummary,
  type SubjectAttendanceKind,
  type SubjectAttendanceRecord,
} from '../lib/subjectAttendance';
import { saveSubjectRecord, subscribeSubjectAttendanceDay } from '../lib/subjectAttendanceStore';
import { classLabelOf, normalizeSlotText } from '../lib/teachingSlot';
import { shortDateLabel } from '../lib/notices';
import { showErrorToast } from '../utils/toast';

interface SubjectAttendancePanelProps {
  dateStr: string;
  period: number;
  classKey: string;
  /** 칸 글자의 과목 ('과학') - 머리줄에만 쓴다 */
  subject?: string;
  docked: boolean;
  onClose: () => void;
}

export default function SubjectAttendancePanel({
  dateStr,
  period,
  classKey,
  subject,
  docked,
  onClose,
}: SubjectAttendancePanelProps) {
  const { rosterList, loading: rosterLoading } = useRoster();
  const { mode, preset } = useTeachingMode();
  const panelRef = useRef<HTMLElement>(null);
  const roster = rosterList.find((c) => classKeyOf(c) === classKey) || null;
  const info: ClassInfo | null = roster
    ? { classKey, year: Number(roster.year), grade: String(roster.grade), classNum: String(roster.classNum) }
    : null;
  const label = roster ? classLabelOf(roster) : '';

  const [records, setRecords] = useState<Record<string, SubjectAttendanceRecord> | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // 문서를 구독한다 - 저장은 한 칸씩이고, 화면은 서버(와 이 기기의 쓰기)를 그대로 따른다
  useEffect(() => {
    if (!info) return;
    setRecords(null);
    return subscribeSubjectAttendanceDay(
      info,
      dateStr,
      (day) => setRecords(day.periods[String(period)] || {}),
      (err) => showErrorToast('교과 출결을 불러오지 못했습니다.', err)
    );
    // info는 classKey·명렬표에서 나온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classKey, dateStr, period, !!roster]);

  // 교과 + 담임의 담임반이면 그날 담임 출석부 결석 (읽기만)
  const isHomeroom = preset === 'subjectHomeroom' && !!label && normalizeSlotText(mode.homeroomClass) === label;
  const [homeroomAbsent, setHomeroomAbsent] = useState<AttendanceRecord[]>([]);
  useEffect(() => {
    if (!isHomeroom || !info) return;
    let alive = true;
    loadAttendanceDay(info, dateStr)
      .then((day) => {
        if (!alive) return;
        setHomeroomAbsent(Object.values(day.records).filter((r) => r.kind === 'absent').sort((a, b) => a.num - b.num));
      })
      .catch(() => alive && setHomeroomAbsent([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHomeroom, classKey, dateStr]);

  const save = async (num: number, rec: SubjectAttendanceRecord | null) => {
    if (!info) return;
    setBusy(String(num));
    try {
      await saveSubjectRecord(info, dateStr, period, num, rec);
    } catch (err) {
      showErrorToast('교과 출결을 저장하지 못했습니다.', err);
    } finally {
      setBusy(null);
    }
  };

  const setKind = (num: number, name: string, kind: SubjectAttendanceKind | null) => {
    const old = records?.[String(num)];
    if (!kind) return void save(num, null);
    // 사유·메모는 고른 적이 있으면 이어받는다. 처음이면 질병 (담임 출석부와 같다)
    void save(num, { num, name, kind, reason: old?.reason || 'sick', ...(old?.note ? { note: old.note } : {}) });
  };
  const patch = (num: number, p: Partial<SubjectAttendanceRecord>) => {
    const old = records?.[String(num)];
    if (old) void save(num, { ...old, ...p });
  };
  const commitNote = (num: number) => {
    const old = records?.[String(num)];
    if (old && (old.note || '') !== noteDraft.trim()) patch(num, { note: noteDraft.trim() });
  };

  const students = useMemo(
    () => (roster?.students || []).filter((s) => s.isActive !== false || records?.[String(s.num)]),
    [roster, records]
  );
  const summary = periodSummary(records || {});

  const chip = (on: boolean, tone: string) =>
    `px-2 py-1 rounded-lg border font-bold transition-colors ${on ? tone : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`;

  const panel = (
    <div className={sidePanelClass(docked)} data-subject-attendance-panel>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-slate-800">🙋 교과 출결</h3>
          <p className="text-xs font-bold text-primary mt-0.5 truncate" data-subject-attendance-title>
            {label || '반'} · {shortDateLabel(dateStr)} {period}교시{subject ? ` · ${subject}` : ''} · 🔒 개인
          </p>
          <p className="text-xs text-slate-400 mt-0.5">누르는 대로 바로 저장됩니다 · 담임 출석부와 따로 둡니다</p>
        </div>
        <button
          title="닫기"
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 space-y-3 text-xs text-slate-700" data-scroll-lock>
        {!rosterLoading && !roster ? (
          <p className="text-center text-slate-400 py-8">
            이 반의 명렬표가 없습니다. ⋮ 메뉴 → 학급 정보(명렬표) 관리에서 학급과 학생을 먼저 넣어 주세요.
          </p>
        ) : records === null ? (
          <p className="text-center text-slate-400 py-6">불러오는 중...</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">
                {students.length}명 · {summary ? <b className="text-rose-600">{summary}</b> : <b className="text-emerald-700">모두 출석</b>}
              </span>
            </div>
            {isHomeroom && homeroomAbsent.length > 0 && (
              <p className="text-slate-400" data-homeroom-absent>
                담임 출석부: 결석 {homeroomAbsent.map((r) => `${r.num}번 ${r.name}`).join(', ')}
              </p>
            )}
            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
              {students.map((st) => {
                const key = String(st.num);
                const r = records[key];
                return (
                  <div key={st.num} data-subject-att-num={st.num} className={`px-3 py-2 ${r ? 'bg-rose-50/40' : ''}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="w-24 shrink-0 font-bold text-slate-800 truncate">
                        <span className="text-slate-400 mr-1">{st.num}</span>
                        {st.name || '(이름 없음)'}
                      </span>
                      <div className={`flex items-center gap-1 flex-wrap ${busy === key ? 'opacity-60' : ''}`}>
                        <button
                          type="button"
                          onClick={() => setKind(st.num, st.name, null)}
                          aria-pressed={!r}
                          className={chip(!r, 'bg-emerald-600 text-white border-emerald-600')}
                        >
                          출석
                        </button>
                        {SUBJECT_KINDS.map((k) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setKind(st.num, st.name, k)}
                            aria-pressed={r?.kind === k}
                            className={chip(r?.kind === k, 'bg-rose-600 text-white border-rose-600')}
                          >
                            {SUBJECT_KIND_LABEL[k]}
                          </button>
                        ))}
                      </div>
                      {r && (
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-slate-300">|</span>
                          {REASONS.map((rs) => (
                            <button
                              key={rs}
                              type="button"
                              onClick={() => patch(st.num, { reason: rs })}
                              aria-pressed={r.reason === rs}
                              className={chip(r.reason === rs, 'bg-slate-800 text-white border-slate-800')}
                            >
                              {REASON_LABEL[rs]}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              setOpenNote(openNote === key ? null : key);
                              setNoteDraft(r.note || '');
                            }}
                            className="px-2 py-1 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-slate-500"
                          >
                            {r.note ? `📝 ${r.note}` : '＋ 사유 적기'}
                          </button>
                        </div>
                      )}
                    </div>
                    {r && openNote === key && (
                      <div className="mt-1.5 pl-24">
                        <input
                          type="text"
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          onBlur={() => commitNote(st.num)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                              commitNote(st.num);
                              setOpenNote(null);
                            }
                          }}
                          placeholder="사유 (예: 보건실, 상담) - Enter로 저장"
                          aria-label={`${st.num}번 사유`}
                          className="w-full px-2 py-1 border border-slate-200 rounded-lg"
                          autoFocus
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {students.length === 0 && <p className="text-center text-slate-400 py-6">이 반에 학생이 없습니다.</p>}
            </div>
            <p className="text-slate-400">
              적지 않은 학생은 출석입니다. 교과 출결은 담임 출석부·기록 칸에 들어가지 않습니다 - 이 반 이 교시에만 남습니다.
            </p>
          </>
        )}
      </div>

      <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50/50">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
        >
          닫기
        </button>
      </div>
    </div>
  );

  return (
    <SidePanelFrame docked={docked} onClose={onClose} onBackdropClose={onClose} ariaLabel="교과 출결" panelRef={panelRef}>
      {panel}
    </SidePanelFrame>
  );
}
