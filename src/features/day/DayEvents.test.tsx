import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DayEvents from './DayEvents';
import EntryPanelHost, { closeAllEntryPanels } from '../../components/EntryPanelHost';
import type { EventItem } from '../../hooks/useDayData';
import { useAppStore } from '../../store/useAppStore';

// 일정을 쓰고 고치는 칸은 이제 목록 안이 아니라 오른쪽 칸(EventDrawer)이다.
// 칸은 Layout의 EntryPanelHost가 그리고, 저장도 그쪽이 useDayData로 한다.
// 그 훅을 가짜로 바꿔 저장 호출을 지켜본다.
let hook: {
  eventList: EventItem[];
  addEventItem: ReturnType<typeof vi.fn>;
  updateEventItem: ReturnType<typeof vi.fn>;
  deleteEventItem: ReturnType<typeof vi.fn>;
};
vi.mock('../../hooks/useDayData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useDayData')>();
  return { ...actual, useDayData: () => hook };
});

// 넓은 화면(칸이 화면 옆에 붙는 경우)으로 본다. 휴대폰 폭에서는 예전처럼 덮는 배너다.
vi.mock('../../hooks/useMinWidth', () => ({ useMinWidth: () => true }));

beforeEach(() => {
  useAppStore.setState({ entryPanels: [], entryPanel: null });
});

const events: EventItem[] = [
  { id: 'ev_1', content: '교직원 회의', completed: false, linkedItems: [], attachments: [] },
  { id: 'ev_2', content: '안전 점검', completed: false, linkedItems: [], attachments: [] },
];

function renderEvents(list: EventItem[] = events) {
  const props = {
    events: list,
    onToggleEvent: vi.fn(async () => {}),
    onDeleteEvent: vi.fn(async () => {}),
    onUpdateEvent: vi.fn(async () => {}),
  };
  hook = {
    eventList: list,
    addEventItem: vi.fn(async () => {}),
    updateEventItem: vi.fn(async () => {}),
    deleteEventItem: vi.fn(async () => {}),
  };
  return {
    ...render(
      <>
        <DayEvents {...props} />
        <EntryPanelHost />
      </>
    ),
    props,
  };
}

const panel = () => screen.getByRole('complementary', { name: '일정 쓰기' });
const propBoxOf = () => within(panel()).getByText('속성 설정').closest('div')!;

