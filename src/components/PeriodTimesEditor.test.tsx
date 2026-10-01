import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PeriodTimesEditor from './PeriodTimesEditor';
import { savePeriodTimes } from '../hooks/usePeriodTimes';

// 시간표 설정의 '교시 시각' 칸 (docs/ROADMAP.md 2-2)

const timesStore = vi.hoisted(() => ({ times: {} as Record<string, { start: string; end: string }>, loaded: true }));
vi.mock('../hooks/usePeriodTimes', () => ({
  // 그릴 때마다 같은 객체를 준다 (새 객체면 채우기가 매번 다시 돈다 - CLAUDE.md 라벨 트리 교훈)
  usePeriodTimes: () => timesStore,
  savePeriodTimes: vi.fn(async () => {}),
}));

const NAMES = ['1교시', '2교시', '3교시', '4교시', '5교시'];

beforeEach(() => {
  vi.mocked(savePeriodTimes).mockClear();
  timesStore.times = {};
  timesStore.loaded = true;
});

describe('교시 시각 칸', () => {
  it('빠르게 채우기로 모든 교시를 채우고, 저장하면 그 시각을 쓴다', async () => {
    render(<PeriodTimesEditor periodNames={NAMES} />);
    fireEvent.click(screen.getByRole('button', { name: '채우기' }));

    expect((screen.getByLabelText('1교시 시작') as HTMLInputElement).value).toBe('09:00');
    expect((screen.getByLabelText('4교시 끝') as HTMLInputElement).value).toBe('12:10');
    // 점심(4교시 뒤 50분)
    expect((screen.getByLabelText('5교시 시작') as HTMLInputElement).value).toBe('13:00');

    fireEvent.click(screen.getByRole('button', { name: '교시 시각 저장' }));
    await waitFor(() => expect(savePeriodTimes).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(savePeriodTimes).mock.calls[0][0];
    expect(Object.keys(saved)).toEqual(['1', '2', '3', '4', '5']);
    expect(saved['5']).toEqual({ start: '13:00', end: '13:40' });
  });

  it('끝이 시작보다 이른 교시가 있으면 저장하지 않는다', async () => {
    timesStore.times = { '1': { start: '09:00', end: '09:40' } };
    render(<PeriodTimesEditor periodNames={NAMES} />);
    fireEvent.change(screen.getByLabelText('2교시 시작'), { target: { value: '10:30' } });
    fireEvent.change(screen.getByLabelText('2교시 끝'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '교시 시각 저장' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(savePeriodTimes).not.toHaveBeenCalled();
  });

  it('저장된 시각을 불러오기 전에는 저장할 수 없다', () => {
    timesStore.loaded = false;
    render(<PeriodTimesEditor periodNames={NAMES} />);
    expect(screen.getByRole('button', { name: '교시 시각 저장' })).toBeDisabled();
  });
});
