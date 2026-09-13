import { describe, it, expect } from 'vitest';
import {
  parseV3EventText,
  formatV3EventText,
  eventContentOf,
  eventDocPayload,
  readEventList,
} from './eventText';

// 이 파일의 규약은 V3와 V4가 같은 Firestore 문서를 두고 공유한다.
// 여기가 깨지면 두 앱 사이에서 일정이 사라지거나 되살아난다.

describe('eventContentOf', () => {
  it('content를 우선하고 없으면 text로 넘어간다', () => {
    expect(eventContentOf({ content: '회의' })).toBe('회의');
    expect(eventContentOf({ text: '회의' })).toBe('회의');
    expect(eventContentOf({ content: '회의', text: '다른값' })).toBe('회의');
  });

  it('앞뒤 공백을 없애고, 값이 없으면 빈 문자열', () => {
    expect(eventContentOf({ content: '  회의  ' })).toBe('회의');
    expect(eventContentOf({})).toBe('');
    expect(eventContentOf(null)).toBe('');
  });
});

describe('parseV3EventText', () => {
  it('완료 표시와 라벨을 분리한다', () => {
    const list = parseV3EventText('[v] [이월] 학년 협의회');
    expect(list).toHaveLength(1);
    expect(list[0].completed).toBe(true);
    expect(list[0].label).toBe('이월');
    expect(list[0].content).toBe('학년 협의회');
  });

  it('라벨이 없으면 label이 비어 있다', () => {
    const list = parseV3EventText('부장 회의');
    expect(list[0].label).toBeUndefined();
    expect(list[0].completed).toBe(false);
    expect(list[0].content).toBe('부장 회의');
  });

  it('빈 줄은 건너뛴다', () => {
    expect(parseV3EventText('회의\n\n\n안전점검')).toHaveLength(2);
  });

  it('빈 입력은 빈 배열', () => {
    expect(parseV3EventText('')).toEqual([]);
    expect(parseV3EventText('   ')).toEqual([]);
  });
});

describe('formatV3EventText', () => {
  it('완료/라벨 접두어를 붙인다', () => {
    const text = formatV3EventText([
      { id: '1', content: '회의', completed: true, label: '이월' },
    ]);
    expect(text).toBe('[v] [이월] 회의');
  });

  it('content가 없으면 text를 쓴다 (V3 및 일부 모달 호환)', () => {
    expect(formatV3EventText([{ id: '1', text: '반복 회의' } as any])).toBe('반복 회의');
  });

  it('내용이 빈 항목은 줄을 만들지 않는다', () => {
    const text = formatV3EventText([
      { id: '1', content: '회의' },
      { id: '2', content: '   ' },
      { id: '3', content: '안전점검' },
    ] as any);
    expect(text).toBe('회의\n안전점검');
  });

  it('빈 목록은 빈 문자열', () => {
    expect(formatV3EventText([])).toBe('');
  });
});

describe('parse <-> format 왕복', () => {
  it('직렬화한 뒤 다시 읽어도 내용/완료/라벨이 유지된다', () => {
    const original = [
      { id: 'a', content: '학년 협의회', completed: false, label: '이월' },
      { id: 'b', content: '안전점검', completed: true, label: undefined },
      { id: 'c', content: '수업 공개', completed: false, label: '완료' },
    ];
    const roundTripped = parseV3EventText(formatV3EventText(original));
    expect(roundTripped.map((e) => [e.content, e.completed, e.label])).toEqual(
      original.map((e) => [e.content, e.completed, e.label])
    );
  });
});

describe('eventDocPayload', () => {
  it('eventList와 eventText를 항상 같이 만든다', () => {
    // 한쪽만 갱신하면 읽기 폴백이 옛 내용을 되살려 지운 일정이 부활한다
    const payload = eventDocPayload([{ id: '1', content: '회의', completed: false }]);
    expect(payload.eventList).toHaveLength(1);
    expect(payload.eventText).toBe('회의');
    expect(typeof payload.updatedAt).toBe('number');
  });

  it('빈 목록이면 eventText도 빈 문자열이 된다', () => {
    const payload = eventDocPayload([]);
    expect(payload.eventList).toEqual([]);
    expect(payload.eventText).toBe('');
  });
});

describe('readEventList', () => {
  it('eventList가 있으면 그것을 쓴다', () => {
    const list = readEventList({
      eventList: [{ id: '1', content: '회의' }],
      eventText: '옛날 내용',
    });
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe('회의');
  });

  it('eventList가 비어 있으면 레거시 eventText를 읽는다', () => {
    const list = readEventList({ eventList: [], eventText: '회의\n안전점검' });
    expect(list).toHaveLength(2);
  });

  it('eventList 필드가 없는 V3 문서도 읽는다', () => {
    expect(readEventList({ eventText: '회의' })).toHaveLength(1);
  });

  it('둘 다 없으면 빈 배열', () => {
    expect(readEventList({})).toEqual([]);
    expect(readEventList(null)).toEqual([]);
  });
});
