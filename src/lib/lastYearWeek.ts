// src/lib/lastYearWeek.ts
//
// 작년 이맘때 (docs/ROADMAP.md 7) - 보고 있는 주의 '작년 학년도 같은 주'를 찾는다.
//
// 같은 주 = 학년도 몇째 주. 개학 주(3월 2일이 든 주, 3월 2일이 주말이면 다음 월요일이 든 주)가 1주다.
// 364일(52주)을 빼는 것으로는 안 된다. 해마다 1~2일씩 밀려서 해에 따라 한 주가 어긋난다
// (2030 개학 주는 3.4 주인데 364일 전은 2029.3.5 주 - 2029 개학 주는 2.26 주라 둘째 주가 된다).
// 주는 월요일에 시작한다(dateUtils.getWeekDays와 같다).
import { addDays, daysBetween, formatDateStr, parseDateStr } from './dateUtils';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/** 그 학년도 개학일: 3월 2일, 주말이면 다음 월요일 */
export function schoolStartDate(schoolYear: number): string {
  const d = new Date(schoolYear, 2, 2);
  const dow = d.getDay();
  if (dow === 6) d.setDate(4);
  else if (dow === 0) d.setDate(3);
  return formatDateStr(d);
}

/** 그 날이 든 주의 월요일 */
export function mondayOf(dateStr: string): string {
  const dow = parseDateStr(dateStr).getDay();
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}

/** 그 학년도 1주(개학 주)의 월요일 */
const firstWeekMonday = (schoolYear: number) => mondayOf(schoolStartDate(schoolYear));

export interface SchoolWeek {
  schoolYear: number;
  /** 1부터. 개학 주가 1주 */
  week: number;
}

/** 그 날이 든 주가 몇 학년도 몇째 주인가. 개학 주 앞(2월 말)은 지난 학년도의 끝 주들이다. */
export function schoolWeekOf(dateStr: string): SchoolWeek {
  const monday = mondayOf(dateStr);
  let schoolYear = Number(monday.slice(0, 4));
  if (monday < firstWeekMonday(schoolYear)) schoolYear -= 1;
  return { schoolYear, week: daysBetween(firstWeekMonday(schoolYear), monday) / 7 + 1 };
}

/** 그 학년도에 주가 몇 개인가 (다음 개학 주 앞까지, 52 또는 53) */
export function weeksInSchoolYear(schoolYear: number): number {
  return daysBetween(firstWeekMonday(schoolYear), firstWeekMonday(schoolYear + 1)) / 7;
}

/** 몇 학년도 몇째 주의 월요일. 그 학년도에 그 주가 없으면(한 주 짧은 해) 마지막 주 */
export function mondayOfSchoolWeek(schoolYear: number, week: number): string {
  const w = Math.min(Math.max(1, week), weeksInSchoolYear(schoolYear));
  return addDays(firstWeekMonday(schoolYear), (w - 1) * 7);
}

/** 작년 학년도 같은 주 같은 요일 */
export function lastYearDateOf(dateStr: string): string {
  const { schoolYear, week } = schoolWeekOf(dateStr);
  const weekday = daysBetween(mondayOf(dateStr), dateStr); // 0 = 월
  return addDays(mondayOfSchoolWeek(schoolYear - 1, week), weekday);
}

export interface LastYearWeek {
  /** 작년 학년도와 몇째 주 */
  schoolYear: number;
  week: number;
  /** 올해 날짜 → 작년 같은 요일 날짜 */
  dateMap: Record<string, string>;
  /** 작년 날짜들 (차례대로) */
  lastDates: string[];
  /** 예: "2025학년도 1주 · 2025.3.3 (월) ~ 3.9 (일)" */
  label: string;
}

const shortDate = (dateStr: string, withYear: boolean) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = DAY_NAMES[parseDateStr(dateStr).getDay()];
  return `${withYear ? `${y}.` : ''}${m}.${d} (${dow})`;
};

/** 보고 있는 주(날짜들)의 작년 같은 주. 날짜가 없으면 null */
export function lastYearWeekOf(dates: string[]): LastYearWeek | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  const dateMap: Record<string, string> = {};
  for (const d of sorted) dateMap[d] = lastYearDateOf(d);
  const lastDates = sorted.map((d) => dateMap[d]);
  const { schoolYear, week } = schoolWeekOf(lastDates[0]);
  const first = lastDates[0];
  const last = lastDates[lastDates.length - 1];
  const range =
    first === last
      ? shortDate(first, true)
      : `${shortDate(first, true)} ~ ${shortDate(last, first.slice(0, 4) !== last.slice(0, 4))}`;
  return { schoolYear, week, dateMap, lastDates, label: `${schoolYear}학년도 ${week}주 · ${range}` };
}
