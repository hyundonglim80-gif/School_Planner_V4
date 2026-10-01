import { describe, it, expect } from 'vitest';
import { mapEvents } from './useCalendarData';
import { isCalendarVisible } from '../lib/eventLabels';

const labels = [{ id: 'ev_1', name: '달력', color: 'red', calendar: true }] as any[];

describe('mapEvents (달력 요약)', () => {
  it('일정마다 끈 달력·기간 묶음을 옮긴다', () => {
    const [off, on, plain] = mapEvents({
      eventList: [
        { id: 'a', content: '끈 것', label: '달력', labelIds: ['ev_1'], calendar: false },
        { id: 'b', content: '시험 (1/2)', groupId: 'g1', period: true, calendar: true },
        { id: 'c', content: 'V3 일정', label: '달력', labelIds: ['ev_1'] },
      ],
    });
    expect(off.calendar).toBe(false);
    expect(isCalendarVisible(off, labels)).toBe(false);
    expect(on).toMatchObject({ groupId: 'g1', period: true, calendar: true });
    // 칸이 없으면(V3) 라벨을 따른다
    expect('calendar' in plain).toBe(false);
    expect(isCalendarVisible(plain, labels)).toBe(true);
  });
});
