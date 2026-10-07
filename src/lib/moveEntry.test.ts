import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addDoc, deleteDoc, doc, runTransaction, setDoc } from 'firebase/firestore';
import { isMovableJournal, journalLabelNames, relocateEntry, toJournalEntry, toMemoDoc } from './moveEntry';

// 메모·기록 '자리 옮기기' (19번 U7 - 날짜 칸 = 자리). 일정은 옮기지 않는다(사용자와 정함).

beforeEach(() => vi.clearAllMocks());

const LABELS = [
  { id: 'j_1', name: '학급활동', color: 'green' },
  { id: 'jm_긴급', name: '긴급', color: 'red' },
];

describe('옮길 수 있는 기록 · 라벨 이름', () => {
  it('알림장·출석부가 만든 기록은 옮기지 않는다', () => {
    expect(isMovableJournal({ id: 'jr_1' })).toBe(true);
    expect(isMovableJournal({ id: 'notice_2026-09-29' })).toBe(false);
    expect(isMovableJournal({ id: 'attendance_2026_1_2' })).toBe(false);
  });
  it('기록의 labelIds·label을 이름으로 (id·이름 모두, 지운 라벨은 뺀다)', () => {
    expect(journalLabelNames({ labelIds: ['j_1', 'j_없음'], label: '긴급' }, LABELS)).toEqual(['학급활동', '긴급']);
  });
});

describe('칸 옮기기 (순수 함수)', () => {
  const src = {
    content: '글',
    labels: ['긴급'],
    attachments: [{ name: 'a.png', url: 'u' }],
    tables: [{ id: 't1' }],
    linkedItems: [{ id: 'l1' }],
    completed: true,
    favorite: true,
    createdAt: 123,
    keepId: 'k1',
    fromDate: '2026-09-01',
  };
  it('메모 → 기록: 글·라벨(id)·첨부·표·링크·완료·즐겨찾기·처음 쓴 때·keepId, fromDate는 뺀다', () => {
    const e = toJournalEntry(src, 'memo', ['긴급'], LABELS, 'jr_new');
    expect(e).toMatchObject({
      id: 'jr_new',
      content: '글',
      label: '긴급',
      labelIds: ['jm_긴급'],
      attachments: src.attachments,
      tables: src.tables,
      linkedItems: src.linkedItems,
      completed: true,
      favorite: true,
      createdAt: 123,
      keepId: 'k1',
    });
    expect(e).not.toHaveProperty('fromDate');
    expect(e).not.toHaveProperty('labels');
  });
  it('기록 → 기록(다른 날)은 모르는 칸도 그대로, 완료를 끈 것은 끈 채로', () => {
    const e = toJournalEntry({ id: 'jr_1', content: '글', v3: 1, labelIds: ['j_1'] }, 'journal', ['학급활동'], LABELS, 'jr_2');
    expect(e).toMatchObject({ id: 'jr_2', v3: 1, labelIds: ['j_1'] });
    expect(e).not.toHaveProperty('completed');
  });
  it("기록 → 메모: 글에 날짜 줄을 더하지 않고 fromDate, 표만 있던 '[표]'는 빈 글", () => {
    const m = toMemoDoc({ content: '[표]', tables: [{ id: 't' }], completed: true, createdAt: 5 }, ['학급활동'], '2026-10-06', { uid: 'u', name: '나' }, null, 99);
    expect(m).toMatchObject({ content: '', text: '', fromDate: '2026-10-06', labels: ['학급활동'], completed: true, completedAt: 99, createdAt: 5 });
  });
});

/**
 * 트랜잭션 흉내. 읽기는 늘 서버의 지금 모습(기록 묶음·메모 문서·라벨 문서), 쓰기는 txWrites에 담는다.
 * 기록 묶음은 날짜마다 따로 바뀐다 (옮기기는 원본 읽기 → 새 자리 → 원본 빼기로 여러 번 읽는다).
 */
