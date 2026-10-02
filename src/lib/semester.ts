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

/**
 * 학년도 범위 (3월 1일 ~ 이듬해 2월 말일 - 윤년이면 29일).
 * 예전에는 곳곳에서 2월 28일로 끝내 윤년의 2월 29일 자료가 검색·링크·내보내기에서 빠졌다.
 * (날짜 칸에 그대로 보이므로 없는 날 '2027-02-29'를 쓰지 않는다 - 날짜 칸이 비어 버린다)
 */
export function schoolYearSpan(year: number): { start: string; end: string } {
  const febLast = new Date(year + 1, 2, 0).getDate();
  return { start: `${year}-03-01`, end: `${year + 1}-02-${febLast}` };
}

/**
 * 그 학년도의 1·2학기 범위 (검색·링크·내보내기·출석 누계의 '1학기 / 2학기').
 * evalSummary.semesterOf와 같은 규칙으로 학년도를 빈틈없이 나눈다:
 *   그 학년도의 방학 설정이 있으면 2학기 = 여름 방학 끝난 다음 날 ~ 2월 끝, 1학기 = 3월 1일 ~ 그 전날.
 *   (여름 방학은 1학기, 겨울 방학과 2월은 2학기 쪽 - 방학 중에 적은 것도 어느 학기엔가 들어간다)
 *   설정이 없거나 다른 학년도의 설정이면 3~8월이 1학기, 9월 ~ 2월이 2학기.
 * 예전에는 화면마다 '8/15까지', '8/31까지'로 따로 정했고, 1~2월에 열면 달력의 해로 셈해 다음 학년도를 찾았다.
 */
export function semesterSpan(year: number, sem: 1 | 2, cfg?: SemesterConfig | null): { start: string; end: string } {
  const all = schoolYearSpan(year);
  let sem2Start = `${year}-09-01`;
  if (cfg?.summerStart && cfg.summerEnd && Number(cfg.summerStart.slice(0, 4)) === year) {
    const s = shiftDate(cfg.summerEnd, 1);
    if (s) sem2Start = s;
  }
  return sem === 1 ? { start: all.start, end: shiftDate(sem2Start, -1) } : { start: sem2Start, end: all.end };
}

/** 그 날이 방학인지 (방학에는 시간표 수업을 채우지 않는다) */
export function isVacationDay(dateStr: string, cfg: SemesterConfig): boolean {
  const inRange = (start?: string, end?: string) =>
    !!start && !!end && dateStr >= start && dateStr <= end;
  return inRange(cfg.summerStart, cfg.summerEnd) || inRange(cfg.winterStart, cfg.winterEnd);
}
