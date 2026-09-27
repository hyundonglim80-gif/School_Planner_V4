import { describe, it, expect } from 'vitest';
import { pickPreferences, preferencesKey, sanitizePreferences, type SyncedPreferences } from './preferenceSync';

const base: SyncedPreferences = {
  semesterFilter: 'all',
  showWeekend: true,
  showClass: true,
  showEvents: true,
  enableScrollNav: false,
  startupScope: 'last',
  fontScale: 'md',
  forwardLookbackDays: 7,
  shortcutOverrides: {},
};

describe('preferenceSync', () => {
  it('설정 값만 골라내고 화면 상태는 넣지 않는다', () => {
    const picked = pickPreferences({ ...base, scope: 'week', currentDate: 'x' } as any);
    expect(picked).toEqual(base);
  });

  it('키 순서가 달라도 같은 값이면 같다고 본다', () => {
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as unknown as SyncedPreferences;
    expect(preferencesKey(reordered)).toBe(preferencesKey(base));
    expect(preferencesKey({ ...base, showWeekend: false })).not.toBe(preferencesKey(base));
  });

  it('믿을 만한 값만 받아들인다', () => {
    const out = sanitizePreferences({
      semesterFilter: 3,
      showWeekend: false,
      showClass: 'yes',
      startupScope: 'month',
      fontScale: 'huge',
      forwardLookbackDays: 99999,
      shortcutOverrides: {
        search: { key: 'K', ctrl: true, alt: false, shift: false },
        broken: { key: 1 },
      },
      updatedAt: 123,
    });
    expect(out.semesterFilter).toBeUndefined();
    expect(out.showWeekend).toBe(false);
    expect(out.showClass).toBeUndefined();
    expect(out.startupScope).toBe('month');
    expect(out.fontScale).toBeUndefined();
    expect(typeof out.forwardLookbackDays).toBe('number');
    expect(out.forwardLookbackDays).toBeLessThan(99999);
    expect(out.shortcutOverrides).toEqual({ search: { key: 'K', ctrl: true, alt: false, shift: false } });
    expect(out).not.toHaveProperty('updatedAt');
  });

  it('문서가 비었거나 이상하면 아무것도 바꾸지 않는다', () => {
    expect(sanitizePreferences(null)).toEqual({});
    expect(sanitizePreferences('x')).toEqual({});
  });
});