const txWrites: Array<{ path: string; data: any }> = [];
function serverWith(days: Record<string, any[]>, memo: any = null) {
  vi.mocked(doc).mockImplementation(((...args: any[]) => ({ path: args.slice(1).join('/') })) as any);
  vi.mocked(runTransaction).mockImplementation((async (_db: any, fn: any) =>
    fn({
      get: async (ref: any) => {
        const date = /journals\/(.+)$/.exec(ref.path)?.[1];
        if (date) return days[date] ? { exists: () => true, data: () => ({ entries: days[date] }) } : { exists: () => false, data: () => ({}) };
        if (/tasks\//.test(ref.path)) return { exists: () => !!memo, data: () => memo };
        return { exists: () => false, data: () => ({}) };
      },
      set: (ref: any, data: any) => {
        txWrites.push({ path: ref.path, data });
        const date = /journals\/(.+)$/.exec(ref.path)?.[1];
        if (date && Array.isArray(data.entries)) days[date] = data.entries;
      },
    })) as any);
  vi.mocked(addDoc).mockResolvedValue({ id: 'm_new' } as any);
}
beforeEach(() => {
  txWrites.length = 0;
});

describe('relocateEntry', () => {
  it('메모에 날짜 넣기 → 그날 기록 묶음에 덧붙이고(있던 기록은 남는다), 원본 메모는 휴지통에 넣고 지운다', async () => {
    const days: Record<string, any[]> = { '2026-09-29': [{ id: 'jr_old', content: '그날 있던 기록' }] };
    serverWith(days, { content: '옮길 메모', labels: ['학급활동'], attachments: [], linkedItems: [], createdAt: 7 });
    const r = await relocateEntry({ from: { kind: 'memo', id: 'm1' }, toDate: '2026-09-29', groupId: null, journalLabels: LABELS });
    expect(r!.place.kind).toBe('journal');
    expect(days['2026-09-29'].map((e) => e.content)).toEqual(['그날 있던 기록', '옮길 메모']);
    expect(days['2026-09-29'][1]).toMatchObject({ labelIds: ['j_1'], createdAt: 7 });
    expect(vi.mocked(setDoc).mock.calls.some((c) => (c[1] as any).type === 'memo' && /날짜를 바꿈/.test((c[1] as any).content))).toBe(true);
    expect(deleteDoc).toHaveBeenCalledTimes(1);
    expect(r!.trashId).toBeTruthy();
  });

  it('기록 날짜 빼기 → fromDate가 든 메모, 원본은 그날 묶음에서만 빠진다', async () => {
    const days: Record<string, any[]> = { '2026-09-29': [{ id: 'jr_1', content: '옮길 기록', labelIds: ['j_1'] }, { id: 'jr_2', content: '남을 기록' }] };
    serverWith(days);
    const r = await relocateEntry({ from: { kind: 'journal', id: 'jr_1', dateStr: '2026-09-29' }, toDate: null, groupId: null, journalLabels: LABELS });
    const memo = vi.mocked(addDoc).mock.calls[0][1] as any;
    expect(memo).toMatchObject({ content: '옮길 기록', labels: ['학급활동'], fromDate: '2026-09-29' });
    expect(days['2026-09-29'].map((e) => e.id)).toEqual(['jr_2']);
    expect(r!.place).toEqual({ kind: 'memo', id: 'm_new' });
  });

  it('기록 날짜 바꾸기 → 다른 날 묶음으로, 원래 날에서 빠진다', async () => {
    const days: Record<string, any[]> = { '2026-09-29': [{ id: 'jr_1', content: '옮길 기록' }], '2026-10-01': [{ id: 'jr_9', content: '그날 것' }] };
    serverWith(days);
    const r = await relocateEntry({ from: { kind: 'journal', id: 'jr_1', dateStr: '2026-09-29' }, toDate: '2026-10-01', groupId: null, journalLabels: LABELS });
    expect(days['2026-09-29']).toEqual([]);
    expect(days['2026-10-01'].map((e) => e.content)).toEqual(['그날 것', '옮길 기록']);
    expect(r!.place).toMatchObject({ kind: 'journal', dateStr: '2026-10-01' });
  });

  it('같은 자리로는 아무것도 하지 않는다', async () => {
    serverWith({});
    expect(await relocateEntry({ from: { kind: 'memo', id: 'm1' }, toDate: null, groupId: null, journalLabels: LABELS })).toBeNull();
    expect(
      await relocateEntry({ from: { kind: 'journal', id: 'jr_1', dateStr: '2026-09-29' }, toDate: '2026-09-29', groupId: null, journalLabels: LABELS })
    ).toBeNull();
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('서버가 답하지 않으면 아무것도 쓰지 않는다 (그날 다른 기록을 덮어쓰지 않게)', async () => {
    vi.mocked(runTransaction).mockRejectedValue(new Error('offline'));
    await expect(relocateEntry({ from: { kind: 'memo', id: 'm1' }, toDate: '2026-09-29', groupId: null, journalLabels: LABELS })).rejects.toThrow(/서버에 연결되지 않아/);
    expect(setDoc).not.toHaveBeenCalled();
    expect(addDoc).not.toHaveBeenCalled();
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('원본을 휴지통에 넣지 못하면 원본을 지우지 않고 알린다', async () => {
    const days: Record<string, any[]> = { '2026-09-29': [{ id: 'jr_1', content: '옮길 기록' }] };
    serverWith(days);
    vi.mocked(setDoc).mockRejectedValueOnce(new Error('trash down'));
    await expect(
      relocateEntry({ from: { kind: 'journal', id: 'jr_1', dateStr: '2026-09-29' }, toDate: null, groupId: null, journalLabels: LABELS })
    ).rejects.toThrow(/그대로 두었습니다/);
    expect(days['2026-09-29'].map((e) => e.id)).toEqual(['jr_1']);
  });

  it('방금 만든 항목(새로 쓰며 날짜를 바꿈)은 휴지통을 거치지 않는다', async () => {
    serverWith({ '2026-09-29': [] }, { content: '새 메모', labels: [] });
    const r = await relocateEntry({ from: { kind: 'memo', id: 'm1' }, toDate: '2026-09-29', groupId: null, journalLabels: LABELS, justCreated: true });
    expect(vi.mocked(setDoc).mock.calls.some((c) => (c[1] as any).type === 'memo')).toBe(false);
    expect(deleteDoc).toHaveBeenCalledTimes(1);
    expect(r!.trashId).toBeUndefined();
  });

  it('알림장·출석부 기록은 옮기지 않는다', async () => {
    await expect(
      relocateEntry({ from: { kind: 'journal', id: 'notice_2026-09-29', dateStr: '2026-09-29' }, toDate: null, groupId: null, journalLabels: LABELS })
    ).rejects.toThrow(/옮길 수 없습니다/);
    expect(addDoc).not.toHaveBeenCalled();
  });
});
