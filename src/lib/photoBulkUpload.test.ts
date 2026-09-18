import { describe, it, expect } from 'vitest';
import { planBulkUpload } from './photoBulkUpload';

const cls = { year: 2026, grade: '3', classNum: '1' };
const students = [
  { num: 18, name: '김세희' },
  { num: 19, name: '김솔희' },
  { num: 20, name: '양다은' },
  { num: 21, name: '이경빈' },
  { num: 22, name: '주서연' },
  { num: 23, name: '최지우' },
];

const f = (...names: string[]) => names.map((name) => ({ name }));
/** 짝지어진 것을 '번호:파일이름'으로 간추린다 */
const pairs = (plan: ReturnType<typeof planBulkUpload>) =>
  plan.matched.map((m) => `${m.student.num}:${m.file.name}`).sort();

describe('앱이 쓰는 이름 그대로', () => {
  it('학년도-학년-반-번호-이름 을 짝짓는다', () => {
    const plan = planBulkUpload(f('2026-3-1-23-최지우.png', '2026-3-1-22-주서연.png'), cls, students);
    expect(pairs(plan)).toEqual(['22:2026-3-1-22-주서연.png', '23:2026-3-1-23-최지우.png']);
    expect(plan.unmatched).toEqual([]);
    expect(plan.matched[0].by).toBe('numAndName');
  });

  it('스물세 장을 통째로 넘겨도 다 짝짓는다', () => {
    const files = f(...students.map((s) => `2026-3-1-${s.num}-${s.name}.png`));
    const plan = planBulkUpload(files, cls, students);
    expect(plan.matched).toHaveLength(students.length);
    expect(plan.unmatched).toEqual([]);
  });
});

describe('번호는 두 자리로 적는다', () => {
  it('05 처럼 앞에 0이 붙어 있어도 5번으로 본다', () => {
    const five = [{ num: 5, name: '홍길동' }];
    expect(pairs(planBulkUpload(f('2026-3-1-05-홍길동.png'), cls, five))).toEqual([
      '5:2026-3-1-05-홍길동.png',
    ]);
  });

  it('한 자리로 적어도 받아들인다', () => {
    const five = [{ num: 5, name: '홍길동' }];
    expect(pairs(planBulkUpload(f('2026-3-1-5-홍길동.png'), cls, five))).toEqual([
      '5:2026-3-1-5-홍길동.png',
    ]);
  });

  it('번호-이름 에서도 두 자리를 받아들인다', () => {
    const five = [{ num: 5, name: '홍길동' }];
    expect(pairs(planBulkUpload(f('05-홍길동.jpg'), cls, five))).toEqual(['5:05-홍길동.jpg']);
  });

  it('번호만 적힌 05.png 도 5번으로 본다', () => {
    const five = [{ num: 5, name: '홍길동' }];
    expect(pairs(planBulkUpload(f('05.png'), cls, five))).toEqual(['5:05.png']);
  });

  it('한 학급을 두 자리 번호로 통째로 넘겨도 다 짝짓는다', () => {
    const roster = [
      { num: 3, name: '강지훈' },
      { num: 9, name: '서지호' },
      { num: 10, name: '손하윤' },
      { num: 23, name: '최지우' },
    ];
    const files = f(...roster.map((s) => `2026-3-1-${String(s.num).padStart(2, '0')}-${s.name}.png`));
    const plan = planBulkUpload(files, cls, roster);
    expect(plan.matched).toHaveLength(4);
    expect(plan.unmatched).toEqual([]);
    expect(plan.matched.every((m) => m.by === 'numAndName')).toBe(true);
  });
});

