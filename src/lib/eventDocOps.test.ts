import { describe, it, expect, vi, beforeEach } from 'vitest';
import { doc, runTransaction } from 'firebase/firestore';
import { moveEventToDate, shiftAlarmTime } from './eventDocOps';
import { daysBetween } from './dateUtils';
import { applyReverseLink } from '../utils/linkUtils';

// 일정 날짜 옮기기 (docs/ROADMAP.md 1번). 두 날짜 문서를 한 트랜잭션에서 서버로 읽고 쓴다.

/** 서버 흉내: 경로 → 문서. 트랜잭션은 늘 여기서 읽고, 쓰기는 merge로 합친다. */
let store: Record<string, any>;
let writes: Array<{ path: string; data: any }>;
function useServer(initial: Record<string, any>) {
  store = JSON.parse(JSON.stringify(initial));
  writes = [];
  vi.mocked(doc).mockImplementation(((...args: any[]) => ({ path: args.slice(1).join('/') })) as any);
  vi.mocked(runTransaction).mockImplementation((async (_db: any, fn: any) =>
    fn({
      get: async (ref: any) => ({
        exists: () => store[ref.path] !== undefined,
        data: () => store[ref.path],
      }),
      set: (ref: any, data: any) => {
        writes.push({ path: ref.path, data });
        store[ref.path] = { ...(store[ref.path] || {}), ...data };
      },
    })) as any);
}
const day = (date: string) => `users/test-uid/events/${date}`;
const ids = (date: string) => (store[day(date)]?.eventList || []).map((e: any) => e.id);

beforeEach(() => vi.clearAllMocks());

describe('날짜 셈', () => {
  it('두 날짜 사이의 날 수 (뒤로 가면 음수)', () => {
    expect(daysBetween('2026-10-01', '2026-10-05')).toBe(4);
    expect(daysBetween('2026-10-05', '2026-10-01')).toBe(-4);
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3);
    expect(daysBetween('2026-10-01', '2026-10-01')).toBe(0);
  });

  it('알림 시각은 날짜만 옮기고 시각은 그대로', () => {
    expect(shiftAlarmTime('2026-10-01T14:30', 4)).toBe('2026-10-05T14:30');
    expect(shiftAlarmTime('2026-03-01T08:00', -1)).toBe('2026-02-28T08:00');
    expect(shiftAlarmTime('이상한 값', 3)).toBe('이상한 값');
  });
});

