import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DayJournal from './DayJournal';
import type { JournalEntry } from '../../hooks/useDayData';
import { useAppStore } from '../../store/useAppStore';

const entries: JournalEntry[] = [
  { id: 'jr_1', content: '첫 번째 기록', createdAt: 1, labelIds: [], linkedItems: [], attachments: [] },
  { id: 'jr_2', content: '두 번째 기록', createdAt: 2, labelIds: [], linkedItems: [], attachments: [] },
];

function renderJournal(journals: JournalEntry[] = entries) {
  const props = {
    journals,
    onAddJournal: vi.fn(async () => {}),
    onDeleteJournal: vi.fn(async () => {}),
    onUpdateJournal: vi.fn(async () => {}),
  };
  return { ...render(<DayJournal {...props} />), props };
}

// 기록 배너는 메모와 같은 컴포넌트(EntryDrawer)이므로, 여기서 검증하는 동작이
// 곧 메모 배너의 동작이기도 하다.
describe('DayJournal - 기록 추가/수정 배너', () => {
  it('+ 추가를 누르면 새 기록 배너가 열린다', async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole('button', { name: /추가/ }));

    expect(await screen.findByRole('heading', { name: '새 기록' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/기록/)).toBeInTheDocument();
  });

  it('카드를 한 번 클릭하면 그 기록의 수정 배너가 열린다', async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByText('첫 번째 기록'));

    expect(await screen.findByRole('heading', { name: '기록 수정' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('첫 번째 기록')).toBeInTheDocument();
  });

  it('수정 아이콘으로도 같은 배너가 열린다', async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getAllByTitle('기록 수정')[0]);

    expect(await screen.findByDisplayValue('첫 번째 기록')).toBeInTheDocument();
  });

  it('배너에 파일 첨부와 링크 추가가 있다', async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getAllByTitle('기록 수정')[0]);

    expect(await screen.findByText(/파일 첨부/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /링크 추가/ })).toBeInTheDocument();
  });

  it('빠른 저장 단축키 안내가 Ctrl + S 이다', async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole('button', { name: /추가/ }));

    expect(await screen.findByText(/Ctrl \+ S/)).toBeInTheDocument();
    expect(screen.queryByText(/Ctrl \+ Enter/)).toBeNull();
  });

  it('라벨은 여러 개 고를 수 있다', async () => {
    const user = userEvent.setup();
    renderJournal();
    await user.click(screen.getAllByTitle('기록 수정')[0]);
    await screen.findByDisplayValue('첫 번째 기록');

    const labelButtons = screen
      .getAllByRole('button')
      .filter((b) => /학급활동|학생상담|업무전달|수업기록/.test(b.textContent || '') && b.className.includes('rounded-lg'));
    expect(labelButtons.length).toBeGreaterThanOrEqual(2);

    await user.click(labelButtons[0]);
    await user.click(labelButtons[1]);
    expect(labelButtons[0].className).toContain('bg-blue-600');
    expect(labelButtons[1].className).toContain('bg-blue-600');
  });
});

describe('DayJournal - 카드 아이콘', () => {
  it('수정과 삭제 아이콘만 있고 파일/링크 아이콘은 없다', () => {
    const { container } = renderJournal();

    expect(screen.getAllByTitle('기록 수정').length).toBe(entries.length);
    expect(screen.getAllByTitle('기록 삭제').length).toBe(entries.length);
    expect(screen.queryAllByTitle('파일 추가').length).toBe(0);
    expect(screen.queryAllByTitle('링크 연결').length).toBe(0);

    // 카드 목록은 그대로 남아 있다
    const grid = container.querySelector('.grid.grid-cols-1')!;
    expect(within(grid as HTMLElement).getByText('두 번째 기록')).toBeInTheDocument();
  });

  it('수정 중에도 카드는 목록에 그대로 보인다', async () => {
    const user = userEvent.setup();
    const { container } = renderJournal();

    await user.click(screen.getAllByTitle('기록 수정')[0]);
    await screen.findByDisplayValue('첫 번째 기록');

    // 배너가 따로 뜨므로 목록에서 항목을 빼지 않는다
    const grid = container.querySelector('.grid.grid-cols-1')!;
    expect(within(grid as HTMLElement).getByText('첫 번째 기록')).toBeInTheDocument();
  });
});

