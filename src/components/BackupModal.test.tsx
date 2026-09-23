import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BackupModal from './BackupModal';
import {
  setDoc as setDocMock,
  doc as docMock,
  collection as collectionMock,
} from 'firebase/firestore';

// 가져오기는 파일을 하나만 받았다. 백업을 기간별로 나눠 받아 두면(학기별 등)
// 되돌릴 때 파일 수만큼 이 과정을 되풀이해야 했고, 그때마다 새로고침까지 됐다.

const backup = (name: string, data: any) =>
  new File([JSON.stringify(data)], name, { type: 'application/json' });

/** 어느 컬렉션의 어느 문서에 썼는지 (doc 목 덕분에 경로가 남는다) */
const written = () =>
  (setDocMock as any).mock.calls.map((c: any[]) => String(c[0]?.path || ''));

beforeEach(() => {
  vi.clearAllMocks();
  // 어느 컬렉션에 썼는지 알아야 하므로 경로를 남기는 목으로 바꾼다
  (collectionMock as any).mockImplementation((...args: any[]) => ({
    path: args.slice(1).join('/'),
  }));
  (docMock as any).mockImplementation((...args: any[]) => {
    const [first, ...rest] = args;
    const head = typeof first === 'string' ? first : (first?.path ?? '');
    return { path: [head, ...rest.filter((x) => typeof x === 'string')].join('/') };
  });
  // 새로고침을 막는다 (jsdom에서 not implemented 오류가 난다)
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  Object.defineProperty(window, 'location', {
    value: { ...window.location, reload: vi.fn() },
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const openAndPick = async (files: File[]) => {
  const user = userEvent.setup();
  render(<BackupModal isOpen onClose={vi.fn()} />);
  await user.upload(screen.getByLabelText('가져올 백업 파일'), files);
  return user;
};

describe('내보내기/가져오기 - 백업 파일 여러 개 가져오기', () => {
  it('고른 파일을 모두 되돌린다', async () => {
    await openAndPick([
      backup('1학기.json', { tasks: { m1: { text: '메모1' } } }),
      backup('2학기.json', { tasks: { m2: { text: '메모2' } } }),
    ]);

    await waitFor(() => expect(setDocMock).toHaveBeenCalled());
    const paths = written();
    expect(paths.some((p: string) => p.endsWith('/m1'))).toBe(true);
    expect(paths.some((p: string) => p.endsWith('/m2'))).toBe(true);
  });

  it('무엇을 되돌리는지 파일 이름까지 묻는다', async () => {
    await openAndPick([
      backup('1학기.json', { tasks: { m1: { text: '메모1' } } }),
      backup('2학기.json', { tasks: { m2: { text: '메모2' } } }),
    ]);

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    const asked = (window.confirm as any).mock.calls[0][0] as string;
    expect(asked).toContain('백업 파일 2개');
    expect(asked).toContain('1학기.json');
    expect(asked).toContain('2학기.json');
    expect(asked).toContain('메모 2건');
  });

  it('깨진 파일이 있어도 나머지는 되돌린다', async () => {
    const user = userEvent.setup();
    render(<BackupModal isOpen onClose={vi.fn()} />);
    const bad = new File(['{이건 JSON이 아니다'], '깨진.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('가져올 백업 파일'), [
      bad,
      backup('정상.json', { tasks: { m1: { text: '메모1' } } }),
    ]);

    await waitFor(() => expect(setDocMock).toHaveBeenCalled());
    expect(written().some((p: string) => p.endsWith('/m1'))).toBe(true);
    expect((window.confirm as any).mock.calls[0][0]).toContain('읽지 못한 파일 1개');
  });
});

describe('내보내기/가져오기 - 고른 항목만 되돌린다', () => {
  it('메모만 골랐으면 일정은 건드리지 않는다', async () => {
    // 예전에는 고른 항목이 내보낼 때만 쓰이고 가져올 때는 무시됐다.
    // 메모만 가져오려 해도 그날 일정·수업이 백업 시점 것으로 바뀌었다.
    const user = userEvent.setup();
    render(<BackupModal isOpen onClose={vi.fn()} />);

    // 일정·수업·기록을 끄고 메모만 남긴다
    for (const label of ['📅 일정', '⏰ 수업', '📔 기록']) {
      const box = screen.getByLabelText(label) as HTMLInputElement;
      if (box.checked) await user.click(box);
    }

    await user.upload(screen.getByLabelText('가져올 백업 파일'), [
      backup('전체.json', {
        events: { '2026-09-01': { eventText: '일정' } },
        tasks: { m1: { text: '메모1' } },
      }),
    ]);

    await waitFor(() => expect(setDocMock).toHaveBeenCalled());
    const paths = written();
    expect(paths.some((p: string) => p.includes('/tasks/'))).toBe(true);
    expect(paths.some((p: string) => p.includes('/events/'))).toBe(false);
  });
});

// Keep에서 내보낸 파일을 이 창에 넣는 일이 잦다. 생김새가 아주 달라 백업 복원
// 길로는 읽을 수 없으므로(갈래별 묶음이 아니라 메모 한 건의 모양),
// 라벨·사진·중복 건너뛰기를 챙기는 Keep 전용 창으로 넘긴다.
describe('내보내기/가져오기 - Keep 파일을 넣었을 때', () => {
  const keepNote = new File(
    [JSON.stringify({ textContent: '운동회 준비', isTrashed: false })],
    'note.json',
    { type: 'application/json' }
  );

  it('Keep 전용 가져오기 창으로 넘긴다', async () => {
    const user = userEvent.setup();
    render(<BackupModal isOpen onClose={vi.fn()} />);

    await user.upload(screen.getByLabelText('가져올 백업 파일'), [keepNote]);

    expect(await screen.findByRole('heading', { name: /Keep 메모 가져오기/ })).toBeInTheDocument();
    // 백업 복원 확인창은 뜨지 않는다 (덮어쓰기와 아무 상관이 없다)
    expect(window.confirm).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('넘겨준 파일을 그 창이 바로 읽는다', async () => {
    const user = userEvent.setup();
    render(<BackupModal isOpen onClose={vi.fn()} />);

    await user.upload(screen.getByLabelText('가져올 백업 파일'), [keepNote]);

    expect(await screen.findByText('운동회 준비')).toBeInTheDocument();
  });

  it('V4 백업 파일은 그대로 복원한다', async () => {
    const user = userEvent.setup();
    render(<BackupModal isOpen onClose={vi.fn()} />);

    await user.upload(screen.getByLabelText('가져올 백업 파일'), [
      backup('백업.json', { tasks: { m1: { text: '메모1' } } }),
    ]);

    await waitFor(() => expect(setDocMock).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: /Keep 메모 가져오기/ })).toBeNull();
  });
});