describe('DayEvents - 일정을 누르면 오른쪽 칸에서 고친다', () => {
  it('일정을 클릭하면 오른쪽 칸에 그 일정의 수정 칸이 열린다', async () => {
    const user = userEvent.setup();
    renderEvents();

    await user.click(screen.getByText('교직원 회의'));

    expect(await screen.findByRole('heading', { name: '일정 수정' })).toBeInTheDocument();
    expect(within(panel()).getByDisplayValue('교직원 회의')).toBeInTheDocument();
    // 목록은 그대로 남아 있다 (칸이 목록을 밀어내거나 가리지 않는다)
    expect(screen.getByText('안전 점검')).toBeInTheDocument();
  });

  it('칸에 알림·링크·라벨·5대 속성·내용·삭제/닫기/저장이 모두 있다', async () => {
    const user = userEvent.setup();
    renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    const p = await screen.findByRole('complementary', { name: '일정 쓰기' });

    expect(within(p).getByRole('button', { name: /알림 추가/ })).toBeInTheDocument();
    expect(within(p).getByRole('button', { name: /링크 추가/ })).toBeInTheDocument();
    expect(within(p).getByText('라벨 (다중 선택 가능)')).toBeInTheDocument();
    expect(within(p).getByRole('button', { name: /라벨 수정/ })).toBeInTheDocument();
    for (const name of ['달력', '이월', '기간', '반복', '수업X']) {
      expect(within(propBoxOf()).getByText(name)).toBeInTheDocument();
    }
    expect(within(propBoxOf()).getAllByRole('checkbox')).toHaveLength(5);
    expect(within(p).getByText('일정 내용')).toBeInTheDocument();
    expect(within(p).getByRole('button', { name: '삭제' })).toBeInTheDocument();
    expect(within(p).getByRole('button', { name: '닫기' })).toBeInTheDocument();
    expect(within(p).getByRole('button', { name: '저장' })).toBeInTheDocument();
  });

  it('저장하면 속성까지 함께 넘기고, 칸은 열어 둔다', async () => {
    const user = userEvent.setup();
    renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    await user.type(await screen.findByDisplayValue('교직원 회의'), ' 준비');
    await user.click(within(panel()).getByRole('button', { name: '저장' }));

    expect(hook.updateEventItem).toHaveBeenCalledTimes(1);
    const [id, updates] = hook.updateEventItem.mock.calls[0];
    expect(id).toBe('ev_1');
    expect(updates).toMatchObject({
      content: '교직원 회의 준비',
      calendar: expect.any(Boolean),
      period: expect.any(Boolean),
      recur: expect.any(Boolean),
      skip: expect.any(Boolean),
    });
    expect(screen.getByRole('heading', { name: '일정 수정' })).toBeInTheDocument();
  });

  it('라벨을 떼면 labelIds에서도 빠진다 (옛 ID로 라벨이 되살아나지 않게)', async () => {
    const user = userEvent.setup();
    renderEvents([{ id: 'ev_l', content: '회의', label: '이월', completed: false }]);

    await user.click(screen.getByText('회의'));
    await screen.findByRole('heading', { name: '일정 수정' });
    const chip = within(panel()).getByRole('button', { name: '이월', pressed: true });
    await user.click(chip);
    await user.click(within(panel()).getByRole('button', { name: '저장' }));

    const [, updates] = hook.updateEventItem.mock.calls[0];
    expect(updates.label).toBe('');
    expect(updates.labelIds).toEqual([]);
  });

  it('고치고 있는 일정을 목록에서 짚어 준다', async () => {
    const user = userEvent.setup();
    renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    await screen.findByRole('heading', { name: '일정 수정' });

    const rows = screen.getAllByTitle('클릭하여 오른쪽 칸에서 수정');
    expect(rows[0].className).toContain('ring-primary');
    expect(rows[1].className).not.toContain('ring-primary');
  });

  it('칸을 연 채 다른 일정을 누르면 새 칸이 위에 쌓이고, 먼저 연 칸은 적던 것째 아래에 남는다', async () => {
    // 예전에는 먼저 연 칸을 저장하고 새 칸으로 바꿨다. 이제 다른 팝업 칸처럼 쌓인다.
    const user = userEvent.setup();
    renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    await user.type(await screen.findByDisplayValue('교직원 회의'), '!');
    await user.click(screen.getByText('안전 점검'));

    const panels = await screen.findAllByRole('complementary', { name: '일정 쓰기' });
    expect(panels).toHaveLength(2);
    // 나중에 연 것이 위(order 0), 먼저 연 것이 아래(order 1)
    const top = panels.find((p) => p.style.order === '0')!;
    const below = panels.find((p) => p.style.order === '1')!;
    expect(within(top).getByDisplayValue('안전 점검')).toBeInTheDocument();
    expect(within(below).getByDisplayValue('교직원 회의!')).toBeInTheDocument();
    // 쓰던 중이므로 저장하지 않는다
    expect(hook.updateEventItem).not.toHaveBeenCalled();
  });

  it('이미 열린 일정을 다시 누르면 새 칸을 만들지 않고 그 칸을 맨 위로 올린다', async () => {
    const user = userEvent.setup();
    renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    await user.type(await screen.findByDisplayValue('교직원 회의'), '!');
    await user.click(screen.getByText('안전 점검'));
    await user.click(screen.getByText('교직원 회의'));

    const panels = await screen.findAllByRole('complementary', { name: '일정 쓰기' });
    expect(panels).toHaveLength(2);
    const top = panels.find((p) => p.style.order === '0')!;
    // 적던 것이 그대로 남아 있다 (다시 그리지 않았다)
    expect(within(top).getByDisplayValue('교직원 회의!')).toBeInTheDocument();
  });

  it('쌓인 칸 중 하나를 닫으면 그 칸만 닫힌다', async () => {
    const user = userEvent.setup();
    renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    await user.click(screen.getByText('안전 점검'));
    const panels = await screen.findAllByRole('complementary', { name: '일정 쓰기' });
    const top = panels.find((p) => p.style.order === '0')!;
    await user.click(within(top).getByRole('button', { name: '닫기' }));

    const left = screen.getAllByRole('complementary', { name: '일정 쓰기' });
    expect(left).toHaveLength(1);
    expect(within(left[0]).getByDisplayValue('교직원 회의')).toBeInTheDocument();
  });

  it('닫기는 저장하지 않고 닫는다', async () => {
    const user = userEvent.setup();
    renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    await user.type(await screen.findByDisplayValue('교직원 회의'), '!');
    await user.click(within(panel()).getByRole('button', { name: '닫기' }));

    expect(screen.queryByRole('heading', { name: '일정 수정' })).toBeNull();
    expect(hook.updateEventItem).not.toHaveBeenCalled();
  });

  it('내용을 다 지우면 저장 단추가 꺼지고, 다른 것을 열어도 일정을 지우지 않는다', async () => {
    const user = userEvent.setup();
    renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    await user.clear(await screen.findByDisplayValue('교직원 회의'));
    expect(within(panel()).getByRole('button', { name: '저장' })).toBeDisabled();

    await user.click(screen.getByText('안전 점검'));

    expect(hook.updateEventItem).not.toHaveBeenCalled();
    expect(hook.deleteEventItem).not.toHaveBeenCalled();
  });

  it('칸의 삭제는 확인창 없이 지우고 칸을 닫는다', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    await screen.findByRole('heading', { name: '일정 수정' });
    await user.click(within(panel()).getByRole('button', { name: '삭제' }));

    await waitFor(() => expect(hook.deleteEventItem).toHaveBeenCalledWith('ev_1', expect.anything()));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: '일정 수정' })).toBeNull();
    confirmSpy.mockRestore();
  });

  it('목록에서 지운 일정을 칸에서 고치고 있었으면 칸도 닫는다', async () => {
    const user = userEvent.setup();
    const { props } = renderEvents();

    await user.click(screen.getByText('교직원 회의'));
    await screen.findByRole('heading', { name: '일정 수정' });
    await user.click(screen.getAllByTitle('일정 삭제')[0]);

    expect(props.onDeleteEvent).toHaveBeenCalledWith('ev_1');
    await waitFor(() => expect(screen.queryByRole('heading', { name: '일정 수정' })).toBeNull());
  });
});

