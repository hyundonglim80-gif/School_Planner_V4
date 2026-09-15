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
