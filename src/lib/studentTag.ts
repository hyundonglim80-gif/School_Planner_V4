// src/lib/studentTag.ts
//
// 학생 고유 번호 태그.  #26040305 = 2026학년도 4학년 3반 5번
//
// 기록에 이 태그를 적어 두면 '학생 기록(누가기록)'이 그 학생의 기록을 모아 준다.
// 학년도·학년·반·번호를 두 자리씩 이어 적는다. 명렬표에 이름을 따로 두므로
// 태그에는 이름을 넣지 않는다(이름이 바뀌거나 동명이인이어도 흔들리지 않는다).

import type { ClassRoster, Student } from '../hooks/useRoster';

export interface StudentTag {
  /** 학년도 (2026) */
  year: number;
  grade: number;
  classNum: number;
  num: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** #26040305 꼴의 태그를 만든다 */
export function makeStudentTag(t: StudentTag): string {
  return `#${pad2(t.year % 100)}${pad2(t.grade)}${pad2(t.classNum)}${pad2(t.num)}`;
}

/**
 * 글 안의 태그를 모두 찾는다. 처음·끝뿐 아니라 어디에 있어도 찾는다.
 * 여덟 자리보다 긴 숫자(#2604030512 등)는 태그로 보지 않는다.
 */
export function findStudentTags(text: string): StudentTag[] {
  const out: StudentTag[] = [];
  const seen = new Set<string>();
  for (const m of String(text || '').matchAll(/#(\d{2})(\d{2})(\d{2})(\d{2})(?!\d)/g)) {
    const key = m[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ year: 2000 + Number(m[1]), grade: Number(m[2]), classNum: Number(m[3]), num: Number(m[4]) });
  }
  return out;
}

export function sameStudent(a: StudentTag, b: StudentTag): boolean {
  return a.year === b.year && a.grade === b.grade && a.classNum === b.classNum && a.num === b.num;
}

/** 명렬표의 학급·학생으로 태그 값을 만든다 */
export function tagOfStudent(cls: Pick<ClassRoster, 'year' | 'grade' | 'classNum'>, student: Pick<Student, 'num'>): StudentTag {
  return {
    year: Number(cls.year),
    grade: Number(cls.grade),
    classNum: Number(cls.classNum),
    num: Number(student.num),
  };
}

/** 태그가 가리키는 학생의 이름 (명렬표에 없으면 null) */
export function studentNameOf(tag: StudentTag, rosters: ClassRoster[]): string | null {
  const cls = rosters.find(
    (c) => Number(c.year) === tag.year && Number(c.grade) === tag.grade && Number(c.classNum) === tag.classNum
  );
  const st = cls?.students?.find((s) => Number(s.num) === tag.num);
  return st?.name || null;
}