describe('DayEvents - + 추가(새 일정)도 오른쪽 칸에서', () => {
  const openCreate = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: '일정 추가' }));
    await screen.findByRole('heading', { name: '새 일정' });
  };

  it('맨 위 라벨이 미리 골라져 있고, 눌러서 뗄 수 있다', async () => {
    const user = userEvent.setup();
    renderEvents([]);
    await openCreate(user);

    const chips = within(panel())
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('aria-pressed'));
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');

    await user.click(chips[0]);
    expect(chips[0]).toHaveAttribute('aria-pressed', 'false');
  });

  it('내용 입력칸이 여러 줄로 늘어나는 입력칸이다', async () => {
    const user = userEvent.setup();
    renderEvents([]);
    await openCreate(user);

    expect(within(panel()).getByPlaceholderText(/새로운 일정/).tagName).toBe('TEXTAREA');
  });

  it('저장하면 고른 속성까지 넘기고, 칸을 비워 이어 적게 한다', async () => {
    const user = userEvent.setup();
    renderEvents([]);
    await openCreate(user);

    await user.type(within(panel()).getByPlaceholderText(/새로운 일정/), '교내 행사');
    const forwardBox = within(propBoxOf()).getAllByRole('checkbox')[1] as HTMLInputElement;
    if (!forwardBox.checked) await user.click(forwardBox);
    await user.click(within(panel()).getByRole('button', { name: '저장' }));

    await waitFor(() => expect(hook.addEventItem).toHaveBeenCalledTimes(1));
    const [content, options] = hook.addEventItem.mock.calls[0];
    expect(content).toBe('교내 행사');
    expect(options).toMatchObject({ forward: true, linkedItems: [] });
    // 칸은 남고 비워진다
    expect(screen.getByRole('heading', { name: '새 일정' })).toBeInTheDocument();
    expect(within(panel()).getByPlaceholderText(/새로운 일정/)).toHaveValue('');
  });

  it('Ctrl+S로도 저장한다', async () => {
    const user = userEvent.setup();
    renderEvents([]);
    await openCreate(user);

    const box = within(panel()).getByPlaceholderText(/새로운 일정/);
    await user.type(box, '학부모 상담');
    await user.keyboard('{Control>}s{/Control}');

    await waitFor(() => expect(hook.addEventItem).toHaveBeenCalledTimes(1));
    expect(hook.addEventItem.mock.calls[0][0]).toBe('학부모 상담');
  });

  it('라벨을 고르면 그 라벨의 기본 속성을 따라간다', async () => {
    const user = userEvent.setup();
    renderEvents([]);
    await openCreate(user);

    // 기본 라벨 '이월'은 forward 속성이 켜져 있다
    const forwardBox = within(propBoxOf()).getAllByRole('checkbox')[1] as HTMLInputElement;
    if (forwardBox.checked) await user.click(forwardBox);
    await user.click(within(panel()).getByRole('button', { name: '이월', pressed: false }));

    expect(forwardBox.checked).toBe(true);
  });

  it('저장한 적 없는 빈 칸에서 다른 일정을 열면 아무것도 만들지 않는다', async () => {
    const user = userEvent.setup();
    renderEvents();
    await openCreate(user);

    await user.click(screen.getByText('교직원 회의'));

    expect(await screen.findByRole('heading', { name: '일정 수정' })).toBeInTheDocument();
    expect(hook.addEventItem).not.toHaveBeenCalled();
  });
});

