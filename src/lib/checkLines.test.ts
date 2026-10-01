import { describe, it, expect } from 'vitest';
import { checkLineState, hasCheckLines, toggleCheckLine } from './checkLines';

describe('체크 줄 (☐ / ☑)', () => {
  it('줄 앞의 체크 글자를 알아본다 (들여쓰기도)', () => {
    expect(checkLineState('☐ 우유')).toBe('open');
    expect(checkLineState('☑ 우유')).toBe('done');
    expect(checkLineState('  ☐ 들여 쓴 것')).toBe('open');
    expect(checkLineState('우유 ☐')).toBeNull();
    expect(checkLineState('[ ] 우유')).toBeNull();
    expect(checkLineState('')).toBeNull();
  });

  it('글에 체크 줄이 있는지', () => {
    expect(hasCheckLines('장보기\n☐ 우유\n☑ 빵')).toBe(true);
    expect(hasCheckLines('장보기\n우유')).toBe(false);
  });

  it('그 줄의 글자만 바꾸고 다른 줄·뒤의 글은 그대로 둔다', () => {
    const text = '장보기\n☐ 우유 https://a.b\n  ☑ 빵\n☐ 우유 https://a.b';
    expect(toggleCheckLine(text, 1)).toBe('장보기\n☑ 우유 https://a.b\n  ☑ 빵\n☐ 우유 https://a.b');
    expect(toggleCheckLine(text, 2)).toBe('장보기\n☐ 우유 https://a.b\n  ☐ 빵\n☐ 우유 https://a.b');
  });

  it('두 번 바꾸면 처음 글로 돌아온다', () => {
    const text = '☐ 하나\r\n☑ 둘';
    expect(toggleCheckLine(toggleCheckLine(text, 0)!, 0)).toBe(text);
  });

  it('체크 줄이 아니거나 없는 줄이면 바꾸지 않는다', () => {
    expect(toggleCheckLine('장보기\n☐ 우유', 0)).toBeNull();
    expect(toggleCheckLine('☐ 우유', 5)).toBeNull();
  });

  it('보던 줄과 지금 줄이 다르면(그새 고쳤다) 바꾸지 않는다', () => {
    expect(toggleCheckLine('☐ 우유\n☐ 빵', 1, '☐ 빵')).toBe('☐ 우유\n☑ 빵');
    expect(toggleCheckLine('☐ 계란\n☐ 우유\n☐ 빵', 1, '☐ 빵')).toBeNull();
  });
});
