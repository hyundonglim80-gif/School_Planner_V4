import { describe, it, expect } from 'vitest';
import {
  isLongEntry,
  previewLine,
  COLLAPSE_CHAR_LIMIT,
  COLLAPSE_LINE_LIMIT,
} from './entryCollapse';

describe('접은 채로 시작할 기준', () => {
  it('짧은 글은 펼친 채로 둔다', () => {
    expect(isLongEntry('오늘 급식 지도')).toBe(false);
  });

  it('빈 글은 길지 않다', () => {
    expect(isLongEntry('')).toBe(false);
    expect(isLongEntry('   \n  ')).toBe(false);
    expect(isLongEntry(undefined)).toBe(false);
  });

  it('글자 수가 기준을 넘으면 접는다', () => {
    expect(isLongEntry('가'.repeat(COLLAPSE_CHAR_LIMIT))).toBe(false);
    expect(isLongEntry('가'.repeat(COLLAPSE_CHAR_LIMIT + 1))).toBe(true);
  });

  it('짧은 줄이라도 줄 수가 많으면 접는다', () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `- 항목 ${i}`).join('\n');
    expect(isLongEntry(lines(COLLAPSE_LINE_LIMIT))).toBe(false);
    expect(isLongEntry(lines(COLLAPSE_LINE_LIMIT + 1))).toBe(true);
  });
});

describe('접혔을 때 보여 줄 한 줄', () => {
  it('첫 줄을 쓴다', () => {
    expect(previewLine('학부모 상담\n둘째 줄은 안 보인다')).toBe('학부모 상담');
  });

  it('앞의 빈 줄은 건너뛴다', () => {
    expect(previewLine('\n\n  실제 첫 줄')).toBe('실제 첫 줄');
  });

  it('너무 길면 말줄임한다', () => {
    const out = previewLine('나'.repeat(100));
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThan(100);
  });

  it('내용이 없으면 빈 문자열', () => {
    expect(previewLine('')).toBe('');
    expect(previewLine(null)).toBe('');
  });
});
