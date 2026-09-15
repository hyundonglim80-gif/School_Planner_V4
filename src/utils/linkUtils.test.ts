import { describe, it, expect } from 'vitest';
import { applyReverseLink } from './linkUtils';

const eventLink = (id: string, date: string) => ({
  targetType: 'event',
  targetId: id,
  targetDate: date,
  title: `[${date}] 회의 준비`,
  targetFId: 'personal',
});

describe('applyReverseLink - 이월된 일정의 역링크', () => {
  it('처음 연결하면 목록에 더한다', () => {
    const next = applyReverseLink([], eventLink('ev_1', '2026-09-01'));
    expect(next).toHaveLength(1);
  });

  it('이미 같은 항목이 있으면 아무것도 바꾸지 않는다', () => {
    const list = [eventLink('ev_1', '2026-09-01')];
    expect(applyReverseLink(list, eventLink('ev_1', '2026-09-01'))).toBeNull();
  });

  it('이월 전 링크는 쌓지 않고 갈아끼운다', () => {
    const list = [eventLink('ev_1', '2026-09-01')];
    const next = applyReverseLink(list, eventLink('ev_2', '2026-09-02'), {
      replaceIds: ['ev_1'],
    });
    expect(next?.map((l: any) => l.targetId)).toEqual(['ev_2']);
  });

  it('이월이 지나온 날짜에 남아 있지 않은 링크도 함께 걷어낸다', () => {
    // 9월 1일에 만든 일정이 9월 2일로, 다시 9월 3일로 이월된 상황.
    // 기록에는 9월 1일·9월 2일 링크가 이미 쌓여 있다.
    const list = [eventLink('ev_1', '2026-09-01'), eventLink('ev_2', '2026-09-02')];
    const next = applyReverseLink(list, eventLink('ev_3', '2026-09-03'), {
      replaceIds: ['ev_2'],
      liveIdsByDate: new Map([
        ['2026-09-01', new Set<string>()],
        ['2026-09-02', new Set<string>()],
      ]),
      liveFId: 'personal',
    });
    expect(next?.map((l: any) => l.targetId)).toEqual(['ev_3']);
  });

  it('그 날짜에 아직 살아 있는 다른 일정 링크는 남긴다', () => {
    const list = [eventLink('ev_keep', '2026-09-02')];
    const next = applyReverseLink(list, eventLink('ev_3', '2026-09-03'), {
      liveIdsByDate: new Map([['2026-09-02', new Set(['ev_keep'])]]),
      liveFId: 'personal',
    });
    expect(next?.map((l: any) => l.targetId)).toEqual(['ev_keep', 'ev_3']);
  });

  it('다른 종류(기록·메모·수업)의 링크는 건드리지 않는다', () => {
    const list = [
      { targetType: 'memo', targetId: 'memo_1', targetDate: '', title: '[메모] 준비물' },
      eventLink('ev_1', '2026-09-01'),
    ];
    const next = applyReverseLink(list, eventLink('ev_2', '2026-09-02'), {
      replaceIds: ['ev_1'],
    });
    expect(next?.map((l: any) => l.targetId)).toEqual(['memo_1', 'ev_2']);
  });

  it('다른 그룹을 가리키는 링크는 끊어진 것으로 보지 않는다', () => {
    const list = [{ ...eventLink('ev_other', '2026-09-02'), targetFId: 'group_a' }];
    const next = applyReverseLink(list, eventLink('ev_3', '2026-09-03'), {
      liveIdsByDate: new Map([['2026-09-02', new Set<string>()]]),
      liveFId: 'personal',
    });
    expect(next?.map((l: any) => l.targetId)).toEqual(['ev_other', 'ev_3']);
  });
});
