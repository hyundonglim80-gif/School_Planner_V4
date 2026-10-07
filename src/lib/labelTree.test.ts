import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTER,
  expandLabel,
  matchEntry,
  readLabelFilter,
  otherKey,
  isOtherKey,
  labelPath,
  orderByTree,
  parentCandidates,
  pruneFilter,
  sanitizeParents,
  toggleFilterLabel,
  clickFilterLabel,
  readLabelTree,
} from './labelTree';

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

  it('상위와 그 하위 (expandLabel)', () => {
    expect(expandLabel('학교', parents).sort()).toEqual(['A초', 'B초', 'C초', '학교'].sort());
    expect(expandLabel('A초', parents)).toEqual(['A초']);
  });

  // 19번 U8 (2026-10-06 사용자가 바꿈): 상위를 고르면 하위도, 가상 칩 '기타' = 상위만 붙고 하위는 없는 항목
  it('거르개: 아무것도 안 고르면 전체, 상위를 고르면 하위가 붙은 항목도', () => {
    expect(matchEntry(['아무거나'], EMPTY_FILTER, parents)).toBe(true);
    const school = { labels: ['학교'], others: [] };
    expect(matchEntry(['학교'], school, parents)).toBe(true);
    expect(matchEntry(['A초'], school, parents)).toBe(true);
    expect(matchEntry(['업무'], school, parents)).toBe(false);
    // 하위 하나만 고르면 그것만
    expect(matchEntry(['B초'], { labels: ['A초'], others: [] }, parents)).toBe(false);
    expect(matchEntry(['학교'], { labels: ['A초'], others: [] }, parents)).toBe(false);
  });

  it("'기타' = 그 상위가 붙었지만 하위는 하나도 안 붙은 항목", () => {
    const other = { labels: [], others: ['학교'] };
    expect(matchEntry(['학교'], other, parents)).toBe(true);
    expect(matchEntry(['학교', '업무'], other, parents)).toBe(true);
    expect(matchEntry(['학교', 'A초'], other, parents)).toBe(false);
    expect(matchEntry(['A초'], other, parents)).toBe(false);
    // 여러 개는 하나라도
    expect(matchEntry(['업무'], { labels: ['업무'], others: ['학교'] }, parents)).toBe(true);
  });

  it("옛 기억값({ labels, withChildren }·글자 하나)을 읽는다 - withChildren은 버린다", () => {
    expect(readLabelFilter({ labels: ['학교'], withChildren: ['학교'] })).toEqual({ labels: ['학교'], others: [] });
    expect(readLabelFilter('업무')).toEqual({ labels: ['업무'], others: [] });
    expect(readLabelFilter(null)).toEqual(EMPTY_FILTER);
    expect(readLabelFilter({ labels: ['a', 3], others: ['학교'] })).toEqual({ labels: ['a'], others: ['학교'] });
  });

  it('거르개 칩 누르기: 붙이고 떼기 (기타 칩도)', () => {
    const one = toggleFilterLabel(EMPTY_FILTER, '학교');
    expect(one).toEqual({ labels: ['학교'], others: [] });
    const two = toggleFilterLabel(one, otherKey('학교'));
    expect(two).toEqual({ labels: ['학교'], others: ['학교'] });
    expect(toggleFilterLabel(two, '학교')).toEqual({ labels: [], others: ['학교'] });
    expect(isOtherKey(otherKey('학교'))).toBe(true);
    expect(isOtherKey('기타')).toBe(false); // 진짜 '기타' 라벨과 다르다
  });

  it('탐색기처럼 고르기: 그냥 = 하나, Ctrl = 더하기·빼기, Shift = 범위(기타 칩 포함), Ctrl+Shift = 범위 더하기', () => {
    const order = ['업무', '학교', 'A초', 'B초', otherKey('학교'), '개인'];
    const plain = { ctrl: false, shift: false };
    const f1 = clickFilterLabel({ labels: ['업무', '학교'], others: ['학교'] }, 'A초', plain, order, null);
    expect(f1).toEqual({ labels: ['A초'], others: [] });
    const f2 = clickFilterLabel(f1, '업무', { ctrl: true, shift: false }, order, 'A초');
    expect(f2.labels).toEqual(['A초', '업무']);
    expect(clickFilterLabel(f2, '업무', { ctrl: true, shift: false }, order, '업무').labels).toEqual(['A초']);
    // 기준(업무)부터 B초까지, 거꾸로 눌러도 같다
    expect(clickFilterLabel(EMPTY_FILTER, 'B초', { ctrl: false, shift: true }, order, '업무').labels).toEqual(['업무', '학교', 'A초', 'B초']);
    expect(clickFilterLabel(EMPTY_FILTER, '업무', { ctrl: false, shift: true }, order, 'A초').labels).toEqual(['업무', '학교', 'A초']);
    expect(clickFilterLabel({ labels: ['개인'], others: [] }, 'B초', { ctrl: true, shift: true }, order, 'A초').labels).toEqual(['개인', 'A초', 'B초']);
    // 범위에 기타 칩이 들면 others로
    expect(clickFilterLabel(EMPTY_FILTER, '개인', { ctrl: false, shift: true }, order, 'B초')).toEqual({ labels: ['B초', '개인'], others: ['학교'] });
    // 기준이 없으면 Shift도 하나만
    expect(clickFilterLabel(EMPTY_FILTER, '학교', { ctrl: false, shift: true }, order, null).labels).toEqual(['학교']);
    // 기타 칩 그냥 누르기
    expect(clickFilterLabel(f2, otherKey('학교'), plain, order, null)).toEqual({ labels: [], others: ['학교'] });
  });

  it('지워진 라벨은 거르개에서 뺀다', () => {
    expect(pruneFilter({ labels: ['학교', '없음'], others: ['없음', '학교'] }, names)).toEqual({ labels: ['학교'], others: ['학교'] });
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

describe('readLabelTree - 메모·기록 한 트리 (19번 U5)', () => {
  it('entry가 있으면 그것을 memo·journal에도', () => {
    const t = readLabelTree({ entry: { A초: '학교' }, memo: { 숙제: '할일' }, journal: {} });
    expect(t).toEqual({ memo: { A초: '학교' }, journal: { A초: '학교' }, entry: { A초: '학교' }, conflicts: [] });
  });
  it('entry가 없으면 memo·journal을 합치고 상위가 다른 하위는 기록 쪽 + 알림', () => {
    const t = readLabelTree({ memo: { 숙제: '할일', B초: '학교' }, journal: { 숙제: '수업' } });
    expect(t.entry).toEqual({ 숙제: '수업', B초: '학교' });
    expect(t.memo).toEqual(t.entry);
    expect(t.conflicts).toEqual(['숙제']);
  });
  it('합쳐서 3단계가 되면 끊는다', () => {
    const t = readLabelTree({ memo: { 학교: '기관' }, journal: { A초: '학교' } });
    expect(Object.keys(t.entry!).length).toBe(1);
  });
});