describe('일정 날짜 옮기기', () => {
  it('옛 날짜에서 그 일정만 빼고 새 날짜 끝에 넣는다 - 두 날의 다른 일정과 V3 글은 그대로', async () => {
    useServer({
      [day('2026-10-01')]: {
        eventList: [
          { id: 'ev_a', content: '교직원 회의', completed: false },
          { id: 'ev_b', content: '남을 일정', completed: false },
        ],
      },
      [day('2026-10-05')]: { eventList: [{ id: 'ev_c', content: '그날 원래 일정' }] },
    });

    const r = await moveEventToDate({ fId: 'personal', fromDate: '2026-10-01', toDate: '2026-10-05', eventId: 'ev_a' });

    expect(r?.id).toBe('ev_a'); // id는 그대로
    expect(ids('2026-10-01')).toEqual(['ev_b']);
    expect(ids('2026-10-05')).toEqual(['ev_c', 'ev_a']);
    // V3가 읽는 글(eventText)도 두 날 모두 새로 쓴다
    expect(store[day('2026-10-01')].eventText).toBe('남을 일정');
    expect(store[day('2026-10-05')].eventText).toBe('그날 원래 일정\n교직원 회의');
  });

  it('새 날짜 문서가 아직 없어도 만든다', async () => {
    useServer({ [day('2026-10-01')]: { eventList: [{ id: 'ev_a', content: '회의' }] } });
    await moveEventToDate({ fId: 'personal', fromDate: '2026-10-01', toDate: '2026-10-09', eventId: 'ev_a' });
    expect(ids('2026-10-01')).toEqual([]);
    expect(ids('2026-10-09')).toEqual(['ev_a']);
  });

  it('V3가 글로만 쓴 날에서도 옮긴다 (빈 목록으로 알고 그날을 지우지 않는다)', async () => {
    useServer({ [day('2026-10-01')]: { eventText: '[v] 끝낸 일\n옮길 일\n남을 일' } });
    const list = (await import('./eventText')).readEventList(store[day('2026-10-01')]);
    const target = list.find((e: any) => e.content === '옮길 일')!;

    await moveEventToDate({ fId: 'personal', fromDate: '2026-10-01', toDate: '2026-10-02', eventId: String(target.id) });

    const left = store[day('2026-10-01')].eventList.map((e: any) => e.content);
    expect(left).toEqual(['끝낸 일', '남을 일']);
    expect(store[day('2026-10-02')].eventList.map((e: any) => e.content)).toEqual(['옮길 일']);
  });

  it('새 날짜에 같은 id가 있으면(V3가 id 없이 쓴 ev_0 등) 새 id를 붙인다', async () => {
    useServer({
      [day('2026-10-01')]: { eventList: [{ content: 'id 없는 일정' }] }, // ev_0으로 읽힌다
      [day('2026-10-02')]: { eventList: [{ content: '거기도 id 없음' }] }, // 여기도 ev_0
    });
    const r = await moveEventToDate({ fId: 'personal', fromDate: '2026-10-01', toDate: '2026-10-02', eventId: 'ev_0' });
    expect(r?.id).not.toBe('ev_0');
    expect(ids('2026-10-02')).toEqual(['ev_0', r!.id]);
  });

  it('알림도 같은 날 수만큼 옮기고, 아직 오지 않은 시각이면 다시 울리게 한다', async () => {
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const from = `${future.getFullYear()}-${p2(future.getMonth() + 1)}-${p2(future.getDate())}`;
    const to = (await import('./dateUtils')).addDays(from, 2);
    useServer({
      [day(from)]: { eventList: [{ id: 'ev_a', content: '상담', time: `${from}T14:20`, alarmTriggered: true, date: from }] },
    });

    const r = await moveEventToDate({ fId: 'personal', fromDate: from, toDate: to, eventId: 'ev_a' });

    expect(r?.item.time).toBe(`${to}T14:20`);
    expect(r?.item.alarmTriggered).toBe(false);
    expect(r?.item.date).toBe(to); // V3가 찍는 date 칸
  });

  it('쓰는 칸에서 알림 시각을 새로 정했으면 그 시각 그대로 둔다', async () => {
    useServer({ [day('2026-10-01')]: { eventList: [{ id: 'ev_a', content: '상담', time: '2026-10-01T09:00' }] } });
    const r = await moveEventToDate({
      fId: 'personal',
      fromDate: '2026-10-01',
      toDate: '2026-10-03',
      eventId: 'ev_a',
      patch: { content: '학부모 상담', time: '2026-10-02T17:00' },
      shiftAlarm: false,
    });
    expect(r?.item).toMatchObject({ content: '학부모 상담', text: '학부모 상담', time: '2026-10-02T17:00' });
  });

  it('이월 사슬은 그대로 둔다', async () => {
    useServer({
      [day('2026-10-01')]: {
        eventList: [{ id: 'ev_a', content: '공문', forwardChainId: 'chain_1', originalDate: '2026-09-20', forward: true }],
      },
    });
    const r = await moveEventToDate({ fId: 'personal', fromDate: '2026-10-01', toDate: '2026-10-06', eventId: 'ev_a' });
    expect(r?.item).toMatchObject({ forwardChainId: 'chain_1', originalDate: '2026-09-20', forward: true });
  });

  it('공유 그룹 공간의 일정은 그 그룹 안에서 옮긴다', async () => {
    useServer({ ['groups/g1/events/2026-10-01']: { eventList: [{ id: 'ev_a', content: '협의회' }] } });
    await moveEventToDate({ fId: 'g1', fromDate: '2026-10-01', toDate: '2026-10-02', eventId: 'ev_a' });
    expect(store['groups/g1/events/2026-10-02'].eventList.map((e: any) => e.id)).toEqual(['ev_a']);
    expect(store[day('2026-10-02')]).toBeUndefined();
  });

  it('일정을 못 찾으면 아무것도 쓰지 않는다', async () => {
    useServer({ [day('2026-10-01')]: { eventList: [{ id: 'ev_b', content: '다른 일정' }] } });
    const r = await moveEventToDate({ fId: 'personal', fromDate: '2026-10-01', toDate: '2026-10-02', eventId: 'ev_a' });
    expect(r).toBeNull();
    expect(writes).toEqual([]);
  });

  it('서버가 답하지 않으면 던지고 아무것도 쓰지 않는다', async () => {
    useServer({});
    vi.mocked(runTransaction).mockRejectedValue(new Error('offline'));
    await expect(
      moveEventToDate({ fId: 'personal', fromDate: '2026-10-01', toDate: '2026-10-02', eventId: 'ev_a' })
    ).rejects.toThrow('offline');
    expect(writes).toEqual([]);
  });

  it('링크로 이어진 상대 항목의 역링크는 새 날짜를 가리키게 고친다', async () => {
    useServer({
      [day('2026-10-01')]: {
        eventList: [
          {
            id: 'ev_a',
            content: '상담',
            linkedItems: [{ targetType: 'journal', targetId: 'jr_1', targetDate: '2026-09-30', targetFId: 'personal', title: '기록' }],
          },
        ],
      },
      ['users/test-uid/journals/2026-09-30']: {
        entries: [
          {
            id: 'jr_1',
            content: '상담 기록',
            linkedItems: [
              { targetType: 'event', targetId: 'ev_a', targetDate: '2026-10-01', targetFId: 'personal', title: '[2026-10-01] 상담' },
            ],
          },
        ],
      },
    });

    await moveEventToDate({ fId: 'personal', fromDate: '2026-10-01', toDate: '2026-10-07', eventId: 'ev_a' });

    const back = store['users/test-uid/journals/2026-09-30'].entries[0].linkedItems;
    expect(back).toEqual([
      { targetType: 'event', targetId: 'ev_a', targetDate: '2026-10-07', targetFId: 'personal', title: '[2026-10-07] 상담' },
    ]);
  });
});

