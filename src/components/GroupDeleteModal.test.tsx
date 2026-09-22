import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GroupDeleteModal from './GroupDeleteModal';

// 묶음 조회·삭제는 Firestore를 훑는다. 여기서는 훑은 결과만 갈아 끼운다.
const store = vi.hoisted(() => ({
  hits: [] as any[],
  deletedDates: [] as string[],
}));

vi.mock('../lib/eventGroups', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/eventGroups')>();
  return {
    ...actual,
    findGroupEvents: async () => store.hits,
    deleteGroupEvents: async (_fId: string, hits: any[]) => {
      store.deletedDates = hits.map((h) => h.dateStr);
      return actual.countGroupItems(hits);
    },
  };
});

const hits = [
  { dateStr: '2026-09-21', list: [], items: [{ id: 'a' }] },
  { dateStr: '2026-09-22', list: [], items: [{ id: 'b' }, { id: 'c' }] },
  { dateStr: '2026-09-23', list: [], items: [{ id: 'd' }] },
];

function renderModal(overrides: Partial<React.ComponentProps<typeof GroupDeleteModal>> = {}) {
  const props = {
    isOpen: true as const,
    onClose: vi.fn(),
    dateStr: '2026-09-22',
    fId: 'personal',
    groupId: 'group_x',
    content: '여름방학 (2/4)',
    onDeleteThisOnly: vi.fn(async () => {}),
    onDeleted: vi.fn(),
    ...overrides,
  };
  return { ...render(<GroupDeleteModal {...props} />), props };
}

beforeEach(() => {
  store.hits = hits;
  store.deletedDates = [];
});

describe('GroupDeleteModal - 삭제 범위 고르기', () => {
  it('범위마다 몇 건이 지워지는지 보여 준다', async () => {
    renderModal();

    // 기준 날짜(22일)부터 뒤로 3건, 전체는 4건
    expect(await screen.findByRole('button', { name: /이 날짜와 이후 일정 모두 삭제 \(3건\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /연결된 일정 전체 삭제 \(4건\)/ })).toBeInTheDocument();
  });

  it("'이 날짜만'은 기존 한 건 삭제 경로를 쓴다", async () => {
    const user = userEvent.setup();
    const { props } = renderModal();

    await user.click(screen.getByRole('button', { name: /이 날짜의 일정만 삭제/ }));

    expect(props.onDeleteThisOnly).toHaveBeenCalledTimes(1);
    expect(store.deletedDates).toEqual([]);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("'이 날짜와 이후'는 지난 날짜를 건드리지 않는다", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: /이 날짜와 이후 일정 모두 삭제/ }));

    expect(store.deletedDates).toEqual(['2026-09-22', '2026-09-23']);
  });

  it("'전체'는 지난 날짜까지 지운다", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: /연결된 일정 전체 삭제/ }));

    expect(store.deletedDates).toEqual(['2026-09-21', '2026-09-22', '2026-09-23']);
  });

  it('묶음에 남은 것이 없으면 범위 단추는 눌리지 않는다', async () => {
    store.hits = [];
    renderModal();

    const all = await screen.findByRole('button', { name: /연결된 일정 전체 삭제 \(0건\)/ });
    expect(all).toBeDisabled();
    // 이 날짜 한 건 지우기는 언제나 할 수 있다
    expect(screen.getByRole('button', { name: /이 날짜의 일정만 삭제/ })).toBeEnabled();
  });
});
