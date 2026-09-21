// src/lib/gridNav.ts
//
// 표 안에서 칸을 오가고, 엑셀에서 복사한 것을 붙여 넣는 규칙.
//
// 시간표는 엑셀로 만들어 두고 옮겨 적는 일이 잦다. 옮겨 적는 동안 손이
// 마우스로 가면 스물다섯 칸이 스물다섯 번이다. 엑셀에서 하던 그대로
// 화살표·엔터·탭으로 옮겨 다니고, 통째로 붙여 넣을 수 있어야 한다.

export interface CellPos {
  row: number;
  col: number;
}

export interface CellMoveInput {
  key: string;
  shift: boolean;
  /** 글자 사이 커서가 맨 앞인가 (왼쪽 화살표를 칸 이동으로 볼지 가른다) */
  atStart: boolean;
  /** 커서가 맨 끝인가 */
  atEnd: boolean;
}

/**
 * 눌린 키로 옮겨 갈 칸을 정한다. 옮기지 않을 자리면 null.
 *
 * 좌우 화살표는 글자 사이를 오가는 데도 쓰인다. 그래서 커서가 칸의 끝에
 * 닿아 있을 때만 옆 칸으로 넘긴다. 엑셀은 늘 칸을 옮기지만, 글자를 고치는
 * 도중에 칸이 바뀌면 고치던 것을 놓친다.
 *
 * 위아래 화살표와 엔터는 줄을 옮긴다. 탭은 칸을 옮기고 줄 끝에서 다음 줄로
 * 넘어간다. 표의 끝에서는 null을 돌려주어, 탭이 표 밖으로 빠져나가는 길을
 * 막지 않는다.
 */
export function nextCell(
  pos: CellPos,
  size: { rows: number; cols: number },
  input: CellMoveInput
): CellPos | null {
  const { row, col } = pos;
  const { rows, cols } = size;
  const { key, shift, atStart, atEnd } = input;

  const clampRow = (r: number) => (r < 0 || r >= rows ? null : { row: r, col });

  switch (key) {
    case 'ArrowUp':
      return clampRow(row - 1);
    case 'ArrowDown':
      return clampRow(row + 1);
    case 'Enter':
      return clampRow(shift ? row - 1 : row + 1);

    case 'ArrowLeft':
      if (!atStart) return null; // 글자 사이를 옮기는 중이다
      return col - 1 < 0 ? null : { row, col: col - 1 };
    case 'ArrowRight':
      if (!atEnd) return null;
      return col + 1 >= cols ? null : { row, col: col + 1 };

    case 'Tab': {
      // 줄 끝에 닿으면 다음 줄 첫 칸으로 넘어간다 (엑셀과 같다)
      const flat = row * cols + col + (shift ? -1 : 1);
      if (flat < 0 || flat >= rows * cols) return null;
      return { row: Math.floor(flat / cols), col: flat % cols };
    }

    default:
      return null;
  }
}

/**
 * 엑셀에서 복사한 것을 표 모양으로 되돌린다.
 *
 * 엑셀은 칸을 탭으로, 줄을 줄바꿈으로 갈라 붙여 준다. 마지막에 붙는 빈 줄은
 * 버린다 — 엑셀이 줄 끝마다 줄바꿈을 넣어서, 그대로 두면 없는 줄 하나가
 * 맨 아래 칸을 비워 버린다.
 */
export function parseClipboardGrid(text: string): string[][] {
  const rows = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.split('\t').map((cell) => cell.trim()));

  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows;
}

/** 칸 하나짜리인가. 그렇다면 브라우저가 하던 대로 두는 편이 낫다. */
export function isSingleCell(text: string): boolean {
  return !/[\t\n\r]/.test(String(text ?? '').trim());
}

/**
 * 붙여 넣을 자리를 하나하나 짚어 준다. 표 밖으로 나가는 것은 버린다.
 *
 * 엑셀에서 표보다 큰 덩어리를 복사해 오는 일이 있다. 넘치는 만큼 표를
 * 늘리면 교시가 제멋대로 늘어나므로, 들어갈 수 있는 데까지만 넣는다.
 */
export function clipboardWrites(
  start: CellPos,
  size: { rows: number; cols: number },
  grid: string[][]
): Array<{ row: number; col: number; value: string }> {
  const out: Array<{ row: number; col: number; value: string }> = [];

  grid.forEach((line, r) => {
    const row = start.row + r;
    if (row >= size.rows) return;
    line.forEach((value, c) => {
      const col = start.col + c;
      if (col >= size.cols) return;
      out.push({ row, col, value });
    });
  });

  return out;
}