describe('역링크 - 옮긴 일정의 옛 자리 고치기', () => {
  const link = (id: string, date: string) => ({
    targetType: 'event',
    targetId: id,
    targetDate: date,
    targetFId: 'personal',
    title: `[${date}] 회의`,
  });

  it('옛 자리를 그 자리에서 새 날짜로 고친다 (차례도 그대로)', () => {
    const list = [{ targetType: 'memo', targetId: 'm1', title: '[메모] 준비물' }, link('ev_a', '2026-10-01')];
    const next = applyReverseLink(list, link('ev_a', '2026-10-05'), { movedFrom: { id: 'ev_a', date: '2026-10-01' } });
    expect(next).toEqual([list[0], link('ev_a', '2026-10-05')]);
  });

  it('다른 날짜의 같은 id(V3의 ev_0 등)는 건드리지 않는다', () => {
    const list = [link('ev_0', '2026-09-01'), link('ev_0', '2026-10-01')];
    const next = applyReverseLink(list, link('ev_0', '2026-10-05'), { movedFrom: { id: 'ev_0', date: '2026-10-01' } });
    expect(next).toEqual([link('ev_0', '2026-09-01'), link('ev_0', '2026-10-05')]);
  });

  it('옛 자리가 없으면 새로 더하고, 이미 새 자리를 가리키면 바꾸지 않는다', () => {
    expect(applyReverseLink([], link('ev_a', '2026-10-05'), { movedFrom: { id: 'ev_a', date: '2026-10-01' } })).toEqual([
      link('ev_a', '2026-10-05'),
    ]);
    const done = [link('ev_a', '2026-10-05')];
    expect(applyReverseLink(done, link('ev_a', '2026-10-05'), { movedFrom: { id: 'ev_a', date: '2026-10-01' } })).toBeNull();
  });

  it('새 id를 받았으면 옛 id 자리를 새 id로 갈아끼운다', () => {
    const list = [link('ev_0', '2026-10-01')];
    const next = applyReverseLink(list, link('ev_new', '2026-10-02'), { movedFrom: { id: 'ev_0', date: '2026-10-01' } });
    expect(next).toEqual([link('ev_new', '2026-10-02')]);
  });
});
