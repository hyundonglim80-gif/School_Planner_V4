import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MemoScreen from './MemoScreen';
// 새 메모 배너(오른쪽 칸)는 Layout의 EntryPanelHost가 그린다. 화면과 함께 띄운다.
import EntryPanelHost from '../../components/EntryPanelHost';
import { addDoc as addDocMock, onSnapshot as onSnapshotMock, writeBatch as writeBatchMock } from 'firebase/firestore';
import { isUnlabeledMemo } from '../../hooks/useMemos';
import { useAppStore } from '../../store/useAppStore';

// 라벨 상위/하위는 이 파일에서 따로 정한다 (Firestore 구독 흉내가 메모 모양만 돌려준다)
let memoParents: Record<string, string> = {};
vi.mock('../../lib/labelTree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/labelTree')>();
  return { ...actual, useLabelTree: () => ({ memo: memoParents, journal: {} }) };
});

vi.mock('../../hooks/useLabels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useLabels')>();
  return {
    ...actual,
    useLabels: () => ({
      eventLabels: [],
      journalLabels: [],
      memoLabels: ['업무', '개인'],
      labelsLoaded: true,
      getLabelColor: () => ({ bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' }),
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  // 아래 시험 대부분은 '전체'를 보며 진행한다. 처음 열 때의 거르개는 따로 본다.
  useAppStore.setState({ memoFilter: '전체', entryPanels: [], entryPanel: null });
});

async function 새메모작성(user: ReturnType<typeof userEvent.setup>) {
  render(<><MemoScreen /><EntryPanelHost /></>);
  await user.click(await screen.findByRole('button', { name: /새 메모/ }));
  const box = await screen.findByRole('textbox');
  await user.click(box);
  await user.type(box, '회의 준비');
  return box;
}

/** 저장된 메모 데이터 (addDoc의 두 번째 인자) */
const 저장된메모 = () => (addDocMock as any).mock.calls[0][1];

// 새 메모는 기록과 같은 오른쪽 배너에서 쓴다. 단추는 왼쪽 라벨 거르개 바로 위에 있다.
describe('새 메모는 오른쪽 배너에서', () => {
  it('+ 새 메모 단추는 라벨 거르개 바로 위에 있다', async () => {
    render(<><MemoScreen /><EntryPanelHost /></>);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    const button = screen.getByRole('button', { name: /새 메모/ });

    expect(button.nextElementSibling).toBe(nav);
  });

  it('+ 새 메모를 누르면 배너가 열리고, 저장하면 한 개가 생긴다', async () => {
    const user = userEvent.setup();
    await 새메모작성(user);

    await user.keyboard('{Control>}s{/Control}');

    await waitFor(() => expect(addDocMock).toHaveBeenCalledTimes(1));
    expect(저장된메모().content).toBe('회의 준비');
  });

  it('라벨로 걸러 보고 있으면 그 라벨을 골라 둔 채로 연다', async () => {
    const user = userEvent.setup();
    render(<><MemoScreen /><EntryPanelHost /></>);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    await user.click(within(nav).getByRole('button', { name: /개인/ }));

    await user.click(screen.getByRole('button', { name: /새 메모/ }));
    const box = await screen.findByRole('textbox');
    await user.type(box, '장보기');
    await user.keyboard('{Control>}s{/Control}');

    await waitFor(() => expect(addDocMock).toHaveBeenCalled());
    expect(저장된메모().labels).toEqual(['개인']);
  });
});

describe('메모 Ctrl+S 저장', () => {
  it('한 번 누르면 한 개만 저장된다', async () => {
    const user = userEvent.setup();
    await 새메모작성(user);

    await user.keyboard('{Control>}s{/Control}');

    await waitFor(() => expect(addDocMock).toHaveBeenCalledTimes(1));
  });

  it('키가 눌린 채 반복 입력돼도 한 개만 저장된다', async () => {
    const user = userEvent.setup();
    await 새메모작성(user);

    // 키를 누른 채로 두면 브라우저가 keydown을 되풀이해 보낸다 (auto-repeat)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true }));
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, repeat: true })
    );

    await waitFor(() => expect(addDocMock).toHaveBeenCalled());
    expect(addDocMock).toHaveBeenCalledTimes(1);
  });

  it('빠르게 두 번 눌러도 새 메모가 두 개 생기지 않는다', async () => {
    const user = userEvent.setup();
    await 새메모작성(user);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true }));

    await waitFor(() => expect(addDocMock).toHaveBeenCalled());
    expect(addDocMock).toHaveBeenCalledTimes(1);
  });
});

