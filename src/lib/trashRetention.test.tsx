import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { getDocs, deleteDoc, getDoc } from 'firebase/firestore';
import { purgeExpiredTrash, sanitizeRetention } from './trashRetention';
import {
  useClipboardHistory,
  addClipText,
  removeClip,
  clearClips,
  restoreClipFromTrash,
  purgeClipTrash,
} from './clipboardHistory';
import TrashModal from '../components/TrashModal';

// 클립보드에서 지운 것도 휴지통으로 가고, 휴지통은 환경설정에서 정한 기간이 지나면 비운다.

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  useClipboardHistory.setState({ items: [], trash: [], loaded: true });
});

describe('클립보드 - 지우면 휴지통으로', () => {
  it('✕로 지우면 목록에서 빠지고 휴지통에 들어간다. 되살리면 돌아온다', async () => {
    await addClipText('되살릴 글');
    const id = useClipboardHistory.getState().items[0].id;
    await removeClip(id);
    expect(useClipboardHistory.getState().items).toHaveLength(0);
    expect(useClipboardHistory.getState().trash.map((t) => t.text)).toEqual(['되살릴 글']);

    await restoreClipFromTrash(id);
    expect(useClipboardHistory.getState().items.map((i) => i.text)).toEqual(['되살릴 글']);
    expect(useClipboardHistory.getState().trash).toHaveLength(0);
  });

  it("'모두 지우기'도 휴지통으로 옮긴다", async () => {
    await addClipText('하나');
    await addClipText('둘');
    await clearClips();
    expect(useClipboardHistory.getState().items).toHaveLength(0);
    expect(useClipboardHistory.getState().trash).toHaveLength(2);
  });

  it('기간이 지난 클립보드 휴지통 항목만 영구 삭제한다', async () => {
    await addClipText('오래된 것');
    await addClipText('최근 것');
    await clearClips();
    const [a, b] = useClipboardHistory.getState().trash;
    useClipboardHistory.setState({
      trash: [
        { ...a, deletedAt: Date.now() - 40 * DAY },
        { ...b, deletedAt: Date.now() - 1 * DAY },
      ],
    });
    const n = await purgeClipTrash(Date.now() - 30 * DAY);
    expect(n).toBe(1);
    expect(useClipboardHistory.getState().trash.map((t) => t.deletedAt > Date.now() - 2 * DAY)).toEqual([true]);
  });
});

describe('휴지통 자동 비우기', () => {
  it('고를 수 있는 값이 아니면 끄기(0)로 본다', () => {
    expect(sanitizeRetention(30)).toBe(30);
    expect(sanitizeRetention('7')).toBe(7);
    expect(sanitizeRetention(45)).toBe(0);
    expect(sanitizeRetention(undefined)).toBe(0);
  });

  it('끄기(0)면 아무것도 지우지 않는다', async () => {
    expect(await purgeExpiredTrash('uid', 0)).toBe(0);
    expect(getDocs).not.toHaveBeenCalled();
  });

  it('기간이 지난 계정 휴지통 항목을 영구 삭제한다', async () => {
    const ref1 = { id: 'a' };
    const ref2 = { id: 'b' };
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [
        { id: 'a', ref: ref1, data: () => ({ data: {} }) },
        { id: 'b', ref: ref2, data: () => ({ data: {} }) },
      ],
    } as any);
    expect(await purgeExpiredTrash('uid', 30)).toBe(2);
    expect(deleteDoc).toHaveBeenCalledWith(ref1);
    expect(deleteDoc).toHaveBeenCalledWith(ref2);
  });
});

describe('휴지통 창', () => {
  it('클립보드에서 지운 것도 보이고(이 기기), 되살릴 수 있다', async () => {
    await addClipText('휴지통 속 클립');
    await removeClip(useClipboardHistory.getState().items[0].id);
    render(<TrashModal isOpen onClose={vi.fn()} />);
    expect(await screen.findByText('휴지통 속 클립')).toBeInTheDocument();
    // 항목의 종류 표시와 위쪽 '클립보드' 탭 (개수 1)
    expect(screen.getAllByText('클립보드')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: /^클립보드/ })).toHaveTextContent('클립보드1');
    expect(screen.getByText('이 기기')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '복원' }));
    await waitFor(() => expect(useClipboardHistory.getState().items.map((i) => i.text)).toEqual(['휴지통 속 클립']));
  });

  it('자동 비우기 기간을 알려 주고, 휴지통 비우기로 바로 모두 지운다', async () => {
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({ retentionDays: 30 }) } as any);
    await addClipText('비울 것');
    await removeClip(useClipboardHistory.getState().items[0].id);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TrashModal isOpen onClose={vi.fn()} />);
    expect(await screen.findByText('30일')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '휴지통 비우기' }));
    await waitFor(() => expect(useClipboardHistory.getState().trash).toHaveLength(0));
    vi.mocked(getDoc).mockReset();
  });
});
