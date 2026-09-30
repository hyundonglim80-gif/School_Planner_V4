import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DayJournal from './DayJournal';
import EntryPanelHost from '../../components/EntryPanelHost';
import type { JournalEntry } from '../../hooks/useDayData';
import { useAppStore } from '../../store/useAppStore';

// 기록 배너(오른쪽 칸)는 이제 화면이 아니라 Layout의 EntryPanelHost가 그리고,
// 저장도 그쪽이 useDayData로 한다. 그 훅을 가짜로 바꿔 저장 호출을 지켜본다.
let hook: {
  journals: JournalEntry[];
  addJournalEntry: ReturnType<typeof vi.fn>;
  updateJournalEntry: ReturnType<typeof vi.fn>;
  deleteJournalEntry: ReturnType<typeof vi.fn>;
};
// 라벨 상위/하위는 이 파일에서 따로 정한다
let journalParents: Record<string, string> = {};
vi.mock('../../lib/labelTree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/labelTree')>();
  return { ...actual, useLabelTree: () => ({ memo: {}, journal: journalParents }) };
});

vi.mock('../../hooks/useDayData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useDayData')>();
  return { ...actual, useDayData: () => hook };
});

beforeEach(() => {
  useAppStore.setState({ entryPanels: [], entryPanel: null });
});

const entries: JournalEntry[] = [
  { id: 'jr_1', content: '첫 번째 기록', createdAt: 1, labelIds: [], linkedItems: [], attachments: [] },
  { id: 'jr_2', content: '두 번째 기록', createdAt: 2, labelIds: [], linkedItems: [], attachments: [] },
];

function renderJournal(journals: JournalEntry[] = entries, onAdd = vi.fn(async () => {}) as any) {
  const props = {
    journals,
    onAddJournal: onAdd,
    onDeleteJournal: vi.fn(async () => {}),
    onUpdateJournal: vi.fn(async (_id: string, _updates: Partial<JournalEntry>) => {}),
  };
  hook = {
    journals,
    addJournalEntry: props.onAddJournal,
    updateJournalEntry: props.onUpdateJournal,
    deleteJournalEntry: props.onDeleteJournal,
  };
  return {
    ...render(
      <>
        <DayJournal journals={journals} onDeleteJournal={props.onDeleteJournal} />
        <EntryPanelHost />
      </>
    ),
    props,
  };
}

