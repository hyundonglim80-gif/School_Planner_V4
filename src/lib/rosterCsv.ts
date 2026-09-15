// src/lib/rosterCsv.ts
//
// 조사표(학급 명렬표)를 CSV로 주고받는다.
//
// 예전에는 백업 파일 안에 JSON으로만 들어 있어서, 이름 하나 고치려 해도
// 중괄호를 헤치고 들어가야 했다. 학급이 여러 개라도 한 파일에 담고, 그 파일을
// 엑셀에서 고쳐 그대로 다시 넣을 수 있게 한다.
//
//   학년도, 학년, 반, 번호, 이름, 성별, 상태, 특이사항
//
// 한 줄이 학생 한 명이다. 앞의 세 칸이 같으면 같은 학급으로 묶는다.
import type { ClassRoster, Student } from '../hooks/useRoster';

export const ROSTER_CSV_HEADER = ['학년도', '학년', '반', '번호', '이름', '성별', '상태', '특이사항'];

/** 저장은 M/F로 하지만 사람이 보는 칸에는 남/여로 적는다 */
export function genderToText(gender?: string): string {
  if (gender === 'M') return '남';
  if (gender === 'F') return '여';
  return '';
}

/** 남/여/M/F/male/female 을 모두 받는다. 엑셀에서 손으로 고칠 수 있기 때문이다. */
export function textToGender(text: string): string {
  const value = String(text ?? '').trim();
  if (!value) return '';
  if (/^(남|남자|M|male)$/i.test(value)) return 'M';
  if (/^(여|여자|F|female)$/i.test(value)) return 'F';
  return '';
}

export function buildRosterCsvRows(classList: ClassRoster[]): string[][] {
  const rows: string[][] = [ROSTER_CSV_HEADER];

  for (const cls of classList) {
    for (const st of cls.students || []) {
      rows.push([
        String(cls.year ?? ''),
        String(cls.grade ?? ''),
        String(cls.classNum ?? ''),
        String(st.num ?? ''),
        st.name || '',
        genderToText(st.gender),
        st.isActive === false ? '전출' : '재학',
        st.note || '',
      ]);
    }
  }

  return rows;
}

export interface RosterCsvResult {
  classList: ClassRoster[];
  /** 읽지 못하고 건너뛴 줄 수. 왜 적게 들어왔는지 알려주려면 필요하다. */
  skipped: number;
}

/**
 * CSV 표를 학급 목록으로 되돌린다.
 *
 * 머리말이 어느 자리에 있든 이름으로 찾는다. 엑셀에서 칸 차례를 바꿔 저장하는
 * 일이 흔하기 때문이다. 머리말을 알아보지 못하면 정해진 차례대로 읽는다.
 */
export function parseRosterCsvRows(rows: string[][]): RosterCsvResult {
  if (!rows || rows.length < 2) return { classList: [], skipped: 0 };

  const header = rows[0].map((h) => String(h ?? '').trim());
  const idxOf = (name: string, fallback: number) => {
    const found = header.findIndex((h) => h === name);
    return found === -1 ? fallback : found;
  };

  const col = {
    year: idxOf('학년도', 0),
    grade: idxOf('학년', 1),
    classNum: idxOf('반', 2),
    num: idxOf('번호', 3),
    name: idxOf('이름', 4),
    gender: idxOf('성별', 5),
    status: idxOf('상태', 6),
    note: idxOf('특이사항', 7),
  };

  const byClass = new Map<string, ClassRoster>();
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const cell = (i: number) => String(row[i] ?? '').trim();

    const num = parseInt(cell(col.num), 10);
    const name = cell(col.name);
    const grade = cell(col.grade);
    const classNum = cell(col.classNum);
    const year = parseInt(cell(col.year), 10);

    // 번호와 이름이 없으면 학생 줄이 아니다 (빈 줄, 합계 줄, 메모 줄 등)
    if (!Number.isFinite(num) || !name) {
      skipped++;
      continue;
    }
    if (!grade || !classNum) {
      skipped++;
      continue;
    }

    const key = `${year || ''}|${grade}|${classNum}`;
    if (!byClass.has(key)) {
      byClass.set(key, {
        year: Number.isFinite(year) ? year : new Date().getFullYear(),
        grade,
        classNum,
        students: [],
      });
    }

    const student: Student = {
      num,
      name,
      gender: textToGender(cell(col.gender)),
      // '전출'이라고 적힌 것만 전출로 본다. 빈칸은 재학이다.
      isActive: !cell(col.status).includes('전출'),
      note: cell(col.note),
    };
    byClass.get(key)!.students.push(student);
  }

  // 학급은 학년도·학년·반 순으로, 학생은 번호순으로 정렬한다
  const classList = Array.from(byClass.values()).map((cls) => ({
    ...cls,
    students: [...cls.students].sort((a, b) => a.num - b.num),
  }));
  classList.sort(
    (a, b) =>
      a.year - b.year ||
      String(a.grade).localeCompare(String(b.grade), 'ko', { numeric: true }) ||
      String(a.classNum).localeCompare(String(b.classNum), 'ko', { numeric: true })
  );

  return { classList, skipped };
}

/**
 * 가져온 학급을 지금 있는 목록에 얹는다.
 * 학년도·학년·반이 같으면 그 학급의 명단을 통째로 바꾸고, 없으면 새로 넣는다.
 * 파일에 없는 학급은 그대로 둔다(파일 하나로 다른 학급이 지워지면 곤란하다).
 */
export function mergeRosters(current: ClassRoster[], incoming: ClassRoster[]): ClassRoster[] {
  const keyOf = (c: ClassRoster) => `${c.year}|${c.grade}|${c.classNum}`;
  const merged = new Map<string, ClassRoster>();

  for (const cls of current) merged.set(keyOf(cls), cls);
  for (const cls of incoming) merged.set(keyOf(cls), cls);

  return Array.from(merged.values());
}
