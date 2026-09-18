// src/lib/classPicker.ts
//
// 학년도 / 학년 / 반 세 칸으로 학급 하나를 고르는 셈.
//
// 예전에는 학급 목록 하나짜리 드롭다운이었다('2026년 3학년 2반' …).
// 학급이 대여섯 개를 넘어가면 그 목록에서 원하는 반을 찾는 것이 일이 되고,
// 검색 탭에서는 '학년 전체'처럼 반만 비워 둔 범위도 필요하다.
// 그래서 세 칸으로 나눈다.
import type { ClassRoster } from '../hooks/useRoster';

/** 세 칸에 걸린 값. 빈 문자열은 '전체'를 뜻한다(검색 탭에서만 쓴다). */
export interface ClassPick {
  year: string;
  grade: string;
  classNum: string;
}

/** 숫자처럼 생긴 것은 숫자 차례로, 아니면 글자 차례로 세운다 ('10반'이 '2반' 뒤에 오게) */
function compareLabel(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b, 'ko');
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((v) => v !== ''))].sort(compareLabel);
}

/** 고를 수 있는 학년도. 최근 것이 앞에 오게 뒤집는다. */
export function yearOptions(classes: ClassRoster[]): string[] {
  return uniqueSorted(classes.map((c) => String(c.year))).reverse();
}

/** 그 학년도 안에서 고를 수 있는 학년 */
export function gradeOptions(classes: ClassRoster[], year: string): string[] {
  return uniqueSorted(
    classes.filter((c) => !year || String(c.year) === year).map((c) => String(c.grade))
  );
}

/** 그 학년도·학년 안에서 고를 수 있는 반 */
export function classNumOptions(
  classes: ClassRoster[],
  year: string,
  grade: string
): string[] {
  return uniqueSorted(
    classes
      .filter((c) => (!year || String(c.year) === year) && (!grade || String(c.grade) === grade))
      .map((c) => String(c.classNum))
  );
}

/** 세 값에 딱 맞는 학급이 목록의 몇 번째인가. 없으면 -1. */
export function indexOfPick(classes: ClassRoster[], pick: ClassPick): number {
  return classes.findIndex(
    (c) =>
      String(c.year) === pick.year &&
      String(c.grade) === pick.grade &&
      String(c.classNum) === pick.classNum
  );
}

/** 몇 번째 학급인지로부터 세 값을 되짚는다 */
export function pickOfIndex(classes: ClassRoster[], index: number): ClassPick {
  const c = classes[index];
  if (!c) return { year: '', grade: '', classNum: '' };
  return { year: String(c.year), grade: String(c.grade), classNum: String(c.classNum) };
}

/**
 * 한 칸을 바꿨을 때 나머지 두 칸을 추슬러 준다.
 *
 * 학년도를 2025로 바꿨는데 그 해에 3학년이 없으면 학년 칸이 허공을 가리킨다.
 * 그럴 때는 고를 수 있는 것 중 첫 번째로 내려앉힌다. 고를 것이 아예 없으면
 * 빈 값으로 둔다(학급을 아직 하나도 안 만든 경우).
 */
export function reconcilePick(classes: ClassRoster[], want: ClassPick): ClassPick {
  const years = yearOptions(classes);
  const year = years.includes(want.year) ? want.year : years[0] || '';

  const grades = gradeOptions(classes, year);
  const grade = grades.includes(want.grade) ? want.grade : grades[0] || '';

  const nums = classNumOptions(classes, year, grade);
  const classNum = nums.includes(want.classNum) ? want.classNum : nums[0] || '';

  return { year, grade, classNum };
}

/**
 * 검색 범위에 드는 학급들.
 * 빈 칸은 '전체'로 본다 — 반만 비우면 그 학년 전체, 학년까지 비우면 그 해 전체.
 */
export function classesInScope(classes: ClassRoster[], pick: ClassPick): ClassRoster[] {
  return classes.filter(
    (c) =>
      (!pick.year || String(c.year) === pick.year) &&
      (!pick.grade || String(c.grade) === pick.grade) &&
      (!pick.classNum || String(c.classNum) === pick.classNum)
  );
}

/** '2026학년도 3학년 2반' — 화면에 적을 이름 */
export function describeClass(c: { year: number | string; grade: string; classNum: string }): string {
  const parts = [`${c.year}학년도`];
  if (c.grade) parts.push(`${c.grade}학년`);
  if (c.classNum) parts.push(`${c.classNum}반`);
  return parts.join(' ');
}
