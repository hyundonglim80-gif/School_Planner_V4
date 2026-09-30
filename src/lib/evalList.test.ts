import { describe, it, expect } from 'vitest';
import { readEvalList, evalDocPayload } from './evalList';

const A = { id: 'a', title: 'V4가 만든 조사' };
const B = { id: 'b', title: 'V3에서 더한 조사' };

describe('readEvalList', () => {
  it('한 이름만 있으면 그것을 쓴다 (V3는 evalList만, 9/14 전 V4는 list만)', () => {
    expect(readEvalList({ evalList: [B] })).toEqual([B]);
    expect(readEvalList({ list: [A] })).toEqual([A]);
    expect(readEvalList({})).toEqual([]);
    expect(readEvalList(null)).toEqual([]);
  });

  it('V4가 맞춰 쓴 뒤 V3가 더하면 evalList를 본다 (예전엔 list를 봐서 V3 조사표가 안 보이고 저장 때 지워졌다)', () => {
    expect(readEvalList({ list: [A], evalList: [A, B] })).toEqual([A, B]);
  });

  it('V4가 맞춰 쓴 뒤 V3가 지우면 지운 것이 되살아나지 않는다', () => {
    expect(readEvalList({ list: [A, B], evalList: [B] })).toEqual([B]);
    expect(readEvalList({ list: [A], evalList: [] })).toEqual([]);
  });

  it('겹치는 항목이 없으면 따로 만든 두 목록이라 합친다', () => {
    expect(readEvalList({ list: [A], evalList: [B] })).toEqual([B, A]);
  });

  it('쓸 때는 두 이름에 같은 목록', () => {
    const p = evalDocPayload([A]);
    expect(p.list).toEqual([A]);
    expect(p.evalList).toEqual([A]);
  });
});
