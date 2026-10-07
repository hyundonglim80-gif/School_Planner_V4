// src/components/CourseEvalOverview.tsx
//
// 평가 모아 보기의 '과정별' 탭 (docs/ROADMAP-SUBJECT.md S9, 교과 모드만). 과정 하나를 고르면 반마다 그 학년도 조사표를 모아
// (lib/evalArchive - 학급별 탭과 같은 읽기) 제목+종류로 묶은 반 × 평가 표(lib/courseEvals). 칸은 '완료 n/m'(값이 있는 학생 / 재학생),
// 누르면 그 반 조사표가 열린다(닫으면 다시 읽는다 - 부모의 reloadTick). 읽기만 한다.
import { useEffect, useMemo, useState } from 'react';
import { auth } from '../lib/firebase';
import type { ClassRoster } from '../hooks/useRoster';
import { useProgressPlans } from '../hooks/useProgress';
import { courseTitle, isCourse } from '../lib/progress';
import { schoolYearOf } from '../lib/schoolSetting';
import { rosterForSlot } from '../lib/teachingSlot';
import { loadClassEvals, type ArchivedEval, type EvalSpace } from '../lib/evalArchive';
import { EVAL_TYPE_LABEL } from '../lib/evalSummary';
import { courseColumnDate, courseEvalCompletion, courseOverviewCsvRows, groupCourseEvals } from '../lib/courseEvals';
import { downloadCsv } from '../lib/csv';
import { showErrorToast, showToast } from '../utils/toast';

interface Props {
  rosterList: ClassRoster[];
  spaces: EvalSpace[];
  /** 조사표 창을 닫을 때마다 늘어난다 - 다시 읽는다 */
  reloadTick: number;
  openEval: (ev: ArchivedEval) => void;
}

const COURSE_MEMORY_KEY = 'sp4-eval-overview-course';

