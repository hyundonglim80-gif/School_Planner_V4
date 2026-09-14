import { describe, it, expect } from 'vitest';
import { resolveEventLabelNames, resolveEventLabel, eventDisplayContent, isForwardLabel } from './eventLabels';
import type { EventLabel } from '../hooks/useLabels';

const labels: EventLabel[] = [
  { id: 'ev_1', name: '회의', color: 'red', calendar: true, skip: false, forward: false, period: false, recur: false },
  { id: 'ev_2', name: '완료', color: 'green', calendar: true, skip: false, forward: true, period: false, recur: false },
];

describe('resolveEventLabelNames', () => {
  it('label에 이름이 있으면 찾는다', () => {
    expect(resolveEventLabelNames({ label: '회의', content: '교직원 회의' }, labels)).toEqual(['회의']);
  });

  // 주간/년간 화면이 label 전체를 이름으로 봐서 "회의,완료"를 못 찾고 있었다.
  it('label이 콤마로 이어져 있어도 모두 찾는다', () => {
    expect(resolveEventLabelNames({ label: '회의,완료', content: '회의' }, labels)).toEqual(['회의', '완료']);
  });

  it('label에 ID가 들어 있어도 이름으로 풀어준다', () => {
    expect(resolveEventLabelNames({ label: 'ev_1', content: '회의' }, labels)).toEqual(['회의']);
  });

  // 주간/년간 화면이 labelIds를 아예 보지 않아 칩이 안 나왔다.
  it('labelIds만 있어도 찾는다 (이름이든 ID든)', () => {
    expect(resolveEventLabelNames({ labelIds: ['ev_2'], content: '보고' }, labels)).toEqual(['완료']);
    expect(resolveEventLabelNames({ labelIds: ['완료'], content: '보고' }, labels)).toEqual(['완료']);
  });

  // V3가 남긴 항목은 라벨이 본문 접두어로만 있다.
  it('본문 앞의 [라벨명] 접두어로도 찾는다', () => {
    expect(resolveEventLabelNames({ content: '[회의] 교직원 회의' }, labels)).toEqual(['회의']);
  });

  it('등록되지 않은 라벨은 제외한다', () => {
    expect(resolveEventLabelNames({ label: '지워진라벨', content: '무언가' }, labels)).toEqual([]);
  });

  it('같은 라벨이 여러 군데 있어도 한 번만 돌려준다', () => {
    const item = { label: '회의', labelIds: ['ev_1', '회의'], content: '[회의] 회의' };
    expect(resolveEventLabelNames(item, labels)).toEqual(['회의']);
  });

  it('라벨이 없으면 빈 배열', () => {
    expect(resolveEventLabelNames({ content: '그냥 일정' }, labels)).toEqual([]);
    expect(resolveEventLabelNames({}, labels)).toEqual([]);
  });

  it('text 필드만 있는 V3 항목도 본문 접두어를 읽는다', () => {
    expect(resolveEventLabelNames({ text: '[완료] 보고서' }, labels)).toEqual(['완료']);
  });
});

describe('resolveEventLabel', () => {
  it('첫 번째 라벨의 정의를 돌려준다', () => {
    expect(resolveEventLabel({ label: '회의,완료' }, labels)?.id).toBe('ev_1');
  });

  it('못 찾으면 null', () => {
    expect(resolveEventLabel({ label: '없음' }, labels)).toBeNull();
  });
});

describe('eventDisplayContent', () => {
  it('[라벨명] 접두어를 떼어낸다', () => {
    expect(eventDisplayContent({ content: '[회의] 교직원 회의' })).toBe('교직원 회의');
  });

  it('접두어가 없으면 그대로 둔다', () => {
    expect(eventDisplayContent({ content: '교직원 회의' })).toBe('교직원 회의');
  });

  it('text 필드도 읽는다', () => {
    expect(eventDisplayContent({ text: '[완료] 보고서' })).toBe('보고서');
  });
});

describe('isForwardLabel', () => {
  it('forward 속성을 읽는다', () => {
    expect(isForwardLabel(labels[1])).toBe(true);
    expect(isForwardLabel(labels[0])).toBe(false);
    expect(isForwardLabel(null)).toBe(false);
  });

  it('V3의 isForward 필드명도 인식한다', () => {
    expect(isForwardLabel({ ...labels[0], forward: false, isForward: true } as any)).toBe(true);
  });
});
