import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KeepImportModal from './KeepImportModal';

// Takeout은 메모 하나에 파일 하나씩 준다.
const file = (name: string, note: any) =>
  new File([JSON.stringify(note)], name, { type: 'application/json' });

const NOTES = [
  file('a.json', { title: '학부모 상담', textContent: '3시 김OO', labels: [{ name: '업무' }] }),
  file('b.json', { textContent: '보관한 메모', isArchived: true }),
  file('c.json', { textContent: '버린 메모', isTrashed: true }),
  file('d.html', { textContent: '이건 안 읽는다' }),
];

function renderModal() {
  const onAddMemo = vi.fn(async (_data: { content: string; labels?: string[] }) => ({}));
  const onClose = vi.fn();
  render(<KeepImportModal isOpen onClose={onClose} onAddMemo={onAddMemo} />);
  return { onAddMemo, onClose };
}

const pickFiles = async (user: ReturnType<typeof userEvent.setup>, files: File[]) => {
  await user.upload(screen.getByLabelText('Keep 파일'), files);
};

describe('Keep 가져오기', () => {
  it('고른 파일에서 메모를 찾아 미리 보여 준다', async () => {
    const user = userEvent.setup();
    renderModal();

    await pickFiles(user, NOTES);

    // .html은 건너뛰고, 휴지통과 보관은 기본으로 빠져 한 건만 남는다
    expect(await screen.findByText(/메모 1건 가져오기/)).toBeInTheDocument();
    expect(screen.getByText(/학부모 상담/)).toBeInTheDocument();
  });

  it('보관한 메모도 고르면 함께 가져온다', async () => {
    const user = userEvent.setup();
    renderModal();

    await pickFiles(user, NOTES);
    await screen.findByText(/메모 1건 가져오기/);
    await user.click(screen.getByLabelText(/보관/));

    expect(await screen.findByText(/메모 2건 가져오기/)).toBeInTheDocument();
  });

  it('휴지통에 있던 메모는 골라도 안 들어간다', async () => {
    const user = userEvent.setup();
    const { onAddMemo } = renderModal();

    await pickFiles(user, NOTES);
    await screen.findByText(/메모 1건 가져오기/);
    await user.click(screen.getByRole('button', { name: /메모 1건 가져오기/ }));

    await waitFor(() => expect(onAddMemo).toHaveBeenCalledTimes(1));
    expect(onAddMemo).toHaveBeenCalledWith({
      content: '학부모 상담\n3시 김OO',
      labels: ['업무'],
    });
  });

  it('라벨을 끄면 라벨 없이 넣는다', async () => {
    const user = userEvent.setup();
    const { onAddMemo } = renderModal();

    await pickFiles(user, NOTES);
    await screen.findByText(/메모 1건 가져오기/);
    await user.click(screen.getByLabelText(/라벨/));
    await user.click(screen.getByRole('button', { name: /메모 1건 가져오기/ }));

    await waitFor(() => expect(onAddMemo).toHaveBeenCalled());
    expect(onAddMemo.mock.calls[0][0]).toMatchObject({ labels: [] });
  });

  it('가져올 것이 없으면 단추가 눌리지 않는다', () => {
    renderModal();

    expect(screen.getByRole('button', { name: /메모 0건 가져오기/ })).toBeDisabled();
  });
});
