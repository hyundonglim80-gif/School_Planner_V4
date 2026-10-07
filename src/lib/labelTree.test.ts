import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTER,
  expandLabel,
  filterLabelSet,
  labelPath,
  orderByTree,
  parentCandidates,
  pruneFilter,
  sanitizeParents,
  toggleFilterChildren,
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

  it('거르개: 아무것도 안 고르면 전체, 상위만 고르면 하위는 빠진다', () => {
    expect(filterLabelSet(EMPTY_FILTER, parents)).toBeNull();
    expect([...filterLabelSet({ labels: ['학교'], withChildren: [] }, parents)!]).toEqual(['학교']);
  });

  it("거르개: '하위 포함'을 켠 상위만 하위까지, 여러 개는 합친다", () => {
    const set = filterLabelSet({ labels: ['학교', '업무'], withChildren: ['학교'] }, parents)!;
    expect([...set].sort()).toEqual(['A초', 'B초', 'C초', '업무', '학교'].sort());
  });

  it('거르개 칩 누르기: 붙이고 떼기, 뗀 상위는 하위 포함도 꺼진다', () => {
    const one = toggleFilterLabel(EMPTY_FILTER, '학교');
    expect(one).toEqual({ labels: ['학교'], withChildren: [] });
    const withKids = toggleFilterChildren(one, '학교');
    expect(withKids).toEqual({ labels: ['학교'], withChildren: ['학교'] });
    expect(toggleFilterLabel(withKids, '학교')).toEqual(EMPTY_FILTER);
    expect(toggleFilterChildren(withKids, '학교')).toEqual({ labels: ['학교'], withChildren: [] });
  });

  it('탐색기처럼 고르기: 그냥 = 하나, Ctrl = 더하기·빼기, Shift = 범위, Ctrl+Shift = 범위 더하기', () => {
    const order = ['업무', '학교', 'A초', 'B초', '개인'];
    const plain = { ctrl: false, shift: false };
    const f1 = clickFilterLabel({ labels: ['업무', '학교'], withChildren: ['학교'] }, 'A초', plain, order, null);
    expect(f1).toEqual({ labels: ['A초'], withChildren: [] });
    // 계속 골라져 있는 상위의 '하위 포함'은 남는다
    expect(clickFilterLabel({ labels: ['학교'], withChildren: ['학교'] }, '학교', plain, order, null)).toEqual({ labels: ['학교'], withChildren: ['학교'] });
    const f2 = clickFilterLabel(f1, '업무', { ctrl: true, shift: false }, order, 'A초');
    expect(f2.labels).toEqual(['A초', '업무']);
    expect(clickFilterLabel(f2, '업무', { ctrl: true, shift: false }, order, '업무').labels).toEqual(['A초']);
    // 기준(업무)부터 B초까지, 거꾸로 눌러도 같다
    expect(clickFilterLabel(EMPTY_FILTER, 'B초', { ctrl: false, shift: true }, order, '업무').labels).toEqual(['업무', '학교', 'A초', 'B초']);
    expect(clickFilterLabel(EMPTY_FILTER, '업무', { ctrl: false, shift: true }, order, 'A초').labels).toEqual(['업무', '학교', 'A초']);
    expect(clickFilterLabel({ labels: ['개인'], withChildren: [] }, 'B초', { ctrl: true, shift: true }, order, 'A초').labels).toEqual(['개인', 'A초', 'B초']);
    // 기준이 없으면 Shift도 하나만
    expect(clickFilterLabel(EMPTY_FILTER, '학교', { ctrl: false, shift: true }, order, null).labels).toEqual(['학교']);
  });

  it("'하위 포함'을 켜면 상위도 함께 골라진다", () => {
    expect(toggleFilterChildren(EMPTY_FILTER, '학교')).toEqual({ labels: ['학교'], withChildren: ['학교'] });
  });

  it('지워진 라벨은 거르개에서 뺀다', () => {
    expect(pruneFilter({ labels: ['학교', '없음'], withChildren: ['없음'] }, names)).toEqual({ labels: ['학교'], withChildren: [] });
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
