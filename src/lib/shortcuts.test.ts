import { describe, it, expect } from 'vitest';
import {
  SHORTCUT_ACTIONS,
  FIXED_SHORTCUTS,
  eventKeyOf,
  bindingFromEvent,
  matchesEvent,
  formatBinding,
  formatActionBinding,
  resolveBindings,
  findConflicts,
  isModifierOnly,
  type Binding,
} from './shortcuts';

const ev = (over: Partial<KeyboardEvent> = {}) =>
  ({ key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over }) as KeyboardEvent;

const bind = (key: string, mods: Partial<Omit<Binding, 'key'>> = {}): Binding => ({
  ctrl: false,
  alt: false,
  shift: false,
  ...mods,
  key,
});

describe('eventKeyOf - 눌린 키의 이름', () => {
  it('자리(code)를 먼저 본다. Shift+1이 자판에 따라 !로 오기 때문이다', () => {
    expect(eventKeyOf(ev({ key: '!', code: 'Digit1' }))).toBe('1');
  });

  it('한글 입력 상태에서도 글자 키를 알아본다', () => {
    // 한글 상태에서 F 자리를 누르면 e.key 는 'ㄹ' 로 온다
    expect(eventKeyOf(ev({ key: 'ㄹ', code: 'KeyF' }))).toBe('F');
  });

  it('대소문자를 가리지 않는다', () => {
    expect(eventKeyOf(ev({ key: 'f', code: 'KeyF' }))).toBe('F');
  });

  it('화살표와 Space는 이름을 그대로 쓴다', () => {
    expect(eventKeyOf(ev({ key: 'ArrowUp', code: 'ArrowUp' }))).toBe('ArrowUp');
    expect(eventKeyOf(ev({ key: ' ', code: 'Space' }))).toBe('Space');
  });

  it('자리를 알 수 없는 기호도 받는다', () => {
    expect(eventKeyOf(ev({ key: '/', code: 'Slash' }))).toBe('/');
  });
});

describe('matchesEvent', () => {
  it('수식키가 하나라도 다르면 맞지 않다', () => {
    const b = bind('F', { ctrl: true });
    expect(matchesEvent(b, ev({ key: 'f', code: 'KeyF', ctrlKey: true }))).toBe(true);
    expect(matchesEvent(b, ev({ key: 'f', code: 'KeyF' }))).toBe(false);
    expect(matchesEvent(b, ev({ key: 'f', code: 'KeyF', ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it('맥의 Cmd는 Ctrl로 본다', () => {
    expect(matchesEvent(bind('F', { ctrl: true }), ev({ key: 'f', code: 'KeyF', metaKey: true }))).toBe(true);
  });

  it('켜고 끄는 기능은 ↑와 ↓를 같이 받는다', () => {
    const action = SHORTCUT_ACTIONS.find((a) => a.id === 'toggleEvents')!;
    const b = bind('ArrowUp', { ctrl: true });
    expect(matchesEvent(b, ev({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true }), action)).toBe(true);
    expect(matchesEvent(b, ev({ key: 'ArrowDown', code: 'ArrowDown', ctrlKey: true }), action)).toBe(true);
  });

  it('짝으로 보지 않는 기능은 방향을 구분한다', () => {
    const action = SHORTCUT_ACTIONS.find((a) => a.id === 'datePrev')!;
    const b = bind('ArrowLeft', { ctrl: true });
    expect(matchesEvent(b, ev({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true }), action)).toBe(false);
  });

  it('화살표가 아닌 키로 바꾸면 짝 규칙은 적용되지 않는다', () => {
    const action = SHORTCUT_ACTIONS.find((a) => a.id === 'toggleEvents')!;
    const b = bind('E', { ctrl: true });
    expect(matchesEvent(b, ev({ key: 'e', code: 'KeyE', ctrlKey: true }), action)).toBe(true);
    expect(matchesEvent(b, ev({ key: 'ArrowDown', code: 'ArrowDown', ctrlKey: true }), action)).toBe(false);
  });
});

describe('bindingFromEvent - 입력칸에서 키를 잡을 때', () => {
  it('누른 대로 수식키까지 담는다', () => {
    expect(bindingFromEvent(ev({ key: 'm', code: 'KeyM', ctrlKey: true, shiftKey: true }))).toEqual({
      ctrl: true,
      alt: false,
      shift: true,
      key: 'M',
    });
  });

  it('수식키만 눌린 것은 걸러낸다', () => {
    expect(isModifierOnly(ev({ key: 'Control' }))).toBe(true);
    expect(isModifierOnly(ev({ key: 'A' }))).toBe(false);
  });
});

describe('보여주는 이름', () => {
  it('누르는 순서대로 적는다', () => {
    expect(formatBinding(bind('F', { ctrl: true, shift: true }))).toBe('Ctrl + Shift + F');
    expect(formatBinding(bind('ArrowLeft', { ctrl: true }))).toBe('Ctrl + ←');
  });

  it('짝으로 동작하는 기능은 ↑ / ↓ 로 적는다', () => {
    const action = SHORTCUT_ACTIONS.find((a) => a.id === 'toggleClass')!;
    expect(formatActionBinding(action, bind('ArrowUp', { alt: true }))).toBe('Alt + ↑ / ↓');
  });
});

describe('resolveBindings', () => {
  it('바꾼 것이 없으면 기본값이다', () => {
    const resolved = resolveBindings();
    expect(resolved.toggleEvents).toEqual(bind('ArrowUp', { ctrl: true }));
    expect(Object.keys(resolved)).toHaveLength(SHORTCUT_ACTIONS.length);
  });

  it('바꾼 것만 덮어쓴다', () => {
    const resolved = resolveBindings({ search: bind('K', { ctrl: true }) });
    expect(resolved.search).toEqual(bind('K', { ctrl: true }));
    expect(resolved.datePrev).toEqual(bind('ArrowLeft', { ctrl: true }));
  });
});

describe('findConflicts - 겹치는 조합 찾기', () => {
  it('기본값끼리는 겹치지 않는다', () => {
    expect(findConflicts(resolveBindings())).toEqual([]);
  });

  it('같은 조합을 두 기능이 쓰면 잡아낸다', () => {
    const conflicts = findConflicts(resolveBindings({ search: bind('ArrowLeft', { ctrl: true }) }));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('search');
    expect(conflicts[0]).toContain('datePrev');
  });

  it('↑와 ↓는 짝이라 서로 겹치는 것으로 본다', () => {
    // 주말이 Shift+↑ 인데 일정을 Shift+↓ 로 두면, 둘 다 양쪽 화살표를 받으므로 겹친다
    const conflicts = findConflicts(resolveBindings({ toggleEvents: bind('ArrowDown', { shift: true }) }));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('toggleWeekend');
    expect(conflicts[0]).toContain('toggleEvents');
  });
});

describe('목록 자체', () => {
  it('id가 겹치지 않는다', () => {
    const ids = SHORTCUT_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ESC는 고정 목록에 있고 바꿀 수 있는 목록에는 없다', () => {
    expect(FIXED_SHORTCUTS.some((f) => f.keys === 'ESC')).toBe(true);
    expect(SHORTCUT_ACTIONS.some((a) => a.def.key === 'Escape')).toBe(false);
  });

  it('모든 기능에 기본 조합이 있다', () => {
    for (const action of SHORTCUT_ACTIONS) {
      expect(action.def.key, `${action.id} 의 기본 키가 비어 있다`).toBeTruthy();
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.group.length).toBeGreaterThan(0);
    }
  });
});
