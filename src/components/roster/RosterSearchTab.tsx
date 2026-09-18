// src/components/roster/RosterSearchTab.tsx
//
// 검색 탭. 학년도 / 학년 / 반 / 번호 / 이름 다섯 칸으로 좁혀 나간다.
//
// 이름 칸은 초성도 받는다('ㄱㅈ' -> 김지우, 강지원). 스물다섯 명 중 한 명을
// 찾자고 이름 석 자를 다 치는 일은 드물다.
//
// 아무 조건도 안 걸면 지금 고른 학급의 사진을 크게 늘어놓는다. 학기 초에
// 얼굴과 이름을 맞춰 보는 자리로 쓰라는 뜻이고, '이름 가리기'를 켜면
// 혼자 맞춰 볼 수 있다.
import React, { useMemo, useState } from 'react';
import type { ClassRoster, Student } from '../../hooks/useRoster';
import {
  classesInScope,
  gradeOptions,
  classNumOptions,
  yearOptions,
  describeClass,
  type ClassPick,
} from '../../lib/classPicker';
import { matchesName, matchRange } from '../../lib/hangul';
import { classFolderName } from '../../lib/studentPhotoNames';
import StudentPhoto from './StudentPhoto';
import type { StudentPhoto as PhotoEntry } from '../../hooks/useStudentPhotos';

interface RosterSearchTabProps {
  classes: ClassRoster[];
  /** 위쪽 선택 상자에서 고른 학급 */
  pick: ClassPick;
  /** 지금 고른 학급의 사진 (번호 -> 사진) */
  photos: Map<number, PhotoEntry>;
  /** 다른 학급의 사진은 그 학급을 골라야 뜬다는 것을 알리기 위해 */
  photoFolderReady: boolean;
  /** 결과에서 학생을 눌렀을 때 (관리 탭의 그 줄로 데려간다) */
  onOpenStudent: (cls: ClassRoster, student: Student) => void;
}

/** 이름에서 맞아떨어진 자리에만 노란 칠 */
function HighlightedName({ name, query }: { name: string; query: string }) {
  const range = matchRange(name, query);
  if (!range) return <>{name}</>;
  return (
    <>
      {name.slice(0, range.start)}
      <mark className="bg-amber-200 text-amber-900 rounded-xs px-px">
        {name.slice(range.start, range.end)}
      </mark>
      {name.slice(range.end)}
    </>
  );
}

function Chevron() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-slate-400 shrink-0"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

const FIELD = 'w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-primary';

