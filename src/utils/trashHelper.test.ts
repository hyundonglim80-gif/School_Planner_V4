import { describe, it, expect, vi, beforeEach } from 'vitest';

// 휴지통은 V3와 V4가 같은 문서(users/{uid}/trash)를 함께 쓴다.
// V3는 날짜를 dateStr, V4는 originalDateStr 이라는 이름으로 읽는다.
// 한쪽 이름만 쓰면 다른 앱의 휴지통에서 그 항목을 복원할 수 없다.

const setDocMock = vi.fn(async (_ref: unknown, _data: Record<string, any>) => {});

vi.mock('firebase/firestore', () => ({
  doc: (...args: any[]) => ({ path: args.slice(1).join('/') }),
  setDoc: (ref: unknown, data: Record<string, any>) => setDocMock(ref, data),
  getDoc: vi.fn(),
  deleteDoc: vi.fn(async () => {}),
}));

vi.mock('../lib/firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1' } },
}));

const { moveToTrash } = await import('./trashHelper');

beforeEach(() => {
  setDocMock.mockClear();
});

describe('moveToTrash - V3와 함께 쓰는 문서 모양', () => {
  it('날짜를 originalDateStr와 dateStr 두 이름에 같이 쓴다', async () => {
    await moveToTrash({
      id: 'ev_1',
      type: 'event',
      originalDateStr: '2026-09-15',
      fId: 'personal',
      content: '교직원 회의',
      data: { id: 'ev_1', content: '교직원 회의' },
    });

    expect(setDocMock).toHaveBeenCalledTimes(1);
    const written = setDocMock.mock.calls[0][1] as any;
    expect(written.originalDateStr).toBe('2026-09-15');
    expect(written.dateStr).toBe('2026-09-15');
  });

  it('V3가 기대하는 필드를 모두 채운다', async () => {
    await moveToTrash({
      id: 'jr_1',
      type: 'journal',
      originalDateStr: '2026-09-15',
      content: '수업 기록',
      data: { id: 'jr_1', content: '수업 기록' },
    });

    const written = setDocMock.mock.calls[0][1] as any;
    expect(written).toMatchObject({
      type: 'journal',
      content: '수업 기록',
      fId: 'personal', // 없으면 personal로 채운다 (V3가 소속을 표시한다)
    });
    expect(typeof written.deletedAt).toBe('number');
    expect(written.data).toBeDefined();
  });

  it('날짜가 없는 항목(메모 등)도 빈 문자열로 넣어 필드를 비우지 않는다', async () => {
    await moveToTrash({
      id: 'memo_1',
      type: 'memo',
      content: '메모 하나',
      data: { firestoreId: 'memo_1', text: '메모 하나' },
    });

    const written = setDocMock.mock.calls[0][1] as any;
    expect(written.dateStr).toBe('');
  });
});
