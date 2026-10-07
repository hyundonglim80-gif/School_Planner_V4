// src/components/StudentTagPicker.tsx
//
// 기록·메모 쓰는 칸에서 학생을 골라 #26040305 태그를 넣는 작은 칸 (메모는 2026-10-07).
// 태그를 외워 칠 필요가 없게 한다. 명렬표는 이 칸을 열 때만 읽는다.
// 명렬표에 없는 학생(지난 학년도·다른 반)도 넣을 수 있게 학년도·학년·반·번호를 직접 고르는 줄을 둔다(ManualTagRow).
import React, { useEffect, useState } from 'react';
import { useRoster } from '../hooks/useRoster';
import { classKeyOf } from '../lib/attendance';
import { makeStudentTag, tagOfStudent } from '../lib/studentTag';
import { schoolYearOf } from '../lib/schoolSetting';
import { formatDateStr } from '../lib/dateUtils';

const MEMORY_KEY = 'sp4-student-record';

export default function StudentTagPicker({ onPick, picked }: { onPick: (tag: string) => void; picked: string }) {
  const { rosterList, loading } = useRoster();
  const [classKey, setClassKey] = useState<string | null>(null);

  useEffect(() => {
    if (loading || classKey || rosterList.length === 0) return;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(MEMORY_KEY);
    } catch {
      /* 무시 */
    }
    setClassKey(
      classKeyOf(
        rosterList.find((c) => classKeyOf(c) === remembered) ||
          rosterList.find((c) => (c.students || []).length > 0) ||
          rosterList[0]
      )
    );
  }, [loading, rosterList, classKey]);

  const cls = rosterList.find((c) => classKeyOf(c) === classKey) || null;

  if (loading) return <p className="text-xs text-slate-400 py-2">명렬표를 불러오는 중...</p>;
  if (rosterList.length === 0) {
    return (
      <div className="p-2.5 bg-amber-50/60 border border-amber-200 rounded-xl space-y-2">
        <p className="text-xs text-slate-500">명렬표가 없습니다 - 학년도·학년·반·번호를 골라 넣습니다. (⋮ 메뉴 → 명렬표에서 학생을 넣으면 이름으로 고릅니다)</p>
        <ManualTagRow onPick={onPick} />
      </div>
    );
  }

  return (
    <div className="p-2.5 bg-amber-50/60 border border-amber-200 rounded-xl space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={classKey || ''}
          onChange={(e) => setClassKey(e.target.value)}
          aria-label="태그 넣을 학급"
          className="px-2 py-1 text-xs border border-slate-200 rounded-lg font-bold bg-white"
        >
          {rosterList.map((c) => (
            <option key={classKeyOf(c)} value={classKeyOf(c)}>
              {c.year}학년도 {c.grade}학년 {c.classNum}반
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">학생을 누르면 내용 끝에 태그가 붙습니다</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {(cls?.students || [])
          .filter((s) => s.isActive !== false)
          .map((s) => {
            const tag = makeStudentTag(tagOfStudent(cls!, s));
            const on = picked.includes(tag);
            return (
              <button
                key={s.num}
                type="button"
                onClick={() => onPick(tag)}
                title={tag}
                aria-pressed={on}
                className={`px-2 py-1 rounded-lg border text-xs font-bold ${
                  on ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 border-slate-200 hover:border-amber-400'
                }`}
              >
                {s.num} {s.name}
              </button>
            );
          })}
      </div>
      <ManualTagRow onPick={onPick} defaults={cls ? { year: Number(cls.year), grade: Number(cls.grade), classNum: Number(cls.classNum) } : undefined} />
    </div>
  );
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** 학년도·학년·반·번호를 골라 #(두 자리씩) 태그를 넣는다 - 명렬표에 없는 학생도 */
function ManualTagRow({
  onPick,
  defaults,
}: {
  onPick: (tag: string) => void;
  defaults?: { year: number; grade: number; classNum: number };
}) {
  const thisYear = schoolYearOf(formatDateStr(new Date()));
  const [year, setYear] = useState(defaults?.year || thisYear);
  const [grade, setGrade] = useState(defaults?.grade || 1);
  const [classNum, setClassNum] = useState(defaults?.classNum || 1);
  const [num, setNum] = useState(1);
  // 위에서 학급을 바꾸면 그 학급으로 맞춘다
  useEffect(() => {
    if (!defaults) return;
    setYear(defaults.year || thisYear);
    setGrade(defaults.grade || 1);
    setClassNum(defaults.classNum || 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults?.year, defaults?.grade, defaults?.classNum]);
  const tag = makeStudentTag({ year, grade, classNum, num });
  const sel = 'px-1.5 py-1 text-xs border border-slate-200 rounded-lg font-bold bg-white';
  return (
    <div className="flex items-center gap-1 flex-wrap text-xs text-slate-600" data-student-tag-manual>
      <span className="font-bold text-slate-500">직접:</span>
      <select aria-label="학년도" value={year} onChange={(e) => setYear(Number(e.target.value))} className={sel}>
        {range(thisYear - 3, thisYear + 1).map((y) => (
          <option key={y} value={y}>
            {y}학년도
          </option>
        ))}
      </select>
      <select aria-label="학년" value={grade} onChange={(e) => setGrade(Number(e.target.value))} className={sel}>
        {range(1, 12).map((g) => (
          <option key={g} value={g}>
            {g}학년
          </option>
        ))}
      </select>
      <select aria-label="반" value={classNum} onChange={(e) => setClassNum(Number(e.target.value))} className={sel}>
        {range(1, 30).map((c) => (
          <option key={c} value={c}>
            {c}반
          </option>
        ))}
      </select>
      <select aria-label="번호" value={num} onChange={(e) => setNum(Number(e.target.value))} className={sel}>
        {range(1, 50).map((n) => (
          <option key={n} value={n}>
            {n}번
          </option>
        ))}
      </select>
      <button
        type="button"
        data-student-tag-manual-add
        onClick={() => onPick(tag)}
        className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-bold"
        title={`${tag} 태그를 넣습니다`}
      >
        {tag} 넣기
      </button>
    </div>
  );
}
