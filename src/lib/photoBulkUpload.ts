// src/lib/photoBulkUpload.ts
//
// 사진 여러 장을 한꺼번에 올릴 때, 어느 파일이 어느 학생인지 짝짓는다.
// 드라이브도 화면도 부르지 않는 순수한 셈만 둔다.
//
// 스물다섯 명을 하나씩 눌러 올리게 할 수는 없다. 파일 이름에 이미 누구인지가
// 적혀 있으므로 그걸 읽어 짝지어 준다. 다만 사람이 붙인 이름은 제각각이라
// 한 가지 모양만 받아들이면 대부분 짝을 못 찾는다. 그래서 좁은 규칙부터
// 넓은 규칙까지 차례로 대 본다.
//
//   2026-3-1-05-홍길동.png   학년도-학년-반-번호-이름 (앱이 쓰는 이름)
//   2026-3-1-홍길동.png      학년도-학년-반-이름
//   05-홍길동.png            번호-이름
//   홍길동.png               이름만
//   05.png                   번호만
//
// 번호는 두 자리로 적는 것이 약속이지만(05), 손으로 붙인 이름은 한 자리인
// 경우가 있다(5). 어느 쪽이든 받아들인다.
//
// 넓은 규칙일수록 엉뚱하게 걸리기 쉬우므로, 좁은 규칙에서 이미 짝을 지은
// 학생은 건너뛴다. 한 학생에게 두 파일이 걸리면 뒤엣것은 버린다.
import {
  classFolderName,
  normalizeName,
  stripExtension,
  isPhotoFile,
  padNum,
  type ClassKey,
} from './studentPhotoNames';

export interface UploadCandidate {
  /** 파일 이름 (확장자 포함) */
  name: string;
}

export interface PlannedUpload<T extends UploadCandidate> {
  file: T;
  student: { num: number; name: string };
  /** 어느 규칙으로 짝지었는가 (화면에서 확신의 정도를 보여 주려고) */
  by: 'numAndName' | 'name' | 'num';
}

export interface BulkUploadPlan<T extends UploadCandidate> {
  matched: PlannedUpload<T>[];
  /** 학생을 못 찾은 파일 */
  unmatched: T[];
  /** 사진이 아닌 파일 (확장자가 다름) */
  notPhotos: T[];
  /** 이미 짝이 있는 학생에게 또 걸린 파일 */
  duplicates: T[];
}

interface Student {
  num: number;
  name: string;
}

/** 파일 이름에서 확장자와 군더더기를 걷어낸 비교용 문자열 */
function baseOf(fileName: string): string {
  return normalizeName(stripExtension(fileName));
}

/**
 * 파일 이름과 명단을 짝짓는다.
 *
 * 돌려주는 matched의 차례는 넘긴 파일 차례를 따르지 않는다. 규칙이 좁은
 * 것부터 훑기 때문이다. 화면에 늘어놓을 때는 번호로 다시 세우면 된다.
 */
export function planBulkUpload<T extends UploadCandidate>(
  files: T[],
  cls: ClassKey,
  students: Student[]
): BulkUploadPlan<T> {
  const prefix = normalizeName(classFolderName(cls));

  const notPhotos = files.filter((f) => !isPhotoFile(f.name));
  const photos = files.filter((f) => isPhotoFile(f.name));

  const matched: PlannedUpload<T>[] = [];
  const duplicates: T[] = [];
  /** 이미 짝을 지은 학생 번호 */
  const taken = new Set<number>();
  /** 아직 짝을 못 지은 파일 */
  let left = photos;

  const claim = (file: T, student: Student, by: PlannedUpload<T>['by']) => {
    if (taken.has(student.num)) {
      duplicates.push(file);
      return;
    }
    taken.add(student.num);
    matched.push({ file, student, by });
  };

  /** 한 바퀴 돌며 짝지어진 것을 걷어낸다 */
  const pass = (pick: (base: string) => { student: Student; by: PlannedUpload<T>['by'] } | null) => {
    const rest: T[] = [];
    for (const file of left) {
      const hit = pick(baseOf(file.name));
      if (hit) claim(file, hit.student, hit.by);
      else rest.push(file);
    }
    left = rest;
  };

  // 이름이 겹치는 학생이 있으면 이름만으로는 가를 수 없다. 그런 이름은
  // 이름 규칙에서 빼고 번호가 든 규칙으로만 짝짓는다.
  const nameCount = new Map<string, number>();
  for (const st of students) {
    const key = normalizeName(st.name);
    if (key) nameCount.set(key, (nameCount.get(key) || 0) + 1);
  }
  const uniqueByName = new Map<string, Student>();
  for (const st of students) {
    const key = normalizeName(st.name);
    if (key && nameCount.get(key) === 1) uniqueByName.set(key, st);
  }

  // 1. 학년도-학년-반-번호-이름 (번호는 두 자리든 한 자리든)
  pass((base) => {
    for (const st of students) {
      const n = normalizeName(st.name);
      if (!n) continue;
      if (base === `${prefix}-${padNum(st.num)}-${n}` || base === `${prefix}-${st.num}-${n}`) {
        return { student: st, by: 'numAndName' };
      }
    }
    return null;
  });

  // 2. 번호-이름 (학급 앞머리는 있어도 없어도 된다)
  pass((base) => {
    for (const st of students) {
      const n = normalizeName(st.name);
      if (!n) continue;
      if (base === `${st.num}-${n}` || base === `${padNum(st.num)}-${n}`) {
        return { student: st, by: 'numAndName' };
      }
    }
    return null;
  });

  // 3. 이름 (앞머리가 붙어 있어도 된다). 겹치는 이름은 제외.
  pass((base) => {
    for (const [n, st] of uniqueByName) {
      if (base === n || base === `${prefix}-${n}` || base.endsWith(`-${n}`)) {
        return { student: st, by: 'name' };
      }
    }
    return null;
  });

  // 4. 번호만 ('5.png'도 '05.png'도 5번으로 본다)
  pass((base) => {
    if (!/^\d+$/.test(base)) return null;
    const num = Number(base);
    const st = students.find((s) => s.num === num);
    return st ? { student: st, by: 'num' } : null;
  });

  // 5. 이름이 어딘가 들어 있기만 해도 (IMG_2026-3-1-최지우(1).png 같은 것)
  pass((base) => {
    for (const [n, st] of uniqueByName) {
      if (n.length >= 2 && base.includes(n)) return { student: st, by: 'name' };
    }
    return null;
  });

  return { matched, unmatched: left, notPhotos, duplicates };
}
