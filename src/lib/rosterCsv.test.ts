import { describe, it, expect } from 'vitest';
import { toCsv, parseCsv } from './csv';
import {
  ROSTER_CSV_HEADER,
  buildRosterCsvRows,
  parseRosterCsvRows,
  mergeRosters,
  genderToText,
  textToGender,
} from './rosterCsv';
import type { ClassRoster } from '../hooks/useRoster';

const classes: ClassRoster[] = [
  {
    year: 2026,
    grade: '3',
    classNum: '2',
    students: [
      { num: 1, name: '김하늘', gender: 'F', isActive: true, note: '체육 면제' },
      { num: 2, name: '이바다', gender: 'M', isActive: false, note: '' },
    ],
  },
  {
    year: 2026,
    grade: '3',
    classNum: '1',
    students: [{ num: 1, name: '박구름', gender: 'M', isActive: true, note: '' }],
  },
];

describe('CSV 읽기 - 엑셀에서 고친 파일도 읽어야 한다', () => {
  it('따옴표 없는 칸의 공백을 칸의 끝으로 보지 않는다', () => {
    // 예전 파서는 여기서 '체육'만 남기고 '면제'를 버렸다.
    // 엑셀은 따옴표가 필요 없는 칸의 따옴표를 떼고 저장하므로 흔한 모양이다.
    expect(parseCsv('번호,이름,특이사항\n1,김하늘,체육 면제')).toEqual([
      ['번호', '이름', '특이사항'],
      ['1', '김하늘', '체육 면제'],
    ]);
  });

  it('따옴표 안의 쉼표와 줄바꿈을 한 칸으로 본다', () => {
    expect(parseCsv('a,"콤마, 포함","두 줄\n짜리"')).toEqual([['a', '콤마, 포함', '두 줄\n짜리']]);
  });

  it('두 번 적은 따옴표는 한 글자로 읽는다', () => {
    expect(parseCsv('a,"그는 ""안녕"" 했다"')).toEqual([['a', '그는 "안녕" 했다']]);
  });

  it('BOM과 \\r\\n 줄바꿈을 받는다', () => {
    expect(parseCsv('﻿번호,이름\r\n1,김하늘\r\n')).toEqual([
      ['번호', '이름'],
      ['1', '김하늘'],
    ]);
  });

  it('빈 줄은 버린다', () => {
    expect(parseCsv('a,b\n\n\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('만든 것을 그대로 되읽는다', () => {
    const rows = [
      ['번호', '특이사항'],
      ['1', '쉼표, 따옴표" 줄바꿈\n까지'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('감쌀 필요가 없는 칸은 감싸지 않는다 (엑셀에서 보기 좋게)', () => {
    expect(toCsv([['1', '김하늘']], false)).toBe('1,김하늘');
  });
});

describe('성별 칸', () => {
  it('사람이 보는 칸에는 남/여로 적는다', () => {
    expect(genderToText('M')).toBe('남');
    expect(genderToText('F')).toBe('여');
    expect(genderToText('')).toBe('');
  });

  it('손으로 고칠 수 있으니 여러 모양을 받는다', () => {
    for (const text of ['남', '남자', 'M', 'm', 'male']) expect(textToGender(text)).toBe('M');
    for (const text of ['여', '여자', 'F', 'f', 'female']) expect(textToGender(text)).toBe('F');
    expect(textToGender('')).toBe('');
    expect(textToGender('알 수 없음')).toBe('');
  });
});

describe('조사표 CSV', () => {
  const rows = buildRosterCsvRows(classes);

  it('머리말이 정해진 차례대로 나온다', () => {
    expect(rows[0]).toEqual(ROSTER_CSV_HEADER);
  });

  it('학생 한 명이 한 줄이고, 학급 정보가 앞에 붙는다', () => {
    expect(rows).toHaveLength(4); // 머리말 + 3명
    expect(rows[1]).toEqual(['2026', '3', '2', '1', '김하늘', '여', '재학', '체육 면제']);
    expect(rows[2]).toEqual(['2026', '3', '2', '2', '이바다', '남', '전출', '']);
  });

  it('내보낸 것을 되읽으면 원래 값이 나온다', () => {
    const { classList } = parseRosterCsvRows(rows);

    expect(classList).toHaveLength(2);
    // 학년·반 순으로 정렬한다
    expect(classList[0].classNum).toBe('1');
    expect(classList[1].classNum).toBe('2');

    const cls = classList[1];
    expect(cls.students[0]).toEqual({ num: 1, name: '김하늘', gender: 'F', isActive: true, note: '체육 면제' });
    expect(cls.students[1].isActive).toBe(false);
  });

  it('파일로 한 바퀴 돌려도 값이 그대로다', () => {
    const { classList } = parseRosterCsvRows(parseCsv(toCsv(rows)));
    expect(classList.find((c) => c.classNum === '2')!.students[0].note).toBe('체육 면제');
  });

  it('칸 차례를 바꿔 저장해도 머리말을 보고 찾는다', () => {
    const swapped = [
      ['이름', '번호', '학년도', '학년', '반', '성별', '상태', '특이사항'],
      ['김하늘', '1', '2026', '3', '2', '여', '재학', '체육 면제'],
    ];
    const { classList } = parseRosterCsvRows(swapped);

    expect(classList[0].students[0]).toMatchObject({ num: 1, name: '김하늘', gender: 'F' });
  });

  it('번호나 이름이 빈 줄은 건너뛰고 몇 줄인지 알려준다', () => {
    const messy = [
      ROSTER_CSV_HEADER,
      ['2026', '3', '2', '1', '김하늘', '여', '재학', ''],
      ['', '', '', '', '', '', '', ''],
      ['2026', '3', '2', '', '이름만 있고 번호 없음', '', '', ''],
      ['합계', '', '', '', '', '', '', ''],
    ];
    const { classList, skipped } = parseRosterCsvRows(messy);

    expect(classList[0].students).toHaveLength(1);
    expect(skipped).toBe(3);
  });

  it('번호가 뒤섞여 있어도 번호순으로 정리한다', () => {
    const unsorted = [
      ROSTER_CSV_HEADER,
      ['2026', '3', '2', '5', '다섯', '', '', ''],
      ['2026', '3', '2', '1', '하나', '', '', ''],
    ];
    const { classList } = parseRosterCsvRows(unsorted);

    expect(classList[0].students.map((s) => s.num)).toEqual([1, 5]);
  });

  it('상태가 비어 있으면 재학으로 본다', () => {
    const { classList } = parseRosterCsvRows([
      ROSTER_CSV_HEADER,
      ['2026', '3', '2', '1', '김하늘', '여', '', ''],
    ]);
    expect(classList[0].students[0].isActive).toBe(true);
  });

  it('머리말만 있으면 빈 값이다', () => {
    expect(parseRosterCsvRows([ROSTER_CSV_HEADER])).toEqual({ classList: [], skipped: 0 });
  });
});

describe('mergeRosters - 파일에 없는 학급은 건드리지 않는다', () => {
  it('같은 학급은 파일 내용으로 바꾼다', () => {
    const current: ClassRoster[] = [
      { year: 2026, grade: '3', classNum: '1', students: [{ num: 1, name: '옛날' }] },
    ];
    const incoming: ClassRoster[] = [
      { year: 2026, grade: '3', classNum: '1', students: [{ num: 1, name: '새것' }] },
    ];

    const merged = mergeRosters(current, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].students[0].name).toBe('새것');
  });

  it('파일에 없는 학급은 그대로 남는다', () => {
    const current: ClassRoster[] = [
      { year: 2026, grade: '3', classNum: '1', students: [{ num: 1, name: '3-1' }] },
      { year: 2026, grade: '4', classNum: '1', students: [{ num: 1, name: '4-1' }] },
    ];
    const incoming: ClassRoster[] = [
      { year: 2026, grade: '3', classNum: '1', students: [{ num: 1, name: '바뀜' }] },
    ];

    const merged = mergeRosters(current, incoming);
    expect(merged).toHaveLength(2);
    expect(merged.find((c) => c.grade === '4')!.students[0].name).toBe('4-1');
  });

  it('새 학급은 더한다', () => {
    const merged = mergeRosters([], [{ year: 2026, grade: '5', classNum: '3', students: [] }]);
    expect(merged).toHaveLength(1);
  });
});