describe('DayEvents - 기간 속성', () => {
  // '기간'은 하루짜리 표시가 아니라 '언제부터 언제까지'를 정해야 뜻이 생긴다.
  const turnOnPeriod = async (user: ReturnType<typeof userEvent.setup>) => {
    const periodBox = within(propBoxOf()).getAllByRole('checkbox')[2] as HTMLInputElement; // 달력·이월·기간 순
    await user.click(periodBox);
    return periodBox;
  };

  it("새 일정에서 '기간'을 켜면 적던 내용을 가지고 기간을 정하는 칸이 뜬다", async () => {
    const user = userEvent.setup();
    renderEvents([]);
    await user.click(screen.getByRole('button', { name: '일정 추가' }));
    await user.type(await screen.findByPlaceholderText(/새로운 일정/), '여름방학');

    await turnOnPeriod(user);

    expect(await screen.findByRole('heading', { name: /연속 기간 등록/ })).toBeInTheDocument();
    expect(screen.getByLabelText('시작일')).toBeInTheDocument();
    expect(screen.getByLabelText('종료일')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('여름방학').length).toBeGreaterThan(0);
  });

  it('기간을 정하지 않고 닫으면 체크도 다시 풀린다', async () => {
    const user = userEvent.setup();
    renderEvents([]);
    await user.click(screen.getByRole('button', { name: '일정 추가' }));
    await screen.findByRole('heading', { name: '새 일정' });

    const periodBox = await turnOnPeriod(user);
    await screen.findByRole('heading', { name: /연속 기간 등록/ });
    await user.click(screen.getAllByTitle('닫기').at(-1)!);

    expect(screen.queryByRole('heading', { name: /연속 기간 등록/ })).toBeNull();
    expect(periodBox.checked).toBe(false);
  });

  it('고치던 일정에서 기간을 켜도 날짜를 고르는 팝업이 뜬다', async () => {
    const user = userEvent.setup();
    renderEvents();
    await user.click(screen.getByText('교직원 회의'));
    await screen.findByRole('heading', { name: '일정 수정' });

    await turnOnPeriod(user);

    expect(await screen.findByRole('heading', { name: /연속 기간 등록/ })).toBeInTheDocument();
  });

  it('이미 기간으로 만들어진 일정을 열기만 할 때는 뜨지 않는다', async () => {
    const user = userEvent.setup();
    renderEvents([{ id: 'ev_p', content: '여름방학 (1/5)', period: true, groupId: 'group_x', completed: false }]);

    await user.click(screen.getByText('여름방학 (1/5)'));
    await screen.findByRole('heading', { name: '일정 수정' });

    expect(screen.queryByRole('heading', { name: /연속 기간 등록/ })).toBeNull();
  });
});

