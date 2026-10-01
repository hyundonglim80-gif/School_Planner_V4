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

describe('DaySchedule - 상단 링크 버튼 제거 / 바깥 클릭으로 닫기', () => {
  it("상단에 '+ 링크' 버튼이 없다 (교시마다 링크 아이콘이 있으므로)", () => {
    renderSchedule();
    expect(screen.queryByText('+ 링크')).toBeNull();
  });

  it('페이지의 다른 곳을 누르면 수정 섹션이 닫힌다', async () => {
    const user = userEvent.setup();
    renderSchedule();

    await user.click(screen.getByText('국어'));
    await screen.findByDisplayValue('국어');

    await user.click(document.body);

    expect(screen.queryByDisplayValue('국어')).toBeNull();
  });

  it('수정 섹션 안을 누르면 닫히지 않는다', async () => {
    const user = userEvent.setup();
    renderSchedule();

    await user.click(screen.getByText('국어'));
    const box = await screen.findByDisplayValue('국어');

    await user.click(box);

    expect(screen.getByDisplayValue('국어')).toBeInTheDocument();
  });
});

describe('DaySchedule - 촘촘한 수업 칸 (docs/ROADMAP.md 2-1)', () => {
  it("빈 수업 메모·준비물은 그리지 않는다 - '없음'이 서지 않는다", () => {
    renderSchedule();
    // 1교시는 메모·준비물이 있어 두 칸 모두, 2교시는 둘 다 비어 한 줄
    expect(screen.getAllByText('📝 수업 메모')).toHaveLength(1);
    expect(screen.getAllByText('📌 비고 / 준비물')).toHaveLength(1);
    expect(screen.queryByText('없음')).not.toBeInTheDocument();
    const second = screen.getByText('수학').closest('[title="클릭하여 수정"]')!;
    expect(second.textContent).not.toMatch(/수업 메모|준비물/);
  });

  it('메모만 있으면 메모 칸만, 준비물만 있으면 준비물 칸만 그린다', () => {
    render(
      <DaySchedule
        schedules={{
          1: { subject: '국어', content: '', memo: '1단원 5차시', supplies: '', linkedItems: [] },
          2: { subject: '과학', content: '', memo: '', supplies: '돋보기', linkedItems: [] },
        }}
        onSavePeriod={vi.fn(async () => {})}
        onReorderPeriods={vi.fn(async () => {})}
        dateStr="2026-09-14"
        maxPeriods={2}
      />
    );
    const first = screen.getByText('국어').closest('[title="클릭하여 수정"]')!;
    const second = screen.getByText('과학').closest('[title="클릭하여 수정"]')!;
    expect(first.textContent).toMatch(/수업 메모.*1단원 5차시/);
    expect(first.textContent).not.toMatch(/준비물/);
    expect(second.textContent).toMatch(/준비물.*돋보기/);
    expect(second.textContent).not.toMatch(/수업 메모/);
  });
});
