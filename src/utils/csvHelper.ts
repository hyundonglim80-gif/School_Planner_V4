import type { Student } from '../hooks/useRoster';
import { toCsv, parseCsv } from '../lib/csv';
import { genderToText, textToGender } from '../lib/rosterCsv';

// 학급 하나의 명단을 CSV로 주고받는다.
// 여러 학급을 한 파일로 다루는 것은 lib/rosterCsv.ts 쪽이다.
const HEADER = ['번호', '이름', '성별', '상태', '특이사항'];

/** 학생 명단을 CSV 파일로 다운로드합니다. */
export function downloadCSV(students: Student[], filename: string) {
  const rows: string[][] = [HEADER];
  for (const st of students) {
    rows.push([
      String(st.num ?? ''),
      st.name || '',
      genderToText(st.gender),
      st.isActive !== false ? '재학' : '전출',
      st.note || '',
    ]);
  }

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

/**
 * CSV 텍스트를 학생 배열로 변환합니다.
 *
 * 읽는 일은 lib/csv.ts 에 맡긴다. 예전에는 여기서 정규식 하나로 칸을 잘랐는데,
 * 따옴표가 없는 칸에서 공백을 칸의 끝으로 봐서 '체육 면제' 같은 값이
 * '체육'에서 잘렸다. 엑셀은 따옴표가 필요 없는 칸의 따옴표를 떼고 저장하므로,
 * 우리가 내보낸 파일도 한 번 열었다 저장하면 그렇게 된다.
 */
export async function parseCSV(file: File): Promise<Student[]> {
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV 파일에 데이터가 없습니다. (헤더 행 포함)');

  const header = rows[0].map((h) => String(h ?? '').trim());
  const idxOf = (name: string, fallback: number) => {
    const found = header.indexOf(name);
    return found === -1 ? fallback : found;
  };
  const col = {
    num: idxOf('번호', 0),
    name: idxOf('이름', 1),
    gender: idxOf('성별', 2),
    status: idxOf('상태', 3),
    note: idxOf('특이사항', 4),
  };

  const students: Student[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const cell = (i: number) => String(row[i] ?? '').trim();

    const num = parseInt(cell(col.num), 10);
    if (!Number.isFinite(num)) continue; // 번호가 숫자가 아니면 학생 줄이 아니다

    students.push({
      num,
      name: cell(col.name),
      gender: textToGender(cell(col.gender)),
      isActive: !cell(col.status).includes('전출'),
      note: cell(col.note),
    });
  }
  return students;
}