// 고른 라벨에 연한 라벨색만 깔려서, 색이 옅은 라벨은 안 고른 것과 거의 같아 보였다.
// 무엇으로 걸러 보고 있는지 모른 채 '메모가 없다'고 여기기 쉬웠다.
describe('메모 필터 - 고른 것이 분명히 보인다', () => {
  const nav = () => screen.getByRole('navigation', { name: '메모 라벨 거르개' });
  const chip = (name: string) => within(nav()).getByRole('button', { name: new RegExp(name) });

  it('거르개는 왼쪽 세로 목록이고, 기억한 것이 없으면 즐겨찾기로 연다', async () => {
    useAppStore.setState({ memoFilter: null });
    render(<><MemoScreen /><EntryPanelHost /></>);

    await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    expect(chip('⭐ 즐겨찾기')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('전체 메모')).toHaveAttribute('aria-pressed', 'false');
  });

  it('차례는 즐겨찾기 → 라벨(라벨 관리의 차례) → 전체 메모', async () => {
    render(<><MemoScreen /><EntryPanelHost /></>);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    const names = within(nav)
      .getAllByRole('button', { pressed: undefined as any })
      .filter((b) => b.hasAttribute('aria-pressed'))
      .map((b) => b.textContent!.replace(/✓|\d+/g, '').trim());
    expect(names).toEqual(['⭐ 즐겨찾기', '업무', '개인', '전체 메모']);
  });

  it('고른 거르개를 기억했다가 다시 열 때 그대로 연다', async () => {
    const user = userEvent.setup();
    const first = render(<><MemoScreen /><EntryPanelHost /></>);
    await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    await user.click(chip('개인'));
    first.unmount();

    render(<><MemoScreen /><EntryPanelHost /></>);
    await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    expect(chip('개인')).toHaveAttribute('aria-pressed', 'true');
  });

  it('기억한 라벨이 지워졌으면 즐겨찾기로 연다', async () => {
    useAppStore.setState({ memoFilter: '없어진라벨' });
    render(<><MemoScreen /><EntryPanelHost /></>);
    await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    expect(chip('⭐ 즐겨찾기')).toHaveAttribute('aria-pressed', 'true');
  });

  it('라벨을 누르면 그 라벨만 골라진 것으로 보인다', async () => {
    const user = userEvent.setup();
    render(<><MemoScreen /><EntryPanelHost /></>);
    await screen.findByRole('navigation', { name: '메모 라벨 거르개' });

    await user.click(chip('업무'));

    expect(chip('업무')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('전체 메모')).toHaveAttribute('aria-pressed', 'false');
  });

  it('고른 것에는 ✓와 테두리 고리가 붙고, 안 고른 것은 흐리다', async () => {
    const user = userEvent.setup();
    render(<><MemoScreen /><EntryPanelHost /></>);
    await screen.findByRole('navigation', { name: '메모 라벨 거르개' });

    await user.click(chip('업무'));

    const picked = chip('업무');
    expect(picked).toHaveTextContent('✓');
    expect(picked.className).toContain('ring-2');
    expect(picked.className).not.toContain('opacity-60');

    const other = chip('전체 메모');
    expect(other).not.toHaveTextContent('✓');
    expect(other.className).toContain('opacity-60');
  });

  it('거르개마다 진행 중인 메모 개수가 붙는다', async () => {
    render(<><MemoScreen /><EntryPanelHost /></>);
    await screen.findByRole('navigation', { name: '메모 라벨 거르개' });

    expect(chip('전체 메모')).toHaveTextContent(/\d+$/);
  });
});

