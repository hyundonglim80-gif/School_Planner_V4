import { describe, it, expect, vi, beforeEach } from 'vitest';

const exportCalendarDataMock = vi.fn();
const showToastMock = vi.fn();
const showErrorToastMock = vi.fn();

vi.mock('./calendarSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./calendarSync')>();
  return { ...actual, exportCalendarData: exportCalendarDataMock };
});

vi.mock('../utils/toast', () => ({
  showToast: showToastMock,
  showErrorToast: showErrorToastMock,
}));

const { startCalendarSync, getSyncProgress, subscribeSyncProgress } = await import('./calendarSyncTask');

const args = {
  token: 't',
  startStr: '2026-09-15',
  endStr: '2026-09-15',
  mode: 'merge' as const,
  include: { event: true, class: false, journal: false },
  colPathOf: () => 'users/u/events',
  periodNames: ['1교시'],
  eventLabels: [],
  journalLabels: [],
};

const ok = { days: 1, counts: { event: 3, class: 0, journal: 0 } };

beforeEach(() => {
  vi.clearAllMocks();
  exportCalendarDataMock.mockResolvedValue(ok);
});

describe('캘린더 동기화는 창 밖에서 돈다', () => {
  it('끝나면 창이 열려 있든 아니든 토스트로 알린다', async () => {
    await startCalendarSync(args);

    expect(exportCalendarDataMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('동기화를 마쳤습니다'));
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('일정 3건'));
  });

  it('도는 동안 진행 상황을 밖에서 읽을 수 있다', async () => {
    let seen = '';
    exportCalendarDataMock.mockImplementation(async (a: any) => {
      a.onProgress?.('2026-09-15 반영 중', 42.6);
      seen = getSyncProgress().message;
      expect(getSyncProgress().running).toBe(true);
      expect(getSyncProgress().percent).toBe(43); // 반올림해서 보여준다
      return ok;
    });

    await startCalendarSync(args);

    expect(seen).toBe('2026-09-15 반영 중');
    expect(getSyncProgress().running).toBe(false);
  });

  it('구경하는 쪽에 바뀔 때마다 알린다', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSyncProgress(listener);

    await startCalendarSync(args);

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('이미 돌고 있으면 또 시작하지 않는다', async () => {
    let release: (v: any) => void = () => {};
    exportCalendarDataMock.mockImplementation(() => new Promise((r) => (release = r)));

    const first = startCalendarSync(args);
    await startCalendarSync(args); // 창을 다시 열어 또 누른 경우

    expect(exportCalendarDataMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('이미 동기화가 돌고 있습니다'));

    release(ok);
    await first;
    expect(getSyncProgress().running).toBe(false);
  });

  it('끝나면 결과 요약을 남겨 다시 열었을 때 보여준다', async () => {
    await startCalendarSync(args);
    expect(getSyncProgress().lastResult).toContain('일정 3건');
  });

  it('실패하면 알리고 진행 상태를 풀어 준다', async () => {
    exportCalendarDataMock.mockRejectedValue(new Error('그물이 끊겼습니다'));

    await startCalendarSync(args);

    expect(showErrorToastMock).toHaveBeenCalledWith(expect.stringContaining('그물이 끊겼습니다'));
    expect(getSyncProgress().running).toBe(false);
  });

  it('권한 오류는 무엇을 해야 하는지 알려 준다', async () => {
    exportCalendarDataMock.mockRejectedValue(new Error('구글 API 오류 (403): forbidden'));

    await startCalendarSync(args);

    expect(showErrorToastMock).toHaveBeenCalledWith(expect.stringContaining('캘린더 접근을 허용'));
  });
});
