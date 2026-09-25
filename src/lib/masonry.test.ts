import { describe, it, expect } from 'vitest';
import { layoutMasonry } from './masonry';

// 1→2→3→4열로 돌아가며 담았더니 긴 카드가 한 열에 겹쳐 그 열만 길어졌다.
describe('메모 카드 쌓기 - 가장 짧은 열에 넣는다', () => {
  it('처음 줄은 왼쪽부터 차례로 채운다', () => {
    const { positions } = layoutMasonry([100, 100, 100], 3, 10);
    expect(positions.map((p) => p.col)).toEqual([0, 1, 2]);
    expect(positions.every((p) => p.top === 0)).toBe(true);
  });

  it('긴 카드가 있는 열은 건너뛰고 짧은 열에 넣는다', () => {
    // 첫 카드가 아주 길다. 돌아가며 담으면 4번째 카드도 0번 열 밑으로 간다.
    const { positions } = layoutMasonry([600, 100, 100, 100, 100], 2, 10);
    expect(positions.map((p) => p.col)).toEqual([0, 1, 1, 1, 1]);
  });

  it('열 높이의 차이가 카드 하나를 넘지 않는다', () => {
    const heights = [400, 80, 120, 300, 90, 90, 500, 60, 200, 150, 70, 350];
    const columns = 3;
    const gap = 8;
    const { positions } = layoutMasonry(heights, columns, gap);
    const bottoms = new Array(columns).fill(0);
    positions.forEach((p, i) => {
      bottoms[p.col] = Math.max(bottoms[p.col], p.top + heights[i]);
    });
    const spread = Math.max(...bottoms) - Math.min(...bottoms);
    expect(spread).toBeLessThanOrEqual(Math.max(...heights) + gap);
  });

  it('전체 높이는 가장 긴 열의 높이다', () => {
    const { total } = layoutMasonry([100, 50, 30], 2, 10);
    // 0열: 100, 1열: 50 + 10 + 30 = 90
    expect(total).toBe(100);
  });
});
