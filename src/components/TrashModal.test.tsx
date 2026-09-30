import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDocs as getDocsMock } from 'firebase/firestore';
import TrashModal, { trashTabOf } from './TrashModal';
import { deleteFromTrash } from '../utils/trashHelper';

// 휴지통 위쪽 탭 (2026-09-30): 전체 / 일정 / 기록 / 메모 / 클립보드 / 기타.
// 기타 = 일정·기록·메모·클립보드를 뺀 모든 것.

vi.mock('../lib/clipboardHistory', () => ({
  listClipTrash: vi.fn(async () => [{ id: 'c1', kind: 'text', text: '복사한 글', deletedAt: 5 }]),
  deleteClipTrash: vi.fn(async () => {}),
  restoreClipFromTrash: vi.fn(async () => {}),
}));
vi.mock('../lib/trashRetention', () => ({
  loadTrashRetention: vi.fn(async () => 0),
  purgeExpiredTrash: vi.fn(async () => {}),
}));
vi.mock('../utils/trashHelper', () => ({
  completeRestoreFromTrash: vi.fn(async () => {}),
  deleteFromTrash: vi.fn(async () => {}),
}));
vi.mock('../utils/storageCleanup', () => ({
  collectUploadUrls: () => [],
  deleteUnreferencedUploads: vi.fn(async () => {}),
}));

const ITEMS = [
  { id: 'e1', type: 'event', content: '지운 일정', deletedAt: 10 },
  { id: 'j1', type: 'journal', content: '지운 기록', deletedAt: 9 },
  { id: 'm1', type: 'memo', content: '지운 메모', deletedAt: 8 },
  { id: 'd1', type: 'dday', content: '지운 디데이', deletedAt: 7 },
  { id: 'l1', type: 'label', content: '[메모] 지운 라벨', deletedAt: 6 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDocsMock).mockResolvedValue({ forEach: (f: (d: unknown) => void) => ITEMS.forEach((it) => f({ data: () => it })), docs: [] } as any);
});

const tab = (name: RegExp) => screen.getByRole('tab', { name });

describe('휴지통 - 종류별 탭', () => {
  it('기타는 일정·기록·메모·클립보드를 뺀 모든 것', () => {
    expect(['event', 'journal', 'memo', 'clip'].map(trashTabOf)).toEqual(['event', 'journal', 'memo', 'clip']);
    expect(['schedule', 'dday', 'eval', 'roster', 'label', 'template', '새종류'].map(trashTabOf)).toEqual(
      Array(7).fill('etc')
    );
  });

  it('탭마다 개수가 붙고, 누르면 그 종류만 보인다', async () => {
    const user = userEvent.setup();
    render(<TrashModal isOpen onClose={vi.fn()} />);
    await screen.findByText('지운 일정');
    expect(tab(/^전체/)).toHaveTextContent('전체6');
    expect(tab(/^기타/)).toHaveTextContent('기타2');
    expect(tab(/^클립보드/)).toHaveTextContent('클립보드1');

    await user.click(tab(/^메모/));
    expect(tab(/^메모/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('지운 메모')).toBeInTheDocument();
    expect(screen.queryByText('지운 일정')).toBeNull();

    await user.click(tab(/^기타/));
    expect(screen.getByText('지운 디데이')).toBeInTheDocument();
    expect(screen.getByText('[메모] 지운 라벨')).toBeInTheDocument();
    expect(screen.queryByText('지운 메모')).toBeNull();
  });

  it('전체 선택·비우기는 보고 있는 탭만, 탭을 바꾸면 선택이 풀린다', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TrashModal isOpen onClose={vi.fn()} />);
    await screen.findByText('지운 일정');

    await user.click(screen.getByLabelText(/전체 선택/));
    expect(screen.getByText('(6개 선택됨)')).toBeInTheDocument();
    await user.click(tab(/^기타/));
    expect(screen.queryByText(/개 선택됨/)).toBeNull();
    await user.click(screen.getByLabelText(/전체 선택/));
    expect(screen.getByText('(2개 선택됨)')).toBeInTheDocument();
    await user.click(tab(/^일정/));

    await user.click(screen.getByRole('button', { name: '일정 비우기' }));
    await waitFor(() => expect(deleteFromTrash).toHaveBeenCalledTimes(1));
    expect(deleteFromTrash).toHaveBeenCalledWith('e1');
    expect(screen.getByText('지운 일정 항목이 없습니다.')).toBeInTheDocument();
    // 다른 탭의 것은 그대로
    await user.click(tab(/^전체/));
    expect(within(screen.getByRole('tablist')).getByRole('tab', { name: /^전체/ })).toHaveTextContent('전체5');
  });
});
