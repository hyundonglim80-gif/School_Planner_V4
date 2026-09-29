// src/lib/preferenceSync.ts
//
// 환경설정(단축키, 화면 보기, 시작 화면, 글자 크기 ...)을 계정에 붙여 둔다.
//
// 예전에는 이 값들이 브라우저 localStorage에만 있어서, 다른 기기에서 로그인하면
// 전부 기본값으로 시작했다. 이제 계정에 두고, 로그인하면 그 값을 받아 쓰며,
// 바꾸면 거기에 다시 적는다.
//
// PC와 모바일은 따로 둔다. 화면 크기도 손에 쥐는 방식도 달라, 휴대폰에서 글자를
// 키우거나 주말을 숨긴 것이 PC까지 따라오면 곤란하다.
//   users/{uid}/settings/v4_preferences_pc
//   users/{uid}/settings/v4_preferences_mobile
//
// ⚠️ 'preferences' 문서는 V3가 D-Day 목록 등을 적는 자리라 쓰지 않는다.
//    같은 문서를 나눠 쓰면 한쪽이 통째로 덮어쓸 때 다른 쪽 값이 날아간다.
//
// 지금 보고 있는 화면(scope)과 날짜는 넣지 않는다. 설정이 아니라 '어디까지
// 봤나'여서, 기기마다 따로 두는 것이 맞다.

import { FONT_SCALES, type FontScale } from './fontScale';
import { clampLookbackDays } from './forwarding';
import type { ShortcutOverrides } from './shortcuts';

export type DeviceKind = 'pc' | 'mobile';

/** 기기별로 나누기 전에 한 벌만 두던 문서. 기기별 문서가 없을 때 한 번 옮겨 온다. */
export const LEGACY_PREFERENCE_DOC_ID = 'v4_preferences';

export function preferenceDocId(kind: DeviceKind): string {
  return `v4_preferences_${kind}`;
}

/**
 * 이 기기가 PC인가 모바일인가.
 *
 * ⚠️ 화면 폭(useIsMobile)으로 가르면 안 된다. PC에서 창을 좁히기만 해도
 *    모바일 설정으로 넘어가 버린다. 주 입력이 손가락인지, 모바일 브라우저인지로 본다.
 *    (태블릿은 모바일 쪽에 든다)
 */
export function detectDeviceKind(): DeviceKind {
  if (typeof window === 'undefined') return 'pc';
  try {
    if (window.matchMedia?.('(pointer: coarse)').matches) return 'mobile';
  } catch {
    /* matchMedia가 없는 환경 */
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ? 'mobile' : 'pc';
}

/** 팝업을 화면 오른쪽 칸에 띄울지(side), 예전처럼 가운데에 띄울지(center) */
export type PopupStyle = 'side' | 'center';

export interface SyncedPreferences {
  semesterFilter: 'all' | 1 | 2;
  showWeekend: boolean;
  showClass: boolean;
  showEvents: boolean;
  enableScrollNav: boolean;
  startupScope: 'last' | 'day' | 'week' | 'month' | 'year' | 'memo';
  fontScale: FontScale;
  forwardLookbackDays: number;
  shortcutOverrides: ShortcutOverrides;
  popupStyle: PopupStyle;
}

export const SYNCED_PREFERENCE_KEYS = [
  'semesterFilter',
  'showWeekend',
  'showClass',
  'showEvents',
  'enableScrollNav',
  'startupScope',
  'fontScale',
  'forwardLookbackDays',
  'shortcutOverrides',
  'popupStyle',
] as const satisfies ReadonlyArray<keyof SyncedPreferences>;

/** 스토어 상태에서 계정에 붙여 둘 값만 골라낸다 */
export function pickPreferences(state: SyncedPreferences): SyncedPreferences {
  const out = {} as Record<string, unknown>;
  for (const key of SYNCED_PREFERENCE_KEYS) out[key] = state[key];
  return out as unknown as SyncedPreferences;
}

/** 비교용. 키 순서가 달라도 같은 값이면 같은 문자열이 나오게 한다 */
export function preferencesKey(prefs: SyncedPreferences): string {
  return JSON.stringify(SYNCED_PREFERENCE_KEYS.map((k) => prefs[k]));
}

const STARTUP_SCOPES = ['last', 'day', 'week', 'month', 'year', 'memo'];

/**
 * 클라우드에서 읽은 값 중 믿을 만한 것만 돌려준다.
 *
 * 다른 버전의 앱이 적었거나 손으로 고친 문서일 수 있다. 모양이 틀린 값을
 * 그대로 스토어에 넣으면 화면이 깨지므로, 틀린 항목은 빼고 이 기기 값을 둔다.
 */
export function sanitizePreferences(data: unknown): Partial<SyncedPreferences> {
  if (!data || typeof data !== 'object') return {};
  const d = data as Record<string, unknown>;
  const out: Partial<SyncedPreferences> = {};

  if (d.semesterFilter === 'all' || d.semesterFilter === 1 || d.semesterFilter === 2) {
    out.semesterFilter = d.semesterFilter;
  }
  for (const key of ['showWeekend', 'showClass', 'showEvents', 'enableScrollNav'] as const) {
    if (typeof d[key] === 'boolean') out[key] = d[key] as boolean;
  }
  if (typeof d.startupScope === 'string' && STARTUP_SCOPES.includes(d.startupScope)) {
    out.startupScope = d.startupScope as SyncedPreferences['startupScope'];
  }
  if (typeof d.fontScale === 'string' && FONT_SCALES.some((s) => s.id === d.fontScale)) {
    out.fontScale = d.fontScale as FontScale;
  }
  if (d.popupStyle === 'side' || d.popupStyle === 'center') {
    out.popupStyle = d.popupStyle;
  }
  if (d.forwardLookbackDays !== undefined && d.forwardLookbackDays !== null) {
    out.forwardLookbackDays = clampLookbackDays(d.forwardLookbackDays);
  }
  if (d.shortcutOverrides && typeof d.shortcutOverrides === 'object' && !Array.isArray(d.shortcutOverrides)) {
    const overrides: Record<string, unknown> = {};
    for (const [id, b] of Object.entries(d.shortcutOverrides as Record<string, unknown>)) {
      const binding = b as Record<string, unknown> | null;
      if (
        binding &&
        typeof binding === 'object' &&
        typeof binding.key === 'string' &&
        typeof binding.ctrl === 'boolean' &&
        typeof binding.alt === 'boolean' &&
        typeof binding.shift === 'boolean'
      ) {
        overrides[id] = { key: binding.key, ctrl: binding.ctrl, alt: binding.alt, shift: binding.shift };
      }
    }
    out.shortcutOverrides = overrides as ShortcutOverrides;
  }
  return out;
}
