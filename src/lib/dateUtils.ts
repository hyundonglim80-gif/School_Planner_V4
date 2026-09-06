/**
 * 날짜 관련 종합 유틸리티 함수 모음
 */

export function formatDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateStr(date: Date = new Date()): string {
  return formatDate(date);
}

export function parseDateStr(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatDisplayDate(dateStr: string): {
  year: number;
  month: number;
  day: number;
  dayName: string;
  isWeekend: boolean;
  isSunday: boolean;
  isSaturday: boolean;
  fullString: string;
} {
  const date = parseDateStr(dateStr);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dayIdx = date.getDay();
  const dayName = dayNames[dayIdx];
  const isSunday = dayIdx === 0;
  const isSaturday = dayIdx === 6;
  const isWeekend = isSunday || isSaturday;

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    dayName,
    isWeekend,
    isSunday,
    isSaturday,
    fullString: `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${dayName})`
  };
}

export function addDays(dateStr: string, days: number): string {
  const date = parseDateStr(dateStr);
  date.setDate(date.getDate() + days);
  return formatDateStr(date);
}

export function isToday(dateStr: string): boolean {
  return dateStr === formatDateStr(new Date());
}

/**
 * 특정 연도와 월(1~12)의 달력 날짜 목록 생성 (6주 42칸 기본 그리드)
 */
export interface CalendarDay {
  dateStr: string;
  day: number;
  month: number;
  year: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSunday: boolean;
  isSaturday: boolean;
  holidayName?: string;
}

// 한국 주요 고정 공휴일 (월-일 기준)
const FIXED_HOLIDAYS: Record<string, string> = {
  '01-01': '신정',
  '03-01': '삼일절',
  '05-05': '어린이날',
  '06-06': '현충일',
  '08-15': '광복절',
  '10-03': '개천절',
  '10-09': '한글날',
  '12-25': '성탄절',
};

export function getHolidayName(dateStr: string): string | undefined {
  const mmDd = dateStr.substring(5);
  return FIXED_HOLIDAYS[mmDd];
}

export function getMonthCalendarDays(year: number, month: number): CalendarDay[] {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  const startDayOfWeek = firstDay.getDay(); // 0: 일요일
  const daysInMonth = lastDay.getDate();

  const days: CalendarDay[] = [];

  // 이전 달 채움
  const prevMonthLastDay = new Date(year, month - 1, 0).getDate();
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthLastDay - i;
    const prevDate = new Date(year, month - 2, d);
    const dateStr = formatDateStr(prevDate);
    days.push({
      dateStr,
      day: d,
      month: prevDate.getMonth() + 1,
      year: prevDate.getFullYear(),
      isCurrentMonth: false,
      isToday: isToday(dateStr),
      isSunday: prevDate.getDay() === 0,
      isSaturday: prevDate.getDay() === 6,
      holidayName: getHolidayName(dateStr),
    });
  }

  // 이번 달
  for (let d = 1; d <= daysInMonth; d++) {
    const curDate = new Date(year, month - 1, d);
    const dateStr = formatDateStr(curDate);
    days.push({
      dateStr,
      day: d,
      month,
      year,
      isCurrentMonth: true,
      isToday: isToday(dateStr),
      isSunday: curDate.getDay() === 0,
      isSaturday: curDate.getDay() === 6,
      holidayName: getHolidayName(dateStr),
    });
  }

  // 다음 달 채움 (총 35일 또는 42일로 맞춤)
  const totalSlots = days.length > 35 ? 42 : 35;
  const nextMonthDaysCount = totalSlots - days.length;
  for (let d = 1; d <= nextMonthDaysCount; d++) {
    const nextDate = new Date(year, month, d);
    const dateStr = formatDateStr(nextDate);
    days.push({
      dateStr,
      day: d,
      month: nextDate.getMonth() + 1,
      year: nextDate.getFullYear(),
      isCurrentMonth: false,
      isToday: isToday(dateStr),
      isSunday: nextDate.getDay() === 0,
      isSaturday: nextDate.getDay() === 6,
      holidayName: getHolidayName(dateStr),
    });
  }

  return days;
}

/**
 * 기준 날짜가 속한 주의 날짜 목록 생성 (월요일 시작 기본, 일요일까지 7일)
 */
export function getWeekDays(baseDate: Date): { dateStr: string; dayName: string; isToday: boolean; isWeekend: boolean }[] {
  const date = new Date(baseDate);
  const day = date.getDay();
  // 월요일을 0으로 맞춤 (일요일은 6)
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);

  const dayNames = ['월', '화', '수', '목', '금', '토', '일'];
  const weekDays = [];

  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    const dateStr = formatDateStr(cur);
    const curDayOfWeek = cur.getDay();
    weekDays.push({
      dateStr,
      dayName: dayNames[i],
      isToday: isToday(dateStr),
      isWeekend: curDayOfWeek === 0 || curDayOfWeek === 6,
    });
  }

  return weekDays;
}

/**
 * 학사년도(3월 ~ 익년 2월) 계산 및 12개월 정보 반환
 */
export interface AcademicMonthInfo {
  year: number;
  month: number;
  label: string;
  semester: 1 | 2;
  isCurrent: boolean;
}

export function getAcademicYear(date: Date = new Date()): number {
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  return m < 3 ? y - 1 : y;
}

export function getAcademicMonths(academicYear: number): AcademicMonthInfo[] {
  const today = new Date();
  const currentY = today.getFullYear();
  const currentM = today.getMonth() + 1;

  const months: AcademicMonthInfo[] = [];

  // 1학기: 3월 ~ 8월
  for (let m = 3; m <= 8; m++) {
    months.push({
      year: academicYear,
      month: m,
      label: `${m}월`,
      semester: 1,
      isCurrent: academicYear === currentY && m === currentM,
    });
  }

  // 2학기: 9월 ~ 12월
  for (let m = 9; m <= 12; m++) {
    months.push({
      year: academicYear,
      month: m,
      label: `${m}월`,
      semester: 2,
      isCurrent: academicYear === currentY && m === currentM,
    });
  }

  // 2학기 (익년): 1월 ~ 2월
  for (let m = 1; m <= 2; m++) {
    months.push({
      year: academicYear + 1,
      month: m,
      label: `${m}월`,
      semester: 2,
      isCurrent: academicYear + 1 === currentY && m === currentM,
    });
  }

  return months;
}
