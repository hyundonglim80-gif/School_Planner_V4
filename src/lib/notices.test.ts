import { describe, it, expect } from 'vitest';
import { draftLinesFrom, nextClassDay, numberedNotice, splitNoticeLines } from './notices';

describe('알림장', () => {
  it('줄 앞의 번호·글머리표는 떼고 빈 줄은 뺀다', () => {
    expect(splitNoticeLines('1. 색연필\n\n2) 리코더\n- 동의서\n  • 우유 ')).toEqual(['색연필', '리코더', '동의서', '우유']);
  });

  it('번호를 붙여 적는다', () => {
    expect(numberedNotice(['색연필', '리코더'])).toBe('1. 색연필\n2. 리코더');
  });

  it('다음 수업일은 주말과 쉬는 날을 건너뛴다', () => {
    // 2026-10-02 금 → 10-03(토) 10-04(일) 건너뛰고 10-05(월)
    expect(nextClassDay('2026-10-02', () => false)).toBe('2026-10-05');
    // 10-05가 쉬는 날이면 10-06
    expect(nextClassDay('2026-10-02', (d) => d === '2026-10-05')).toBe('2026-10-06');
    // 2주 내내 쉬면 없다
    expect(nextClassDay('2026-10-02', () => true)).toBeNull();
  });

  it('준비물과 일정으로 초안을 만든다 (수업 메모·완료·공휴일은 뺀다)', () => {
    const schedules = {
      periods: {
        2: { subject: '미술', supplies: '색연필', memo: '교사용 메모' },
        1: { subject: '국어', supplies: '' },
        3: { subject: '음악', supplies: '리코더' },
      },
    };
    const events = {
      eventList: [
        { id: 'a', content: '[달력] 현장체험학습 동의서 제출' },
        { id: 'b', content: '끝난 일', completed: true },
        { id: 'c', content: '개천절', label: '휴일' },
      ],
    };
    expect(draftLinesFrom(schedules, events)).toEqual(['미술 준비물: 색연필', '음악 준비물: 리코더', '현장체험학습 동의서 제출']);
  });
});
