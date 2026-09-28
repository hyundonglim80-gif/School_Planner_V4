// src/components/StudentTagPicker.tsx
//
// 기록 배너에서 학생을 골라 #26040305 태그를 넣는 작은 칸.
// 태그를 외워 칠 필요가 없게 한다. 명렬표는 이 칸을 열 때만 읽는다.
import React, { useEffect, useState } from 'react';
import { useRoster } from '../hooks/useRoster';
import { classKeyOf } from '../lib/attendance';
import { makeStudentTag, tagOfStudent } from '../lib/studentTag';

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
    return <p className="text-xs text-slate-400 py-2">명렬표가 없습니다. ⋮ 메뉴 → 학급 정보(명렬표) 관리에서 먼저 넣어 주세요.</p>;
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
    </div>
  );
}
