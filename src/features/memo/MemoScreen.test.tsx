import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MemoScreen from './MemoScreen';
import { addDoc as addDocMock } from 'firebase/firestore';

vi.mock('../../hooks/useLabels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useLabels')>();
  return {
    ...actual,
    useLabels: () => ({
      eventLabels: [],
      journalLabels: [],
      memoLabels: ['업무'],
      getLabelColor: () => 'blue',
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function 새메모작성(user: ReturnType<typeof userEvent.setup>) {
  render(<MemoScreen />);
  await user.click(await screen.findByRole('button', { name: /첫 메모 작성하기|새 메모|\+/ }));
  const box = await screen.findByRole('textbox');
  await user.click(box);
  await user.type(box, '회의 준비');
  return box;
}

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
  const chip = (name: string) => screen.getByRole('button', { name: new RegExp(name) });

  it('처음에는 전체 메모가 골라져 있다', async () => {
    render(<MemoScreen />);

    expect(await screen.findByRole('button', { name: /전체 메모/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(chip('업무')).toHaveAttribute('aria-pressed', 'false');
  });

  it('라벨을 누르면 그 라벨만 골라진 것으로 보인다', async () => {
    const user = userEvent.setup();
    render(<MemoScreen />);

    await user.click(await screen.findByRole('button', { name: /업무/ }));

    expect(chip('업무')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('전체 메모')).toHaveAttribute('aria-pressed', 'false');
  });

  it('고른 것에는 ✓와 테두리 고리가 붙고, 안 고른 것은 흐리다', async () => {
    const user = userEvent.setup();
    render(<MemoScreen />);

    await user.click(await screen.findByRole('button', { name: /업무/ }));

    const picked = chip('업무');
    expect(picked).toHaveTextContent('✓');
    expect(picked.className).toContain('ring-2');
    expect(picked.className).not.toContain('opacity-60');

    const other = chip('전체 메모');
    expect(other).not.toHaveTextContent('✓');
    expect(other.className).toContain('opacity-60');
  });
});

// 자주 보는 메모가 아래로 밀려 내려가 찾기 어려웠다.
describe('메모 즐겨찾기', () => {
  it('메모마다 즐겨찾기 단추가 있다', async () => {
    const user = userEvent.setup();
    await 새메모작성(user);

    expect(screen.getAllByTitle(/즐겨찾기/).length).toBeGreaterThan(0);
  });

  it('즐겨찾기 거르개가 라벨 옆에 있다', async () => {
    render(<MemoScreen />);

    const chip = await screen.findByRole('button', { name: /즐겨찾기/ });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
  });

  it('즐겨찾기 거르개를 누르면 그것만 골라진 것으로 보인다', async () => {
    const user = userEvent.setup();
    render(<MemoScreen />);

    await user.click(await screen.findByRole('button', { name: /⭐ 즐겨찾기/ }));

    expect(screen.getByRole('button', { name: /⭐ 즐겨찾기/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /전체 메모/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
