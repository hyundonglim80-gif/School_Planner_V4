import { describe, it, expect } from 'vitest';
import {
  cellCss,
  deleteCol,
  deleteRow,
  insertCol,
  insertRow,
  isRealTable,
  MAX_TABLE_CELLS,
  parseClipboardTable,
  setCellText,
  tableForSave,
  type EntryTable,
} from './entryTable';

// 엑셀에서 복사하면 클립보드에 들어오는 HTML의 모양 (줄여 옮김).
// 서식은 대부분 <style>의 .xl클래스로, 병합은 colspan/rowspan, 열 너비는 <col width>.
const EXCEL = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><style>
<!--table {mso-displayed-decimal-separator:"\\.";}
td {padding-top:1px; color:black; font-size:11.0pt; font-weight:400; font-style:normal; text-decoration:none;
  font-family:"맑은 고딕"; text-align:general; vertical-align:bottom; border:none; white-space:nowrap;}
.xl65 {font-weight:700; text-align:center; background:#FFFF00; border:.5pt solid windowtext;}
.xl66 {color:red; border-top:.5pt solid windowtext; border-bottom:1.5pt solid windowtext;}
.xl67 {white-space:normal; vertical-align:top; font-size:14.0pt;}
-->
</style></head><body>
<table border=0 cellpadding=0 cellspacing=0 width=216>
 <col width=72 span=2 style='width:54pt'>
 <col width=100>
 <tr height=22 style='height:16.5pt'>
  <td colspan=2 class=xl65 width=144>학급 명렬</td>
  <td class=xl66>비고</td>
 </tr>
 <tr height=22>
  <td rowspan=2 class=xl67>1반<br style='mso-data-placement:same-cell'>담임</td>
  <td align=right x:num>25</td>
  <td>&nbsp;</td>
 </tr>
 <tr>
  <td x:num>1,234</td>
  <td><font class="font5">빨강</font> 글자</td>
 </tr>
</table></body></html>`;

// 구글 시트: 서식이 칸의 style에 바로 붙는다
const SHEETS = `<meta charset="utf-8"><google-sheets-html-origin><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none"><colgroup><col width="100"/><col width="120"/></colgroup><tbody><tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;background-color:#b6d7a8;font-weight:bold;">이름</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;color:#ff0000;text-align:right;">점수</td></tr><tr style="height:21px;"><td style="text-decoration:underline;font-style:italic;">김하나</td><td style="text-align:right;">95</td></tr></tbody></table>`;

const asTable = (x: ReturnType<typeof parseClipboardTable>) => {
  if (!x || 'error' in x) throw new Error('표가 아님');
  return x;
};
const styleOf = (t: EntryTable, r: number, c: number) => t.styles?.[t.rows[r].cells[c].s ?? -1] ?? {};

describe('붙여넣은 표 읽기 - 엑셀', () => {
  const t = asTable(parseClipboardTable(EXCEL));

  it('격자: 병합된 자리는 가려진 칸, 3줄 × 3열', () => {
    expect(t.rows.length).toBe(3);
    expect(t.rows.every((r) => r.cells.length === 3)).toBe(true);
    expect(t.rows[0].cells[0]).toMatchObject({ v: '학급 명렬', cs: 2 });
    expect(t.rows[0].cells[1]).toEqual({ v: '', x: 1 });
    expect(t.rows[1].cells[0]).toMatchObject({ v: '1반\n담임', rs: 2 });
    expect(t.rows[2].cells[0]).toEqual({ v: '', x: 1 });
    expect(t.rows[2].cells[1].v).toBe('1,234');
    expect(t.rows[2].cells[2].v).toBe('빨강 글자');
    // &nbsp;만 있는 칸은 빈 칸
    expect(t.rows[1].cells[2].v).toBe('');
  });

  it('클래스 서식: 굵게·가운데·배경·테두리', () => {
    expect(styleOf(t, 0, 0)).toMatchObject({ b: 1, ha: 'center', bg: '#ffff00', bt: '1px solid #000000', bl: '1px solid #000000' });
    // 윗선 얇게, 아랫선 굵게, 빨간 글자
    expect(styleOf(t, 0, 2)).toMatchObject({ c: '#ff0000', bt: '1px solid #000000', bb: '2px solid #000000' });
    // 줄 바꿈·위 맞춤·14pt
    expect(styleOf(t, 1, 0)).toMatchObject({ wrap: 1, va: 'top', fs: 14 });
  });

  it("숫자 칸은 엑셀 '일반' 맞춤처럼 오른쪽", () => {
    expect(styleOf(t, 1, 1).ha).toBe('right');
    expect(styleOf(t, 2, 1).ha).toBe('right');
  });

  it('열 너비(span 포함)와 줄 높이', () => {
    expect(t.cols).toEqual([72, 72, 100]);
    expect(t.rows[0].h).toBe(22);
  });

  it('같은 서식은 한 번만 적는다', () => {
    const keys = (t.styles || []).map((s) => JSON.stringify(s));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('붙여넣은 표 읽기 - 구글 시트·그 밖', () => {
  it('칸 style의 서식', () => {
    const t = asTable(parseClipboardTable(SHEETS));
    expect(t.rows.map((r) => r.cells.map((c) => c.v))).toEqual([
      ['이름', '점수'],
      ['김하나', '95'],
    ]);
    expect(styleOf(t, 0, 0)).toMatchObject({ bg: '#b6d7a8', b: 1 });
    expect(styleOf(t, 0, 1)).toMatchObject({ c: '#ff0000', ha: 'right' });
    expect(styleOf(t, 1, 0)).toMatchObject({ u: 1, i: 1 });
    expect(t.cols).toEqual([100, 120]);
  });

  it('표가 없으면 null, 한 칸만이면 표가 아니다(글자로 붙인다)', () => {
    expect(parseClipboardTable('<p>그냥 글</p>')).toBeNull();
    expect(parseClipboardTable('')).toBeNull();
    const one = asTable(parseClipboardTable('<table><tr><td>하나</td></tr></table>'));
    expect(isRealTable(one)).toBe(false);
  });

  it('너무 큰 표는 막는다', () => {
    const row = `<tr>${'<td>1</td>'.repeat(60)}</tr>`;
    const html = `<table>${row.repeat(Math.ceil(MAX_TABLE_CELLS / 60) + 5)}</table>`;
    const res = parseClipboardTable(html);
    expect(res && 'error' in res).toBe(true);
  });

  it('믿을 수 없는 색(스타일 끼워 넣기)은 버린다', () => {
    const t = asTable(
      parseClipboardTable('<table><tr><td style="background:url(javascript:x);color:expression(alert(1))">a</td><td>b</td></tr></table>')
    );
    expect(t.styles).toBeUndefined();
  });
});

describe('표 고치기', () => {
  const base = () => asTable(parseClipboardTable(EXCEL));

  it('칸 글자 고치기 (가려진 칸은 그대로)', () => {
    const t = setCellText(base(), 2, 2, '파랑');
    expect(t.rows[2].cells[2].v).toBe('파랑');
    const same = base();
    expect(setCellText(same, 0, 1, 'x')).toBe(same);
  });

  it('병합 가운데에 줄을 넣으면 병합이 한 줄 늘어난다', () => {
    const t = insertRow(base(), 2);
    expect(t.rows.length).toBe(4);
    expect(t.rows[1].cells[0].rs).toBe(3);
    expect(t.rows[2].cells[0]).toEqual({ v: '', x: 1 });
    expect(t.rows[2].cells[1].v).toBe('');
  });

  it('병합의 첫 줄을 빼면 병합이 다음 줄로 넘어간다', () => {
    const t = deleteRow(base(), 1);
    expect(t.rows.length).toBe(2);
    expect(t.rows[1].cells[0].v).toBe('1반\n담임');
    expect(t.rows[1].cells[0].rs).toBeUndefined();
    expect(t.rows[1].cells[0].x).toBeUndefined();
  });

  it('병합 가운데에 열을 넣고 빼기, 열 너비도 따라간다', () => {
    const t = insertCol(base(), 1);
    expect(t.rows[0].cells[0].cs).toBe(3);
    expect(t.rows[0].cells.length).toBe(4);
    expect(t.cols).toEqual([72, 72, 72, 100]);
    const back = deleteCol(t, 1);
    expect(back.rows[0].cells[0].cs).toBe(2);
    expect(back.cols).toEqual([72, 72, 100]);
  });

  it('병합의 첫 열을 빼면 옆 칸이 병합을 이어받는다', () => {
    const t = deleteCol(base(), 0);
    expect(t.rows[0].cells[0].v).toBe('학급 명렬');
    expect(t.rows[0].cells[0].cs).toBeUndefined();
  });

  it('마지막 한 줄·한 열은 빼지 않는다', () => {
    const one = asTable(parseClipboardTable('<table><tr><td>a</td><td>b</td></tr></table>'));
    expect(deleteRow(one, 0)).toBe(one);
  });

  it('저장 모양에는 undefined가 없고 배열 안에 배열이 없다 (Firestore)', () => {
    const saved = tableForSave(deleteRow(insertCol(base(), 1), 1));
    const json = JSON.stringify(saved);
    expect(json).not.toContain('undefined');
    const hasNestedArray = (v: unknown): boolean =>
      Array.isArray(v) ? v.some((x) => Array.isArray(x) || hasNestedArray(x)) : !!v && typeof v === 'object' && Object.values(v).some(hasNestedArray);
    expect(hasNestedArray(saved)).toBe(false);
    const hasUndefined = (v: unknown): boolean =>
      v === undefined || (Array.isArray(v) ? v.some(hasUndefined) : !!v && typeof v === 'object' && Object.values(v).some(hasUndefined));
    expect(hasUndefined(saved)).toBe(false);
  });

  it('서식 → 화면 스타일', () => {
    expect(cellCss({ b: 1, bg: '#ffff00', fs: 14, ha: 'center' })).toEqual({
      fontWeight: 700,
      backgroundColor: '#ffff00',
      fontSize: '14pt',
      textAlign: 'center',
    });
  });
});
