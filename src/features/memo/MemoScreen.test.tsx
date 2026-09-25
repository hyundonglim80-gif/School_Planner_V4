import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MemoScreen from './MemoScreen';
import { addDoc as addDocMock, onSnapshot as onSnapshotMock } from 'firebase/firestore';

vi.mock('../../hooks/useLabels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useLabels')>();
  return {
    ...actual,
    useLabels: () => ({
      eventLabels: [],
      journalLabels: [],
      memoLabels: ['업무', '개인'],
      getLabelColor: () => ({ bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' }),
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function 새메모작성(user: ReturnType<typeof userEvent.setup>) {
  render(<MemoScreen />);
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
    render(<MemoScreen />);
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
    render(<MemoScreen />);
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

  it('거르개는 왼쪽 세로 목록이고, 처음에는 전체 메모가 골라져 있다', async () => {
    render(<MemoScreen />);

    await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    expect(chip('전체 메모')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('업무')).toHaveAttribute('aria-pressed', 'false');
  });

  it('라벨을 누르면 그 라벨만 골라진 것으로 보인다', async () => {
    const user = userEvent.setup();
    render(<MemoScreen />);
    await screen.findByRole('navigation', { name: '메모 라벨 거르개' });

    await user.click(chip('업무'));

    expect(chip('업무')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('전체 메모')).toHaveAttribute('aria-pressed', 'false');
  });

  it('고른 것에는 ✓와 테두리 고리가 붙고, 안 고른 것은 흐리다', async () => {
    const user = userEvent.setup();
    render(<MemoScreen />);
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
    render(<MemoScreen />);
    await screen.findByRole('navigation', { name: '메모 라벨 거르개' });

    expect(chip('전체 메모')).toHaveTextContent(/\d+$/);
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
    render(<MemoScreen />);

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
    render(<MemoScreen />);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    await screen.findByText('진행 하나');

    expect(within(nav).getByRole('button', { name: /전체 메모/ })).toHaveTextContent(/2$/);
    expect(within(nav).getByRole('button', { name: /업무/ })).toHaveTextContent(/1$/);
  });

  it('좁은 화면에서도 메모를 두 열 이상으로 놓는다', async () => {
    render(<MemoScreen />);
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
    render(<MemoScreen />);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });

    await user.click(within(nav).getByRole('button', { name: '메모 라벨 설정' }));

    expect(useAppStore.getState().isLabelModalOpen).toBe(true);
    expect(useAppStore.getState().labelModalTab).toBe('memo');
    act(() => useAppStore.getState().closeLabelModal());
  });

  it('즐겨찾기 거르개가 라벨 옆에 있다', async () => {
    render(<MemoScreen />);

    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });
    expect(within(nav).getByRole('button', { name: /즐겨찾기/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('즐겨찾기 거르개를 누르면 그것만 골라진 것으로 보인다', async () => {
    const user = userEvent.setup();
    render(<MemoScreen />);
    const nav = await screen.findByRole('navigation', { name: '메모 라벨 거르개' });

    await user.click(within(nav).getByRole('button', { name: /⭐ 즐겨찾기/ }));

    expect(within(nav).getByRole('button', { name: /⭐ 즐겨찾기/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(nav).getByRole('button', { name: /전체 메모/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
