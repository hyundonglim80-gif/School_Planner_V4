import { describe, expect, it } from 'vitest';
import { applyMention, findMention, matchMentionStudents } from './mention';

const rosters = [
  {
    year: 2025,
    grade: '4',
    classNum: '3',
    students: [{ num: 1, name: '김지우' }, { num: 2, name: '박서준' }],
  },
  {
    year: 2026,
    grade: '4',
    classNum: '3',
    students: [
      { num: 1, name: '김지우' },
      { num: 2, name: '이도윤' },
      { num: 5, name: '김지호' },
      { num: 6, name: '최지아', isActive: false },
    ],
  },
  { year: 2026, grade: '5', classNum: '1', students: [{ num: 3, name: '정하은' }] },
] as any[];

describe('findMention', () => {
  it('줄 처음·빈칸 뒤의 @찾는말', () => {
    expect(findMention('@김지', 3)).toEqual({ start: 0, query: '김지' });
    expect(findMention('발표 잘함 @ㄱㅈ', 9)).toEqual({ start: 6, query: 'ㄱㅈ' });
    expect(findMention('발표 @', 4)).toEqual({ start: 3, query: '' });
    expect(findMention('줄\n@5', 4)).toEqual({ start: 2, query: '5' });
  });
  it('메일 주소·빈칸 뒤·커서 뒤 글자는 아니다', () => {
    expect(findMention('teacher@school', 14)).toBeNull();
    expect(findMention('@김지 발표', 6)).toBeNull();
    expect(findMention('@김지우', 2)).toEqual({ start: 0, query: '김' });
    expect(findMention('@#26', 4)).toBeNull();
  });
});

describe('matchMentionStudents', () => {
  it('올해 학년도 학급 먼저, 이름 어디든·초성, 전출은 빼고', () => {
    const hits = matchMentionStudents(rosters, '지', { schoolYear: 2026 });
    expect(hits.map((h) => h.tag)).toEqual(['#26040301', '#26040305', '#25040301']);
    expect(matchMentionStudents(rosters, 'ㄱㅈㅎ', { schoolYear: 2026 }).map((h) => h.student.name)).toEqual(['김지호']);
  });
  it('앞에 둘 학급이 맨 앞, 숫자는 번호', () => {
    const hits = matchMentionStudents(rosters, '1', { preferClassKey: '2025_4_3', schoolYear: 2026 });
    expect(hits.map((h) => h.tag)).toEqual(['#25040301', '#26040301']);
  });
  it('비었으면 맨 앞 학급의 학생들, 많으면 자른다', () => {
    expect(matchMentionStudents(rosters, '', { schoolYear: 2026 }).map((h) => h.student.num)).toEqual([1, 2, 5]);
    expect(matchMentionStudents(rosters, '', { schoolYear: 2026, limit: 2 })).toHaveLength(2);
  });
});

describe('applyMention', () => {
  it('@찾는말을 태그와 빈칸으로, 커서는 그 뒤', () => {
    const text = '오늘 @김지 발표';
    const r = applyMention(text, { start: 3, query: '김지' }, '#26040301');
    expect(r.text).toBe('오늘 #26040301 발표');
    expect(r.caret).toBe('오늘 #26040301 '.length);
  });
  it('끝이면 빈칸을 붙인다', () => {
    const r = applyMention('발표 @', { start: 3, query: '' }, '#26040305');
    expect(r).toEqual({ text: '발표 #26040305 ', caret: '발표 #26040305 '.length });
  });
});
