import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act, fireEvent, waitFor } from '@testing-library/react';
import EntryPanelHost from './EntryPanelHost';
import type { EventItem } from '../hooks/useDayData';
import { useAppStore } from '../store/useAppStore';
import { moveEventToDate } from '../lib/eventDocOps';

// 일정 날짜 옮기기 (docs/ROADMAP.md 1-2). 일정 쓰는 칸 맨 위의 날짜 칸:
// 새 일정은 저장할 날짜가 곧바로 바뀌고, 고치던 일정은 저장할 때 그 날짜로 옮긴 뒤 새 날짜의 수정 칸이 된다.

let hook: {
  eventList: EventItem[];
  addEventItem: ReturnType<typeof vi.fn>;
  updateEventItem: ReturnType<typeof vi.fn>;
  deleteEventItem: ReturnType<typeof vi.fn>;
};
vi.mock('../hooks/useDayData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useDayData')>();
  return { ...actual, useDayData: () => hook };
});
vi.mock('../hooks/useMinWidth', () => ({ useMinWidth: () => true }));
vi.mock('../lib/eventDocOps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/eventDocOps')>();
  return { ...actual, moveEventToDate: vi.fn() };
});

const meeting: EventItem = { id: 'ev_1', content: '교직원 회의', completed: false, linkedItems: [], attachments: [] };

beforeEach(() => {
  vi.mocked(moveEventToDate).mockReset();
  useAppStore.setState({ entryPanels: [], entryPanel: null });
  hook = {
    eventList: [meeting],
    addEventItem: vi.fn(async () => ({ id: 'ev_new', content: '새 일정' })),
    updateEventItem: vi.fn(async () => {}),
    deleteEventItem: vi.fn(async () => {}),
  };
});

function openPanel(target: { entryId?: string; initial?: EventItem }) {
  render(<EntryPanelHost />);
  act(() => useAppStore.getState().openEntryPanel({ kind: 'event', groupId: null, dateStr: '2026-10-01', ...target }));
  return screen.getByRole('complementary', { name: '일정 쓰기' });
}
const dateInput = (p: HTMLElement) => within(p).getByLabelText('일정 날짜') as HTMLInputElement;
const panelDate = () => useAppStore.getState().entryPanels[0]?.dateStr;

describe('일정 쓰는 칸의 날짜', () => {
  it('고치던 일정: 날짜를 바꾸면 옮길 것을 알리고, 저장하면 옮긴 뒤 새 날짜의 수정 칸이 된다', async () => {
    const p = openPanel({ entryId: 'ev_1', initial: meeting });
    expect(dateInput(p).value).toBe('2026-10-01');

    fireEvent.click(within(p).getByTitle('다음 날로'));
    expect(dateInput(p).value).toBe('2026-10-02');
    expect(within(p).getByText(/저장하면 10\/1\(목\) →/)).toBeInTheDocument();
    // 아직 옮기지 않았다 - 칸의 날짜는 그대로
    expect(panelDate()).toBe('2026-10-01');

    vi.mocked(moveEventToDate).mockResolvedValue({ id: 'ev_1', item: { ...meeting } });
    fireEvent.click(within(p).getByRole('button', { name: '옮기고 저장' }));

    await waitFor(() => expect(panelDate()).toBe('2026-10-02'));
    expect(moveEventToDate).toHaveBeenCalledWith(
      expect.objectContaining({
        fId: 'personal',
        fromDate: '2026-10-01',
        toDate: '2026-10-02',
        eventId: 'ev_1',
        shiftAlarm: true,
        patch: expect.objectContaining({ content: '교직원 회의' }),
      })
    );
    // 날짜만 옮기는 길로 갔다 - 그날 목록 저장(updateEventItem)은 부르지 않는다
    expect(hook.updateEventItem).not.toHaveBeenCalled();
    expect(within(p).getByRole('button', { name: '저장' })).toBeInTheDocument();
  });

  it("'그대로 두기'를 누르면 옮기지 않고 그 날짜에 저장한다", async () => {
    const p = openPanel({ entryId: 'ev_1', initial: meeting });
    fireEvent.change(dateInput(p), { target: { value: '2026-10-09' } });
    fireEvent.click(within(p).getByRole('button', { name: '그대로 두기' }));
    expect(dateInput(p).value).toBe('2026-10-01');

    fireEvent.change(within(p).getByDisplayValue('교직원 회의'), { target: { value: '교직원 회의 15:00' } });
    fireEvent.click(within(p).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(hook.updateEventItem).toHaveBeenCalled());
    expect(moveEventToDate).not.toHaveBeenCalled();
  });

  it('옮길 일정을 못 찾으면 칸은 그 날짜에 그대로 남는다', async () => {
    const p = openPanel({ entryId: 'ev_1', initial: meeting });
    fireEvent.change(dateInput(p), { target: { value: '2026-10-09' } });
    vi.mocked(moveEventToDate).mockResolvedValue(null);
    fireEvent.click(within(p).getByRole('button', { name: '옮기고 저장' }));
    await waitFor(() => expect(moveEventToDate).toHaveBeenCalled());
    expect(panelDate()).toBe('2026-10-01');
    // 여전히 옮길 날짜를 들고 있다 (다시 저장하거나 그대로 두기를 고를 수 있다)
    expect(within(p).getByRole('button', { name: '옮기고 저장' })).toBeInTheDocument();
  });

  it('옮기다 실패하면(서버가 답하지 않음) 칸을 그대로 두고 적은 것을 지키며, 닫을 때 묻는다', async () => {
    const p = openPanel({ entryId: 'ev_1', initial: meeting });
    fireEvent.change(dateInput(p), { target: { value: '2026-10-09' } });
    vi.mocked(moveEventToDate).mockRejectedValue(new Error('offline'));
    fireEvent.click(within(p).getByRole('button', { name: '옮기고 저장' }));
    await waitFor(() => expect(moveEventToDate).toHaveBeenCalled());
    expect(panelDate()).toBe('2026-10-01');
    expect(within(p).getByDisplayValue('교직원 회의')).toBeInTheDocument();
    expect(dateInput(p).value).toBe('2026-10-09');
  });

  it('새 일정: 날짜를 고르면 저장할 날짜(칸의 날짜)가 곧바로 바뀌고 적던 글은 남는다', () => {
    const p = openPanel({});
    fireEvent.change(within(p).getByPlaceholderText('새로운 일정을 입력하세요...'), { target: { value: '학년 협의회' } });

    fireEvent.change(dateInput(p), { target: { value: '2026-10-15' } });

    expect(panelDate()).toBe('2026-10-15');
    expect(within(p).getByText(/10\/15\(목\) 일정/)).toBeInTheDocument();
    expect(within(p).getByDisplayValue('학년 협의회')).toBeInTheDocument();
    expect(within(p).queryByText(/저장하면/)).not.toBeInTheDocument();
  });
});
