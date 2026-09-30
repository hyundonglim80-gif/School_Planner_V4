import { describe, it, expect } from 'vitest';
import { normalizeEventLabel, toSharedEventLabel } from './useLabels';

describe('normalizeEventLabel - V3·V4 두 이름', () => {
  it('V4가 두 이름으로 쓴 것은 그대로 읽는다', () => {
    const l = normalizeEventLabel(toSharedEventLabel({ id: 'ev_3', name: '이월', color: 'green', calendar: false, forward: true, skip: false, period: false, recur: false }), 0);
    expect(l).toMatchObject({ forward: true, calendar: false, skip: false });
  });

  it('V3에서 속성을 끄면(V3 이름만 바뀜) V4도 꺼진 것으로 읽는다', () => {
    // V4가 쓴 뒤 V3가 isForward/isSkip만 false로, showInCalendar만 true로 고친 모양
    const saved = { ...toSharedEventLabel({ id: 'ev_3', name: '이월', color: 'green', calendar: false, forward: true, skip: true, period: true, recur: true }) };
    Object.assign(saved, { isForward: false, isSkip: false, isPeriod: false, isRecur: false, showInCalendar: true });
    const l = normalizeEventLabel(saved, 0);
    expect(l).toMatchObject({ forward: false, skip: false, period: false, recur: false, calendar: true });
  });

  it('한쪽 이름만 있으면 그것을 쓴다', () => {
    expect(normalizeEventLabel({ id: 'a', name: 'V3', isForward: true, showInCalendar: false }, 0)).toMatchObject({ forward: true, calendar: false });
    expect(normalizeEventLabel({ id: 'b', name: 'V4', forward: true, calendar: false }, 0)).toMatchObject({ forward: true, calendar: false });
    expect(normalizeEventLabel({ id: 'c', name: '없음' }, 0)).toMatchObject({ forward: false, calendar: true });
  });
});
