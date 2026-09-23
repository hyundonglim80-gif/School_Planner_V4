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

// Takeout의 Keep 폴더에는 파일이 수백 개라 한 번에 다 고르지 못하는 경우가 많다.
// 예전에는 새로 고를 때마다 앞서 고른 것이 통째로 날아가 두 번째 묶음만 들어갔다.
describe('Keep 가져오기 - 파일을 나눠 고르기', () => {
  it('두 번 나눠 골라도 앞서 고른 것이 남는다', async () => {
    const user = userEvent.setup();
    renderModal();

    await pickFiles(user, [file('1.json', { textContent: '첫째' })]);
    expect(await screen.findByText(/메모 1건 가져오기/)).toBeInTheDocument();

    await pickFiles(user, [file('2.json', { textContent: '둘째' })]);

    expect(await screen.findByText(/메모 2건 가져오기/)).toBeInTheDocument();
    expect(screen.getByText('첫째')).toBeInTheDocument();
    expect(screen.getByText('둘째')).toBeInTheDocument();
  });

  it('같은 파일을 또 골라도 한 번만 센다', async () => {
    const user = userEvent.setup();
    renderModal();

    // 디스크의 같은 파일을 두 번 고르는 것과 같다 (이름·크기·고친 때가 같다)
    const same = file('1.json', { textContent: '첫째' });
    await pickFiles(user, [same]);
    await screen.findByText(/메모 1건 가져오기/);
    await pickFiles(user, [same]);

    // 두 번 골랐지만 메모는 하나다
    expect(await screen.findByText(/메모 1건 가져오기/)).toBeInTheDocument();
  });

  it('고른 파일을 비울 수 있다', async () => {
    const user = userEvent.setup();
    renderModal();

    await pickFiles(user, [file('1.json', { textContent: '첫째' })]);
    await screen.findByText(/메모 1건 가져오기/);

    await user.click(screen.getByRole('button', { name: '고른 파일 비우기' }));

    expect(await screen.findByText(/메모 0건 가져오기/)).toBeInTheDocument();
    expect(screen.queryByText('첫째')).toBeNull();
  });

  it('쌓인 파일 수와 메모 수를 알려 준다', async () => {
    const user = userEvent.setup();
    renderModal();

    await pickFiles(user, [
      file('1.json', { textContent: '첫째' }),
      file('2.json', { textContent: '둘째' }),
    ]);

    expect(await screen.findByText(/파일 2개 · 메모 2건/)).toBeInTheDocument();
  });
});
