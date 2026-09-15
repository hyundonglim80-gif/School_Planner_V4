// src/lib/csv.ts
//
// CSV를 만들고 읽는다.
//
// 읽는 쪽을 제대로 만들어야 하는 이유가 있다. 예전 파서는 칸을 이렇게 잘랐다.
//   line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)
// 따옴표가 없는 칸에서 공백을 칸의 끝으로 봤다. 우리가 내보낸 파일은 모든 칸을
// 따옴표로 감싸니 괜찮았지만, 그 파일을 엑셀에서 한 번 열어 고쳐 저장하면
// 엑셀은 따옴표가 필요 없는 칸의 따옴표를 떼고 저장한다. 그러면
//   3,김하늘,여,재학,체육 면제
// 의 '체육 면제'가 '체육'에서 잘리고 '면제'는 사라졌다.
// 사람이 고쳐서 다시 넣는 것이 목적이므로 여기서는 규격대로 읽는다.

/** 칸 하나를 CSV에 넣을 수 있게 감싼다 */
function escapeCell(value: unknown): string {
  const text = String(value ?? '');
  // 쉼표·따옴표·줄바꿈이 있으면 반드시 감싸야 한다
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * 표를 CSV 글자로 바꾼다.
 * 앞에 BOM을 붙인다. 없으면 엑셀이 한글을 깨뜨린다.
 */
export function toCsv(rows: unknown[][], withBom = true): string {
  const body = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
  return (withBom ? '﻿' : '') + body;
}

/**
 * CSV 글자를 표로 읽는다.
 *
 * 따옴표 안의 쉼표와 줄바꿈, 두 번 적은 따옴표("")를 모두 제대로 다룬다.
 * 따옴표가 없는 칸은 쉼표가 나올 때까지가 한 칸이다(공백도 칸의 일부다).
 */
export function parseCsv(text: string): string[][] {
  const input = String(text ?? '').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        // "" 는 따옴표 한 글자를 뜻한다
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }

    if (ch === '"' && cell === '') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      endCell();
      i++;
      continue;
    }
    if (ch === '\r') {
      // \r\n 과 \n 을 모두 받는다
      if (input[i + 1] === '\n') i++;
      endRow();
      i++;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i++;
      continue;
    }

    cell += ch;
    i++;
  }

  // 마지막 줄이 줄바꿈으로 끝나지 않았을 수 있다
  if (cell !== '' || row.length > 0) endRow();

  // 아무것도 없는 줄은 버린다 (파일 끝의 빈 줄 등)
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** 만든 CSV를 파일로 내려준다 */
export function downloadCsv(rows: unknown[][], filename: string) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
