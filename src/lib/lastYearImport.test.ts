import { describe, it, expect, vi, beforeEach } from 'vitest';
import { doc, runTransaction } from 'firebase/firestore';
import {
  copyEventForImport,
  copyJournalForImport,
  importLastYear,
  undoLastYearImport,
  importedMessage,
  isImportableJournal,
  pickKey,
  ImportFailedError,
} from './lastYearImport';

// 작년 이맘때 - 올해로 가져오기 (docs/ROADMAP.md 7-2). 날짜마다 트랜잭션으로 서버 목록 끝에 더한다.

let store: Record<string, any>;
let failOn: string | null;
function useServer(initial: Record<string, any>) {
  store = JSON.parse(JSON.stringify(initial));
  failOn = null;
  vi.mocked(doc).mockImplementation(((...args: any[]) => ({ path: args.slice(1).join('/') })) as any);
  vi.mocked(runTransaction).mockImplementation((async (_db: any, fn: any) => {
    const pending: Array<[string, any]> = [];
    const r = await fn({
      get: async (ref: any) => {
        if (failOn && ref.path.endsWith(failOn)) throw new Error('offline');
        return { exists: () => store[ref.path] !== undefined, data: () => store[ref.path] };
      },
      set: (ref: any, data: any) => pending.push([ref.path, data]),
    });
    for (const [path, data] of pending) store[path] = { ...(store[path] || {}), ...data };
    return r;
  }) as any);
}
const ev = (date: string, gid?: string) => (gid ? `groups/${gid}/events/${date}` : `users/test-uid/events/${date}`);
const jr = (date: string) => `users/test-uid/journals/${date}`;
const contents = (path: string) => (store[path]?.eventList || []).map((e: any) => e.content);

beforeEach(() => vi.clearAllMocks());

describe('복사본 모양', () => {
  it('일정: 글·라벨·속성만, 완료·알림·링크·첨부·묶음·이월 사슬은 빼고 새 id', () => {
    const src = {
      id: 'ev_old',
      content: '[참고] 학부모 총회 안내장',
      completed: true,
      label: '달력',
      labelIds: ['ev_1'],
      calendar: true,
      forward: false,
      skip: true,
      time: '2025-03-05T09:00',
      alarmTriggered: true,
      linkedItems: [{ targetType: 'memo', targetId: 'm1' }],
      attachments: [{ fileId: 'f1' }],
      groupId: 'grp_1',
      forwardChainId: 'ch1',
      originalDate: '2025-03-01',
      authorId: 'someone',
      period: true,
    };
    const c = copyEventForImport(src, { uid: 'me', name: '나' }, 123);
    expect(c.id).not.toBe('ev_old');
    expect(c.id).toMatch(/^ev_/);
    expect(c.content).toBe('[참고] 학부모 총회 안내장'); // 본문은 그대로 (ARCHITECTURE 4-5)
    expect(c.text).toBe(c.content);
    expect(c).toMatchObject({ completed: false, label: '달력', labelIds: ['ev_1'], calendar: true, forward: false, skip: true });
    expect(c).toMatchObject({ linkedItems: [], attachments: [], authorId: 'me', authorName: '나', createdAt: 123 });
    for (const k of ['time', 'alarmTriggered', 'groupId', 'forwardChainId', 'originalDate', 'period']) {
      expect(c).not.toHaveProperty(k);
    }
  });

  it('기록: 글·라벨·표만, 표만 있으면 [표]', () => {
    const c = copyJournalForImport({
      id: 'j1',
      content: '규칙 정함',
      labelIds: ['j_1'],
      attachments: [{ fileId: 'f' }],
      linkedItems: [1],
    });
    expect(c).toMatchObject({ content: '규칙 정함', labelIds: ['j_1'], attachments: [], linkedItems: [] });
    expect(c.id).toMatch(/^jr_/);
    const t = copyJournalForImport({ id: 'j2', content: '', tables: [{ id: 't', rows: [] }] });
    expect(t.content).toBe('[표]');
    expect(t.tables).toEqual([{ id: 't', rows: [] }]);
  });

  it('알림장·출석부 자동 기록은 가져오지 않는다', () => {
    expect(isImportableJournal({ id: 'notice_2025-03-04' })).toBe(false);
    expect(isImportableJournal({ id: 'attendance_2025_3_2' })).toBe(false);
    expect(isImportableJournal({ id: 'jr_abc' })).toBe(true);
    expect(pickKey('event', '2025-03-03', 'ev_1')).toBe('event|2025-03-03|ev_1');
  });
});

