// src/components/SubjectAttendanceSummaryModal.tsx
//
// 교과 출결 누계 (docs/ROADMAP-SUBJECT.md S7, 사용 설명서 '교과 출결'). 학급 탭 '교과 출결', 교과 출결 칸의 '📊 누계',
// 단축키·⋮ 메뉴 '교과 출결 누계'로 연다.
// 반을 고르고 기간(1학기·2학기·학년도)을 고르면 학생마다 결과·지각·조퇴 교시 수. 학생을 누르면 날짜·교시 내역.
// CSV(엑셀에서 열리게 BOM 붙은 UTF-8)·인쇄. 읽기만 한다 - 적는 것은 수업 칸의 '🙋 출결'.
import { useEffect, useMemo, useRef, useState } from 'react';
import ModalShell, { ModalCloseButton } from './ModalShell';
import { useRoster } from '../hooks/useRoster';
import { useTimetableTemplate } from '../hooks/useTimetableTemplate';
import { useClassColorOf } from '../hooks/useClassColor';
import { classKeyOf, REASON_LABEL } from '../lib/attendance';
import { schoolYearOf } from '../lib/schoolSetting';
import { formatDateStr } from '../lib/dateUtils';
import { classesForYear } from '../lib/teachingSlot';
import { semesterOf, schoolYearRange } from '../lib/evalSummary';
import {
  studentTotals,
  subjectRecordText,
  summaryCsvRows,
  type SubjectAttendanceDay,
} from '../lib/subjectAttendance';
import { loadSubjectAttendanceForClass } from '../lib/subjectAttendanceStore';
import { shortDateLabel } from '../lib/notices';
import { downloadCsv } from '../lib/csv';
import { printNode } from '../lib/print';
import { showErrorToast } from '../utils/toast';

type Range = 'sem1' | 'sem2' | 'year';
const RANGE_LABEL: Record<Range, string> = { sem1: '1학기', sem2: '2학기', year: '학년도 전체' };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** 처음 고를 반 (학급 탭·교과 출결 칸에서 열 때) */
  initialClassKey?: string;
}

