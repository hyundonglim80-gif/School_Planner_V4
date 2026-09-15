import { describe, it, expect } from 'vitest';

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
