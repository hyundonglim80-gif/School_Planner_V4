import { formatDate } from './dateUtils';

// 학기는 직접 입력하지 않고 방학 기간에서 계산한다.
//   1학기 = 3월 1일 ~ 여름방학 시작 전날
//   2학기 = 여름방학 끝난 다음 날 ~ 겨울방학 시작 전날
export interface SemesterConfig {
  summerStart: string; // 여름 방학 시작일
  summerEnd: string;   // 여름 방학 종료일
  winterStart: string; // 겨울 방학 시작일
  winterEnd: string;   // 겨울 방학 종료일

  // 예전 문서에 남아 있는 학기 직접 입력값 (읽기 전용, 더 이상 쓰지 않음)
  sem1Start?: string;
  sem1End?: string;
  sem2Start?: string;
  sem2End?: string;
}

export const DEFAULT_SEMESTER_CONFIG: SemesterConfig = {
  summerStart: `${new Date().getFullYear()}-07-21`,
  summerEnd: `${new Date().getFullYear()}-08-16`,
  winterStart: `${new Date().getFullYear() + 1}-01-05`,
  winterEnd: `${new Date().getFullYear() + 1}-02-28`,
};

/** 날짜 문자열을 days만큼 이동시킨다. */
export function shiftDate(dateStr: string, days: number): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

/** 방학 기간에서 1·2학기 기간을 계산한다. */
export function getSemesterRanges(cfg: SemesterConfig) {
  const year = cfg.summerStart
    ? Number(cfg.summerStart.slice(0, 4))
    : new Date().getFullYear();
  return {
    sem1: {
      start: `${year}-03-01`,
      end: shiftDate(cfg.summerStart, -1),
    },
    sem2: {
      start: shiftDate(cfg.summerEnd, 1),
      end: shiftDate(cfg.winterStart, -1),
    },
  };
}

/** 그 날이 방학인지 (방학에는 시간표 수업을 채우지 않는다) */
export function isVacationDay(dateStr: string, cfg: SemesterConfig): boolean {
  const inRange = (start?: string, end?: string) =>
    !!start && !!end && dateStr >= start && dateStr <= end;
  return inRange(cfg.summerStart, cfg.summerEnd) || inRange(cfg.winterStart, cfg.winterEnd);
}
