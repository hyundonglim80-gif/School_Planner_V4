import { describe, it, expect } from 'vitest';
import { FORWARD_LOOKBACK_DAYS, pastDateStrings, isForwardTarget } from './forwarding';

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

// 이월이 라벨을 화면과 다르게 풀던 문제.
// V3가 만든 일정은 label 자리에 이름이 아니라 id(lbl_ev_...)가 들어 있다.
// 이월은 그것을 이름으로 단정해서, 이월 라벨이 붙은 일정을 못 알아봤다.
// 화면은 id와 이름을 둘 다 맞춰 보므로 라벨 칩은 멀쩡히 보였다.
describe('이월 대상 판단', () => {
  const defs = [
    { id: 'lbl_ev_aaa_111', name: '회의', color: 'blue', forward: false, skip: false, period: false, recur: false, calendar: true },
    { id: 'lbl_ev_bbb_222', name: 'ToDo', color: 'orange', forward: true, skip: false, period: false, recur: false, calendar: true },
  ] as any[];

  it('라벨을 이름으로 들고 있으면 알아본다', () => {
    expect(isForwardTarget({ label: 'ToDo', content: '공문' }, defs)).toBe(true);
    expect(isForwardTarget({ label: '회의', content: '협의회' }, defs)).toBe(false);
  });

  it('label 자리에 id가 들어 있어도 알아본다 (V3가 만든 일정)', () => {
    expect(isForwardTarget({ label: 'lbl_ev_bbb_222', content: '공문' }, defs)).toBe(true);
    expect(isForwardTarget({ label: 'lbl_ev_aaa_111', content: '협의회' }, defs)).toBe(false);
  });

  it('labelIds로 들고 있어도 알아본다', () => {
    expect(isForwardTarget({ labelIds: ['lbl_ev_bbb_222'], content: '공문' }, defs)).toBe(true);
  });

  it('본문 앞 [라벨] 접두어도 본다', () => {
    expect(isForwardTarget({ content: '[ToDo] 공문 처리' }, defs)).toBe(true);
  });

  it('콤마로 이은 것 중 하나만 이월이어도 대상이다', () => {
    expect(isForwardTarget({ label: '회의,ToDo', content: '공문' }, defs)).toBe(true);
  });

  it('항목에 직접 정해 둔 값이 라벨보다 세다', () => {
    expect(isForwardTarget({ label: '회의', forward: true }, defs)).toBe(true);
    expect(isForwardTarget({ label: 'ToDo', forward: false }, defs)).toBe(false);
  });

  it('라벨 정의가 없으면 라벨로는 판단하지 않는다', () => {
    expect(isForwardTarget({ label: 'ToDo' }, [])).toBe(false);
    expect(isForwardTarget({ label: 'ToDo', forward: true }, [])).toBe(true);
  });
});

// 이월은 옮길 때마다 일정에 흔적을 남긴다 (V4: forwardChainId+originalDate, V3: originalDate).
// 라벨로 판단할 수 없을 때는 그 흔적을 믿어야 한다. 예전에는 무조건 '아니다'로 보아,
// 며칠째 이월되던 일정이 라벨을 못 읽는 순간 지난 날짜에 발이 묶였다.
describe('이월 대상 판단 - 라벨을 못 읽을 때', () => {
  const noDefs: any[] = [];
  const defs = [
    { id: 'lbl_ev_bbb_222', name: 'ToDo', color: 'orange', forward: true, skip: false, period: false, recur: false, calendar: true },
  ] as any[];

  it('전에 이월되던 일정은 라벨 정의가 없어도 계속 이월된다', () => {
    expect(isForwardTarget({ content: '공문', originalDate: '2026-09-01' }, noDefs)).toBe(true);
    expect(isForwardTarget({ content: '공문', forwardChainId: 'chain_1' }, noDefs)).toBe(true);
  });

  it('이월된 적 없는 일정은 그대로 두지 않는다', () => {
    expect(isForwardTarget({ content: '그냥 일정' }, noDefs)).toBe(false);
  });

  it('라벨이 풀리면 라벨이 정답이다 (흔적보다 세다)', () => {
    // 이월 흔적이 있어도, 지금 라벨이 이월 라벨이 아니면 더 이상 이월하지 않는다
    const notForward = [{ id: 'l1', name: '회의', color: 'blue', forward: false, skip: false, period: false, recur: false, calendar: true }] as any[];
    expect(isForwardTarget({ label: '회의', originalDate: '2026-09-01' }, notForward)).toBe(false);
  });

  it('라벨이 풀리고 이월 라벨이면 이월한다', () => {
    expect(isForwardTarget({ label: 'lbl_ev_bbb_222' }, defs)).toBe(true);
  });

  it('항목에 직접 끈 것은 흔적보다 세다', () => {
    expect(isForwardTarget({ forward: false, originalDate: '2026-09-01' }, noDefs)).toBe(false);
  });
});
