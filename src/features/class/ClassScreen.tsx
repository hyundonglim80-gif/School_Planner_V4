// src/features/class/ClassScreen.tsx
//
// '학급' 화면 (ROADMAP 16, 2026-10-02 - 결정은 Claude 추천으로 하라고 사용자가 맡겼다).
//
//   학급 운영 도구(출석부·알림장·자리표·발표자 뽑기·학생 누가기록·평가 모아 보기·명렬표)가 ⋮ 메뉴 안에 흩어져 있었다.
//   여기서 학급을 한 번 고르면 그 학급으로 도구를 연다(lib/classMemory - 도구마다의 학급 기억에 같이 적는다).
//   학생 이름을 누르면 그 학생의 누가기록. 오늘 출결은 한 줄로 미리 보인다.
//
//   도구 창은 Layout이 연다(lib/appActions). 새 학급 도구를 만들면 여기 TOOLS에도 한 줄 더한다.
import { useEffect, useMemo, useState } from 'react';
import { useRoster, type ClassRoster } from '../../hooks/useRoster';
import { classKeyOf, KIND_LABEL, type AttendanceRecord } from '../../lib/attendance';
import { loadAttendanceDay } from '../../lib/attendanceStore';
import { describeClass } from '../../lib/classPicker';
import { getAcademicYear, formatDateStr } from '../../lib/dateUtils';
import { readHubClass, rememberHubClass } from '../../lib/classMemory';
import { runAppAction } from '../../lib/appActions';
import type { ShortcutId } from '../../lib/shortcuts';
import { useTeachingMode } from '../../hooks/useTeachingMode';

// homeroom: 담임 도구 - 교과 전담(담임반 없음)은 숨긴다 (docs/ROADMAP-SUBJECT.md S3)
const TOOLS: { id: ShortcutId; icon: string; label: string; desc: string; homeroom?: true }[] = [
  { id: 'attendance', icon: '📋', label: '출석부', desc: '오늘 출결 체크 · 누계', homeroom: true },
  { id: 'notices', icon: '📢', label: '알림장', desc: '모아 보기 · 쓰기', homeroom: true },
  { id: 'seating', icon: '🪑', label: '자리표', desc: '자리 · 학생 칸 · 모둠' },
  { id: 'drawStudent', icon: '🎯', label: '발표자 뽑기', desc: '겹치지 않게 차례로' },
  { id: 'studentRecord', icon: '🧑‍🎓', label: '학생 누가기록', desc: '학생마다 기록 · 출결 · 평가' },
  { id: 'evalOverview', icon: '📊', label: '평가 모아 보기', desc: '조사표를 학생 × 평가 표로' },
  { id: 'roster', icon: '🧑‍🤝‍🧑', label: '명렬표 관리', desc: '학생 · 학급 정보' },
];

