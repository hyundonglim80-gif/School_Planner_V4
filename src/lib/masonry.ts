// src/lib/masonry.ts
//
// 카드를 '지금 가장 짧은 열'에 차례로 넣는 계산 (구글 Keep과 같은 방식).
// 높이가 같으면 왼쪽 열을 먼저 쓴다.

/** 각 카드의 열 번호와 위쪽 위치, 그리고 가장 긴 열의 높이 */
export function layoutMasonry(heights: number[], columns: number, gap: number) {
  const colHeights = new Array(columns).fill(0);
  const positions = heights.map((h) => {
    let col = 0;
    for (let c = 1; c < columns; c++) if (colHeights[c] < colHeights[col] - 0.5) col = c;
    const top = colHeights[col];
    colHeights[col] += h + gap;
    return { col, top };
  });
  const total = Math.max(0, ...colHeights.map((h) => h - gap));
  return { positions, total };
}
