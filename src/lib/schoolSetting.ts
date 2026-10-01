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

/** 고른 학년의 학사일정만 (전 학년 행사는 늘 남긴다) */
export function filterScheduleByGrade(items: NeisScheduleItem[], grade: number): NeisScheduleItem[] {
  if (!grade) return items;
  return items.filter((it) => it.grades.length === 0 || it.grades.includes(grade));
}
