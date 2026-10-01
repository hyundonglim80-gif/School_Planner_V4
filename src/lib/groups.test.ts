import { describe, expect, it } from 'vitest';
import {
  apartInGroups,
  defaultGroupCount,
  evalGroupsFrom,
  groupIndexByNum,
  groupSetSummary,
  moveMember,
  swapMembers,
  randomGroups,
  sanitizeGroupSets,
  seatGroups,
} from './groups';

const nums = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
/** 정해진 차례로 도는 가짜 무작위 */
const seq = (seed = 1) => {
  let x = seed;
  return () => {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
};

describe('defaultGroupCount', () => {
  it('넷씩, 적어도 하나', () => {
    expect(defaultGroupCount(0)).toBe(1);
    expect(defaultGroupCount(3)).toBe(1);
    expect(defaultGroupCount(25)).toBe(6);
    expect(defaultGroupCount(28)).toBe(7);
  });
});

describe('randomGroups', () => {
  it('모두 한 번씩, 크기는 많아야 한 명 차이, 이름은 1모둠부터', () => {
    const groups = randomGroups(nums(25), 6, [], seq(3));
    expect(groups).toHaveLength(6);
    expect(groups.flatMap((g) => g.members).sort((a, b) => a - b)).toEqual(nums(25));
    const sizes = groups.map((g) => g.members.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(groups.map((g) => g.name)).toEqual(['1모둠', '2모둠', '3모둠', '4모둠', '5모둠', '6모둠']);
    // 모둠 안은 번호 차례
    for (const g of groups) expect(g.members).toEqual([...g.members].sort((a, b) => a - b));
  });

  it('떨어뜨릴 학생은 한 모둠에 넣지 않는다', () => {
    const apart = ['1-2', '1-3', '2-3', '4-5', '6-7', '8-9'];
    for (let s = 1; s <= 20; s++) {
      const groups = randomGroups(nums(12), 3, apart, seq(s));
      expect(apartInGroups(groups, apart)).toEqual([]);
    }
  });

  it('모둠 수는 학생 수를 넘지 않는다', () => {
    expect(randomGroups([1, 2], 5, [], seq())).toHaveLength(2);
    expect(randomGroups([], 3)).toEqual([]);
  });
});

describe('seatGroups', () => {
  // 4줄 × 6열, 두 칸씩 짝 → 앞뒤 넷씩 여섯 모둠
  const seats: Record<string, number> = {};
  let n = 1;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) seats[`${r}-${c}`] = n++;

  it('앞뒤 두 줄 × 짝 = 넷씩, 앞줄·왼쪽부터', () => {
    const groups = seatGroups({ rows: 4, cols: 6, groupCols: 2, seats }, nums(24));
    expect(groups).toHaveLength(6);
    expect(groups[0]).toEqual({ name: '1모둠', members: [1, 2, 7, 8] });
    expect(groups[1].members).toEqual([3, 4, 9, 10]);
    expect(groups[3].members).toEqual([13, 14, 19, 20]);
  });

  it('줄이 홀수면 맨 뒷줄은 앞 모둠에 붙는다', () => {
    const s5 = { ...seats, '4-0': 25, '4-1': 26 };
    const groups = seatGroups({ rows: 5, cols: 6, groupCols: 2, seats: s5 }, nums(26));
    expect(groups).toHaveLength(6);
    expect(groups[3].members).toEqual([13, 14, 19, 20, 25, 26]);
  });

  it('통로 없음이면 두 열씩, 혼자 남은 학생은 앞뒤 모둠으로, 자리 없는 학생은 작은 모둠에', () => {
    const s = { '0-0': 1, '0-1': 2, '1-0': 3, '1-1': 4, '0-2': 5, '2-0': 6, '2-1': 7, '3-0': 8 };
    // 9번은 자리 없음, 10번은 재학생이 아니다
    const groups = seatGroups({ rows: 4, cols: 3, groupCols: 0, seats: { ...s, '3-2': 10 } }, nums(9));
    const all = groups.flatMap((g) => g.members).sort((a, b) => a - b);
    expect(all).toEqual(nums(9));
    // 5번(0-2)은 혼자라 앞뒤가 아닌 옆 모둠(1모둠)으로
    expect(groups[0].members).toEqual([1, 2, 3, 4, 5]);
    // 6·7·8번이 한 모둠, 자리 없는 9번은 작은 모둠으로
    expect(groups[1].members).toEqual([6, 7, 8, 9]);
  });

  it('앉은 학생이 없으면 모두 한 모둠', () => {
    expect(seatGroups({ rows: 2, cols: 2, groupCols: 2, seats: {} }, [3, 1])).toEqual([{ name: '1모둠', members: [1, 3] }]);
  });
});

describe('moveMember · groupIndexByNum', () => {
  it('다른 모둠으로 옮긴다 (빈 모둠도 남는다)', () => {
    const groups = [
      { name: '1모둠', members: [1] },
      { name: '2모둠', members: [2, 3] },
    ];
    const moved = moveMember(groups, 1, 1);
    expect(moved).toEqual([
      { name: '1모둠', members: [] },
      { name: '2모둠', members: [1, 2, 3] },
    ]);
    expect(groupIndexByNum(moved).get(1)).toBe(1);
    expect(moveMember(groups, 1, 5)).toBe(groups);
  });
});

describe('swapMembers', () => {
  const groups = [
    { name: '1모둠', members: [1, 2] },
    { name: '2모둠', members: [3, 4] },
  ];
  it('두 모둠의 학생을 맞바꾼다', () => {
    expect(swapMembers(groups, 1, 4)).toEqual([
      { name: '1모둠', members: [2, 4] },
      { name: '2모둠', members: [1, 3] },
    ]);
  });
  it('모둠 없는 학생은 그 자리를 넘겨받는다, 같은 모둠이면 그대로', () => {
    expect(swapMembers(groups, 9, 3)).toEqual([
      { name: '1모둠', members: [1, 2] },
      { name: '2모둠', members: [4, 9] },
    ]);
    expect(swapMembers(groups, 1, 2)).toBe(groups);
  });
});

describe('sanitizeGroupSets', () => {
  it('만든 차례로, 한 학생은 한 모둠에만, 빈 이름은 채운다', () => {
    const sets = sanitizeGroupSets({
      gs_b: { name: '2학기', createdAt: 2, groups: [{ name: '', members: [1, '2', 2] }, { name: '나', members: [2, 3] }] },
      gs_a: { name: '1학기', createdAt: 1, groups: [] },
      bad: 'x',
    });
    expect(sets.map((s) => s.id)).toEqual(['gs_a', 'gs_b']);
    expect(sets[1].groups).toEqual([
      { name: '1모둠', members: [1, 2] },
      { name: '나', members: [3] },
    ]);
    expect(sanitizeGroupSets(null)).toEqual([]);
    expect(sanitizeGroupSets([1])).toEqual([]);
  });
});

describe('evalGroupsFrom · groupSetSummary', () => {
  it('조사표 명단에 있는 학생만, 빈 모둠은 뺀다', () => {
    const set = {
      groups: [
        { name: '1모둠', members: [1, 2, 9] },
        { name: '2모둠', members: [9] },
        { name: '3모둠', members: [3] },
      ],
    };
    expect(evalGroupsFrom(set, [1, 2, 3])).toEqual([
      { name: '1모둠', members: [1, 2] },
      { name: '3모둠', members: [3] },
    ]);
    expect(groupSetSummary(set.groups)).toBe('3모둠 · 5명');
  });
});