export default function RosterSearchTab({
  classes,
  pick,
  photos,
  photoFolderReady,
  onOpenStudent,
}: RosterSearchTabProps) {
  // 세 칸은 위쪽 선택을 따라 시작하되, 여기서 '전체'로 넓힐 수 있다.
  const [scope, setScope] = useState<ClassPick>(pick);
  const [num, setNum] = useState('');
  const [name, setName] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [hideNames, setHideNames] = useState(false);

  // 위에서 학급을 바꾸면 검색 칸도 따라간다 (사람은 그것을 한 몸으로 여긴다).
  // 지난 값을 state로 들고 있다가 render 중에 견주는 것이 리액트가 일러 주는
  // 방식이다. useEffect로 맞추면 한 번 헌 값으로 그렸다가 고쳐 그리게 된다.
  const pickKey = `${pick.year}|${pick.grade}|${pick.classNum}`;
  const [lastPickKey, setLastPickKey] = useState(pickKey);
  if (lastPickKey !== pickKey) {
    setLastPickKey(pickKey);
    setScope(pick);
  }

  const filtering = num.trim() !== '' || name.trim() !== '';

  const groups = useMemo(() => {
    const inScope = classesInScope(classes, scope);
    const wantNum = num.trim();

    return inScope
      .map((cls) => {
        const hits = (cls.students || []).filter((st) => {
          if (activeOnly && st.isActive === false) return false;
          if (wantNum && String(st.num) !== wantNum) return false;
          if (name.trim() && !matchesName(st.name, name)) return false;
          return true;
        });
        return { cls, hits };
      })
      .filter((g) => g.hits.length > 0)
      .sort(
        (a, b) =>
          Number(b.cls.year) - Number(a.cls.year) ||
          Number(a.cls.grade) - Number(b.cls.grade) ||
          Number(a.cls.classNum) - Number(b.cls.classNum)
      );
  }, [classes, scope, num, name, activeOnly]);

  const totalHits = groups.reduce((n, g) => n + g.hits.length, 0);
  const singleClass = groups.length === 1 && !filtering;

  /** 지금 화면에 사진을 띄울 수 있는 학급인가 (사진은 고른 학급 것만 들고 있다) */
  const photoOwner = `${pick.year}-${pick.grade}-${pick.classNum}`;
  const photoFor = (cls: ClassRoster, st: Student) =>
    classFolderName(cls) === photoOwner ? photos.get(st.num) : undefined;

  return (
    <div className="flex flex-col gap-2.5">
      {/* 찾는 조건 다섯 칸 */}
      <div className="flex items-end gap-2 flex-wrap">
        <label className="flex flex-col gap-1" style={{ width: 84 }}>
          <span className="text-2xs font-bold text-slate-500 pl-0.5">학년도</span>
          <div className="relative">
            <select
              value={scope.year}
              onChange={(e) => setScope({ year: e.target.value, grade: '', classNum: '' })}
              className={`${FIELD} appearance-none pr-6`}
            >
              <option value="">전체</option>
              {yearOptions(classes).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"><Chevron /></span>
          </div>
        </label>

        <label className="flex flex-col gap-1" style={{ width: 68 }}>
          <span className="text-2xs font-bold text-slate-500 pl-0.5">학년</span>
          <div className="relative">
            <select
              value={scope.grade}
              onChange={(e) => setScope((s) => ({ ...s, grade: e.target.value, classNum: '' }))}
              className={`${FIELD} appearance-none pr-6`}
            >
              <option value="">전체</option>
              {gradeOptions(classes, scope.year).map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"><Chevron /></span>
          </div>
        </label>

        <label className="flex flex-col gap-1" style={{ width: 68 }}>
          <span className="text-2xs font-bold text-slate-500 pl-0.5">반</span>
          <div className="relative">
            <select
              value={scope.classNum}
              onChange={(e) => setScope((s) => ({ ...s, classNum: e.target.value }))}
              className={`${FIELD} appearance-none pr-6`}
            >
              <option value="">전체</option>
              {classNumOptions(classes, scope.year, scope.grade).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"><Chevron /></span>
          </div>
        </label>

        <label className="flex flex-col gap-1" style={{ width: 68 }}>
          <span className="text-2xs font-bold text-slate-500 pl-0.5">번호</span>
          <input
            type="text"
            inputMode="numeric"
            value={num}
            onChange={(e) => setNum(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="전체"
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1 flex-1 min-w-38">
          <span className="text-2xs font-bold text-slate-500 pl-0.5">이름 (초성도 가능)</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 김지우 · ㄱㅈㅇ"
            className={FIELD}
          />
        </label>

        <button
          type="button"
          onClick={() => {
            setScope(pick);
            setNum('');
            setName('');
          }}
          className="px-2.5 py-1.5 bg-transparent border border-slate-200 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer"
        >
          조건 지우기
        </button>

        <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 pb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="w-3.5 h-3.5 accent-primary cursor-pointer"
          />
          재학생만
        </label>

        <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 pb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hideNames}
            onChange={(e) => setHideNames(e.target.checked)}
            className="w-3.5 h-3.5 accent-primary cursor-pointer"
          />
          이름 가리기
        </label>
      </div>

      {/* 찾는 말이 있을 때만 몇 명인지 알린다 */}
      {filtering && (
        <div className="flex items-center gap-2 text-2xs font-bold text-slate-600 flex-wrap">
          {name.trim() && /^[ㄱ-ㅎ\s]+$/.test(name) && (
            <span className="bg-blue-50 border border-blue-200 text-primary rounded px-1.5 py-0.5">
              초성으로 찾는 중
            </span>
          )}
          <span>
            {[
              scope.classNum ? `${scope.classNum}반` : scope.grade ? `${scope.grade}학년 전체` : '전체 학급',
              '에서 ',
            ].join('')}
            <b className="text-primary">{totalHits}명</b>
          </span>
        </div>
      )}

      {groups.length === 0 && (
        <div className="text-center py-10 text-xs text-slate-400 font-semibold">
          조건에 맞는 학생이 없습니다.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {groups.map(({ cls, hits }) => {
          const canShowPhotos = photoFolderReady && classFolderName(cls) === photoOwner;
          return (
            <div key={classFolderName(cls)} className="flex flex-col gap-2">
              {/* 학급 하나만 통째로 보고 있을 때는 제목이 군더더기가 아니라
                  '지금 무엇을 보고 있는지'가 되므로 언제나 낸다. */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold text-slate-700">{describeClass(cls)}</span>
                <span className="text-2xs font-bold text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
                  {hits.length}명
                </span>
                <span className="flex-1 h-px bg-slate-200" />
                {!canShowPhotos && photoFolderReady && (
                  <span className="text-2xs font-semibold text-slate-400">
                    사진은 위에서 이 학급을 골라야 보입니다
                  </span>
                )}
              </div>

              <div
                className={`grid gap-2 ${
                  singleClass
                    ? 'grid-cols-5'
                    : 'grid-cols-8'
                }`}
              >
                {hits.map((st) => {
                  const photo = photoFor(cls, st);
                  return (
                    <button
                      key={`${st.num}-${st.name}`}
                      type="button"
                      onClick={() => onOpenStudent(cls, st)}
                      title={`${st.num}번 ${st.name}`}
                      className={`text-left border rounded-xl overflow-hidden bg-white shadow-2xs transition-all cursor-pointer hover:border-primary hover:shadow-xs ${
                        st.isActive === false ? 'opacity-45 border-slate-200' : 'border-slate-200'
                      }`}
                    >
                      <StudentPhoto
                        url={photo?.url}
                        name={st.name}
                        shape="card"
                        loose={photo?.exact === false}
                      />
                      <div className="flex items-center gap-1 px-1.5 py-1.5">
                        <span className="bg-blue-50 text-primary rounded text-2xs font-extrabold px-1 shrink-0">
                          {st.num}
                        </span>
                        <span
                          className={`${singleClass ? 'text-sm' : 'text-xs'} font-extrabold text-slate-800 truncate`}
                        >
                          {hideNames ? '?' : <HighlightedName name={st.name} query={name} />}
                        </span>
                        {st.gender && (
                          <span className="ml-auto text-2xs font-bold text-slate-400 shrink-0">
                            {st.gender === 'M' ? '남' : st.gender === 'F' ? '여' : ''}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