describe('DayEvents - 묶인 일정 삭제 범위', () => {
  const grouped: EventItem[] = [
    { id: 'ev_g', content: '여름방학 (1/5)', period: true, groupId: 'group_x', completed: false },
  ];

  it('묶인 일정을 지우면 어디까지 지울지 먼저 묻는다', async () => {
    const user = userEvent.setup();
    const { props } = renderEvents(grouped);

    await user.click(screen.getByTitle('일정 삭제'));

    expect(await screen.findByRole('heading', { name: /연결된 일정 삭제/ })).toBeInTheDocument();
    expect(props.onDeleteEvent).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /이 날짜의 일정만 삭제/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /이 날짜와 이후 일정 모두 삭제/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /연결된 일정 전체 삭제/ })).toBeInTheDocument();
  });

  it("'이 날짜의 일정만'을 고르면 그 한 건만 지운다", async () => {
    const user = userEvent.setup();
    const { props } = renderEvents(grouped);

    await user.click(screen.getByTitle('일정 삭제'));
    await screen.findByRole('heading', { name: /연결된 일정 삭제/ });
    await user.click(screen.getByRole('button', { name: /이 날짜의 일정만 삭제/ }));

    expect(props.onDeleteEvent).toHaveBeenCalledWith('ev_g');
  });

  it('묶이지 않은 일정은 묻지 않고 바로 지운다', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    const { props } = renderEvents();

    await user.click(screen.getAllByTitle('일정 삭제')[0]);

    expect(props.onDeleteEvent).toHaveBeenCalledWith('ev_1');
    expect(screen.queryByRole('heading', { name: /연결된 일정 삭제/ })).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe('쓰는 칸 - ESC와 Ctrl+S', () => {
  it('저장 안 한 것이 없으면 ESC 한 번에 쓰는 칸이 모두 닫힌다', async () => {
    const user = userEvent.setup();
    renderEvents();
    await user.click(screen.getByText('교직원 회의'));
    await user.click(screen.getByText('안전 점검'));
    expect(screen.getAllByRole('complementary', { name: '일정 쓰기' })).toHaveLength(2);

    act(() => {
      expect(closeAllEntryPanels()).toBe(true);
    });
    expect(screen.queryAllByRole('complementary', { name: '일정 쓰기' })).toHaveLength(0);
  });

  it('저장 안 한 글이 있으면 먼저 묻고, 아니라고 하면 닫지 않는다', async () => {
    const user = userEvent.setup();
    renderEvents();
    await user.click(screen.getByText('교직원 회의'));
    await user.type(await screen.findByDisplayValue('교직원 회의'), '!');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);

    act(() => {
      expect(closeAllEntryPanels()).toBe(false);
    });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('complementary', { name: '일정 쓰기' })).toHaveLength(1);
    ask.mockRestore();
  });

  it('커서가 아무 데도 없을 때 Ctrl+S는 맨 위 칸만 저장한다', async () => {
    const user = userEvent.setup();
    renderEvents();
    await user.click(screen.getByText('교직원 회의'));
    await user.type(await screen.findByDisplayValue('교직원 회의'), '!');
    await user.click(screen.getByText('안전 점검'));
    const panels = await screen.findAllByRole('complementary', { name: '일정 쓰기' });
    const top = panels.find((p) => p.style.order === '0')!;
    await user.type(within(top).getByDisplayValue('안전 점검'), '?');
    (document.activeElement as HTMLElement | null)?.blur();

    fireEvent.keyDown(document.body, { key: 's', code: 'KeyS', ctrlKey: true });

    await waitFor(() => expect(hook.updateEventItem).toHaveBeenCalledTimes(1));
    expect(hook.updateEventItem.mock.calls[0][1].content).toBe('안전 점검?');
  });
});
