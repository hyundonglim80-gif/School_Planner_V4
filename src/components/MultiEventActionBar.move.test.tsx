import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MultiEventActionBar from './MultiEventActionBar';
import { useAppStore } from '../store/useAppStore';
import { moveEventToDate } from '../lib/eventDocOps';

// 다중 선택 막대의 '옮기기' (docs/ROADMAP.md 1-5): 고른 일정을 모두 한 날짜로.

vi.mock('../lib/eventDocOps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/eventDocOps')>();
  return { ...actual, moveEventToDate: vi.fn() };
});

beforeEach(() => {
  vi.mocked(moveEventToDate).mockReset();
  useAppStore.setState({
    isMultiSelectMode: true,
    selectedEventIds: ['a', 'b', 'c'],
    selectedEventDateMap: { a: '2026-10-01', b: '2026-10-02', c: '2026-10-05' },
    selectedGroupId: null,
    entryPanels: [],
    entryPanel: null,
  });
});

const openMove = () => {
  fireEvent.click(screen.getByTitle('선택 일정을 다른 날짜로 옮기기'));
  return screen.getByLabelText('옮길 날짜') as HTMLInputElement;
};

describe('다중 선택 - 한 날짜로 옮기기', () => {
  it('고른 날짜로 하나씩 옮기고, 이미 그 날인 것은 건너뛰며, 다 되면 다중 선택을 끝낸다', async () => {
    vi.mocked(moveEventToDate).mockImplementation(async ({ eventId }) => ({ id: eventId, item: { id: eventId } }));
    render(<MultiEventActionBar />);
    const input = openMove();
    fireEvent.change(input, { target: { value: '2026-10-05' } });
    fireEvent.click(screen.getByRole('button', { name: /10\/5\(월\)로 3건 옮기기/ }));

    await waitFor(() => expect(useAppStore.getState().isMultiSelectMode).toBe(false));
    expect(vi.mocked(moveEventToDate).mock.calls.map((c) => [c[0].eventId, c[0].fromDate, c[0].toDate])).toEqual([
      ['a', '2026-10-01', '2026-10-05'],
      ['b', '2026-10-02', '2026-10-05'],
    ]);
  });

  it('못 옮긴 것은 고른 채로 남겨 다시 누를 수 있게 한다', async () => {
    vi.mocked(moveEventToDate).mockImplementation(async ({ eventId }) => {
      if (eventId === 'b') throw new Error('offline');
      return { id: eventId, item: { id: eventId } };
    });
    render(<MultiEventActionBar />);
    const input = openMove();
    fireEvent.change(input, { target: { value: '2026-10-09' } });
    fireEvent.click(screen.getByRole('button', { name: /3건 옮기기/ }));

    await waitFor(() => expect(useAppStore.getState().selectedEventIds).toEqual(['b']));
    expect(useAppStore.getState().isMultiSelectMode).toBe(true);
    expect(useAppStore.getState().selectedEventDateMap).toEqual({ b: '2026-10-02' });
  });

  it('옮긴 일정을 고치던 칸이 열려 있으면 새 날짜로 따라간다', async () => {
    vi.mocked(moveEventToDate).mockImplementation(async ({ eventId }) => ({ id: eventId, item: { id: eventId } }));
    useAppStore.getState().openEntryPanel({ kind: 'event', groupId: null, dateStr: '2026-10-01', entryId: 'a' });
    render(<MultiEventActionBar />);
    const input = openMove();
    fireEvent.change(input, { target: { value: '2026-10-09' } });
    fireEvent.click(screen.getByRole('button', { name: /3건 옮기기/ }));
    await waitFor(() => expect(useAppStore.getState().entryPanels[0]?.dateStr).toBe('2026-10-09'));
  });
});