describe('올해로 가져오기', () => {
  it('그날 목록 끝에 더하고 V3 글(eventText)도 새로 쓴다 - 원래 일정은 그대로', async () => {
    useServer({ [ev('2026-03-02')]: { eventText: '[v] 올해 원래 있던 일\n두 번째' } });
    const r = await importLastYear(null, [
      { kind: 'event', fromDate: '2025-03-03', toDate: '2026-03-02', item: { id: 'a', content: '입학식 준비', label: '달력' } },
    ]);
    expect(r.added).toHaveLength(1);
    expect(contents(ev('2026-03-02'))).toEqual(['올해 원래 있던 일', '두 번째', '입학식 준비']);
    expect(store[ev('2026-03-02')].eventText).toBe('[v] 올해 원래 있던 일\n두 번째\n[달력] 입학식 준비');
  });

  it('그날 같은 글이 있으면 건너뛴다 (두 번 눌러도 두 벌이 되지 않는다)', async () => {
    useServer({ [ev('2026-03-02')]: { eventList: [{ id: 'x', content: '학년 협의회' }] } });
    const picks = [
      { kind: 'event' as const, fromDate: '2025-03-03', toDate: '2026-03-02', item: { id: 'a', content: ' 학년 협의회 ' } },
      { kind: 'event' as const, fromDate: '2025-03-03', toDate: '2026-03-02', item: { id: 'b', content: '새 일' } },
    ];
    const first = await importLastYear(null, picks);
    expect(first.added).toHaveLength(1);
    expect(first.skipped).toBe(1);
    const again = await importLastYear(null, picks);
    expect(again.added).toHaveLength(0);
    expect(again.skipped).toBe(2);
    expect(contents(ev('2026-03-02'))).toEqual(['학년 협의회', '새 일']);
  });

  it('기록도 그날 기록 끝에 (자동 기록은 빼고)', async () => {
    useServer({ [jr('2026-03-04')]: { entries: [{ id: 'jr_0', content: '올해 기록' }] } });
    const r = await importLastYear(null, [
      { kind: 'journal', fromDate: '2025-03-05', toDate: '2026-03-04', item: { id: 'j', content: '작년 기록', labelIds: ['j_1'] } },
      { kind: 'journal', fromDate: '2025-03-05', toDate: '2026-03-04', item: { id: 'notice_2025-03-05', content: '알림장' } },
    ]);
    expect(r.added).toEqual([{ kind: 'journal', date: '2026-03-04', id: expect.stringMatching(/^jr_/) }]);
    expect(store[jr('2026-03-04')].entries.map((j: any) => j.content)).toEqual(['올해 기록', '작년 기록']);
  });

  it('공유 그룹 공간이면 그 그룹 문서에', async () => {
    useServer({});
    await importLastYear('g1', [
      { kind: 'event', fromDate: '2025-03-03', toDate: '2026-03-02', item: { id: 'a', content: '그룹 일정' } },
    ]);
    expect(contents(ev('2026-03-02', 'g1'))).toEqual(['그룹 일정']);
    expect(store[ev('2026-03-02')]).toBeUndefined();
  });

  it('서버가 답하지 않으면 그 날짜에서 멈추고, 앞에서 더한 것을 알려 준다', async () => {
    useServer({});
    failOn = 'events/2026-03-03';
    const err = await importLastYear(null, [
      { kind: 'event', fromDate: '2025-03-03', toDate: '2026-03-02', item: { id: 'a', content: '월요일' } },
      { kind: 'event', fromDate: '2025-03-04', toDate: '2026-03-03', item: { id: 'b', content: '화요일' } },
    ]).catch((e) => e);
    expect(err).toBeInstanceOf(ImportFailedError);
    expect(err.date).toBe('2026-03-03');
    expect(err.partial.added).toHaveLength(1);
    expect(contents(ev('2026-03-02'))).toEqual(['월요일']);
    expect(store[ev('2026-03-03')]).toBeUndefined();
  });

  it('되돌리기는 가져온 것만 뺀다 (그 사이 더한 일정은 그대로)', async () => {
    useServer({ [ev('2026-03-02')]: { eventList: [{ id: 'x', content: '원래' }] } });
    const r = await importLastYear(null, [
      { kind: 'event', fromDate: '2025-03-03', toDate: '2026-03-02', item: { id: 'a', content: '가져온 것' } },
      { kind: 'journal', fromDate: '2025-03-03', toDate: '2026-03-02', item: { id: 'j', content: '가져온 기록' } },
    ]);
    store[ev('2026-03-02')].eventList.push({ id: 'y', content: '그 사이 다른 기기' });
    const n = await undoLastYearImport(null, r.added);
    expect(n).toBe(2);
    expect(contents(ev('2026-03-02'))).toEqual(['원래', '그 사이 다른 기기']);
    expect(store[jr('2026-03-02')].entries).toEqual([]);
  });

  it('안내 글', () => {
    expect(
      importedMessage({
        added: [
          { kind: 'event', date: 'd', id: '1' },
          { kind: 'event', date: 'd', id: '2' },
          { kind: 'journal', date: 'd', id: '3' },
        ],
        skipped: 1,
      })
    ).toBe('🕰️ 작년 일정 2개·기록 1개를 올해로 가져왔습니다. 그날 같은 글이 있어 1개는 건너뛰었습니다.');
    expect(importedMessage({ added: [], skipped: 2 })).toBe('가져온 것이 없습니다. 그날 같은 글이 있어 2개는 건너뛰었습니다.');
  });
});
