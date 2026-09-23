import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KeepImportModal from './KeepImportModal';

// 드라이브 올리기는 구글 계정이 필요하다. 여기서는 올린 척만 한다.
vi.mock('../lib/driveApi', () => ({
  uploadToDrive: vi.fn(async (_file: File, name: string) => ({
    id: 'drive-1',
    name,
    downloadLink: 'https://drive.test/drive-1',
  })),
  driveUrlToStore: (mime: string | undefined, f: any) =>
    mime?.startsWith('image/') ? `https://drive.test/img/${f.id}` : f.downloadLink,
}));

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
  const onAddMemo = vi.fn(async (_data: Record<string, any>) => ({}));
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

  it('쌓인 메모 수를 알려 준다', async () => {
    const user = userEvent.setup();
    renderModal();

    await pickFiles(user, [
      file('1.json', { textContent: '첫째' }),
      file('2.json', { textContent: '둘째' }),
    ]);

    expect(await screen.findByText(/지금까지 메모 2건/)).toBeInTheDocument();
  });
});

// Takeout은 메모에 붙어 있던 사진을 같은 폴더에 따로 둔다. 메모의 .json에는
// 파일 이름만 적혀 있어서, 사진까지 함께 골라야 이름으로 짝을 찾을 수 있다.
describe('Keep 가져오기 - 붙어 있던 사진·파일', () => {
  const photo = () =>
    new File([new Uint8Array([1, 2, 3])], '사진.jpg', { type: 'image/jpeg' });
  const noteWithPhoto = () =>
    file('p.json', { textContent: '운동회', attachments: [{ filePath: '사진.jpg' }] });

  it('같이 고른 사진은 짝을 찾아 알려 준다', async () => {
    const user = userEvent.setup();
    renderModal();

    await pickFiles(user, [noteWithPhoto(), photo()]);

    expect(await screen.findByText(/짝을 찾은 파일 1개/)).toBeInTheDocument();
    expect(screen.getByText(/사진·파일 1개/)).toBeInTheDocument();
  });

  it('사진을 드라이브에 올려 메모에 붙인다', async () => {
    const user = userEvent.setup();
    const { onAddMemo } = renderModal();

    await pickFiles(user, [noteWithPhoto(), photo()]);
    await screen.findByText(/짝을 찾은 파일 1개/);
    await user.click(screen.getByRole('button', { name: /메모 1건 가져오기/ }));

    await waitFor(() => expect(onAddMemo).toHaveBeenCalled());
    const sent = onAddMemo.mock.calls[0][0] as any;
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0]).toMatchObject({ name: '사진.jpg', type: 'image/jpeg' });
    // 첫 이미지는 메모의 대표 그림으로도 쓴다
    expect(sent.imageUrl).toBeTruthy();
    // 붙였으므로 본문에 이름을 또 남기지 않는다
    expect(sent.content).toBe('운동회');
  });

  it('사진을 같이 고르지 않았으면 이름만 남긴다', async () => {
    const user = userEvent.setup();
    const { onAddMemo } = renderModal();

    await pickFiles(user, [noteWithPhoto()]);
    await user.click(await screen.findByRole('button', { name: /메모 1건 가져오기/ }));

    await waitFor(() => expect(onAddMemo).toHaveBeenCalled());
    const sent = onAddMemo.mock.calls[0][0] as any;
    expect(sent.attachments).toBeUndefined();
    expect(sent.content).toContain('📎 Keep에 붙어 있던 파일: 사진.jpg');
  });

  it("'사진·파일도 함께 붙이기'를 끄면 올리지 않는다", async () => {
    const user = userEvent.setup();
    const { onAddMemo } = renderModal();

    await pickFiles(user, [noteWithPhoto(), photo()]);
    await screen.findByText(/짝을 찾은 파일 1개/);
    await user.click(screen.getByLabelText(/사진·파일도 함께 붙이기/));
    await user.click(screen.getByRole('button', { name: /메모 1건 가져오기/ }));

    await waitFor(() => expect(onAddMemo).toHaveBeenCalled());
    expect((onAddMemo.mock.calls[0][0] as any).attachments).toBeUndefined();
  });
});
