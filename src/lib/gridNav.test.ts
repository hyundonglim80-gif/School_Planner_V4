import { describe, it, expect } from 'vitest';
import { nextCell, parseClipboardGrid, isSingleCell, clipboardWrites } from './gridNav';

// 시간표는 엑셀로 만들어 두고 옮겨 적는 일이 잦다. 엑셀에서 하던 그대로
// 움직이고 붙여 넣을 수 있어야 한다는 약속을 여기에 고정한다.
const size = { rows: 6, cols: 6 }; // 6교시 × (교시명 + 월~금)
const mid = { row: 2, col: 2 };
const key = (k: string, extra: Partial<{ shift: boolean; atStart: boolean; atEnd: boolean }> = {}) => ({
  key: k,
  shift: false,
  atStart: false,
  atEnd: false,
  ...extra,
});

describe('표 안에서 칸 옮기기', () => {
  it('위아래 화살표는 줄을 옮긴다', () => {
    expect(nextCell(mid, size, key('ArrowUp'))).toEqual({ row: 1, col: 2 });
    expect(nextCell(mid, size, key('ArrowDown'))).toEqual({ row: 3, col: 2 });
  });

  it('엔터는 아래로, 시프트+엔터는 위로', () => {
    expect(nextCell(mid, size, key('Enter'))).toEqual({ row: 3, col: 2 });
    expect(nextCell(mid, size, key('Enter', { shift: true }))).toEqual({ row: 1, col: 2 });
  });

  it('표 위아래 끝에서는 옮기지 않는다', () => {
    expect(nextCell({ row: 0, col: 2 }, size, key('ArrowUp'))).toBeNull();
    expect(nextCell({ row: 5, col: 2 }, size, key('ArrowDown'))).toBeNull();
  });

  it('좌우 화살표는 커서가 칸 끝에 닿았을 때만 칸을 옮긴다', () => {
    // 글자를 고치는 도중이면 커서만 움직여야 한다
    expect(nextCell(mid, size, key('ArrowLeft'))).toBeNull();
    expect(nextCell(mid, size, key('ArrowRight'))).toBeNull();

    expect(nextCell(mid, size, key('ArrowLeft', { atStart: true }))).toEqual({ row: 2, col: 1 });
    expect(nextCell(mid, size, key('ArrowRight', { atEnd: true }))).toEqual({ row: 2, col: 3 });
  });

  it('탭은 줄 끝에서 다음 줄 첫 칸으로 넘어간다', () => {
    expect(nextCell({ row: 2, col: 5 }, size, key('Tab'))).toEqual({ row: 3, col: 0 });
    expect(nextCell({ row: 3, col: 0 }, size, key('Tab', { shift: true }))).toEqual({ row: 2, col: 5 });
  });

  it('표의 맨 끝에서 탭은 비켜선다 (표 밖으로 나갈 길을 막지 않는다)', () => {
    expect(nextCell({ row: 5, col: 5 }, size, key('Tab'))).toBeNull();
    expect(nextCell({ row: 0, col: 0 }, size, key('Tab', { shift: true }))).toBeNull();
  });

  it('다루지 않는 키는 그냥 둔다', () => {
    expect(nextCell(mid, size, key('a'))).toBeNull();
    expect(nextCell(mid, size, key('Escape'))).toBeNull();
  });
});

describe('엑셀에서 복사한 것 읽기', () => {
  it('탭은 칸, 줄바꿈은 줄로 가른다', () => {
    expect(parseClipboardGrid('국어\t수학\n영어\t과학')).toEqual([
      ['국어', '수학'],
      ['영어', '과학'],
    ]);
  });

  it('윈도우 줄바꿈도 읽는다', () => {
    expect(parseClipboardGrid('국어\t수학\r\n영어\t과학')).toEqual([
      ['국어', '수학'],
      ['영어', '과학'],
    ]);
  });

  it('맨 아래 빈 줄은 버린다', () => {
    // 엑셀이 줄 끝마다 줄바꿈을 붙인다. 그대로 두면 맨 아래 칸이 비워진다.
    expect(parseClipboardGrid('국어\t수학\n')).toEqual([['국어', '수학']]);
  });

  it('칸 앞뒤 공백은 턴다', () => {
    expect(parseClipboardGrid(' 국어 \t 수학 ')).toEqual([['국어', '수학']]);
  });

  it('칸 하나짜리는 브라우저에 맡긴다', () => {
    expect(isSingleCell('국어')).toBe(true);
    expect(isSingleCell('국어\t수학')).toBe(false);
    expect(isSingleCell('국어\n수학')).toBe(false);
  });
});

describe('붙여 넣을 자리 짚기', () => {
  it('누른 칸에서 오른쪽·아래로 채운다', () => {
    const writes = clipboardWrites({ row: 1, col: 1 }, size, [
      ['국어', '수학'],
      ['영어', '과학'],
    ]);
    expect(writes).toEqual([
      { row: 1, col: 1, value: '국어' },
      { row: 1, col: 2, value: '수학' },
      { row: 2, col: 1, value: '영어' },
      { row: 2, col: 2, value: '과학' },
    ]);
  });

  it('표 밖으로 넘치는 것은 버린다', () => {
    // 교시가 제멋대로 늘어나는 것보다 들어갈 데까지만 넣는 편이 낫다
    const writes = clipboardWrites({ row: 5, col: 5 }, size, [
      ['국어', '수학'],
      ['영어', '과학'],
    ]);
    expect(writes).toEqual([{ row: 5, col: 5, value: '국어' }]);
  });

  it('빈 칸도 그대로 넣는다 (지우려고 복사해 온 것일 수 있다)', () => {
    expect(clipboardWrites({ row: 0, col: 0 }, size, [['', '수학']])).toEqual([
      { row: 0, col: 0, value: '' },
      { row: 0, col: 1, value: '수학' },
    ]);
  });
});
