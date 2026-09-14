// 공휴일 일정을 알아보는 규칙을 한곳에 모은다.
//
// 💡 공휴일은 날짜 옆에 빨간 글씨로 이름이 나오므로, 같은 내용을 일정 목록에도
// 보여주면 중복된다. 그래서 공휴일로 표시된 일정은 목록에서 감추고 이름만 쓴다.
// 예전에는 '휴일'이라는 이름만 찾았는데, 실제 데이터(공휴일 가져오기)는
// '공휴일'로 저장되어 하나도 걸리지 않았다.

const HOLIDAY_LABEL_NAMES = ['공휴일', '휴일'];

export function isHolidayEvent(ev: any): boolean {
  if (!ev) return false;
  const names: string[] = [];
  if (ev.label) names.push(...String(ev.label).split(',').map((x: string) => x.trim()));
  if (Array.isArray(ev.labelIds)) names.push(...ev.labelIds.map((x: any) => String(x)));
  return names.some((n) => HOLIDAY_LABEL_NAMES.includes(n));
}

/** 공휴일 일정을 제외한 목록과, 거기서 얻은 공휴일 이름을 함께 돌려준다. */
export function splitHolidayEvents<T>(rawEvents: T[]): { events: T[]; holidayName?: string } {
  const holiday = (rawEvents as any[]).find(isHolidayEvent);
  return {
    events: (rawEvents as any[]).filter((e) => !isHolidayEvent(e)) as T[],
    holidayName: holiday?.content || undefined,
  };
}

// ── 날짜 칸 색 규칙 ──────────────────────────────────────────────────────
// 토요일은 파랑, 일요일과 공휴일은 빨강. 주간/월간/년간이 같은 규칙을 쓴다.
// 예전에는 화면마다 조건과 색이 조금씩 달라(어떤 곳은 글자만, 어떤 곳은 배경까지)
// 같은 날이 화면마다 다르게 보였다.

export interface DayToneInput {
  isSunday?: boolean;
  isSaturday?: boolean;
  /** 공휴일 이름이 있으면 공휴일로 본다 */
  holidayName?: string | null;
}

export type DayTone = 'holiday' | 'saturday' | 'normal';

export function dayToneOf({ isSunday, isSaturday, holidayName }: DayToneInput): DayTone {
  if (holidayName || isSunday) return 'holiday';
  if (isSaturday) return 'saturday';
  return 'normal';
}

/** 날짜 숫자 글자색 */
export const DAY_NUMBER_COLOR: Record<DayTone, string> = {
  holiday: 'text-red-500',
  saturday: 'text-blue-500',
  normal: 'text-slate-700',
};

/** 날짜 칸 배경색 (연하게) */
export const DAY_CELL_BG: Record<DayTone, string> = {
  holiday: 'bg-red-50/70',
  saturday: 'bg-blue-50/70',
  normal: 'bg-white',
};

/** 요일 머리글 글자색 */
export const WEEKDAY_HEADER_COLOR: Record<DayTone, string> = {
  holiday: 'text-red-500',
  saturday: 'text-blue-500',
  normal: 'text-slate-700',
};
