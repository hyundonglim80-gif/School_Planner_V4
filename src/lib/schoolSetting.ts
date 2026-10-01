// src/lib/schoolSetting.ts
//
// 환경설정 '우리 학교' (docs/ROADMAP.md 4-2) - 나이스 급식·학사일정을 부를 학교.
// users/{uid}/settings/v4_school (V4 전용, 계정에 하나 - PC·휴대폰이 같은 학교를 본다).
// 학교를 고르지 않았으면 급식·학사일정을 부르지 않는다.
import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { NeisSchool, NeisScheduleItem, SchoolRef } from './neis';

export interface SchoolSetting extends SchoolRef {
  officeName: string;
  name: string;
  kind: string;
  /** 학사일정을 거를 학년 (0 = 전 학년) */
  grade: number;
}

export const schoolSettingRef = (uid: string) => doc(db, 'users', uid, 'settings', 'v4_school');

/** 저장된 모양을 믿지 않고 고쳐 읽는다. 학교가 없으면 null */
export function sanitizeSchool(raw: any): SchoolSetting | null {
  if (!raw?.officeCode || !raw?.schoolCode) return null;
  const kind = String(raw.kind || '');
  const grade = Number(raw.grade);
  return {
    officeCode: String(raw.officeCode),
    schoolCode: String(raw.schoolCode),
    officeName: String(raw.officeName || ''),
    name: String(raw.name || ''),
    kind,
    grade: Number.isInteger(grade) && grade >= 1 && grade <= maxGrade(kind) ? grade : 0,
  };
}

/** 초등학교는 6학년까지, 그 밖은 3학년까지 */
export function maxGrade(kind: string): number {
  return /초등/.test(kind) ? 6 : 3;
}

/** 학교를 고른다 (학년은 처음으로). null이면 지운다 - 급식·학사일정을 부르지 않는다 */
export async function saveSchool(uid: string, school: NeisSchool | null): Promise<void> {
  await setDoc(
    schoolSettingRef(uid),
    school
      ? {
          officeCode: school.officeCode,
          schoolCode: school.schoolCode,
          officeName: school.officeName,
          name: school.name,
          kind: school.kind,
          grade: 0,
          updatedAt: Date.now(),
        }
      : { updatedAt: Date.now() }
  );
}

export async function saveSchoolGrade(uid: string, grade: number): Promise<void> {
  await setDoc(schoolSettingRef(uid), { grade, updatedAt: Date.now() }, { merge: true });
}

/** 학사일정 이름에 마우스를 올리면 보일 글 - 이름·학년·내용, 한 줄에 하나 */
export function schoolEventTitle(items: NeisScheduleItem[]): string {
  return items
    .map((it) => `📚 ${it.name}${it.grades.length ? ` (${it.grades.join('·')}학년)` : ''}${it.content ? ` - ${it.content}` : ''}`)
    .join('\n');
}

/** 고른 학년의 학사일정만 (전 학년 행사는 늘 남긴다) */
export function filterScheduleByGrade(items: NeisScheduleItem[], grade: number): NeisScheduleItem[] {
  if (!grade) return items;
  return items.filter((it) => it.grades.length === 0 || it.grades.includes(grade));
}

// ── 방학 기간을 학사일정으로 채우기 (docs/ROADMAP.md 4-5) ─────────────
// 시간표 설정의 방학 기간 = 수업이 없는 날. 그래서 방학식 '다음 날'부터 개학식 '전날'까지다.
// 방학식·개학식이 없으면 '여름방학'·'학년말방학'처럼 방학 날마다 적힌 줄의 처음·끝을 쓴다.

export interface VacationRange {
  start: string;
  end: string;
}

/** 그 날짜가 든 학년도 (3월~이듬해 2월) */
export function schoolYearOf(dateStr: string): number {
  const y = Number(dateStr.slice(0, 4));
  return Number(dateStr.slice(5, 7)) >= 3 ? y : y - 1;
}

/** 방학을 찾으려고 불러올 달 - 여름(7~9월)과 겨울(12월~이듬해 2월) */
export function vacationMonths(schoolYear: number): string[] {
  const n = schoolYear + 1;
  return [`${schoolYear}-07`, `${schoolYear}-08`, `${schoolYear}-09`, `${schoolYear}-12`, `${n}-01`, `${n}-02`];
}

const squash = (name: string) => name.replace(/\s+/g, '');
/** 방학이 시작되는 행사 (그 다음 날부터 방학) */
const isClosing = (name: string) => /방학식|종업식/.test(squash(name));
/** 방학이 끝나는 행사 (그 전날까지 방학) */
const isOpening = (name: string) => /개학/.test(squash(name));
/** 방학 날마다 적힌 줄 ('여름방학', '학년말방학', '봄방학' …) */
const isVacationDay = (name: string) => /방학/.test(squash(name)) && !/방학식/.test(squash(name));

const addDays = (dateStr: string, days: number) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function findRange(items: NeisScheduleItem[], from: string, to: string, fallbackEnd?: string): VacationRange | null {
  const inWindow = items.filter((it) => it.date >= from && it.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const closing = inWindow.find((it) => isClosing(it.name));
  const start = closing ? addDays(closing.date, 1) : inWindow.find((it) => isVacationDay(it.name))?.date;
  if (!start) return null;
  const opening = inWindow.find((it) => it.date >= start && isOpening(it.name));
  const lastDay = inWindow.filter((it) => it.date >= start && isVacationDay(it.name)).pop()?.date;
  const end = opening ? addDays(opening.date, -1) : lastDay || fallbackEnd;
  return end && end >= start ? { start, end } : null;
}

/**
 * 학사일정에서 여름·겨울 방학을 찾는다. 못 찾은 쪽은 null.
 * - 여름: 7~9월. 방학식 다음 날 ~ 개학식 전날.
 * - 겨울: 12월~이듬해 2월. 방학식(또는 종업식) 다음 날 ~ 개학식 전날. 개학식이 없으면(종업식 뒤 학년말 방학)
 *   방학 날 줄의 끝, 그것도 없으면 2월 말일(학년도 끝).
 */
export function findVacations(
  items: NeisScheduleItem[],
  schoolYear: number
): { summer: VacationRange | null; winter: VacationRange | null } {
  const n = schoolYear + 1;
  const febEnd = addDays(`${n}-03-01`, -1);
  return {
    summer: findRange(items, `${schoolYear}-07-01`, `${schoolYear}-09-30`),
    winter: findRange(items, `${schoolYear}-12-01`, febEnd, febEnd),
  };
}
