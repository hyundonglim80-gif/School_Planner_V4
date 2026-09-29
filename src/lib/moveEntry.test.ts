import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addDoc, deleteDoc, getDocFromServer, setDoc } from 'firebase/firestore';
import {
  initialLabelChoices,
  isMovableJournal,
  journalDateLine,
  moveJournalToMemo,
  moveMemoToJournal,
  resolveLabelNames,
} from './moveEntry';

// 메모 ↔ 기록 옮기기. 일정은 옮기지 않는다(사용자와 정함).

beforeEach(() => vi.clearAllMocks());

describe('라벨 고르기', () => {
  it('같은 이름이 옮겨 갈 쪽에 있으면 그대로, 없으면 처음에는 빼기', () => {
    expect(initialLabelChoices(['학급활동', '긴급', '학급활동', ''], ['학급활동', '학생상담'])).toEqual([
      { from: '학급활동', action: 'keep' },
      { from: '긴급', action: 'drop' },
    ]);
  });

  it('고른 대로 풀면 옮겨 갈 쪽 라벨 이름이 되고, 새로 만들 것을 알려 준다', () => {
    const r = resolveLabelNames([
      { from: '학급활동', action: 'keep' },
      { from: '긴급', action: 'create' },
      { from: '업무', action: 'map', to: '업무전달' },
      { from: '기타', action: 'drop' },
      { from: '학급', action: 'map', to: '학급활동' }, // 이미 있는 이름 - 겹치지 않는다
    ]);
    expect(r.names).toEqual(['학급활동', '긴급', '업무전달']);
    expect(r.toCreate).toEqual(['긴급']);
  });
});

describe('기록 → 메모 첫 줄과 옮길 수 있는 기록', () => {
  it('원래 날짜를 요일과 함께 남긴다', () => {
    expect(journalDateLine('2026-09-29')).toBe('[2026-09-29 (화) 기록]');
  });

  it('알림장·출석부가 만든 기록은 옮기지 않는다', () => {
    expect(isMovableJournal({ id: 'jr_abc' })).toBe(true);
    expect(isMovableJournal({ id: 'notice_2026-09-29' })).toBe(false);
    expect(isMovableJournal({ id: 'attendance_2026_1_2' })).toBe(false);
  });
});

const serverDay = (entries: any[]) =>
  ({ exists: () => true, data: () => ({ entries }) }) as any;

describe('메모 → 기록', () => {
  it('고른 날짜의 기록 묶음에 덧붙이고, 원본 메모는 휴지통에 넣고 지운다', async () => {
    vi.mocked(getDocFromServer).mockResolvedValue(serverDay([{ id: 'jr_old', content: '그날 있던 기록' }]));
    const memo: any = { firestoreId: 'm1', content: '옮길 메모', labels: ['긴급'], attachments: [], linkedItems: [] };

    const { newId } = await moveMemoToJournal({
      memo,
      groupId: null,
      dateStr: '2026-09-29',
      labelChoices: [{ from: '긴급', action: 'map', to: '업무전달' }],
      journalLabels: [{ id: 'j_3', name: '업무전달', color: 'blue' }],
    });

    const dayWrite = vi.mocked(setDoc).mock.calls.find((c) => Array.isArray((c[1] as any).entries))!;
    const entries = (dayWrite[1] as any).entries;
    // 그날 있던 기록은 남고 새 기록이 붙는다
    expect(entries.map((e: any) => e.id)).toEqual(['jr_old', newId]);
    expect(entries[1]).toMatchObject({ content: '옮길 메모', label: '업무전달', labelIds: ['j_3'] });
    // 휴지통(setDoc) + 원본 삭제
    expect(vi.mocked(setDoc).mock.calls.some((c) => (c[1] as any).type === 'memo')).toBe(true);
    expect(deleteDoc).toHaveBeenCalledTimes(1);
  });

  it('서버가 답하지 않으면 아무것도 쓰지 않는다 (그날 다른 기록을 덮어쓰지 않게)', async () => {
    vi.mocked(getDocFromServer).mockRejectedValue(new Error('offline'));
    await expect(
      moveMemoToJournal({
        memo: { firestoreId: 'm1', content: 'x' } as any,
        groupId: null,
        dateStr: '2026-09-29',
        labelChoices: [],
        journalLabels: [],
      })
    ).rejects.toThrow(/서버에 연결되지 않아/);
    expect(setDoc).not.toHaveBeenCalled();
    expect(deleteDoc).not.toHaveBeenCalled();
  });
});

describe('기록 → 메모', () => {
  it('첫 줄에 날짜를 남긴 메모를 만들고, 원본은 그날 묶음에서 빼되 다른 기록은 남긴다', async () => {
    vi.mocked(getDocFromServer).mockResolvedValue(
      serverDay([
        { id: 'jr_1', content: '옮길 기록' },
        { id: 'jr_2', content: '남을 기록' },
      ])
    );
    await moveJournalToMemo({
      entry: { id: 'jr_1', content: '옮길 기록', createdAt: 1, labelIds: [] } as any,
      groupId: null,
      dateStr: '2026-09-29',
      labelChoices: [{ from: '학급활동', action: 'create' }],
      memoLabels: ['업무'],
    });

    const memo = vi.mocked(addDoc).mock.calls[0][1] as any;
    expect(memo.content).toBe('[2026-09-29 (화) 기록]\n옮길 기록');
    expect(memo.labels).toEqual(['학급활동']);
    // 메모 라벨 목록에 '학급활동'이 새로 생긴다 (있던 모양 - 이름만 - 을 따른다)
    const labelWrite = vi.mocked(setDoc).mock.calls.find((c) => (c[1] as any).memoLabels)!;
    expect((labelWrite[1] as any).memoLabels).toEqual(['업무', '학급활동']);
    const dayWrite = vi.mocked(setDoc).mock.calls.find((c) => Array.isArray((c[1] as any).entries))!;
    expect((dayWrite[1] as any).entries.map((e: any) => e.id)).toEqual(['jr_2']);
  });

  it('알림장·출석부 기록은 옮기지 않는다', async () => {
    await expect(
      moveJournalToMemo({
        entry: { id: 'notice_2026-09-29', content: '알림장' } as any,
        groupId: null,
        dateStr: '2026-09-29',
        labelChoices: [],
        memoLabels: [],
      })
    ).rejects.toThrow(/옮길 수 없습니다/);
    expect(addDoc).not.toHaveBeenCalled();
  });
});
