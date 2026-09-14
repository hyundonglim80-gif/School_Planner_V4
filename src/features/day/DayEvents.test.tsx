import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DayEvents from './DayEvents';
import type { EventItem } from '../../hooks/useDayData';

const events: EventItem[] = [
  { id: 'ev_1', content: '교직원 회의', completed: false, linkedItems: [], attachments: [] },
  { id: 'ev_2', content: '안전 점검', completed: false, linkedItems: [], attachments: [] },
];

function renderEvents(overrides: Partial<React.ComponentProps<typeof DayEvents>> = {}) {
  const props = {
    events,
    onAddEvent: vi.fn(async () => {}),
    onToggleEvent: vi.fn(async () => {}),
    onDeleteEvent: vi.fn(async () => {}),
    onUpdateEvent: vi.fn(async () => {}),
    ...overrides,
  };
  return { ...render(<DayEvents {...props} />), props };
}

describe('DayEvents - 항목 자리에서 바로 수정', () => {
  it('일정을 클릭하면 팝업이 아니라 그 자리에 수정 섹션이 열린다', async () => {
    const user = userEvent.setup();
    renderEvents();

    await user.click(screen.getByText('교직원 회의'));

    // 수정 대상 내용이 입력칸에 들어온다
    expect(await screen.findByDisplayValue('교직원 회의')).toBeInTheDocument();
    // 팝업(일정 수정)은 열리지 않는다
    expect(screen.queryByRole('heading', { name: '일정 수정' })).toBeNull();
  });

  it("수정 섹션에 '일정 수정' 팝업의 버튼과 항목이 모두 있다", async () => {
    const user = userEvent.setup();
    renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    await screen.findByDisplayValue('교직원 회의');

    // 버튼 줄
    expect(screen.getByRole('button', { name: /알림 추가/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /링크 추가/ })).toBeInTheDocument();
    // 라벨 + 라벨 관리
    expect(screen.getByText('라벨 (다중 선택 가능)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /라벨 수정/ })).toBeInTheDocument();
    // 5대 속성 (라벨 칩에도 같은 이름이 있으므로 속성 상자 안에서만 찾는다)
    const propBox = screen.getByText('속성 설정').closest('div')!;
    for (const name of ['달력', '이월', '기간', '반복', '수업X']) {
      expect(within(propBox).getByText(name)).toBeInTheDocument();
    }
    expect(within(propBox).getAllByRole('checkbox')).toHaveLength(5);
    // 본문 + 아래 버튼
    expect(screen.getByText('일정 내용')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '저장 완료' })).toBeInTheDocument();
  });

  it('저장하면 속성까지 함께 넘긴다', async () => {
    const user = userEvent.setup();
    const { props } = renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    await screen.findByDisplayValue('교직원 회의');
    await user.click(screen.getByRole('button', { name: '저장 완료' }));

    expect(props.onUpdateEvent).toHaveBeenCalledTimes(1);
    const [id, updates] = (props.onUpdateEvent as any).mock.calls[0];
    expect(id).toBe('ev_1');
    expect(updates).toMatchObject({
      content: '교직원 회의',
      calendar: expect.any(Boolean),
      forward: expect.any(Boolean),
      period: expect.any(Boolean),
      recur: expect.any(Boolean),
      skip: expect.any(Boolean),
    });
  });

  it('수정 중인 일정만 수정 섹션으로 바뀌고 나머지는 그대로 남는다', async () => {
    const user = userEvent.setup();
    renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    await screen.findByDisplayValue('교직원 회의');

    expect(screen.getByText('안전 점검')).toBeInTheDocument();
  });

  it('삭제 아이콘은 확인창 없이 지운다', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    const { props } = renderEvents();

    await user.click(screen.getAllByTitle('일정 삭제')[0]);

    expect(props.onDeleteEvent).toHaveBeenCalledWith('ev_1');
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("DayEvents - 새 일정 추가 폼도 '일정 수정'과 같은 구성", () => {
  const openAddForm = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /새 일정/ }));
  };

  it('버튼 줄·라벨·5대 속성·내용·닫기/저장이 모두 있다', async () => {
    const user = userEvent.setup();
    renderEvents({ events: [] });

    await openAddForm(user);

    expect(screen.getByRole('button', { name: /알림 추가/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /링크 추가/ })).toBeInTheDocument();
    expect(screen.getByText('라벨 (다중 선택 가능)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /라벨 수정/ })).toBeInTheDocument();

    const propBox = screen.getByText('속성 설정').closest('div')!;
    for (const name of ['달력', '이월', '기간', '반복', '수업X']) {
      expect(within(propBox).getByText(name)).toBeInTheDocument();
    }
    expect(within(propBox).getAllByRole('checkbox')).toHaveLength(5);

    expect(screen.getByText('일정 내용')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '저장' })).toBeInTheDocument();
  });

  it('내용 입력칸이 여러 줄로 늘어나는 입력칸이다', async () => {
    const user = userEvent.setup();
    renderEvents({ events: [] });

    await openAddForm(user);

    const box = screen.getByPlaceholderText(/새로운 일정/);
    expect(box.tagName).toBe('TEXTAREA');
  });

  it('저장하면 고른 속성까지 함께 넘긴다', async () => {
    const user = userEvent.setup();
    const { props } = renderEvents({ events: [] });

    await openAddForm(user);
    await user.type(screen.getByPlaceholderText(/새로운 일정/), '교내 행사');

    const propBox = screen.getByText('속성 설정').closest('div')!;
    await user.click(within(propBox).getAllByRole('checkbox')[1]); // 이월 켜기

    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(props.onAddEvent).toHaveBeenCalledTimes(1);
    const [content, options] = (props.onAddEvent as any).mock.calls[0];
    expect(content).toBe('교내 행사');
    expect(options).toMatchObject({ forward: true, calendar: true });
  });

  it('라벨을 고르면 그 라벨의 기본 속성을 따라간다', async () => {
    const user = userEvent.setup();
    renderEvents({ events: [] });

    await openAddForm(user);

    // 기본 라벨 '이월'은 forward 속성이 켜져 있다
    const labelChips = screen
      .getAllByRole('button')
      .filter((b) => b.className.includes('rounded-lg') && b.textContent === '이월');
    await user.click(labelChips[0]);

    const propBox = screen.getByText('속성 설정').closest('div')!;
    expect((within(propBox).getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(true);
  });
});

describe('DayEvents - 바깥 클릭으로 수정 섹션 닫기', () => {
  it('페이지의 다른 곳을 누르면 수정 섹션이 닫힌다', async () => {
    const user = userEvent.setup();
    renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    await screen.findByDisplayValue('교직원 회의');

    // 섹션 바깥(문서 본문)을 누른다
    await user.click(document.body);

    expect(screen.queryByDisplayValue('교직원 회의')).toBeNull();
  });

  it('수정 섹션 안을 누르면 닫히지 않는다', async () => {
    const user = userEvent.setup();
    renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    const box = await screen.findByDisplayValue('교직원 회의');

    await user.click(box);

    expect(screen.getByDisplayValue('교직원 회의')).toBeInTheDocument();
  });

  it('저장하지 않고 닫히므로 수정 내용은 반영되지 않는다', async () => {
    const user = userEvent.setup();
    const { props } = renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    const box = await screen.findByDisplayValue('교직원 회의');
    await user.type(box, ' 추가');

    await user.click(document.body);

    expect(screen.queryByDisplayValue(/교직원 회의 추가/)).toBeNull();
    expect(props.onUpdateEvent).not.toHaveBeenCalled();
  });
});