// 라벨이 없는 메모는 어느 라벨로 걸러도 보이지 않았다. 한 번에 '메모' 라벨을 붙인다.
describe('라벨 없는 메모에 메모 라벨 붙이기', () => {
  const docs = [
    { id: 'a', data: () => ({ text: '라벨 없음', labels: [], createdAt: 4 }) },
    { id: 'b', data: () => ({ text: '라벨 밭이 아예 없음', createdAt: 3 }) },
    { id: 'c', data: () => ({ text: '끝난 것도', labels: [''], completed: true, createdAt: 2 }) },
    { id: 'd', data: () => ({ text: '라벨 있음', labels: ['업무'], createdAt: 1 }) },
  ];
  beforeEach(() => {
    vi.mocked(onSnapshotMock).mockImplementation(((_ref: unknown, next: (s: unknown) => void) => {
      next({ forEach: (f: (d: unknown) => void) => docs.forEach(f), exists: () => false, data: () => ({}) });
      return () => {};
    }) as any);
  });
  afterEach(() => {
    vi.mocked(onSnapshotMock).mockImplementation((() => () => {}) as any);
    vi.restoreAllMocks();
  });

  it('빈 라벨 이름만 있어도 라벨이 없는 것으로 본다', () => {
    expect(isUnlabeledMemo({ labels: [] })).toBe(true);
    expect(isUnlabeledMemo({ labels: undefined })).toBe(true);
    expect(isUnlabeledMemo({ labels: ['', '  '] })).toBe(true);
    expect(isUnlabeledMemo({ labels: ['업무'] })).toBe(false);
  });

  it('라벨 없는 메모 개수를 알려 주고, 누르면 그것들에만 메모 라벨을 붙인다', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const update = vi.fn();
    vi.mocked(writeBatchMock).mockReturnValue({ set: vi.fn(), update, delete: vi.fn(), commit: vi.fn(async () => {}) } as any);
    render(<><MemoScreen /><EntryPanelHost /></>);

    expect(await screen.findByText(/라벨이 없는 메모 3개/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /'메모' 라벨 붙이기/ }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(3));
    expect(update.mock.calls.every(([, data]) => JSON.stringify(data) === JSON.stringify({ labels: ['메모'] }))).toBe(true);
  });

  it('확인 창에서 취소하면 아무것도 바꾸지 않는다', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<><MemoScreen /><EntryPanelHost /></>);

    await user.click(await screen.findByRole('button', { name: /'메모' 라벨 붙이기/ }));

    expect(writeBatchMock).not.toHaveBeenCalled();
  });
});

describe('메모 진행/완료 구역', () => {
  // 구독이 메모 세 개(진행 둘, 완료 하나)를 돌려주게 한다.
  // 빠른 링크도 같은 onSnapshot을 쓰므로 문서 모양(exists/data)도 갖춰 둔다.
  const docs = [
    { id: 'a', data: () => ({ text: '진행 하나', labels: ['업무'], createdAt: 3 }) },
    { id: 'b', data: () => ({ text: '진행 둘', labels: ['개인'], createdAt: 2 }) },
    { id: 'c', data: () => ({ text: '끝난 일', labels: ['업무'], completed: true, createdAt: 1 }) },
  ];
  beforeEach(() => {
    vi.mocked(onSnapshotMock).mockImplementation(((_ref: unknown, next: (s: unknown) => void) => {
      next({ forEach: (f: (d: unknown) => void) => docs.forEach(f), exists: () => false, data: () => ({}) });
      return () => {};
    }) as any);
  });
  afterEach(() => {
    vi.mocked(onSnapshotMock).mockImplementation((() => () => {}) as any);
  });

  it('진행과 완료를 따로 보여 주고 접을 수 있다', async () => {
    const user = userEvent.setup();
    render(<><MemoScreen /><EntryPanelHost /></>);

    const active = await screen.findByRole('button', { name: /진행 \(2\)/ });
    expect(active).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('진행 하나')).toBeInTheDocument();

    await user.click(active);
    expect(active).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('진행 하나')).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: /완료 \(1\)/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('끝난 일')).toBeInTheDocument();
  });

  it('거르개 개수는 진행 중인 메모만 센다', async () => {
    render(<><MemoScreen /><EntryPanelHost /></>);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    await screen.findByText('진행 하나');

    expect(within(nav).getByRole('button', { name: /전체 메모/ })).toHaveTextContent(/2$/);
    expect(within(nav).getByRole('button', { name: /업무/ })).toHaveTextContent(/1$/);
  });

  it('좁은 화면에서도 메모를 두 열 이상으로 놓는다', async () => {
    render(<><MemoScreen /><EntryPanelHost /></>);
    await screen.findByText('진행 하나');

    const grid = screen.getByText('진행 하나').closest('.grid') as HTMLElement;
    const cols = grid.style.gridTemplateColumns.match(/repeat\((\d+)/);
    expect(Number(cols?.[1])).toBeGreaterThanOrEqual(2);
  });
});

