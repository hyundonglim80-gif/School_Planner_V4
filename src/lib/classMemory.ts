// src/lib/classMemory.ts
//
// 학급 화면(ROADMAP 16)에서 고른 학급. 학급 도구(자리표·출석부·평가 모아 보기·학생 누가기록)는 저마다 마지막에 연 학급을
// 이 기기에 따로 기억한다. 학급 화면에서 학급을 고르면 그 자리에 함께 적어, 학급 화면에서 연 도구가 그 학급으로 열린다.
// (도구 안에서 학급을 바꾸면 그 도구의 기억만 바뀐다 - 예전과 같다.)

export const CLASS_HUB_KEY = 'sp4-class-hub';
/** 도구마다 마지막 학급을 적는 자리 (SeatingModal·AttendanceDrawer·EvalOverviewModal·StudentRecordModal) */
export const TOOL_CLASS_KEYS = ['sp4-seating-class', 'sp4-attendance-class', 'sp4-eval-overview-class', 'sp4-student-record'];

export function readHubClass(): string | null {
  try {
    return localStorage.getItem(CLASS_HUB_KEY) || localStorage.getItem('sp4-attendance-class') || localStorage.getItem('sp4-seating-class');
  } catch {
    return null;
  }
}

/** 학급 화면에서 고른 학급을 학급 도구들도 쓰게 적는다 */
export function rememberHubClass(classKey: string) {
  try {
    localStorage.setItem(CLASS_HUB_KEY, classKey);
    for (const k of TOOL_CLASS_KEYS) localStorage.setItem(k, classKey);
  } catch {
    /* 저장하지 못하면 도구는 제 기억대로 연다 */
  }
}