// 등록된 기록 라벨은 useLabels의 기본값(학급활동/학생상담/업무전달/수업기록, id j_1~j_4)이다.
describe('DayJournal - 라벨 칩과 필터', () => {
  const withLabel = (id: string, label?: string, labelIds?: string[]): JournalEntry => ({
    id,
    content: `${id} 내용`,
    createdAt: 1,
    label,
    labelIds,
    linkedItems: [],
    attachments: [],
  });

  it('라벨을 이름으로 저장한 기록은 칩이 보인다', () => {
    renderJournal([withLabel('jr_a', '학급활동', ['학급활동'])]);
    const card = screen.getByText('jr_a 내용').closest('div.group') as HTMLElement;
    expect(within(card).getByText('학급활동')).toBeInTheDocument();
  });

  it('라벨을 ID로 저장한 기록도 칩이 보인다', () => {
    renderJournal([withLabel('jr_b', 'j_1', ['j_1'])]);
    const card = screen.getByText('jr_b 내용').closest('div.group') as HTMLElement;
    expect(within(card).getByText('학급활동')).toBeInTheDocument();
  });

  // 이번에 고친 것: labelIds에 지금은 없는 예전 ID가 남아 있어도 label의 이름으로 찾는다.
  // 예전에는 labelIds가 비어있지 않으면 거기서 못 찾는 순간 포기해서, 칩이 사라지고
  // 필터에도 걸리지 않았다. (V3에서 만든 기록이 이 경우다)
  it('labelIds에 옛 ID가 남아 있어도 label 이름으로 찾아낸다', () => {
    renderJournal([withLabel('jr_c', '학급활동', ['lbl_jr_없는id'])]);
    const card = screen.getByText('jr_c 내용').closest('div.group') as HTMLElement;
    expect(within(card).getByText('학급활동')).toBeInTheDocument();
  });

  it('등록되지 않은 라벨은 칩을 숨긴다', () => {
    renderJournal([withLabel('jr_d', '지워진라벨', ['지워진라벨'])]);
    const card = screen.getByText('jr_d 내용').closest('div.group') as HTMLElement;
    expect(within(card).queryByText('지워진라벨')).toBeNull();
  });

  it('라벨 필터를 누르면 그 라벨의 기록만 남는다', async () => {
    const user = userEvent.setup();
    renderJournal([
      withLabel('jr_e', '학급활동', ['학급활동']),
      withLabel('jr_f', '학생상담', ['학생상담']),
    ]);

    const filterBar = screen.getByText('전체').parentElement as HTMLElement;
    await user.click(within(filterBar).getByText('학급활동'));

    expect(screen.getByText('jr_e 내용')).toBeInTheDocument();
    expect(screen.queryByText('jr_f 내용')).toBeNull();
  });

  it('옛 ID가 섞인 기록도 필터에 걸린다', async () => {
    const user = userEvent.setup();
    renderJournal([withLabel('jr_g', '학급활동', ['lbl_jr_없는id'])]);

    const filterBar = screen.getByText('전체').parentElement as HTMLElement;
    await user.click(within(filterBar).getByText('학급활동'));

    expect(screen.getByText('jr_g 내용')).toBeInTheDocument();
  });

  // 이번에 고친 것: 라벨을 고르지 않았을 때 '일반'을 저장하면 어떤 필터에도 걸리지 않는다.
  it('라벨을 고르지 않고 저장하면 가짜 라벨을 넣지 않는다', async () => {
    const user = userEvent.setup();
    const { props } = renderJournal([]);

    await user.click(screen.getByRole('button', { name: /추가/ }));
    await user.type(await screen.findByPlaceholderText(/기록/), '라벨 없는 기록');

    // 미리 골라져 있는 라벨을 해제한다
    const drawerLabels = screen
      .getAllByRole('button')
      .filter((b) => b.className.includes('rounded-lg') && /학급활동/.test(b.textContent || ''));
    if (drawerLabels[0]?.className.includes('bg-blue-600')) await user.click(drawerLabels[0]);

    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(props.onAddJournal).toHaveBeenCalledTimes(1);
    const [, mainLabel, labelIds] = (props.onAddJournal as any).mock.calls[0];
    expect(mainLabel).toBe('');
    expect(labelIds).toEqual([]);
  });
});

