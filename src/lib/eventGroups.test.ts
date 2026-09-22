import { describe, it, expect } from 'vitest';
import { baseContentOf, groupIdOf, hitsFrom, countGroupItems, type GroupHit } from './eventGroups';

describe('기간 일정 본문에서 번호 떼기', () => {
  it("'(3/10)'을 떼어낸다", () => {
    expect(baseContentOf('여름방학 (3/10)')).toBe('여름방학');
  });

  it('번호가 없으면 그대로 둔다', () => {
    expect(baseContentOf('교직원 회의')).toBe('교직원 회의');
  });

  it('가운데 있는 괄호는 건드리지 않는다', () => {
    // 뒤에 붙은 번호만 기간 표시다
    expect(baseContentOf('1학년 (1/2반) 상담')).toBe('1학년 (1/2반) 상담');
  });
});

describe('묶음 판별', () => {
  it('groupId가 있으면 묶음에 속한 것으로 본다', () => {
    expect(groupIdOf({ groupId: 'group_a' })).toBe('group_a');
  });

  it('없으면 묶음이 아니다', () => {
    expect(groupIdOf({})).toBeNull();
    expect(groupIdOf(null)).toBeNull();
  });
});

describe('삭제 범위 고르기', () => {
  const hits: GroupHit[] = [
    { dateStr: '2026-09-21', list: [], items: [{ id: 'a' }] },
    { dateStr: '2026-09-22', list: [], items: [{ id: 'b' }, { id: 'c' }] },
    { dateStr: '2026-09-23', list: [], items: [{ id: 'd' }] },
  ];

  it('기준 날짜부터 뒤쪽만 고른다', () => {
    expect(hitsFrom(hits, '2026-09-22').map((h) => h.dateStr)).toEqual([
      '2026-09-22',
      '2026-09-23',
    ]);
  });

  it('날짜 수가 아니라 일정 건수를 센다', () => {
    expect(countGroupItems(hits)).toBe(4);
    expect(countGroupItems(hitsFrom(hits, '2026-09-22'))).toBe(3);
  });
});