describe('사람이 붙인 여러 모양', () => {
  it('번호-이름', () => {
    expect(pairs(planBulkUpload(f('23-최지우.jpg'), cls, students))).toEqual(['23:23-최지우.jpg']);
  });

  it('이름만', () => {
    expect(pairs(planBulkUpload(f('최지우.jpeg'), cls, students))).toEqual(['23:최지우.jpeg']);
  });

  it('번호만', () => {
    expect(pairs(planBulkUpload(f('20.webp'), cls, students))).toEqual(['20:20.webp']);
  });

  it('학급 앞머리 + 이름', () => {
    expect(pairs(planBulkUpload(f('2026-3-1-최지우.png'), cls, students))).toEqual([
      '23:2026-3-1-최지우.png',
    ]);
  });

  it('이름이 어딘가 들어 있기만 해도 찾는다', () => {
    expect(pairs(planBulkUpload(f('IMG_0421_최지우(1).png'), cls, students))).toEqual([
      '23:IMG_0421_최지우(1).png',
    ]);
  });

  it('공백과 대소문자를 가리지 않는다', () => {
    expect(pairs(planBulkUpload(f('2026-3-1-23-최 지우.PNG'), cls, students))).toEqual([
      '23:2026-3-1-23-최 지우.PNG',
    ]);
  });
});

describe('짝을 못 짓는 것들', () => {
  it('사진이 아닌 파일은 따로 뺀다', () => {
    const plan = planBulkUpload(f('명단.csv', '최지우.png'), cls, students);
    expect(plan.notPhotos.map((x) => x.name)).toEqual(['명단.csv']);
    expect(plan.matched).toHaveLength(1);
  });

  it('명단에 없는 이름은 짝을 못 짓는다', () => {
    const plan = planBulkUpload(f('홍길동.png'), cls, students);
    expect(plan.matched).toEqual([]);
    expect(plan.unmatched.map((x) => x.name)).toEqual(['홍길동.png']);
  });

  it('한 학생에게 두 장이 걸리면 뒤엣것은 버린다', () => {
    const plan = planBulkUpload(f('2026-3-1-23-최지우.png', '최지우.jpg'), cls, students);
    expect(plan.matched).toHaveLength(1);
    // 좁은 규칙으로 걸린 쪽이 남는다
    expect(plan.matched[0].file.name).toBe('2026-3-1-23-최지우.png');
    expect(plan.duplicates.map((x) => x.name)).toEqual(['최지우.jpg']);
  });

  it('넘긴 것이 없으면 빈 계획', () => {
    const plan = planBulkUpload([], cls, students);
    expect(plan.matched).toEqual([]);
    expect(plan.unmatched).toEqual([]);
  });
});

describe('동명이인', () => {
  const twins = [
    { num: 3, name: '김지우' },
    { num: 14, name: '김지우' },
    { num: 23, name: '최지우' },
  ];

  it('이름만으로는 가르지 않는다', () => {
    const plan = planBulkUpload(f('김지우.png'), cls, twins);
    expect(plan.matched).toEqual([]);
    expect(plan.unmatched.map((x) => x.name)).toEqual(['김지우.png']);
  });

  it('번호가 붙어 있으면 가른다', () => {
    const plan = planBulkUpload(f('14-김지우.png', '3-김지우.png'), cls, twins);
    expect(pairs(plan)).toEqual(['14:14-김지우.png', '3:3-김지우.png']);
  });

  it('겹치지 않는 이름은 그대로 짝짓는다', () => {
    expect(pairs(planBulkUpload(f('최지우.png'), cls, twins))).toEqual(['23:최지우.png']);
  });
});

describe('다른 학급 사진이 섞여 들어온 경우', () => {
  it('학급 앞머리가 달라도 이름이 맞으면 짝짓는다', () => {
    // 폴더를 잘못 골라 2반 사진을 넘겼는데 이름이 우연히 같은 경우까지
    // 막지는 못한다. 다만 번호까지 다르면 이름 규칙으로만 걸린다.
    const plan = planBulkUpload(f('2026-3-2-23-최지우.png'), cls, students);
    expect(plan.matched).toHaveLength(1);
    expect(plan.matched[0].by).toBe('name');
  });
});
