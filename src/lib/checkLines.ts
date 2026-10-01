// src/lib/checkLines.ts
//
// '☐ 우유' / '☑ 우유' 처럼 체크 글자로 시작하는 줄 (로드맵 6-6).
// 구글 Keep의 목록 메모가 이 글자로 들어온다(lib/keepImport의 listLine). 카드에서 그 줄을
// 누르면 글자만 ☐ ↔ ☑ 로 바꾼다 - 나머지 글(앞의 띄어쓰기·뒤의 내용·다른 줄)은 건드리지 않는다.

/** 줄 앞의 띄어쓰기(들여쓰기)와 체크 글자 */
const CHECK_LINE = /^([ \t]*)([☐☑])/;

/** 체크 줄이면 'open'(☐)·'done'(☑), 아니면 null */
export function checkLineState(line: string): 'open' | 'done' | null {
  const m = CHECK_LINE.exec(line);
  if (!m) return null;
  return m[2] === '☑' ? 'done' : 'open';
}

/** 글에 체크 줄이 하나라도 있나 */
export function hasCheckLines(text: string): boolean {
  return text.split('\n').some((line) => checkLineState(line) !== null);
}

/**
 * lineIndex번째 줄의 체크 글자만 바꾼 글. 그 줄이 체크 줄이 아니거나, expectedLine을 주었는데
 * 그 줄이 다르면(그새 다른 곳에서 고쳤다) null - 엉뚱한 줄을 바꾸지 않는다.
 */
export function toggleCheckLine(text: string, lineIndex: number, expectedLine?: string): string | null {
  const lines = text.split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return null;
  if (expectedLine !== undefined && line !== expectedLine) return null;
  const m = CHECK_LINE.exec(line);
  if (!m) return null;
  lines[lineIndex] = m[1] + (m[2] === '☐' ? '☑' : '☐') + line.slice(m[0].length);
  return lines.join('\n');
}
