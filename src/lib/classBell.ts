// src/lib/classBell.ts
//
// 수업 종 (2026-10-07 사용자 요청). 교시 시각(lib/periodTimes)에 맞춰 종을 울린다 - 순수한 셈만, 소리·시계는 hooks/useClassBell.
//
// 저장: users/{uid}/settings/v4_classBell (V4 전용) =
//   { enabled, start: { on, amount, unit, when }, end: { on, amount, unit, when }, weekdaysOnly, updatedAt }
//   start: 교시 시작 종, end: 교시 끝 종. amount·unit(분/초)·when(전/후)으로 시각을 당기거나 미룬다 (0이면 그 시각).
// 이 기기에서만 끄기는 localStorage(BELL_MUTE_KEY) - 교실 PC에서만 울리고 집 PC·휴대폰은 조용히.
import { validPeriods, type PeriodTimes } from './periodTimes';

export type BellUnit = 'min' | 'sec';
export type BellWhen = 'before' | 'after';

export interface BellPoint {
  on: boolean;
  amount: number;
  unit: BellUnit;
  when: BellWhen;
}

export interface ClassBellSettings {
  enabled: boolean;
  start: BellPoint;
  end: BellPoint;
  /** 토·일에는 울리지 않는다 (처음 켬) */
  weekdaysOnly: boolean;
}

export const DEFAULT_BELL: ClassBellSettings = {
  enabled: false,
  start: { on: true, amount: 0, unit: 'min', when: 'before' },
  end: { on: true, amount: 0, unit: 'min', when: 'after' },
  weekdaysOnly: true,
};

export const BELL_MUTE_KEY = 'sp4-class-bell-muted';

const point = (raw: any, fallback: BellPoint): BellPoint => ({
  on: typeof raw?.on === 'boolean' ? raw.on : fallback.on,
  amount: Number.isFinite(Number(raw?.amount)) ? Math.max(0, Math.min(3600, Math.round(Number(raw.amount)))) : fallback.amount,
  unit: raw?.unit === 'sec' ? 'sec' : raw?.unit === 'min' ? 'min' : fallback.unit,
  when: raw?.when === 'after' ? 'after' : raw?.when === 'before' ? 'before' : fallback.when,
});

/** 저장된 모양을 믿지 않고 고쳐 읽는다 */
export function sanitizeBell(raw: unknown): ClassBellSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any;
  return {
    enabled: !!r.enabled,
    start: point(r.start, DEFAULT_BELL.start),
    end: point(r.end, DEFAULT_BELL.end),
    weekdaysOnly: typeof r.weekdaysOnly === 'boolean' ? r.weekdaysOnly : true,
  };
}

/** 당기거나 미루는 초 (전이면 -) */
export function offsetSeconds(p: BellPoint): number {
  const s = p.amount * (p.unit === 'min' ? 60 : 1);
  return p.when === 'before' ? -s : s;
}

export interface BellTime {
  /** 하루의 초 (0 ~ 86399) */
  at: number;
  period: number;
  kind: 'start' | 'end';
}

/** 오늘 울릴 종 - 시각 차례. 교시 시각이 없으면 빈 목록 */
export function bellTimes(times: PeriodTimes | undefined | null, cfg: ClassBellSettings, count?: number): BellTime[] {
  if (!cfg.enabled) return [];
  const out: BellTime[] = [];
  for (const p of validPeriods(times, count)) {
    if (cfg.start.on) out.push({ at: p.start * 60 + offsetSeconds(cfg.start), period: p.period, kind: 'start' });
    if (cfg.end.on) out.push({ at: p.end * 60 + offsetSeconds(cfg.end), period: p.period, kind: 'end' });
  }
  return out.filter((b) => b.at >= 0 && b.at < 86400).sort((a, b) => a.at - b.at);
}

/** (지난번 본 초, 지금 초] 사이에 든 종. 시계를 건너뛰어도(탭이 잠들었다 깨도) 60초가 넘게 지난 종은 울리지 않는다 */
export function bellsDue(list: BellTime[], prevSec: number, nowSec: number): BellTime[] {
  if (nowSec <= prevSec) return [];
  const from = Math.max(prevSec, nowSec - 60);
  return list.filter((b) => b.at > from && b.at <= nowSec);
}

/** 오늘이 울리는 날인가 */
export function bellDay(cfg: ClassBellSettings, now: Date): boolean {
  if (!cfg.enabled) return false;
  const d = now.getDay();
  return !(cfg.weekdaysOnly && (d === 0 || d === 6));
}

/** 알림 글: '2교시 시작', '2교시 끝 (1분 전)' */
export function bellMessage(b: BellTime, cfg: ClassBellSettings, periodName?: string): string {
  const p = b.kind === 'start' ? cfg.start : cfg.end;
  const name = periodName || `${b.period}교시`;
  const off = p.amount > 0 ? ` (${p.amount}${p.unit === 'min' ? '분' : '초'} ${p.when === 'before' ? '전' : '후'})` : '';
  return `${name} ${b.kind === 'start' ? '시작' : '끝'}${off}`;
}
