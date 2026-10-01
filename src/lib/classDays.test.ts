import { describe, it, expect } from 'vitest';
import { classOffReason, eventSkipsClass } from './classDays';

// 수업이 없는 날 - 시간표 적용과 진도 세기가 같이 쓴다 (docs/ROADMAP.md 5-1)

const semesterConfig = {
  summerStart: '2026-07-21',
  summerEnd: '2026-08-16',
  winterStart: '2027-01-05',
  winterEnd: '2027-02-28',
};
const eventLabels = [
  { id: 'ev_1', name: '회의', skip: false },
  { id: 'lbl_ev_skip', name: '수업X', skip: true },
];
const rules = { semesterConfig, holidays: { '2026-10-09': '한글날' }, eventLabels };

describe('수업이 없는 날', () => {
  it('방학·공휴일', () => {
    expect(classOffReason('2026-07-21', null, rules)).toBe('vacation');
    expect(classOffReason('2027-01-20', null, rules)).toBe('vacation');
    expect(classOffReason('2026-10-09', null, rules)).toBe('holiday');
    expect(classOffReason('2026-10-08', null, rules)).toBeNull();
  });

  it('V3 시절의 공휴일 일정(라벨 공휴일)도 공휴일', () => {
    expect(classOffReason('2026-10-08', { eventList: [{ id: 'a', content: '임시공휴일', label: '공휴일' }] }, rules)).toBe('holiday');
  });

  it('수업X 일정 - V4는 일정에 skip, V3는 라벨(labelIds)로만', () => {
    expect(classOffReason('2026-10-08', { eventList: [{ id: 'a', content: '운동회', skip: true }] }, rules)).toBe('skip');
    expect(classOffReason('2026-10-08', { eventList: [{ id: 'a', content: '운동회', labelIds: ['lbl_ev_skip'] }] }, rules)).toBe('skip');
    // V3 옛 글만 있는 날 ('[수업X] 운동회')
    expect(classOffReason('2026-10-08', { eventText: '[수업X] 운동회' }, rules)).toBe('skip');
    expect(classOffReason('2026-10-08', { eventList: [{ id: 'a', content: '학년 회의', labelIds: ['ev_1'] }] }, rules)).toBeNull();
  });

  it("내용에 '휴업'이 들면 비운다", () => {
    expect(classOffReason('2026-10-08', { eventList: [{ id: 'a', content: '재량휴업일' }] }, rules)).toBe('skip');
  });

  it('일정마다 끈 수업X는 라벨보다 앞선다', () => {
    expect(eventSkipsClass({ content: '운동회', labelIds: ['lbl_ev_skip'], skip: false }, eventLabels)).toBe(false);
    expect(eventSkipsClass({ content: '운동회', labelIds: ['lbl_ev_skip'], isSkip: false }, eventLabels)).toBe(false);
    expect(eventSkipsClass({ content: '운동회', label: '수업X' }, eventLabels)).toBe(true);
    expect(eventSkipsClass({ content: '운동회', label: '수업X' }, [])).toBe(false);
  });

  it('주말은 여기서 보지 않는다 (부르는 쪽이 정한다)', () => {
    expect(classOffReason('2026-10-10', null, rules)).toBeNull();
  });
});