// 기록 배너는 메모와 같은 컴포넌트(EntryDrawer)이므로, 여기서 검증하는 동작이
// 곧 메모 배너의 동작이기도 하다.
describe('DayJournal - 기록 추가/수정 배너', () => {
  it('+ 추가를 누르면 새 기록 배너가 열린다', async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole('button', { name: '기록 추가' }));

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

    await user.click(screen.getByRole('button', { name: '기록 추가' }));

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
    const grid = container.querySelector('.grid.items-start')!;
    expect(within(grid as HTMLElement).getByText('두 번째 기록')).toBeInTheDocument();
  });

  it('수정 중에도 카드는 목록에 그대로 보인다', async () => {
    const user = userEvent.setup();
    const { container } = renderJournal();

    await user.click(screen.getAllByTitle('기록 수정')[0]);
    await screen.findByDisplayValue('첫 번째 기록');

    // 배너가 따로 뜨므로 목록에서 항목을 빼지 않는다
    const grid = container.querySelector('.grid.items-start')!;
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

    await user.click(screen.getByRole('button', { name: '기록 추가' }));
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
    const { props } = renderJournal([], onAddJournal);
    const onUpdateJournal = props.onUpdateJournal;

    await user.click(screen.getByRole('button', { name: '기록 추가' }));
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

describe('DayJournal - 긴 기록은 접은 채로 시작한다', () => {
  const longEntry: JournalEntry = {
    id: 'jr_long',
    content: '나'.repeat(400),
    createdAt: 3,
    labelIds: [],
    linkedItems: [],
    attachments: [],
  };

  it('긴 기록은 본문이 접혀 있고 한 줄만 보인다', () => {
    renderJournal([longEntry]);

    expect(screen.queryByText('나'.repeat(400))).toBeNull();
    expect(screen.getByTitle('펼치기')).toBeInTheDocument();
    expect(screen.getByText(/나{10,}…/)).toBeInTheDocument();
  });

  it('짧은 기록은 그대로 펼쳐져 있다', () => {
    renderJournal();

    expect(screen.getByText('첫 번째 기록')).toBeInTheDocument();
    expect(screen.getAllByTitle('접기').length).toBeGreaterThan(0);
  });

  it('펼치면 전체가 나온다', async () => {
    const user = userEvent.setup();
    renderJournal([longEntry]);

    await user.click(screen.getByTitle('펼치기'));

    expect(screen.getByText('나'.repeat(400))).toBeInTheDocument();
  });
});

// Firestore는 배열 안에 든 undefined를 거부한다. 게다가 어느 밭인지도 안 알려 준다
// ("Unsupported field value: undefined (found in document users/…/tasks/…)").
// 크기가 안 적힌 옛 첨부가 붙은 항목은 그래서 저장할 때마다 실패했다.
describe('EntryDrawer - 저장으로 나가는 첨부에 undefined가 없다', () => {
  const withLegacyAttachment: JournalEntry[] = [
    {
      id: 'jr_a',
      content: '옛 첨부가 붙은 기록',
      createdAt: 1,
      labelIds: [],
      linkedItems: [],
      // 크기도 종류도 안 적혀 있다 (V3 시절 자료가 이렇다)
      attachments: [{ name: '사진.png', url: 'https://example.test/a.png' } as any],
    },
  ];

  it('없는 값은 키째로 빠진다', async () => {
    const user = userEvent.setup();
    const { props } = renderJournal(withLegacyAttachment);

    await user.click(screen.getByText('옛 첨부가 붙은 기록'));
    await screen.findByDisplayValue('옛 첨부가 붙은 기록');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(props.onUpdateJournal).toHaveBeenCalledTimes(1);
    const payload = (props.onUpdateJournal as any).mock.calls[0].at(-1);
    for (const att of payload.attachments) {
      // 값이 undefined인 키가 하나라도 있으면 Firestore가 저장을 통째로 막는다
      expect(Object.entries(att).filter(([, v]) => v === undefined)).toEqual([]);
    }
  });
});

describe('기록 칸 - 새로 만든 것을 알려 주기 (링크 창의 만들어 연결)', () => {
  it('처음 저장할 때 한 번만 알려 준다 (그 뒤 저장은 고치기)', async () => {
    const user = userEvent.setup();
    renderJournal([], vi.fn(async () => 'jr_made') as any);
    const onCreated = vi.fn();
    await act(async () => {
      useAppStore.getState().openEntryPanel({ kind: 'journal', groupId: null, dateStr: '2026-09-15', onCreated });
    });
    const box = await screen.findByPlaceholderText(/기록/);
    await user.type(box, '상담 기록');
    await user.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated.mock.calls[0][0]).toMatchObject({ id: 'jr_made', type: 'journal', date: '2026-09-15' });

    await user.type(box, '!');
    await user.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(hook.updateJournalEntry).toHaveBeenCalled());
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
});

describe('기록 거르개 - 라벨 상위/하위', () => {
  // 기본 기록 라벨 가운데 '학생상담'을 '학급활동' 밑에 둔다
  beforeEach(() => {
    journalParents = { 학생상담: '학급활동' };
  });
  afterEach(() => {
    journalParents = {};
  });

  // 2026-09-30: 라벨은 여러 개 고르고, 상위만 고르면 하위는 빠진다. 상위 앞 '하위 포함' 체크로 하위까지.
  it('하위 칩은 ▾로 펼치고, 상위만 고르면 하위 기록은 빠지며, 하위 포함 체크로 들어간다', async () => {
    const user = userEvent.setup();
    renderJournal([
      { id: 'jr_a', content: '학급 기록', createdAt: 1, label: '학급활동', labelIds: ['j_1'] },
      { id: 'jr_b', content: '상담 기록', createdAt: 2, label: '학생상담', labelIds: ['j_2'] },
      { id: 'jr_c', content: '업무 기록', createdAt: 3, label: '업무전달', labelIds: ['j_3'] },
    ] as JournalEntry[]);

    // 처음에는 하위 칩이 접혀 있다
    expect(screen.queryByRole('button', { name: '학생상담' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '학급활동 하위 라벨 펼치기' }));
    expect(screen.getByRole('button', { name: '학생상담' })).toHaveAttribute('title', '학급활동 › 학생상담');

    await user.click(screen.getByRole('button', { name: '학급활동' }));
    expect(screen.getByText('학급 기록')).toBeInTheDocument();
    expect(screen.queryByText('상담 기록')).toBeNull();
    expect(screen.queryByText('업무 기록')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: '학급활동 하위 라벨 포함' }));
    expect(screen.getByText('학급 기록')).toBeInTheDocument();
    expect(screen.getByText('상담 기록')).toBeInTheDocument();
    expect(screen.queryByText('업무 기록')).toBeNull();

    // 여러 개: 업무전달도 더한다
    await user.click(screen.getByRole('button', { name: '업무전달' }));
    expect(screen.getByText('업무 기록')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '학급활동' })).toHaveAttribute('aria-pressed', 'true');

    // 전체를 누르면 모두 뗀다
    await user.click(screen.getByRole('button', { name: '전체' }));
    expect(screen.getByRole('checkbox', { name: '학급활동 하위 라벨 포함' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '학급활동' })).toHaveAttribute('aria-pressed', 'false');
  });
});
