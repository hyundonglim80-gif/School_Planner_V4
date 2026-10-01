import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setDoc } from 'firebase/firestore';
import {
  backupFileName,
  backupsToTrash,
  isBackupDue,
  overdueDays,
  runDriveBackup,
  sanitizeAutoBackup,
  shouldNag,
} from './autoBackup';

// 드라이브 자동 백업 (docs/ROADMAP.md 3-2)

vi.mock('./backupJson', () => ({
  buildBackupPayload: vi.fn(async () => ({ version: 'SP4-UNIFIED-BACKUP', events: { '2026-10-01': {} }, tasks: { m1: {} } })),
  describeBackup: () => '일정 1일, 메모 1건',
}));

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 1, 9, 0).getTime();

describe('설정 읽기', () => {
  it('없거나 이상한 값은 기본(켜짐·7일·8개)으로', () => {
    expect(sanitizeAutoBackup(undefined)).toEqual({ enabled: true, intervalDays: 7, keep: 8 });
    expect(sanitizeAutoBackup({ enabled: false, intervalDays: 3, keep: 100, lastAt: 5 })).toEqual({
      enabled: false,
      intervalDays: 7,
      keep: 8,
      lastAt: 5,
    });
    expect(sanitizeAutoBackup({ intervalDays: 14, keep: 4 })).toMatchObject({ intervalDays: 14, keep: 4 });
  });
});

describe('언제 백업하나', () => {
  const base = { enabled: true, intervalDays: 7, keep: 8 };
  it('한 번도 안 했으면 지금, 정한 날 수가 지났으면 지금', () => {
    expect(isBackupDue(base, NOW)).toBe(true);
    expect(isBackupDue({ ...base, lastAt: NOW - 6 * DAY }, NOW)).toBe(false);
    expect(isBackupDue({ ...base, lastAt: NOW - 7 * DAY }, NOW)).toBe(true);
    expect(isBackupDue({ ...base, enabled: false }, NOW)).toBe(false);
  });

  it('할 때를 3일 넘기면 띠를 띄운다', () => {
    expect(overdueDays({ ...base, lastAt: NOW - 9 * DAY }, NOW)).toBe(2);
    expect(shouldNag({ ...base, lastAt: NOW - 9 * DAY }, NOW)).toBe(false);
    expect(shouldNag({ ...base, lastAt: NOW - 10 * DAY }, NOW)).toBe(true);
    expect(shouldNag(base, NOW)).toBe(true); // 한 번도 안 했다
    expect(shouldNag({ ...base, enabled: false }, NOW)).toBe(false);
  });

  it('같은 날 두 번째 백업은 시각을 붙여 덮지 않는다', () => {
    const now = new Date(2026, 9, 1, 14, 5);
    expect(backupFileName(now, [])).toBe('SP4_자동백업_2026-10-01.json');
    expect(backupFileName(now, ['SP4_자동백업_2026-10-01.json'])).toBe('SP4_자동백업_2026-10-01_1405.json');
  });

  it('최신 N개만 남기고, 적어도 하나는 늘 남긴다', () => {
    expect(backupsToTrash([1, 2, 3, 4, 5], 3)).toEqual([4, 5]);
    expect(backupsToTrash([1, 2], 8)).toEqual([]);
    expect(backupsToTrash([1, 2], 0)).toEqual([2]);
  });
});

describe('드라이브에 올리기', () => {
  let calls: Array<{ url: string; method: string; body?: any }>;
  let existing: Array<{ id: string; name: string }>;
  beforeEach(() => {
    // 파일 이름에 오늘 날짜가 들어간다 - 날짜를 고정한다
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 1, 9, 0));
    calls = [];
    existing = Array.from({ length: 8 }, (_, i) => ({ id: `old${i}`, name: `SP4_자동백업_2026-09-${String(20 - i).padStart(2, '0')}.json` }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method || 'GET';
        calls.push({ url, method, body: init?.body });
        const json = (data: any, headers: Record<string, string> = {}) =>
          ({ ok: true, status: 200, json: async () => data, text: async () => '', headers: new Headers(headers) }) as any;
        if (url.includes('upload/drive') && method === 'POST') return json({}, { Location: 'https://upload.example/put' });
        if (url === 'https://upload.example/put') {
          existing = [{ id: 'new', name: 'SP4_자동백업_2026-10-01.json' }, ...existing];
          return json({ id: 'new', name: 'SP4_자동백업_2026-10-01.json' });
        }
        if (method === 'PATCH') return json({});
        const q = decodeURIComponent(url);
        if (q.includes("name='School_Planner'")) return json({ files: [{ id: 'root' }] });
        if (q.includes("name='백업'")) return json({ files: [{ id: 'bk', webViewLink: 'https://drive/bk' }] });
        if (q.includes("name contains 'SP4_자동백업_'")) return json({ files: existing });
        return json({});
      })
    );
    vi.mocked(setDoc).mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('백업 폴더에 공개하지 않고 올리고, 최근 8개만 남기며, 마지막 백업을 적는다', async () => {
    const r = await runDriveBackup({ uid: 'u1', token: 't', keep: 8 });

    expect(r).toMatchObject({ name: 'SP4_자동백업_2026-10-01.json', summary: '일정 1일, 메모 1건', trashed: 1, folderLink: 'https://drive/bk' });
    const init = calls.find((c) => c.url.includes('upload/drive'))!;
    expect(JSON.parse(init.body)).toEqual({ name: 'SP4_자동백업_2026-10-01.json', mimeType: 'application/json', parents: ['bk'] });
    // 공개 권한(permissions)을 걸지 않는다 - 명렬표·출석부가 든 파일이다
    expect(calls.some((c) => c.url.includes('/permissions'))).toBe(false);
    // 9개가 되었으니 가장 오래된 하나를 드라이브 휴지통으로
    const trashedCalls = calls.filter((c) => c.method === 'PATCH');
    expect(trashedCalls.map((c) => c.url)).toEqual(['https://www.googleapis.com/drive/v3/files/old7']);
    expect(JSON.parse(trashedCalls[0].body)).toEqual({ trashed: true });
    const saved = vi.mocked(setDoc).mock.calls.at(-1)![1] as any;
    expect(saved).toMatchObject({ lastName: 'SP4_자동백업_2026-10-01.json', lastSummary: '일정 1일, 메모 1건', folderLink: 'https://drive/bk' });
    expect(typeof saved.lastAt).toBe('number');
  });

  it('올리기가 실패하면 던지고 마지막 백업 시각을 고치지 않는다', async () => {
    const realFetch = vi.mocked(fetch as any).getMockImplementation()!;
    vi.mocked(fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === 'https://upload.example/put') return { ok: false, status: 500, json: async () => ({}), text: async () => '' } as any;
      return realFetch(url, init);
    });
    await expect(runDriveBackup({ uid: 'u1', token: 't', keep: 8 })).rejects.toThrow(/업로드 실패/);
    expect(setDoc).not.toHaveBeenCalled();
  });
});