describe('DayJournal - 배너 버튼과 닫기', () => {
  it("버튼 문구가 '저장'과 '닫기'다", async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getAllByTitle('기록 수정')[0]);
    await screen.findByDisplayValue('첫 번째 기록');

    expect(screen.getByRole('button', { name: '저장' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /수정 완료/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '취소' })).toBeNull();
  });

  it('저장을 눌러도 배너는 열려 있다', async () => {
    const user = userEvent.setup();
    const { props } = renderJournal();

    await user.click(screen.getAllByTitle('기록 수정')[0]);
    await screen.findByDisplayValue('첫 번째 기록');

    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(props.onUpdateJournal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: '기록 수정' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('첫 번째 기록')).toBeInTheDocument();
  });

  it('닫기를 누르면 배너가 닫힌다', async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getAllByTitle('기록 수정')[0]);
    await screen.findByDisplayValue('첫 번째 기록');

    await user.click(screen.getByRole('button', { name: '닫기' }));

    expect(screen.queryByRole('heading', { name: '기록 수정' })).toBeNull();
  });

  // 배너가 열린 채로 남으므로, 두 번 저장해도 같은 기록이 하나 더 생기면 안 된다.
  it('새 기록을 두 번 저장하면 두 번째는 수정으로 간다', async () => {
    const user = userEvent.setup();
    const onAddJournal = vi.fn(async () => 'jr_new');
    const onUpdateJournal = vi.fn(async (_id: string, _updates: Partial<JournalEntry>) => {});
    render(
      <DayJournal
        journals={[]}
        onAddJournal={onAddJournal}
        onDeleteJournal={vi.fn(async () => {})}
        onUpdateJournal={onUpdateJournal}
      />
    );

    await user.click(screen.getByRole('button', { name: /추가/ }));
    await user.type(await screen.findByPlaceholderText(/기록/), '두 번 저장');

    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(onAddJournal).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(onAddJournal).toHaveBeenCalledTimes(1);
    expect(onUpdateJournal).toHaveBeenCalledTimes(1);
    expect(onUpdateJournal.mock.calls[0][0]).toBe('jr_new');
  });
});

describe('DayJournal - 링크 추가 팝업에서 담은 링크', () => {
  it('팝업이 닫혀도(=화면이 다시 그려져도) 담은 링크가 남는다', async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByText('첫 번째 기록'));
    await screen.findByRole('heading', { name: '기록 수정' });
    await user.click(screen.getByRole('button', { name: /링크 추가/ }));

    // 링크 추가 팝업이 '연결 저장'에서 하는 일: 고른 목록을 콜백으로 돌려주고 닫는다.
    const callback = useAppStore.getState().linkerCallback;
    expect(callback).toBeTypeOf('function');
    act(() => {
      callback!([
        { targetType: 'event', targetId: 'ev_1', targetDate: '2026-09-16', title: '[2026-09-16] 일정' },
      ]);
      useAppStore.getState().closeLinkerModal();
    });

    expect(await screen.findByText(/첨부 및 링크 \(1개\)/)).toBeInTheDocument();
    expect(screen.getByText('[2026-09-16] 일정')).toBeInTheDocument();
  });
});
