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

// ── 쓰는 칸에서 체크 목록 만들기 (19번 U9) ─────────────────────────────

/** 글자 자리 → 그 자리가 든 줄 번호 */
const lineIndexAt = (text: string, pos: number) => text.slice(0, Math.max(0, pos)).split('\n').length - 1;
/** 줄 번호 → 그 줄이 시작하는 글자 자리 */
const lineStartOf = (lines: string[], i: number) => lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);

/**
 * '☑ 체크리스트' 단추·단축키: 커서가 있는 줄(골랐으면 고른 줄들) 앞에 '☐ '를 붙인다. 모두 붙어 있으면 뗀다(☑ 줄도).
 * 들여쓰기는 그대로 두고 그 뒤에 붙인다. 바뀐 글과 옮겨진 커서 자리를 돌려준다.
 */
export function toggleLinesPrefix(text: string, selStart: number, selEnd: number): { text: string; selStart: number; selEnd: number } {
  const lines = text.split('\n');
  const first = lineIndexAt(text, selStart);
  // 고른 끝이 줄 맨 앞이면 그 줄은 빼고 (줄을 통째로 골랐을 때)
  let last = lineIndexAt(text, selEnd);
  if (selEnd > selStart && last > first && selEnd === lineStartOf(lines, last)) last -= 1;
  const all = lines.slice(first, last + 1).every((l) => checkLineState(l) !== null);
  let shiftStart = 0;
  let shiftEnd = 0;
  for (let i = first; i <= last; i++) {
    const line = lines[i];
    const m = /^([ \t]*)([☐☑] ?)?/.exec(line)!;
    const indent = m[1];
    let next: string;
    if (all) next = indent + line.slice(m[0].length);
    else if (m[2]) next = line;
    else next = indent + '☐ ' + line.slice(indent.length);
    const delta = next.length - line.length;
    if (i === first) shiftStart = delta;
    shiftEnd += delta;
    lines[i] = next;
  }
  const out = lines.join('\n');
  const firstStart = lineStartOf(lines, first);
  const clamp = (n: number) => Math.max(firstStart, Math.min(out.length, n));
  return { text: out, selStart: clamp(selStart + shiftStart), selEnd: clamp(selEnd + shiftEnd) };
}

/**
 * 체크 줄에서 Enter: 다음 줄도 '☐ '로(들여쓰기 유지). 내용이 빈 체크 줄에서 Enter면 표시만 지우고 목록을 끝낸다.
 * 체크 줄이 아니면 null (쓰는 칸이 보통 Enter로 둔다).
 */
export function continueOnEnter(text: string, caret: number): { text: string; caret: number } | null {
  const lines = text.split('\n');
  const i = lineIndexAt(text, caret);
  const line = lines[i];
  const m = /^([ \t]*)([☐☑]) ?/.exec(line);
  if (!m) return null;
  const start = lineStartOf(lines, i);
  if (caret - start < m[0].length) return null; // 표시 앞에서 누른 Enter는 보통대로
  if (!line.slice(m[0].length).trim()) {
    // 빈 체크 줄 → 표시만 지운다
    lines[i] = m[1];
    return { text: lines.join('\n'), caret: start + m[1].length };
  }
  const insert = `\n${m[1]}☐ `;
  return { text: text.slice(0, caret) + insert + text.slice(caret), caret: caret + insert.length };
}

/** 쓰는 칸에서 체크 글자(줄 맨 앞 ☐/☑ 바로 위)를 누르면 바꾼 글. 그 자리가 아니면 null */
export function toggleCheckAtCaret(text: string, caret: number): string | null {
  const lines = text.split('\n');
  const i = lineIndexAt(text, caret);
  const m = /^([ \t]*)([☐☑])/.exec(lines[i] || '');
  if (!m) return null;
  const col = caret - lineStartOf(lines, i);
  if (col < m[1].length || col > m[1].length + 1) return null;
  return toggleCheckLine(text, i);
}

/** 체크 줄 셈 (카드 머리줄 '☑ 2/5'). 체크 줄이 없으면 total 0 */
export function checkCount(text: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const line of text.split('\n')) {
    const st = checkLineState(line);
    if (!st) continue;
    total++;
    if (st === 'done') done++;
  }
  return { done, total };
}
