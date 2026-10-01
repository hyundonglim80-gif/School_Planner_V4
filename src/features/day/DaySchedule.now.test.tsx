import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DaySchedule from './DaySchedule';
import type { PeriodSchedule } from '../../hooks/useDayData';

// 지금 몇 교시 (docs/ROADMAP.md 2-2): 교시 시각을 적어 두면 오늘 하루 화면이 지금 교시·다음 교시를 짚는다.

const timesStore = vi.hoisted(() => ({ times: {} as Record<string, { start: string; end: string }> }));
vi.mock('../../hooks/usePeriodTimes', () => ({
  usePeriodTimes: () => ({ times: timesStore.times, loaded: true }),
  savePeriodTimes: vi.fn(),
}));

const schedules: Record<number, PeriodSchedule> = {
  1: { subject: '국어', content: '', memo: '', supplies: '', linkedItems: [] },
  2: { subject: '과학', content: '', memo: '', supplies: '돋보기', linkedItems: [] },
  3: { subject: '음악', content: '', memo: '', supplies: '', linkedItems: [] },
};
const TIMES = {
  '1': { start: '09:00', end: '09:40' },
  '2': { start: '09:50', end: '10:30' },
  '3': { start: '10:40', end: '11:20' },
};

const renderAt = (dateStr: string) =>
  render(
    <DaySchedule schedules={schedules} onSavePeriod={vi.fn(async () => {})} onReorderPeriods={vi.fn(async () => {})} dateStr={dateStr} maxPeriods={3} />
  );
const cardOf = (subject: string) => screen.getByText(subject).closest('[title="클릭하여 수정"]') as HTMLElement;

beforeEach(() => {
  timesStore.times = TIMES;
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => vi.useRealTimers());

describe('지금 몇 교시', () => {
  it('교시 중이면 그 교시를 짚고 남은 분을 적는다', () => {
    vi.setSystemTime(new Date(2026, 9, 1, 9, 10));
    renderAt('2026-10-01');
    expect(cardOf('국어').dataset.now).toBe('true');
    expect(cardOf('국어')).toHaveTextContent('지금 · 30분 남음');
    expect(screen.getByText(/지금 1교시 국어 · 30분 남음/)).toBeInTheDocument();
    // 교시 칩 옆에 시각
    expect(cardOf('과학')).toHaveTextContent('09:50~10:30');
  });

  it('쉬는 시간에는 다음 교시와 그 준비물을 알려 준다', () => {
    vi.setSystemTime(new Date(2026, 9, 1, 9, 45));
    renderAt('2026-10-01');
    expect(cardOf('과학').dataset.now).toBe('next');
    expect(cardOf('과학')).toHaveTextContent('다음 · 5분 뒤');
    expect(screen.getByText(/쉬는 시간 · 다음 2교시 과학 5분 뒤 · 준비물 돋보기/)).toBeInTheDocument();
  });

  it('다른 날을 볼 때는 짚지 않는다 (시각만 보인다)', () => {
    vi.setSystemTime(new Date(2026, 9, 1, 9, 10));
    renderAt('2026-10-02');
    expect(cardOf('국어').dataset.now).toBeUndefined();
    expect(screen.queryByText(/지금 ·/)).not.toBeInTheDocument();
    expect(cardOf('국어')).toHaveTextContent('09:00~09:40');
  });

  it('교시 시각을 적지 않았으면 아무것도 보이지 않는다', () => {
    timesStore.times = {};
    vi.setSystemTime(new Date(2026, 9, 1, 9, 10));
    renderAt('2026-10-01');
    expect(cardOf('국어').dataset.now).toBeUndefined();
    expect(screen.queryByText(/🕘/)).not.toBeInTheDocument();
    expect(cardOf('국어')).not.toHaveTextContent('09:00');
  });
});