// 자주 보는 메모가 아래로 밀려 내려가 찾기 어려웠다.
describe('메모 즐겨찾기', () => {
  it('거르개 머리의 톱니바퀴를 누르면 메모 라벨 설정이 열린다', async () => {
    const user = userEvent.setup();
    const { useAppStore } = await import('../../store/useAppStore');
    render(<><MemoScreen /><EntryPanelHost /></>);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });

    await user.click(within(nav).getByRole('button', { name: '메모 라벨 설정' }));

    expect(useAppStore.getState().isLabelModalOpen).toBe(true);
    expect(useAppStore.getState().labelModalTab).toBe('memo');
    act(() => useAppStore.getState().closeLabelModal());
  });

  it('즐겨찾기 거르개가 라벨 옆에 있다', async () => {
    render(<><MemoScreen /><EntryPanelHost /></>);

    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    expect(within(nav).getByRole('button', { name: /즐겨찾기/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('즐겨찾기 거르개를 누르면 그것만 골라진 것으로 보인다', async () => {
    const user = userEvent.setup();
    render(<><MemoScreen /><EntryPanelHost /></>);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });

    await user.click(within(nav).getByRole('button', { name: /⭐ 즐겨찾기/ }));

    expect(within(nav).getByRole('button', { name: /⭐ 즐겨찾기/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(nav).getByRole('button', { name: /전체 메모/ })).toHaveAttribute('aria-pressed', 'false');
  });
});

// 로드맵 6-5: 즐겨찾기가 없는데 즐겨찾기로 열면 빈 화면이었다
describe('즐겨찾기가 없으면 전체 메모로 연다', () => {
  let docs: { id: string; data: () => Record<string, unknown> }[] = [];
  const memo = (id: string, text: string, favorite = false) => ({ id, data: () => ({ text, favorite, createdAt: 1 }) });
  const nav = () => screen.getByRole('navigation', { name: '메모 라벨 거르개' });
  const chip = (name: string) => within(nav()).getByRole('button', { name: new RegExp(name) });
  beforeEach(() => {
    useAppStore.setState({ memoFilter: null });
    vi.mocked(onSnapshotMock).mockImplementation(((_ref: unknown, next: (s: unknown) => void) => {
      next({ forEach: (f: (d: unknown) => void) => docs.forEach(f), exists: () => false, data: () => ({}) });
      return () => {};
    }) as any);
  });
  afterEach(() => {
    vi.mocked(onSnapshotMock).mockImplementation((() => () => {}) as any);
  });

  it('하나도 없으면 전체 메모가 골라진 채 메모가 보인다', async () => {
    docs = [memo('a', '장보기'), memo('b', '회의 준비')];
    render(<><MemoScreen /><EntryPanelHost /></>);

    expect(await screen.findByText('장보기')).toBeInTheDocument();
    expect(chip('전체 메모')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('⭐ 즐겨찾기')).toHaveAttribute('aria-pressed', 'false');
  });

  it('하나라도 있으면 지금처럼 즐겨찾기로 연다', async () => {
    docs = [memo('a', '장보기', true), memo('b', '회의 준비')];
    render(<><MemoScreen /><EntryPanelHost /></>);

    expect(await screen.findByText('장보기')).toBeInTheDocument();
    expect(chip('⭐ 즐겨찾기')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('회의 준비')).not.toBeInTheDocument();
  });

  it('즐겨찾기를 기억해 두었어도 없으면 전체로 열고, 기억은 바꾸지 않는다', async () => {
    useAppStore.setState({ memoFilter: '⭐ 즐겨찾기' });
    docs = [memo('a', '장보기')];
    render(<><MemoScreen /><EntryPanelHost /></>);

    expect(await screen.findByText('장보기')).toBeInTheDocument();
    expect(chip('전체 메모')).toHaveAttribute('aria-pressed', 'true');
    expect(useAppStore.getState().memoFilter).toBe('⭐ 즐겨찾기');
  });

  it('기억한 라벨이 지워졌고 즐겨찾기도 없으면 전체로 연다', async () => {
    useAppStore.setState({ memoFilter: '없어진라벨' });
    docs = [memo('a', '장보기')];
    render(<><MemoScreen /><EntryPanelHost /></>);

    expect(await screen.findByText('장보기')).toBeInTheDocument();
    expect(chip('전체 메모')).toHaveAttribute('aria-pressed', 'true');
  });

  it('없어도 ⭐를 누르면 빈 즐겨찾기와 ☆ 안내가 보인다', async () => {
    const user = userEvent.setup();
    docs = [memo('a', '장보기')];
    render(<><MemoScreen /><EntryPanelHost /></>);
    await screen.findByText('장보기');

    await user.click(chip('⭐ 즐겨찾기'));

    expect(chip('⭐ 즐겨찾기')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/즐겨찾기한 메모가 없습니다/)).toBeInTheDocument();
    expect(screen.queryByText('장보기')).not.toBeInTheDocument();
  });
});

describe('메모 라벨 상위/하위', () => {
  // '업무' 칩만 (옆의 '업무 하위 라벨 접기' 단추는 빼고). 이름에는 ✓와 개수가 붙는다.
  const WORK_CHIP = /^(✓\s*)?업무\s*\d*$/;
  // '개인'을 '업무' 밑에 둔다
  const docs = [
    { id: 'a', data: () => ({ text: '업무 메모', labels: ['업무'], createdAt: 3 }) },
    { id: 'b', data: () => ({ text: '개인 메모', labels: ['개인'], createdAt: 2 }) },
  ];
  beforeEach(() => {
    memoParents = { 개인: '업무' };
    vi.mocked(onSnapshotMock).mockImplementation(((_ref: unknown, next: (s: unknown) => void) => {
      next({ forEach: (f: (d: unknown) => void) => docs.forEach(f), exists: () => false, data: () => ({}) });
      return () => {};
    }) as any);
  });
  afterEach(() => {
    memoParents = {};
    vi.mocked(onSnapshotMock).mockImplementation((() => () => {}) as any);
  });

  // 2026-09-30: 상위만 골라도 하위는 들어가지 않는다. 상위 앞 '하위 포함' 체크를 켜야 하위까지.
  // 라벨은 여러 개 고를 수 있고, 트리는 ▴/▾로 접고 편다.
  it('상위만 고르면 하위 메모는 빠지고, 하위 포함 체크를 켜면 들어간다', async () => {
    const user = userEvent.setup();
    render(<><MemoScreen /><EntryPanelHost /></>);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    await screen.findByText('업무 메모');

    // 개수는 그 라벨이 붙은 것만 센다
    expect(within(nav).getByRole('button', { name: WORK_CHIP })).toHaveTextContent(/1$/);
    expect(within(nav).getByRole('button', { name: /개인/ })).toHaveAttribute('title', '업무 › 개인');

    await user.click(within(nav).getByRole('button', { name: WORK_CHIP }));
    expect(screen.getByText('업무 메모')).toBeInTheDocument();
    expect(screen.queryByText('개인 메모')).toBeNull();

    const withChildren = within(nav).getByRole('checkbox', { name: '업무 하위 라벨 포함' });
    await user.click(withChildren);
    expect(withChildren).toBeChecked();
    expect(screen.getByText('업무 메모')).toBeInTheDocument();
    expect(screen.getByText('개인 메모')).toBeInTheDocument();

    // Ctrl+누르기로 상위를 떼면 '하위 포함'도 꺼지고, 아무것도 안 골랐으니 전체
    await user.keyboard('{Control>}');
    await user.click(within(nav).getByRole('button', { name: WORK_CHIP }));
    await user.keyboard('{/Control}');
    expect(withChildren).not.toBeChecked();
    expect(within(nav).getByRole('button', { name: /전체 메모/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('하위 포함 체크만 켜도 상위가 함께 골라진다', async () => {
    const user = userEvent.setup();
    render(<><MemoScreen /><EntryPanelHost /></>);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    await screen.findByText('업무 메모');

    await user.click(within(nav).getByRole('checkbox', { name: '업무 하위 라벨 포함' }));
    expect(within(nav).getByRole('button', { name: WORK_CHIP })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('개인 메모')).toBeInTheDocument();
  });

  // 윈도우 탐색기처럼: 그냥 누르면 하나만, Ctrl은 더하기·빼기, Shift는 범위, ESC는 모두 떼기
  it('그냥 누르면 그 라벨 하나만 골라진다', async () => {
    const user = userEvent.setup();
    render(<><MemoScreen /><EntryPanelHost /></>);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    await screen.findByText('업무 메모');

    await user.click(within(nav).getByRole('button', { name: WORK_CHIP }));
    await user.click(within(nav).getByRole('button', { name: /개인/ }));
    expect(within(nav).getByRole('button', { name: WORK_CHIP })).toHaveAttribute('aria-pressed', 'false');
    expect(within(nav).getByRole('button', { name: /개인/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('업무 메모')).toBeNull();
  });

  it('Shift+누르기는 기준부터 여기까지 골라지고, ESC는 모두 뗀다', async () => {
    const user = userEvent.setup();
    render(<><MemoScreen /><EntryPanelHost /></>);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    await screen.findByText('업무 메모');

    await user.click(within(nav).getByRole('button', { name: WORK_CHIP }));
    await user.keyboard('{Shift>}');
    await user.click(within(nav).getByRole('button', { name: /개인/ }));
    await user.keyboard('{/Shift}');
    expect(useAppStore.getState().memoFilter).toEqual({ labels: ['업무', '개인'], withChildren: [] });

    await user.keyboard('{Escape}');
    expect(within(nav).getByRole('button', { name: /전체 메모/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('업무 메모')).toBeInTheDocument();
    expect(screen.getByText('개인 메모')).toBeInTheDocument();
  });

  it('Ctrl+누르기로 라벨을 여러 개 고를 수 있다 (하나라도 붙은 메모가 보인다)', async () => {
    const user = userEvent.setup();
    render(<><MemoScreen /><EntryPanelHost /></>);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    await screen.findByText('업무 메모');

    await user.click(within(nav).getByRole('button', { name: WORK_CHIP }));
    await user.keyboard('{Control>}');
    await user.click(within(nav).getByRole('button', { name: /개인/ }));
    await user.keyboard('{/Control}');
    expect(within(nav).getByRole('button', { name: WORK_CHIP })).toHaveAttribute('aria-pressed', 'true');
    expect(within(nav).getByRole('button', { name: /개인/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('업무 메모')).toBeInTheDocument();
    expect(screen.getByText('개인 메모')).toBeInTheDocument();
    expect(useAppStore.getState().memoFilter).toEqual({ labels: ['업무', '개인'], withChildren: [] });
  });

  it('트리를 접으면 하위 칩이 숨고, 펴면 다시 보인다', async () => {
    const user = userEvent.setup();
    render(<><MemoScreen /><EntryPanelHost /></>);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    await screen.findByText('업무 메모');

    await user.click(within(nav).getByRole('button', { name: '업무 하위 라벨 접기' }));
    expect(within(nav).queryByRole('button', { name: /개인/ })).toBeNull();
    await user.click(within(nav).getByRole('button', { name: '업무 하위 라벨 펼치기' }));
    expect(within(nav).getByRole('button', { name: /개인/ })).toBeInTheDocument();
  });

  it('예전처럼 라벨 하나를 글자로 기억한 것도 읽는다', async () => {
    useAppStore.setState({ memoFilter: '개인' });
    render(<><MemoScreen /><EntryPanelHost /></>);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    await screen.findByText('개인 메모');
    expect(within(nav).getByRole('button', { name: /개인/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('업무 메모')).toBeNull();
  });
});
