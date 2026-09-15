import { describe, it, expect } from 'vitest';
import { FORWARD_LOOKBACK_DAYS, pastDateStrings } from './forwarding';

describe('pastDateStrings - 이월이 훑는 기간', () => {
  it('어제부터 거슬러 올라간다 (오늘은 넣지 않는다)', () => {
    const list = pastDateStrings(new Date(2026, 8, 15), 3); // 2026-09-15
    expect(list).toEqual(['2026-09-14', '2026-09-13', '2026-09-12']);
  });

  it('기본 기간은 한 곳에서 정한 값을 쓴다', () => {
    expect(pastDateStrings(new Date(2026, 8, 15))).toHaveLength(FORWARD_LOOKBACK_DAYS);
  });

  it('달과 해를 넘어가도 날짜가 맞는다', () => {
    expect(pastDateStrings(new Date(2026, 0, 2), 3)).toEqual(['2026-01-01', '2025-12-31', '2025-12-30']);
  });
});

// 자동 이월(useDayData)과 전달 팝업(ForwardingModal), 설명서 문구가 같은 값을 봐야 한다.
// 예전에는 14일 / 7일 / "14일간"으로 셋이 달라서, 전달 팝업에는 안 뜨는데 자동 이월은
// 가져오는 구간(8~14일 전)이 있었다.
const sources = import.meta.glob('../{components,hooks}/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('이월 기간은 한 곳에서만 정한다', () => {
  const entries = Object.entries(sources)
    .filter(([p]) => !p.includes('.test.'))
    .map(([p, src]) => ({ name: p.split('/').pop()!, src }));

  const users = ['useDayData.ts', 'ForwardingModal.tsx', 'HelpModal.tsx'];

  it('이월을 다루는 곳은 환경설정 값이나 lib/forwarding을 쓴다', () => {
    for (const name of users) {
      const entry = entries.find((e) => e.name === name);
      expect(entry, `${name} 를 찾지 못했다`).toBeDefined();
      const usesShared =
        entry!.src.includes("from '../lib/forwarding'") || entry!.src.includes('forwardLookbackDays');
      expect(usesShared, `${name} 가 이월 기간을 제 마음대로 정하고 있다`).toBe(true);
    }
  });

  it('날짜 수를 직접 적어두지 않는다', () => {
    const offenders = entries
      .filter((e) => users.includes(e.name))
      .filter((e) => /지난 7일간|최근 14일간|i <= 7;|i <= 14;/.test(e.src))
      .map((e) => e.name);

    expect(offenders).toEqual([]);
  });
});
