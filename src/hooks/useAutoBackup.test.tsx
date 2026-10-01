import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAutoBackupRunner } from './useAutoBackup';
import AutoBackupBanner from '../components/AutoBackupBanner';
import { runDriveBackup } from '../lib/autoBackup';
import { getGoogleTokenQuietly, getValidGoogleToken } from '../lib/googleApi';

// 드라이브 자동 백업을 앱을 열 때 돌리기·밀림 띠 (docs/ROADMAP.md 3-3)

const env = vi.hoisted(() => ({ settingsData: null as any, device: 'pc' as 'pc' | 'mobile' }));
vi.mock('../lib/firestoreSubscribe', () => ({
  subscribeDocWithServerFallback: (_ref: any, onData: (d: any) => void) => {
    onData(env.settingsData);
    return () => {};
  },
}));
vi.mock('../lib/preferenceSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/preferenceSync')>();
  return { ...actual, detectDeviceKind: () => env.device };
});
vi.mock('../lib/googleApi', () => ({ getGoogleTokenQuietly: vi.fn(), getValidGoogleToken: vi.fn() }));
vi.mock('../lib/autoBackup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/autoBackup')>();
  return { ...actual, runDriveBackup: vi.fn(async () => ({ name: 'SP4_자동백업_2026-10-01.json', summary: '일정 1일', trashed: 0 })) };
});

const DAY = 86_400_000;

function Harness() {
  const b = useAutoBackupRunner();
  return b.nag ? <AutoBackupBanner overdue={b.overdue} keep={b.settings.keep} onSnooze={b.snooze} /> : <span>띠 없음</span>;
}

beforeEach(() => {
  vi.mocked(runDriveBackup).mockClear();
  vi.mocked(getGoogleTokenQuietly).mockReset();
  vi.mocked(getValidGoogleToken).mockReset();
  env.device = 'pc';
  try {
    localStorage.clear();
  } catch {
    /* 없음 */
  }
});

describe('앱을 열 때 자동 백업', () => {
  it('할 때가 됐고 구글 권한이 이미 있으면 창 없이 조용히 백업한다', async () => {
    env.settingsData = { lastAt: Date.now() - 8 * DAY };
    vi.mocked(getGoogleTokenQuietly).mockResolvedValue('tok');
    render(<Harness />);
    await waitFor(() => expect(runDriveBackup).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok', keep: 8 })));
    expect(getValidGoogleToken).not.toHaveBeenCalled(); // 권한 창을 띄우는 길은 쓰지 않는다
  });

  it('할 때가 아니면 아무것도 하지 않는다', async () => {
    env.settingsData = { lastAt: Date.now() - 2 * DAY };
    vi.mocked(getGoogleTokenQuietly).mockResolvedValue('tok');
    render(<Harness />);
    await new Promise((r) => setTimeout(r, 0));
    expect(getGoogleTokenQuietly).not.toHaveBeenCalled();
    expect(runDriveBackup).not.toHaveBeenCalled();
    expect(screen.getByText('띠 없음')).toBeInTheDocument();
  });

  it('권한이 없어 3일 넘게 밀리면 띠를 띄우고, 나중에를 누르면 내린다', async () => {
    env.settingsData = { lastAt: Date.now() - 11 * DAY };
    vi.mocked(getGoogleTokenQuietly).mockResolvedValue(null);
    render(<Harness />);
    expect(await screen.findByText(/자동 백업이 4일 밀렸습니다/)).toBeInTheDocument();
    expect(runDriveBackup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '나중에' }));
    expect(screen.getByText('띠 없음')).toBeInTheDocument();
  });

  it("띠의 '지금 백업'은 권한 창을 띄워서라도 백업한다", async () => {
    env.settingsData = { lastAt: Date.now() - 11 * DAY, keep: 12 };
    vi.mocked(getGoogleTokenQuietly).mockResolvedValue(null);
    vi.mocked(getValidGoogleToken).mockResolvedValue('tok2');
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: '지금 백업' }));
    await waitFor(() => expect(runDriveBackup).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok2', keep: 12 })));
  });

  it('휴대폰에서는 돌지도, 띠를 띄우지도 않는다', async () => {
    env.device = 'mobile';
    env.settingsData = { lastAt: Date.now() - 30 * DAY };
    vi.mocked(getGoogleTokenQuietly).mockResolvedValue('tok');
    render(<Harness />);
    await new Promise((r) => setTimeout(r, 0));
    expect(runDriveBackup).not.toHaveBeenCalled();
    expect(screen.getByText('띠 없음')).toBeInTheDocument();
  });

  it('끄면 돌지도, 띠를 띄우지도 않는다', async () => {
    env.settingsData = { enabled: false };
    vi.mocked(getGoogleTokenQuietly).mockResolvedValue('tok');
    render(<Harness />);
    await new Promise((r) => setTimeout(r, 0));
    expect(runDriveBackup).not.toHaveBeenCalled();
    expect(screen.getByText('띠 없음')).toBeInTheDocument();
  });
});
