import { describe, it, expect } from 'vitest';
import { findStudentTags, makeStudentTag, studentNameOf, tagOfStudent } from './studentTag';

describe('학생 태그 #학년도학년반번호', () => {
  it('두 자리씩 이어 만든다', () => {
    expect(makeStudentTag({ year: 2026, grade: 4, classNum: 3, num: 5 })).toBe('#26040305');
    expect(makeStudentTag(tagOfStudent({ year: 2026, grade: '4', classNum: '3' }, { num: 12 }))).toBe('#26040312');
  });

  it('글의 처음·끝·가운데 어디에 있어도 찾는다', () => {
    expect(findStudentTags('#26040305 발표를 잘함')).toEqual([{ year: 2026, grade: 4, classNum: 3, num: 5 }]);
    expect(findStudentTags('발표를 잘함 #26040305')).toHaveLength(1);
    expect(findStudentTags('김지우(#26040305)와 박하늘(#26040312) 다툼')).toHaveLength(2);
  });

  it('같은 태그를 두 번 적어도 한 번만 센다', () => {
    expect(findStudentTags('#26040305 … #26040305')).toHaveLength(1);
  });

  it('여덟 자리가 아니면 태그가 아니다', () => {
    expect(findStudentTags('#2604030 #2604030512 #abc')).toEqual([]);
  });

  it('명렬표에서 이름을 찾는다', () => {
    const rosters = [{ year: 2026, grade: '4', classNum: '3', students: [{ num: 5, name: '김지우' }] }];
    expect(studentNameOf({ year: 2026, grade: 4, classNum: 3, num: 5 }, rosters as any)).toBe('김지우');
    expect(studentNameOf({ year: 2026, grade: 4, classNum: 3, num: 6 }, rosters as any)).toBeNull();
  });
});