export default function CourseEvalOverview({ rosterList, spaces, reloadTick, openEval }: Props) {
  const { plans, loaded } = useProgressPlans();
  const courses = useMemo(() => plans.filter(isCourse), [plans]);
  const [courseId, setCourseId] = useState<string>(() => {
    try {
      return localStorage.getItem(COURSE_MEMORY_KEY) || '';
    } catch {
      return '';
    }
  });
  const course = courses.find((c) => c.id === courseId) || courses[0] || null;

  // 반마다: 그 학년도 명렬표와 재학생 번호
  const classes = useMemo(() => {
    if (!course) return [];
    const year = schoolYearOf(course.startDate || new Date().toISOString().slice(0, 10));
    return (course.classes || []).map((cls) => {
      const roster = rosterForSlot(rosterList, cls, year);
      const nums = (roster?.students || [])
        .filter((s) => s.isActive !== false)
        .map((s) => Number(s.num))
        .sort((a, b) => a - b);
      return { cls, roster, nums };
    });
  }, [course, rosterList]);

  const [byClass, setByClass] = useState<Record<string, ArchivedEval[]> | null>(null);
  const spacesKey = spaces.map((s) => s.id || 'me').join(',');
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !course) return;
    let alive = true;
    Promise.all(classes.map(async (c) => [c.cls, c.roster ? await loadClassEvals(uid, spaces, c.roster) : []] as const))
      .then((pairs) => alive && setByClass(Object.fromEntries(pairs)))
      .catch((err) => {
        if (!alive) return;
        setByClass({});
        showErrorToast('조사표를 모으지 못했습니다. 네트워크를 확인해 주세요.', err);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id, classes, spacesKey, reloadTick]);
  useEffect(() => setByClass(null), [course?.id]);

  const columns = useMemo(() => (byClass ? groupCourseEvals(byClass, course?.subject) : []), [byClass, course?.subject]);

  const choose = (id: string) => {
    setCourseId(id);
    try {
      localStorage.setItem(COURSE_MEMORY_KEY, id);
    } catch {
      /* 무시 */
    }
  };

  const download = () => {
    if (!course || columns.length === 0) return showToast('내려받을 조사표가 없습니다.');
    const name = `과정평가_${courseTitle(course)}`.replace(/[\\/:*?"<>|\s]+/g, '_');
    downloadCsv(courseOverviewCsvRows(columns, classes), `${name}.csv`);
  };

  if (!loaded) return <p className="text-center text-slate-400 py-8">과정을 불러오는 중…</p>;
  if (courses.length === 0) {
    return (
      <p className="text-center text-slate-400 py-8">
        과정이 없습니다. ⋮ 메뉴 → 📘 진도 관리 → <b>+ 새 진도</b>에서 과목과 반을 골라 차시 목록 하나를 여러 반에 두면 여기서 반 × 평가로 봅니다.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-course-overview>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={course?.id || ''}
          onChange={(e) => choose(e.target.value)}
          aria-label="과정"
          className="px-2 py-1.5 border border-slate-200 rounded-lg font-bold text-xs bg-white"
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {courseTitle(c)} · {(c.classes || []).join(', ')}
            </option>
          ))}
        </select>
        <span className="font-bold text-slate-500 mr-auto">
          {byClass === null ? '모으는 중…' : `평가 ${columns.length}개 · 반 ${classes.length}개`}
        </span>
        <button
          type="button"
          onClick={download}
          disabled={columns.length === 0}
          className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 font-bold disabled:opacity-40"
        >
          📥 CSV
        </button>
      </div>

      {byClass === null ? (
        <p className="text-center text-slate-400 py-8">불러오는 중…</p>
      ) : columns.length === 0 ? (
        <p className="text-center text-slate-400 py-8">
          이 과정의 반에 {course?.subject ? `'${course.subject}' ` : ''}조사표가 없습니다. 수업 칸의 📊 조사표에서 '같은 과정의 다른 반에도'로 만들면 반마다 생깁니다.
        </p>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-auto max-h-[65vh]">
          <table className="text-xs border-collapse min-w-full" data-course-overview-table>
            <thead className="bg-slate-100 sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-10 bg-slate-100 p-1.5 min-w-14 text-left border-b border-r border-slate-200">반</th>
                {columns.map((col) => (
                  <th key={col.id} className="p-1.5 border-b border-r border-slate-200 align-top min-w-24 max-w-40 font-normal text-left">
                    <span className="block text-2xs font-bold text-slate-400">
                      {EVAL_TYPE_LABEL[col.type] || ''} · {courseColumnDate(col)}~
                    </span>
                    <span className="block font-black text-slate-700 leading-tight line-clamp-2">{col.title}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {classes.map(({ cls, nums, roster }) => (
                <tr key={cls} data-course-overview-row={cls} className="hover:bg-slate-50">
                  <td className="sticky left-0 bg-white p-1.5 font-black text-slate-800 border-b border-r border-slate-100 whitespace-nowrap">
                    {cls}
                    {!roster && <span className="block text-2xs font-normal text-slate-400">명렬표 없음</span>}
                  </td>
                  {columns.map((col) => {
                    const ev = col.byClass[cls];
                    if (!ev) {
                      return (
                        <td key={col.id} className="p-1.5 text-center text-slate-300 border-b border-r border-slate-100" data-course-cell={`${cls}|${col.title}`}>
                          -
                        </td>
                      );
                    }
                    const { done, total } = courseEvalCompletion(ev, nums);
                    const full = total > 0 && done >= total;
                    return (
                      <td key={col.id} className="p-1 text-center border-b border-r border-slate-100">
                        <button
                          type="button"
                          data-course-cell={`${cls}|${col.title}`}
                          onClick={() => openEval(ev)}
                          title={`${cls} ${ev.dateStr} ${ev.title} - 눌러서 열기`}
                          className={`w-full rounded-md px-1.5 py-1 font-bold hover:bg-white border ${
                            full ? 'text-emerald-700 border-emerald-200 bg-emerald-50' : 'text-slate-700 border-transparent'
                          }`}
                        >
                          완료 {done}/{total}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-2xs text-slate-400">
        반마다 같은 제목·종류의 조사표를 한 칸으로 묶었습니다(날짜는 반마다 다릅니다). '완료'는 값이 있는 학생 수 / 그 반 재학생 수. 칸을 누르면 그 반 조사표가 열립니다.
      </p>
    </div>
  );
}
