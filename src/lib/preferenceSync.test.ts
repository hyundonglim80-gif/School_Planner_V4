import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectDeviceKind, preferenceDocId, pickPreferences, preferencesKey, sanitizePreferences, type SyncedPreferences } from './preferenceSync';

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
  popupStyle: 'side',
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

describe('PC와 모바일 구분', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // jsdom에는 matchMedia가 없어 직접 넣어 준다
  const mockPointer = (coarse: boolean) =>
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: coarse && q.includes('coarse') }));

  it('PC와 모바일은 다른 문서에 저장한다', () => {
    expect(preferenceDocId('pc')).not.toBe(preferenceDocId('mobile'));
  });

  it('손가락이 주 입력이면 모바일이다', () => {
    mockPointer(true);
    expect(detectDeviceKind()).toBe('mobile');
  });

  it('마우스를 쓰는 데스크톱 브라우저는 창 폭과 상관없이 PC다', () => {
    mockPointer(false);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36'
    );
    expect(detectDeviceKind()).toBe('pc');
  });

  it('모바일 브라우저면 모바일이다', () => {
    mockPointer(false);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Linux; Android 15; SM-S938N) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36'
    );
    expect(detectDeviceKind()).toBe('mobile');
  });
});
