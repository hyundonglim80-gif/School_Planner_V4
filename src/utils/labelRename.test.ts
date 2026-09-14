import { describe, it, expect } from 'vitest';
import { diffLabelNames } from './labelRename';

describe('diffLabelNames', () => {
  it('이름이 바뀐 라벨만 추려낸다', () => {
    const before = [
      { id: 'ev_1', name: 'A' },
      { id: 'ev_2', name: '회의' },
    ];
    const after = [
      { id: 'ev_1', name: 'B' },
      { id: 'ev_2', name: '회의' },
    ];

    expect(diffLabelNames(before, after)).toEqual([{ from: 'A', to: 'B' }]);
  });

  it('ID가 같아야 같은 라벨로 본다 (순서가 바뀌어도 따라간다)', () => {
    const before = [
      { id: 'ev_1', name: 'A' },
      { id: 'ev_2', name: 'B' },
    ];
    const after = [
      { id: 'ev_2', name: 'B' },
      { id: 'ev_1', name: 'A2' },
    ];

    expect(diffLabelNames(before, after)).toEqual([{ from: 'A', to: 'A2' }]);
  });

  it('삭제된 라벨은 이름 변경으로 보지 않는다', () => {
    const before = [{ id: 'ev_1', name: 'A' }];
    expect(diffLabelNames(before, [])).toEqual([]);
  });

  it('새로 추가된 라벨은 무시한다', () => {
    const before = [{ id: 'ev_1', name: 'A' }];
    const after = [
      { id: 'ev_1', name: 'A' },
      { id: 'ev_2', name: '신규' },
    ];
    expect(diffLabelNames(before, after)).toEqual([]);
  });

  it('앞뒤 공백만 다른 것은 변경으로 보지 않는다', () => {
    const before = [{ id: 'ev_1', name: 'A' }];
    const after = [{ id: 'ev_1', name: '  A  ' }];
    expect(diffLabelNames(before, after)).toEqual([]);
  });

  it('이름을 비우면 변경으로 보지 않는다 (항목의 라벨을 지워버리면 안 된다)', () => {
    const before = [{ id: 'ev_1', name: 'A' }];
    const after = [{ id: 'ev_1', name: '' }];
    expect(diffLabelNames(before, after)).toEqual([]);
  });

  it('여러 개가 동시에 바뀌어도 모두 잡는다', () => {
    const before = [
      { id: 'j_1', name: '가' },
      { id: 'j_2', name: '나' },
    ];
    const after = [
      { id: 'j_1', name: '가가' },
      { id: 'j_2', name: '나나' },
    ];
    expect(diffLabelNames(before, after)).toEqual([
      { from: '가', to: '가가' },
      { from: '나', to: '나나' },
    ]);
  });
});
