import { describe, it, expect } from 'vitest';
import { expandLabel, labelPath, orderByTree, parentCandidates, sanitizeParents } from './labelTree';

// 메모·기록 라벨 상위/하위 (2단계). 예: 학교 › A초·B초·C초

const names = ['업무', '학교', 'A초', 'B초', '개인', 'C초'];
const parents = { A초: '학교', B초: '학교', C초: '학교' };

describe('라벨 트리', () => {
  it('상위는 원래 차례대로, 하위는 제 상위 바로 뒤에', () => {
    expect(orderByTree(names, parents).map((r) => `${r.depth}:${r.name}`)).toEqual([
      '0:업무',
      '0:학교',
      '1:A초',
      '1:B초',
      '1:C초',
      '0:개인',
    ]);
    expect(orderByTree(names, parents).find((r) => r.name === '학교')?.hasChildren).toBe(true);
  });

  it('상위를 고르면 하위까지 (거르개)', () => {
    expect(expandLabel('학교', parents).sort()).toEqual(['A초', 'B초', 'C초', '학교'].sort());
    expect(expandLabel('A초', parents)).toEqual(['A초']);
  });

  it("하위 칩에 마우스를 올리면 '상위 › 하위'", () => {
    expect(labelPath('A초', parents)).toBe('학교 › A초');
    expect(labelPath('업무', parents)).toBe('업무');
  });

  it('2단계까지만: 하위가 있는 라벨은 상위를 못 두고, 하위인 라벨은 상위가 될 수 없다', () => {
    expect(parentCandidates('학교', names, parents)).toEqual([]);
    expect(parentCandidates('업무', names, parents)).toEqual(['학교', '개인']);
  });

  it('저장된 트리를 다듬는다: 자기 자신·없는 라벨·3단계는 버린다', () => {
    const raw = { A초: '학교', 학교: '기관', 자기: '자기', 없는: '학교', B초: 7 };
    const clean = sanitizeParents(raw, ['A초', '학교', '기관', '자기', 'B초']);
    // 학교가 기관 밑이면 A초는 3단계가 되므로 끊는다 (학교 › A초만 남기지 않고 A초를 맨 위로)
    expect(clean).toEqual({ 학교: '기관' });
  });

  it('상위가 목록에서 사라진 하위는 맨 위 단계로 보인다', () => {
    expect(orderByTree(['A초', '업무'], { A초: '학교' }).map((r) => r.depth)).toEqual([0, 0]);
  });
});
