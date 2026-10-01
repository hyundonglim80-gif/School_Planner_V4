// src/components/StudentMentionList.tsx
//
// 기록 내용에서 '@이름'을 치면 뜨는 학생 목록 (ROADMAP 10-1). 셈은 lib/mention.
// 명렬표는 이 목록이 떠 있을 때만 읽는다(쓰는 칸마다 늘 구독하지 않게).
// 키보드(↑↓·Enter·Tab·Esc)는 글 칸이 받아 이리로 넘긴다 - 목록에 초점을 옮기면 한글 조합이 끊긴다.
import React, { useEffect, useMemo } from 'react';
import { useRoster } from '../hooks/useRoster';
import { getAcademicYear } from '../lib/dateUtils';
import { matchMentionStudents, type MentionCandidate } from '../lib/mention';

/** 학생 누가기록·태그 넣기 칸이 마지막에 본 학급 - 그 학급 학생을 앞에 */
const PREFER_CLASS_KEY = 'sp4-student-record';

function preferredClass(): string | null {
  try {
    return localStorage.getItem(PREFER_CLASS_KEY);
  } catch {
    return null;
  }
}

interface StudentMentionListProps {
  query: string;
  activeIndex: number;
  /** 지금 목록 (글 칸이 키보드로 고를 때 쓴다) */
  onCandidates: (list: MentionCandidate[]) => void;
  onPick: (c: MentionCandidate) => void;
}

export default function StudentMentionList({ query, activeIndex, onCandidates, onPick }: StudentMentionListProps) {
  const { rosterList, loading } = useRoster();
  const candidates = useMemo(
    () => matchMentionStudents(rosterList, query, { preferClassKey: preferredClass(), schoolYear: getAcademicYear() }),
    [rosterList, query]
  );
  useEffect(() => onCandidates(candidates), [candidates]);
  useEffect(() => () => onCandidates([]), []);
  const manyClasses = new Set(candidates.map((c) => `${c.cls.year}-${c.cls.grade}-${c.cls.classNum}`)).size > 1;

  return (
    <div
      className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-amber-200 rounded-xl shadow-lg p-1 max-h-64 overflow-y-auto"
      data-student-mention
    >
      {loading ? (
        <p className="px-2 py-1.5 text-xs text-slate-400">명렬표를 불러오는 중...</p>
      ) : candidates.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-slate-400">
          {rosterList.length === 0 ? '명렬표가 없습니다.' : `'${query}'에 맞는 학생이 없습니다.`} Esc로 닫습니다.
        </p>
      ) : (
        <ul role="listbox" aria-label="학생 태그 넣기">
          {candidates.map((c, i) => (
            <li key={c.tag}>
              <button
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                data-mention-tag={c.tag}
                // 글 칸의 초점을 잃지 않게 (blur로 목록이 먼저 닫히지 않게)
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(c)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs ${
                  i === activeIndex ? 'bg-amber-100 text-amber-900' : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                <span className="w-6 text-right font-black text-slate-400">{c.student.num}</span>
                <span className="font-black">{c.student.name}</span>
                {manyClasses && (
                  <span className="text-slate-400">
                    {c.cls.year} {c.cls.grade}-{c.cls.classNum}
                  </span>
                )}
                <span className="ml-auto font-mono text-amber-700">{c.tag}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="px-2 pt-1 text-2xs text-slate-400 border-t border-slate-100 mt-1">↑↓로 고르고 Enter·Tab으로 넣습니다. 자음만 쳐도(ㄱㅈ) 찾습니다.</p>
    </div>
  );
}
