import { describe, it, expect } from 'vitest';
import { checkLineState, hasCheckLines, toggleCheckLine, toggleLinesPrefix,
  continueOnEnter,
  toggleCheckAtCaret,
  checkCount,
} from './checkLines';

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

// 쓰는 칸에서 체크 목록 만들기 (19번 U9)
describe('toggleLinesPrefix · continueOnEnter · toggleCheckAtCaret · checkCount', () => {
  it('커서가 있는 줄 앞에 ☐ 를 붙이고, 모두 붙어 있으면 뗀다 (들여쓰기 유지)', () => {
    const r = toggleLinesPrefix('우유\n  계란', 1, 1);
    expect(r.text).toBe('☐ 우유\n  계란');
    expect(r.selStart).toBe(3);
    const back = toggleLinesPrefix(r.text, r.selStart, r.selEnd);
    expect(back.text).toBe('우유\n  계란');
  });

  it('고른 줄들에 한꺼번에 (이미 붙은 줄은 그대로), 다 붙었으면 ☑ 줄도 뗀다', () => {
    const text = '우유\n☑ 계란\n빵';
    const r = toggleLinesPrefix(text, 0, text.length);
    expect(r.text).toBe('☐ 우유\n☑ 계란\n☐ 빵');
    expect(toggleLinesPrefix(r.text, 0, r.text.length).text).toBe('우유\n계란\n빵');
    // 들여쓴 줄
    expect(toggleLinesPrefix('  들여', 3, 3).text).toBe('  ☐ 들여');
  });

  it('줄을 통째로 고르면(끝이 다음 줄 맨 앞) 다음 줄은 빼고', () => {
    expect(toggleLinesPrefix('가\n나\n다', 0, 2).text).toBe('☐ 가\n나\n다');
  });

  it('체크 줄에서 Enter → 다음 줄도 ☐ (들여쓰기 유지), 빈 체크 줄에서 Enter → 표시만 지우고 끝', () => {
    const r = continueOnEnter('  ☐ 우유', 6)!;
    expect(r.text).toBe('  ☐ 우유\n  ☐ ');
    expect(r.caret).toBe(r.text.length);
    const end = continueOnEnter(r.text, r.text.length)!;
    expect(end.text).toBe('  ☐ 우유\n  ');
    expect(continueOnEnter('보통 줄', 4)).toBeNull();
    // 줄 가운데서 누르면 뒤 글이 새 체크 줄로
    expect(continueOnEnter('☐ 우유우유', 4)!.text).toBe('☐ 우유\n☐ 우유');
  });

  it('쓰는 칸에서 체크 글자 바로 위를 누르면 바꾼다, 다른 자리는 null', () => {
    expect(toggleCheckAtCaret('가\n☐ 우유', 2)).toBe('가\n☑ 우유');
    expect(toggleCheckAtCaret('가\n☐ 우유', 3)).toBe('가\n☑ 우유');
    expect(toggleCheckAtCaret('가\n☐ 우유', 5)).toBeNull();
    expect(toggleCheckAtCaret('가\n☐ 우유', 0)).toBeNull();
  });

  it('셈: 체크한 것 / 체크 줄 모두', () => {
    expect(checkCount('☑ 가\n☐ 나\n보통\n  ☑ 다')).toEqual({ done: 2, total: 3 });
    expect(checkCount('보통')).toEqual({ done: 0, total: 0 });
  });
});
