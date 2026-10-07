import { describe, expect, it } from 'vitest';
import {
  entryJournalId,
  fillEntryLabels,
  mergeEntryLabels,
  mergeEntryTrees,
  missingEntryLabels,
  toJournalLabels,
  toMemoLabels,
} from './entryLabels';

// 메모·기록 라벨 한 목록 (19번 U5)

const J: any[] = [
  { id: 'j_1', name: '학급활동', color: 'green' },
  { id: 'j_2', name: '업무', color: 'blue', v3Extra: 1 },
];

describe('mergeEntryLabels', () => {
  it('차례: 기록 라벨 → 메모에만 있는 것, 같은 이름은 하나(기록 id·색)', () => {
    const list = mergeEntryLabels(['긴급', '업무', ' 기타 '], J);
    expect(list.map((l) => l.name)).toEqual(['학급활동', '업무', '긴급', '기타']);
    expect(list[1]).toMatchObject({ id: 'j_2', color: 'blue', inJournal: true, memoIndex: 1 });
    expect(list[2]).toMatchObject({ id: entryJournalId('긴급'), inJournal: false, memoIndex: 0 });
  });

  it('같은 이름의 색이 다르면 기록 쪽 색, 메모 객체 색은 메모에만 있을 때', () => {
    const list = mergeEntryLabels([{ name: '업무', color: 'red' }, { name: '개인', color: 'pink' }], J);
    expect(list.find((l) => l.name === '업무')!.color).toBe('blue');
    expect(list.find((l) => l.name === '개인')!.color).toBe('pink');
  });

  it('대소문자·가운데 띄어쓰기가 다르면 다른 라벨, 빈 이름은 뺀다', () => {
    const list = mergeEntryLabels(['Work', 'work', '학급 활동', ''], J);
    expect(list.map((l) => l.name)).toEqual(['학급활동', '업무', 'Work', 'work', '학급 활동']);
  });
});

describe('toMemoLabels · toJournalLabels', () => {
  it('문자열 모양의 메모 배열은 문자열로 (V3 옛 판)', () => {
    const memo = ['긴급', '업무'];
    const list = mergeEntryLabels(memo, J);
    expect(toMemoLabels(list, memo)).toEqual(['학급활동', '업무', '긴급']);
  });

  it('객체 모양은 원래 객체의 모르는 칸·id를 지키고 이름을 고친 것도 같은 항목', () => {
    const memo = [{ id: 'memo_1', name: '긴급', color: 'red', v3: true }];
    const list = mergeEntryLabels(memo, []);
    list[0] = { ...list[0], name: '아주 긴급' };
    expect(toMemoLabels(list, memo)).toEqual([{ id: 'memo_1', name: '아주 긴급', color: 'red', v3: true }]);
  });

  it('기록: 있던 id·모르는 칸을 지키고, 메모에만 있던 것은 이름 id', () => {
    const list = mergeEntryLabels(['긴급'], J);
    const out = toJournalLabels(list, J);
    expect(out).toEqual([
      { id: 'j_1', name: '학급활동', color: 'green' },
      { id: 'j_2', name: '업무', color: 'blue', v3Extra: 1 },
      { id: 'jm_긴급', name: '긴급', color: 'green' },
    ]);
  });
});

describe('저장 전에 빠진 라벨 채우기', () => {
  it('한쪽에만 있는 이름을 찾는다', () => {
    expect(missingEntryLabels(['긴급', '업무', '학급활동'], ['긴급', '업무'], J)).toEqual({
      memo: ['학급활동'],
      journal: ['긴급'],
    });
  });

  it('채운 배열 - 메모는 원래 모양, 기록은 이름 id로 (화면이 쓰는 id와 같다)', () => {
    const out = fillEntryLabels(['긴급', '학급활동'], ['긴급'], J, 100);
    expect(out.memoLabels).toEqual(['긴급', '학급활동']);
    expect(out.journalLabels!.at(-1)).toEqual({ id: 'jm_긴급', name: '긴급', color: 'green' });
    expect(mergeEntryLabels(['긴급'], J).find((l) => l.name === '긴급')!.id).toBe('jm_긴급');
  });

  it('바꿀 것이 없거나 클라우드 배열이 비었으면(기본값으로 보이는 중) 그 쪽은 쓰지 않는다', () => {
    expect(fillEntryLabels(['업무'], ['업무'], J)).toEqual({});
    expect(fillEntryLabels(['새것'], [], J).memoLabels).toBeUndefined();
    expect(fillEntryLabels(['새것'], ['a'], []).journalLabels).toBeUndefined();
  });
});

describe('mergeEntryTrees', () => {
  it('같은 하위의 상위가 다르면 기록 쪽, 달랐던 하위를 알린다', () => {
    const { entry, conflicts } = mergeEntryTrees({ A초: '학교', 숙제: '할일' }, { A초: '학교', 숙제: '수업' });
    expect(entry).toEqual({ A초: '학교', 숙제: '수업' });
    expect(conflicts).toEqual(['숙제']);
  });
});