export default function ClassScreen() {
  const { rosterList, loading } = useRoster();
  const { showHomeroomTools } = useTeachingMode();
  const [classKey, setClassKey] = useState<string | null>(null);

  // 처음 학급: 학급 화면에서 마지막에 고른 것 → 출석부·자리표에서 마지막에 연 것 → 올해 학년도의, 학생이 있는 첫 학급
  useEffect(() => {
    if (loading || classKey || rosterList.length === 0) return;
    const remembered = readHubClass();
    const ay = getAcademicYear();
    const withStudents = rosterList.filter((c) => (c.students || []).length > 0);
    const pick =
      rosterList.find((c) => classKeyOf(c) === remembered) ||
      withStudents.find((c) => Number(c.year) === ay) ||
      withStudents[0] ||
      rosterList[0];
    setClassKey(classKeyOf(pick));
    rememberHubClass(classKeyOf(pick));
  }, [loading, rosterList, classKey]);

  const cls: ClassRoster | null = rosterList.find((c) => classKeyOf(c) === classKey) || null;
  const students = useMemo(
    () => (cls?.students || []).filter((s) => s.isActive !== false).sort((a, b) => Number(a.num) - Number(b.num)),
    [cls],
  );
  /** 학년도 최근 것부터 */
  const sortedClasses = useMemo(
    () => [...rosterList].sort((a, b) => Number(b.year) - Number(a.year) || String(a.grade).localeCompare(String(b.grade)) || Number(a.classNum) - Number(b.classNum)),
    [rosterList],
  );

  // 오늘 출결 (출석한 학생은 기록이 없다 - 기록된 학생만)
  const today = formatDateStr(new Date());
  const [todayRecords, setTodayRecords] = useState<AttendanceRecord[] | null>(null);
  useEffect(() => {
    if (!cls || !showHomeroomTools) return;
    let alive = true;
    setTodayRecords(null);
    loadAttendanceDay({ classKey: classKeyOf(cls), year: Number(cls.year), grade: String(cls.grade), classNum: String(cls.classNum) }, today)
      .then((day) => {
        if (alive) setTodayRecords(Object.values(day.records || {}).sort((a, b) => a.num - b.num));
      })
      .catch(() => {
        if (alive) setTodayRecords([]);
      });
    return () => {
      alive = false;
    };
  }, [cls, today, showHomeroomTools]);

  const choose = (key: string) => {
    setClassKey(key);
    rememberHubClass(key);
  };
  const open = (id: ShortcutId) => {
    if (classKey) rememberHubClass(classKey);
    runAppAction({ id, classKey: classKey || undefined });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
        <p className="text-xs text-slate-400 font-medium">명렬표를 불러오는 중...</p>
      </div>
    );
  }

  if (rosterList.length === 0) {
    return (
      <div className="max-w-xl mx-auto text-center py-16 flex flex-col items-center gap-3" data-class-screen>
        <p className="text-4xl">🏫</p>
        <p className="font-bold text-slate-700">아직 학급(명렬표)이 없습니다.</p>
        <p className="text-sm text-slate-500">명렬표를 만들면 이 화면에서 출석부·자리표·누가기록·평가를 학급별로 엽니다.</p>
        <button type="button" onClick={() => open('roster')} className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-sm">
          🧑‍🤝‍🧑 명렬표 만들기
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in pb-12 flex flex-col gap-4" data-class-screen>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-black text-slate-800">🏫 학급</h2>
        <select
          aria-label="학급 고르기"
          value={classKey || ''}
          onChange={(e) => choose(e.target.value)}
          className="px-3 py-1.5 border border-slate-200 rounded-xl font-bold text-sm bg-white"
        >
          {sortedClasses.map((c) => (
            <option key={classKeyOf(c)} value={classKeyOf(c)}>
              {describeClass(c)} ({(c.students || []).filter((s) => s.isActive !== false).length}명)
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-400">고른 학급으로 아래 도구가 열립니다.</span>
      </div>

      {/* 오늘 출결 한 줄 (교과 전담은 출석부를 숨긴다) */}
      {showHomeroomTools && (
      <button
        type="button"
        data-class-today
        onClick={() => open('attendance')}
        className="text-left bg-white border border-slate-200 rounded-2xl px-4 py-3 hover:bg-slate-50 flex flex-wrap items-center gap-x-3 gap-y-1"
      >
        <span className="font-black text-sm text-slate-700">📋 오늘 출결</span>
        {todayRecords === null ? (
          <span className="text-xs text-slate-400">불러오는 중...</span>
        ) : todayRecords.length === 0 ? (
          <span className="text-sm text-emerald-700 font-bold">적힌 결석·지각·조퇴·결과가 없습니다</span>
        ) : (
          todayRecords.map((r) => (
            <span key={r.num} className="text-sm text-slate-700">
              <span className="font-bold">
                {r.num} {r.name}
              </span>{' '}
              <span className="text-rose-600 font-bold">{KIND_LABEL[r.kind]}</span>
            </span>
          ))
        )}
        <span className="ml-auto text-xs font-bold text-primary">출석부 열기 →</span>
      </button>
      )}

      {/* 도구 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
        {TOOLS.filter((t) => showHomeroomTools || !t.homeroom).map((t) => (
          <button
            key={t.id}
            type="button"
            data-class-tool={t.id}
            onClick={() => open(t.id)}
            className="text-left bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 hover:border-primary/50 hover:shadow-sm transition-all flex flex-col gap-1"
          >
            <span className="text-2xl leading-none">{t.icon}</span>
            <span className="font-black text-sm text-slate-800">{t.label}</span>
            <span className="text-xs text-slate-500">{t.desc}</span>
          </button>
        ))}
      </div>

      {/* 학생 명단 - 누르면 그 학생의 누가기록 */}
      <section className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4">
        <h3 className="font-black text-sm text-slate-700 mb-2">
          🧑‍🎓 학생 {students.length}명 <span className="text-xs font-semibold text-slate-400">- 누르면 그 학생의 누가기록</span>
        </h3>
        {students.length === 0 ? (
          <p className="text-sm text-slate-400">이 학급에 학생이 없습니다. 명렬표 관리에서 더합니다.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-1.5">
            {students.map((s) => (
              <button
                key={s.num}
                type="button"
                data-class-student={s.num}
                onClick={() => {
                  if (classKey) rememberHubClass(classKey);
                  runAppAction({ id: 'studentRecord', classKey: classKey || undefined, num: Number(s.num) });
                }}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-slate-200 hover:bg-primary/5 hover:border-primary/40 text-sm text-left min-w-0"
              >
                <span className="text-xs font-bold text-slate-400 tabular-nums shrink-0">{s.num}</span>
                <span className="font-bold text-slate-800 truncate">{s.name}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
