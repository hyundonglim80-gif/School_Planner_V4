import { describe, it, expect } from 'vitest';
import { filterScheduleByGrade, findVacations, maxGrade, sanitizeSchool, schoolYearOf, vacationMonths } from './schoolSetting';
import type { NeisScheduleItem } from './neis';

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

describe('방학 기간을 학사일정으로 (4-5)', () => {
  const ev = (date: string, name: string): NeisScheduleItem => ({ date, name, grades: [], dayKind: '해당없음' });

  it('학년도는 3월~이듬해 2월, 불러올 달은 여름 7~9월·겨울 12~2월', () => {
    expect(schoolYearOf('2026-10-01')).toBe(2026);
    expect(schoolYearOf('2027-02-28')).toBe(2026);
    expect(schoolYearOf('2027-03-02')).toBe(2027);
    expect(vacationMonths(2026)).toEqual(['2026-07', '2026-08', '2026-09', '2026-12', '2027-01', '2027-02']);
  });

  it('방학식 다음 날 ~ 개학식 전날 (방학식·개학식 날은 수업이 있다)', () => {
    const items = [
      ev('2026-07-10', '1학기 기말고사'),
      ev('2026-07-24', '여름방학식'),
      ev('2026-07-27', '여름방학'),
      ev('2026-08-14', '여름방학'),
      ev('2026-08-17', '2학기 개학식'),
      ev('2026-12-31', '겨울 방학식'),
      ev('2027-02-03', '개학식'),
      ev('2027-02-12', '종업식'),
      ev('2027-02-15', '봄방학'),
    ];
    expect(findVacations(items, 2026)).toEqual({
      summer: { start: '2026-07-25', end: '2026-08-16' },
      winter: { start: '2027-01-01', end: '2027-02-02' },
    });
  });

  it('방학식·개학식이 없으면 방학 날 줄의 처음·끝', () => {
    const items = [ev('2026-07-27', '여름방학'), ev('2026-07-28', '여름방학'), ev('2026-08-21', '여름방학'), ev('2026-08-24', '학력평가')];
    expect(findVacations(items, 2026).summer).toEqual({ start: '2026-07-27', end: '2026-08-21' });
  });

  it('종업식 뒤 학년말 방학은 2월 말일까지 (개학식이 없다)', () => {
    expect(findVacations([ev('2027-01-08', '졸업식 및 종업식')], 2026).winter).toEqual({ start: '2027-01-09', end: '2027-02-28' });
    // 윤년 2월
    expect(findVacations([ev('2028-01-07', '종업식')], 2027).winter).toEqual({ start: '2028-01-08', end: '2028-02-29' });
    // 학년말방학 줄이 있으면 그 끝
    const items = [ev('2027-01-08', '종업식'), ev('2027-01-11', '학년말 방학'), ev('2027-02-26', '학년말 방학')];
    expect(findVacations(items, 2026).winter).toEqual({ start: '2027-01-09', end: '2027-02-26' });
  });

  it('찾지 못하면 null (여름에 개학식만 있거나, 아무것도 없을 때)', () => {
    expect(findVacations([ev('2026-08-17', '개학식')], 2026).summer).toBeNull();
    expect(findVacations([ev('2026-07-24', '방학식')], 2026).summer).toBeNull();
    expect(findVacations([], 2026)).toEqual({ summer: null, winter: null });
  });

  it('다른 학년도와 창 밖의 행사는 보지 않는다', () => {
    const items = [ev('2025-12-31', '방학식'), ev('2026-03-02', '개학식'), ev('2026-06-30', '방학식'), ev('2026-07-24', '방학식'), ev('2026-08-17', '개학식')];
    const got = findVacations(items, 2026);
    expect(got.summer).toEqual({ start: '2026-07-25', end: '2026-08-16' });
    expect(got.winter).toBeNull();
  });
});
