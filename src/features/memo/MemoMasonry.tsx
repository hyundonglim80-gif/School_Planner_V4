// src/features/memo/MemoMasonry.tsx
//
// 구글 Keep처럼 카드를 '지금 가장 짧은 열'에 차례로 쌓는다.
//
// 예전에는 1→2→3→4열로 돌아가며 담았다. 카드 높이를 보지 않으니 그림이 든
// 긴 카드가 한 열에 겹치면 그 열만 한참 길어지고, 목록 아래쪽에는 한 열에만
// 메모가 남았다.
//
// 카드마다 실제 높이를 재서(ResizeObserver) 자리를 정한다. 그림이 늦게 뜨거나
// 카드를 접고 펴서 높이가 바뀌면 다시 쌓는다. 모든 카드를 한 상자에 두고
// 위치만 옮기므로, 다른 열로 옮겨 가도 카드가 새로 만들어지지 않는다
// (접어 둔 상태 등이 그대로 남는다).
import React, { useEffect, useState } from 'react';
import { layoutMasonry } from '../../lib/masonry';

/** 아직 재지 못한 카드의 높이 어림값 */
const ESTIMATED_HEIGHT = 160;

interface MemoMasonryProps<T> {
  items: T[];
  getKey: (item: T) => string;
  columns: number;
  /** 카드 사이 간격(px). 가로·세로 같게 쓴다. */
  gap: number;
  renderItem: (item: T) => React.ReactNode;
}

export default function MemoMasonry<T>({ items, getKey, columns, gap, renderItem }: MemoMasonryProps<T>) {
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  // 관찰자는 한 번만 만든다. 높이가 바뀐 카드가 있을 때만 새 Map으로 바꿔 다시 그린다.
  const [observer] = useState(() =>
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          setHeights((prev) => {
            let next: Map<string, number> | null = null;
            for (const entry of entries) {
              const el = entry.target as HTMLElement;
              const key = el.dataset.masonryKey;
              if (!key) continue;
              const h = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
              if (Math.abs((prev.get(key) ?? -1) - h) > 0.5) {
                next ??= new Map(prev);
                next.set(key, h);
              }
            }
            return next ?? prev;
          });
        })
  );

  useEffect(() => () => observer?.disconnect(), [observer]);

  // 높이를 잴 수 없는 브라우저에서는 겹치지 않도록 평범한 격자로 둔다.
  if (!observer) {
    return (
      <div
        className="grid items-start"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap }}
      >
        {items.map((item) => (
          <div key={getKey(item)} className="min-w-0">{renderItem(item)}</div>
        ))}
      </div>
    );
  }

  const keys = items.map(getKey);
  const { positions, total } = layoutMasonry(
    keys.map((k) => heights.get(k) ?? ESTIMATED_HEIGHT),
    columns,
    gap
  );
  const colWidth = `((100% - ${(columns - 1) * gap}px) / ${columns})`;

  return (
    <div className="relative" style={{ height: total }}>
      {items.map((item, i) => {
        const key = keys[i];
        const { col, top } = positions[i];
        return (
          <div
            key={key}
            data-masonry-key={key}
            ref={(el) => {
              if (!el) return;
              observer.observe(el);
              return () => observer.unobserve(el);
            }}
            className="absolute min-w-0"
            style={{
              top,
              left: `calc(${col} * (${colWidth} + ${gap}px))`,
              width: `calc${colWidth}`,
            }}
          >
            {renderItem(item)}
          </div>
        );
      })}
    </div>
  );
}