export default function SubjectAttendanceSummaryModal({ isOpen, onClose, initialClassKey }: Props) {
  const { rosterList, loading } = useRoster();
  const { semesterConfig } = useTimetableTemplate();
  const today = formatDateStr(new Date());
  const schoolYear = schoolYearOf(today);
  const colorOf = useClassColorOf(today);
  // 올해 학년도 반 (학년·반 차례), 넘겨받은 반이 다른 학년도면 그것도
  const classes = useMemo(() => {
    const list = classesForYear(rosterList, schoolYear);
    const extra = initialClassKey ? rosterList.find((c) => classKeyOf(c) === initialClassKey) : null;
    if (extra && !list.some((c) => classKeyOf(c.roster) === initialClassKey)) {
      list.unshift({ label: `${extra.grade}-${extra.classNum}`, roster: extra });
    }
    return list;
  }, [rosterList, schoolYear, initialClassKey]);

  const [classKey, setClassKey] = useState<string>(initialClassKey || '');
  useEffect(() => {
    if (!classKey && classes[0]) setClassKey(classKeyOf(classes[0].roster));
  }, [classes, classKey]);
  const picked = classes.find((c) => classKeyOf(c.roster) === classKey) || null;
  const roster = picked?.roster || null;

  const [range, setRange] = useState<Range>(() => (semesterOf(today, schoolYear, semesterConfig) === 1 ? 'sem1' : 'sem2'));
  const [days, setDays] = useState<SubjectAttendanceDay[] | null>(null);
  const [openNum, setOpenNum] = useState<number | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !classKey) return;
    let alive = true;
    setDays(null);
    loadSubjectAttendanceForClass(classKey)
      .then((d) => alive && setDays(d))
      .catch((err) => {
        if (!alive) return;
        setDays([]);
        showErrorToast('교과 출결 누계를 불러오지 못했습니다.', err);
      });
    return () => {
      alive = false;
    };
  }, [isOpen, classKey]);

  const year = roster ? Number(roster.year) : schoolYear;
  const inRange = useMemo(() => {
    const { start, end } = schoolYearRange(year);
    return (days || []).filter(
      (d) =>
        d.date >= start &&
        d.date <= end &&
        (range === 'year' || semesterOf(d.date, year, semesterConfig) === (range === 'sem1' ? 1 : 2))
    );
  }, [days, range, year, semesterConfig]);
  const totals = useMemo(() => studentTotals(inRange), [inRange]);
  const students = useMemo(
    () =>
      (roster?.students || [])
        .filter((s) => s.isActive !== false || totals[String(s.num)])
        .map((s) => ({ num: Number(s.num), name: s.name }))
        .sort((a, b) => a.num - b.num),
    [roster, totals]
  );
  const rows = summaryCsvRows(students, totals).slice(1);
  const label = picked?.label || '';
  // 파일 이름은 조사표 모아 보기와 같은 모양 (빈칸·괄호 없이)
  const fileStem = `교과출결_${year}학년도_${label}_${RANGE_LABEL[range].replace(/\s+/g, '')}`;

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} width="2xl" title="🙋 교과 출결 누계" footer={<ModalCloseButton onClose={onClose} />}>
      {loading ? (
        <p className="py-10 text-center text-xs text-slate-400">명렬표를 불러오는 중...</p>
      ) : classes.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">
          {schoolYear}학년도 명렬표가 없습니다. ⋮ 메뉴 → 학급 정보(명렬표) 관리에서 반을 먼저 만드세요.
        </p>
      ) : (
        <div className="space-y-3 text-xs text-slate-700" data-subject-att-summary-modal>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="반 고르기">
            {classes.map((c) => {
              const key = classKeyOf(c.roster);
              const on = key === classKey;
              return (
                <button
                  key={key}
                  type="button"
                  data-summary-class={c.label}
                  aria-pressed={on}
                  onClick={() => {
                    setClassKey(key);
                    setOpenNum(null);
                  }}
                  className={`px-2.5 py-1 rounded-lg font-black border ${colorOf(c.label).chip} ${
                    on ? 'ring-2 ring-offset-1 ring-slate-500 border-transparent' : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
            <span className="mx-1 text-slate-300">|</span>
            {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
              <button
                key={r}
                type="button"
                data-summary-range={r}
                aria-pressed={range === r}
                onClick={() => setRange(r)}
                className={`px-2 py-1 rounded-lg border font-bold ${
                  range === r ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                }`}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                data-summary-csv
                disabled={days === null}
                onClick={() => downloadCsv(summaryCsvRows(students, totals), `${fileStem}.csv`)}
                className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 font-bold disabled:opacity-40"
              >
                ⬇️ CSV
              </button>
              <button
                type="button"
                data-summary-print
                disabled={days === null}
                onClick={() =>
                  tableRef.current &&
                  printNode(tableRef.current, {
                    title: `${year}학년도 ${label} 교과 출결 누계 (${RANGE_LABEL[range]})`,
                    subtitle: '결과·지각·조퇴는 교시 수',
                  })
                }
                className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 font-bold disabled:opacity-40"
              >
                🖨️ 인쇄
              </button>
            </div>
          </div>
          <p className="text-slate-400">결과·지각·조퇴는 교시 수입니다. 학생을 누르면 날짜·교시 내역이 펼쳐집니다.</p>

          {days === null ? (
            <p className="py-6 text-center text-slate-400">불러오는 중...</p>
          ) : (
            <div ref={tableRef} className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-xs" data-summary-table>
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-bold w-12">번호</th>
                    <th className="px-2 py-1.5 text-left font-bold">이름</th>
                    <th className="px-2 py-1.5 text-right font-bold">결과</th>
                    <th className="px-2 py-1.5 text-right font-bold">지각</th>
                    <th className="px-2 py-1.5 text-right font-bold">조퇴</th>
                    <th className="px-2 py-1.5 text-right font-bold">합계</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(([num, name, a, l, e, sum]) => {
                    const n = Number(num);
                    const items = totals[String(n)]?.items || [];
                    const open = openNum === n && items.length > 0;
                    return (
                      <tr key={n} data-summary-row={n} className="align-top">
                        <td className="px-2 py-1.5 tabular-nums text-slate-400">{n}</td>
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => setOpenNum(open ? null : n)}
                            disabled={items.length === 0}
                            className="font-bold text-slate-800 hover:underline disabled:no-underline disabled:cursor-default text-left"
                          >
                            {String(name) || '(이름 없음)'}
                          </button>
                          {open && (
                            <ul className="mt-1 space-y-0.5 text-slate-500" data-summary-items>
                              {items.map((it, i) => (
                                <li key={i}>
                                  {shortDateLabel(it.date)} {it.period}교시 {subjectRecordText(it.record, REASON_LABEL)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        {[a, l, e].map((v, i) => (
                          <td key={i} className={`px-2 py-1.5 text-right tabular-nums ${Number(v) ? 'text-rose-600 font-bold' : 'text-slate-300'}`}>
                            {v}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-right tabular-nums font-black text-slate-800">{sum}</td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-2 py-6 text-center text-slate-400">
                        이 반에 학생이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}
