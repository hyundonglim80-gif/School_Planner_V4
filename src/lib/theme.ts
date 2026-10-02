// src/lib/theme.ts
//
// 화면 밝기 (ROADMAP 17 다크 모드). 밝게 / 어둡게 / 시스템 따라 - 이 기기에만 남긴다(PC는 밝게, 휴대폰은 밤에 어둡게처럼
// 기기마다 다르게 쓰는 일이 많다). html에 dark 클래스를 붙이면 src/dark.css가 색 변수를 바꾼다.
// 처음 그리기 전에 index.html의 작은 스크립트가 같은 규칙으로 먼저 붙인다(밝은 화면이 번쩍이지 않게) - 키 이름을 바꾸면 거기도.

export type ThemeMode = 'light' | 'dark' | 'system';
export const THEME_KEY = 'sp4_theme';
export const THEME_CHANGED_EVENT = 'sp4-theme-changed';

export function readThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const systemDark = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;

export function isDarkMode(mode: ThemeMode = readThemeMode()): boolean {
  return mode === 'dark' || (mode === 'system' && systemDark());
}

/** 지금 설정대로 html에 dark를 붙이거나 뗀다 */
export function applyTheme(mode: ThemeMode = readThemeMode()) {
  const dark = isDarkMode(mode);
  document.documentElement.classList.toggle('dark', dark);
  // 휴대폰 주소창·상태 표시줄 빛깔
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1522' : '#2563eb');
}

export function setThemeMode(mode: ThemeMode) {
  try {
    if (mode === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* 저장하지 못해도 이번에는 바뀐다 */
  }
  applyTheme(mode);
  window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
}

/** 어둡게 ↔ 밝게 (지금 보이는 것의 반대로 정한다) */
export function toggleThemeMode() {
  setThemeMode(isDarkMode() ? 'light' : 'dark');
}

/** '시스템 따라'일 때 기기 설정이 바뀌면 따라간다 */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => {};
  const onChange = () => {
    if (readThemeMode() === 'system') applyTheme('system');
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
