import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, createEvent, waitFor, act } from '@testing-library/react';
import { useEventDropMove, eventDragSourceProps } from './useEventDrag';
import { moveEventToDate } from '../lib/eventDocOps';
import { useAppStore } from '../store/useAppStore';

// 주간·월간·년간에서 일정을 끌어 다른 날짜 칸에 놓아 옮기기 (docs/ROADMAP.md 1-4)

vi.mock('../lib/eventDocOps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/eventDocOps')>();
  return { ...actual, moveEventToDate: vi.fn(), moveGroupEvents: vi.fn() };
});
const groupStore = vi.hoisted(() => ({ hits: [] as any[] }));
vi.mock('../lib/eventGroups', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/eventGroups')>();
  return { ...actual, findGroupEvents: async () => groupStore.hits };
});
vi.mock('./useGovHolidays', () => ({ loadHolidayYears: async () => ({}) }));

/** jsdom에는 DataTransfer가 없다 - 끌기에 쓰는 만큼만 흉내 낸다 */
function fakeTransfer() {
  const data: Record<string, string> = {};
  const types: string[] = [];
  return {
    types,
    effectAllowed: '',
    dropEffect: '',
    setData(t: string, v: string) {
      data[t] = v;
      if (!types.includes(t)) types.push(t);
    },
    getData: (t: string) => data[t] || '',
  };
}

function Harness({ item }: { item: any }) {
  const drop = useEventDropMove();
  return (
    <>
      <div data-testid="day-1" {...drop.targetProps('2026-10-01')}>
        <div data-testid="ev" {...eventDragSourceProps('2026-10-01', item, true, drop.clearOver)}>
          {item.content}
        </div>
      </div>
      <div data-testid="day-5" data-over={drop.overDate === '2026-10-05' ? 'yes' : 'no'} {...drop.targetProps('2026-10-05')}>
        <span data-testid="inside-5">안쪽</span>
      </div>
      {drop.groupMoveModal}
    </>
  );
}

beforeEach(() => {
  vi.mocked(moveEventToDate).mockReset();
  groupStore.hits = [];
  useAppStore.setState({ entryPanels: [], entryPanel: null, selectedGroupId: null, isMultiSelectMode: false });
});

const meeting = { id: 'ev_1', content: '교직원 회의', completed: false };

describe('일정 끌어 놓기', () => {
  it('끌어서 다른 날짜 칸에 올리면 짚어 주고, 놓으면 그 날로 옮긴다', async () => {
    vi.mocked(moveEventToDate).mockResolvedValue({ id: 'ev_1', item: meeting });
    render(<Harness item={meeting} />);
    const dt = fakeTransfer();

    fireEvent.dragStart(screen.getByTestId('ev'), { dataTransfer: dt });
    expect(dt.types).toContain('application/x-sp4-event');
    fireEvent.dragOver(screen.getByTestId('day-5'), { dataTransfer: dt });
    expect(screen.getByTestId('day-5').dataset.over).toBe('yes');
    // 칸 안의 글자 위로 옮겨 가도 짚은 것이 풀리지 않는다
    // (jsdom에는 DragEvent가 없어 relatedTarget을 직접 붙인다)
    const leave = createEvent.dragLeave(screen.getByTestId('day-5'), { dataTransfer: dt });
    Object.defineProperty(leave, 'relatedTarget', { value: screen.getByTestId('inside-5') });
    fireEvent(screen.getByTestId('day-5'), leave);
    expect(screen.getByTestId('day-5').dataset.over).toBe('yes');

    fireEvent.drop(screen.getByTestId('day-5'), { dataTransfer: dt });

    expect(screen.getByTestId('day-5').dataset.over).toBe('no');
    await waitFor(() =>
      expect(moveEventToDate).toHaveBeenCalledWith(
        expect.objectContaining({ fId: 'personal', fromDate: '2026-10-01', toDate: '2026-10-05', eventId: 'ev_1' })
      )
    );
  });

  it('같은 날짜 칸에 놓으면 아무것도 하지 않는다', () => {
    render(<Harness item={meeting} />);
    const dt = fakeTransfer();
    fireEvent.dragStart(screen.getByTestId('ev'), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('day-1'), { dataTransfer: dt });
    expect(moveEventToDate).not.toHaveBeenCalled();
  });

  it('일정이 아닌 것(파일·글자)을 끌어 오면 놓을 자리로 짚지 않는다', () => {
    render(<Harness item={meeting} />);
    const dt = fakeTransfer();
    dt.setData('text/plain', '그냥 글자');
    fireEvent.dragOver(screen.getByTestId('day-5'), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('day-5'), { dataTransfer: dt });
    expect(screen.getByTestId('day-5').dataset.over).toBe('no');
    expect(moveEventToDate).not.toHaveBeenCalled();
  });

  it('그 일정을 고치던 칸이 열려 있으면 새 날짜로 따라간다', async () => {
    vi.mocked(moveEventToDate).mockResolvedValue({ id: 'ev_1', item: meeting });
    act(() =>
      useAppStore.getState().openEntryPanel({ kind: 'event', groupId: null, dateStr: '2026-10-01', entryId: 'ev_1', initial: meeting })
    );
    render(<Harness item={meeting} />);
    const dt = fakeTransfer();
    fireEvent.dragStart(screen.getByTestId('ev'), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('day-5'), { dataTransfer: dt });

    await waitFor(() => expect(useAppStore.getState().entryPanels[0]?.dateStr).toBe('2026-10-05'));
    expect(useAppStore.getState().entryPanels[0]?.entryId).toBe('ev_1');
  });

  it('기간·반복 묶음이면 놓을 때 어디까지 옮길지 묻는다', async () => {
    const weekly = { id: 'w1', content: '학년 협의회', groupId: 'grp', recur: true };
    groupStore.hits = [{ dateStr: '2026-10-01', list: [], items: [weekly] }];
    vi.mocked(moveEventToDate).mockResolvedValue({ id: 'w1', item: weekly });
    render(<Harness item={weekly} />);
    const dt = fakeTransfer();
    fireEvent.dragStart(screen.getByTestId('ev'), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('day-5'), { dataTransfer: dt });

    fireEvent.click(await screen.findByRole('button', { name: /이 날짜의 일정만 옮기기/ }));
    await waitFor(() => expect(moveEventToDate).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'w1', toDate: '2026-10-05' })));
  });
});
