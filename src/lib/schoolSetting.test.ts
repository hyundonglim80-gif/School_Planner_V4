import { describe, it, expect } from 'vitest';
import { filterScheduleByGrade, maxGrade, sanitizeSchool } from './schoolSetting';

// 환경설정 '우리 학교' (docs/ROADMAP.md 4-2)

describe('우리 학교 읽기', () => {
  it('학교 코드가 없으면 고르지 않은 것', () => {
    expect(sanitizeSchool(undefined)).toBeNull();
    expect(sanitizeSchool({ updatedAt: 1 })).toBeNull();
    expect(sanitizeSchool({ officeCode: 'B10' })).toBeNull();
  });

  it('학년은 그 학교에 있는 학년만 (아니면 전 학년)', () => {
    const base = { officeCode: 'B10', schoolCode: '7091375', name: '서울대도초등학교', officeName: '서울특별시교육청' };
    expect(sanitizeSchool({ ...base, kind: '초등학교', grade: 6 })?.grade).toBe(6);
    expect(sanitizeSchool({ ...base, kind: '중학교', grade: 6 })?.grade).toBe(0);
    expect(sanitizeSchool({ ...base, kind: '고등학교', grade: '2' })?.grade).toBe(2);
    expect(sanitizeSchool({ ...base, kind: '초등학교' })).toEqual({ ...base, kind: '초등학교', grade: 0 });
  });

  it('초등은 6학년, 그 밖은 3학년까지', () => {
    expect(maxGrade('초등학교')).toBe(6);
    expect(maxGrade('중학교')).toBe(3);
    expect(maxGrade('')).toBe(3);
  });
});

describe('학년으로 거르기', () => {
  const items = [
    { date: '2026-10-14', name: '중간고사', grades: [], dayKind: '' },
    { date: '2026-10-20', name: '3학년 수학여행', grades: [3], dayKind: '' },
    { date: '2026-10-21', name: '5·6학년 현장체험', grades: [5, 6], dayKind: '' },
  ];
  it('전 학년(0)이면 모두, 학년을 고르면 전 학년 행사와 그 학년 것만', () => {
    expect(filterScheduleByGrade(items, 0)).toHaveLength(3);
    expect(filterScheduleByGrade(items, 3).map((it) => it.name)).toEqual(['중간고사', '3학년 수학여행']);
    expect(filterScheduleByGrade(items, 5).map((it) => it.name)).toEqual(['중간고사', '5·6학년 현장체험']);
  });
});
