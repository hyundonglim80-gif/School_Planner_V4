import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DaySchedule from './DaySchedule';
import type { PeriodSchedule } from '../../hooks/useDayData';

const schedules: Record<number, PeriodSchedule> = {
  1: { subject: '국어', content: '받아쓰기', memo: '받아쓰기', supplies: '공책', linkedItems: [] },
  2: { subject: '수학', content: '', memo: '', supplies: '', linkedItems: [] },
};

function renderSchedule() {
  const props = {
    schedules,
    onSavePeriod: vi.fn(async () => {}),
    onReorderPeriods: vi.fn(async () => {}),
    dateStr: '2026-09-14',
    maxPeriods: 2,
  };
  return { ...render(<DaySchedule {...props} />), props };
}

describe('DaySchedule - 교시 항목 수정', () => {
  it('교시 항목을 클릭하면 그 자리에서 수정이 열린다', async () => {
    const user = userEvent.setup();
    renderSchedule();

    await user.click(screen.getByText('국어'));

    expect(await screen.findByDisplayValue('국어')).toBeInTheDocument();
    expect(screen.getByDisplayValue('공책')).toBeInTheDocument();
    expect(screen.getByDisplayValue('받아쓰기')).toBeInTheDocument();
  });

  it('수정 섹션에 링크 추가와 조사표 추가 버튼이 있다', async () => {
    const user = userEvent.setup();
    renderSchedule();

    await user.click(screen.getByText('국어'));
    await screen.findByDisplayValue('국어');

    expect(screen.getByRole('button', { name: /링크 추가/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /조사표 추가/ })).toBeInTheDocument();
  });

  it('저장하면 과목·메모·준비물을 함께 넘긴다', async () => {
    const user = userEvent.setup();
    const { props } = renderSchedule();

    await user.click(screen.getByText('국어'));
    await screen.findByDisplayValue('국어');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(props.onSavePeriod).toHaveBeenCalledTimes(1);
    const [period, data] = (props.onSavePeriod as any).mock.calls[0];
    expect(period).toBe(1);
    expect(data).toMatchObject({ subject: '국어', memo: '받아쓰기', supplies: '공책' });
  });
});
