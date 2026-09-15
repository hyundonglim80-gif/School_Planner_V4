import { describe, it, expect } from 'vitest';
import { SHORTCUT_ACTIONS } from '../lib/shortcuts';

// 상단 '주말' / '일정' / '수업' 버튼이 켜고 끄는 값들.
// 예전에 showEvents는 store에도 있고 주간/월간/년간도 보고 있었는데, 하루 화면만
// 그 값을 읽지 않아서 버튼을 눌러도 하루 화면의 일정은 그대로 남아 있었다.
// 값만 있고 읽는 화면이 빠지는 일을 막는다.
const sources: Record<string, string> = {
  ...(import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  ...(import.meta.glob('../features/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
};

const read = (suffix: string) => {
  const hit = Object.entries(sources).find(([p]) => p.endsWith(suffix));
  expect(hit, `${suffix} 를 찾지 못했다`).toBeDefined();
  return hit![1];
};

// 화면별로 반드시 읽어야 하는 토글. 하루 화면에는 주말 개념이 없다.
const expectations: Record<string, string[]> = {
  'day/DayScreen.tsx': ['showEvents', 'showClass'],
  'week/WeekGrid.tsx': ['showEvents', 'showClass'],
  'month/MonthGrid.tsx': ['showEvents', 'showClass'],
  'month/MonthAgenda.tsx': ['showEvents', 'showClass'],
  'year/YearScreen.tsx': ['showEvents', 'showClass', 'showWeekend'],
};

describe('표시 토글은 버튼과 화면이 같이 움직인다', () => {
  it('Layout이 주말/일정/수업 세 개를 모두 버튼으로 내놓는다', () => {
    const layout = read('/Layout.tsx');
    for (const key of ['showWeekend', 'showEvents', 'showClass']) {
      expect(layout, `${key} 버튼이 없다`).toContain(key);
    }
  });

  it.each(Object.entries(expectations))('%s 가 토글 값을 읽는다', (file, keys) => {
    const src = read(file);
    for (const key of keys) {
      expect(src, `${file} 가 ${key} 를 읽지 않는다`).toContain(key);
    }
  });
});

// 단축키는 세 곳이 어긋나기 쉬웠다.
//   Layout의 키 처리 / 버튼 툴팁 / 사용 설명서의 목록
// 실제로 일정 토글은 셋 다 비어 있었다. 지금은 lib/shortcuts.ts 한 곳을 셋이 같이 본다.
describe('단축키는 한 곳에서만 정한다', () => {
  const layout = read('/Layout.tsx');
  const help = read('/HelpModal.tsx');

  it.each([
    { label: '주말', id: 'toggleWeekend', mods: { ctrl: false, alt: false, shift: true } },
    { label: '일정', id: 'toggleEvents', mods: { ctrl: true, alt: false, shift: false } },
    { label: '수업', id: 'toggleClass', mods: { ctrl: false, alt: true, shift: false } },
  ])('$label - 기본 단축키가 정의에 있다', ({ id, mods }) => {
    const action = SHORTCUT_ACTIONS.find((a) => a.id === id);
    expect(action, `${id} 가 없다`).toBeDefined();
    expect(action!.def).toEqual({ ...mods, key: 'ArrowUp' });
    // 켜고 끄는 기능이라 ↑와 ↓가 같이 동작해야 한다 (예전부터 그렇게 써 왔다)
    expect(action!.pairArrows).toBe(true);
  });

  it('Layout이 키 조합을 직접 적어두지 않는다', () => {
    expect(layout).toContain("from '../lib/shortcuts'");
    // 예전처럼 e.shiftKey && e.key === 'ArrowUp' 같은 판정을 손으로 적으면 설정과 어긋난다
    expect(layout).not.toMatch(/e\.key === 'Arrow(Up|Down|Left|Right)'/);
    expect(layout).not.toMatch(/e\.code === 'Digit[0-9]'/);
  });

  it('사용 설명서가 단축키를 손으로 적어두지 않는다', () => {
    expect(help).toContain("from '../lib/shortcuts'");
    expect(help).not.toMatch(/Shift \+ ↑ \/ ↓|Alt \+ ↑ \/ ↓|Ctrl \+ ↑ \/ ↓/);
  });

  it('버튼 툴팁도 설정값에서 가져온다', () => {
    expect(layout).toContain('formatActionBinding');
    expect(layout).not.toMatch(/hint: 'Shift \+/);
  });
});
