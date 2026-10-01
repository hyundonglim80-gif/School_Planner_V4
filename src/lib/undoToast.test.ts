import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';

// 지운 뒤·옮긴 뒤 안내의 '되돌리기' (로드맵 6번). 되살리기·되옮기기는 각자의 테스트가 본다
// (trashRestore 길은 TrashModal과 같고, undoMoves·restoreEventFields는 eventDocOps.test).
const mocks = vi.hoisted(() => ({
  restoreTrashIds: vi.fn(),
  undoMoves: vi.fn(),
  restoreEventFields: vi.fn(),
  retarget: vi.fn(),
}));
vi.mock('./trashRestore', () => ({ restoreTrashIds: mocks.restoreTrashIds }));
vi.mock('./eventDocOps', () => ({ undoMoves: mocks.undoMoves, restoreEventFields: mocks.restoreEventFields }));
vi.mock('../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ retargetEventPanels: mocks.retarget }) },
}));

const { showDeletedToast, showMovedToast, showFieldsChangedToast, showUndoToast, restoredMessage, UNDO_LABEL } = await import(
  './undoToast'
);

const undoButton = () => screen.queryByRole('button', { name: UNDO_LABEL });

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('되돌리기 안내', () => {
  it('지운 것을 휴지통 id로 되살린다 - 단추를 누르면 안내가 닫히고 결과를 알린다', async () => {
    mocks.restoreTrashIds.mockResolvedValue({ restored: 1, missing: 0 });
    showDeletedToast('🗑️ 일정을 삭제했습니다. 휴지통에서 복원할 수 있습니다.', 'trash_1');

    fireEvent.click(undoButton()!);

    expect(mocks.restoreTrashIds).toHaveBeenCalledWith(['trash_1']);
    expect(await screen.findByText('↩️ 되살렸습니다.')).toBeInTheDocument();
  });

  it('휴지통을 거치지 않았으면(id 없음) 단추 없이 알리기만 한다', () => {
    showDeletedToast('🗑️ 지웠습니다.', [undefined, null]);
    expect(screen.getByText('🗑️ 지웠습니다.')).toBeInTheDocument();
    expect(undoButton()).toBeNull();
  });

  it('되살린 뒤에 부를 것이 있으면 부른다 (목록을 들고 있는 창이 다시 읽게)', async () => {
    mocks.restoreTrashIds.mockResolvedValue({ restored: 2, missing: 0 });
    const after = vi.fn();
    showDeletedToast('🗑️ 2건', ['a', 'b'], after);
    fireEvent.click(undoButton()!);
    await waitFor(() => expect(after).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('↩️ 2건을 되살렸습니다.')).toBeInTheDocument();
  });

  it('두 번 눌러도 한 번만 되돌린다', async () => {
    mocks.restoreTrashIds.mockResolvedValue({ restored: 1, missing: 0 });
    showDeletedToast('🗑️ 일정', 'trash_1');
    const btn = undoButton()!;
    fireEvent.click(btn);
    fireEvent.click(btn);
    await screen.findByText('↩️ 되살렸습니다.');
    expect(mocks.restoreTrashIds).toHaveBeenCalledTimes(1);
  });

  it('되돌리지 못하면 실패를 알린다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.restoreTrashIds.mockRejectedValue(new Error('offline'));
    showDeletedToast('🗑️ 일정', 'trash_1');
    fireEvent.click(undoButton()!);
    expect(await screen.findByText(/되돌리지 못했습니다/)).toBeInTheDocument();
  });

  it('되살린 결과를 사람 말로', () => {
    expect(restoredMessage(1, 0)).toBe('↩️ 되살렸습니다.');
    expect(restoredMessage(3, 1)).toBe('↩️ 3건을 되살렸습니다. 1건은 휴지통에 없어 그대로입니다.');
    expect(restoredMessage(0, 2)).toMatch(/휴지통에 없습니다/);
  });

  it('옮긴 것을 되옮기고, 그 일정을 고치던 칸도 원래 날짜로 따라간다', async () => {
    const trail = [{ fromDate: '2026-10-01', toDate: '2026-10-05', id: 'ev_a' }];
    mocks.undoMoves.mockResolvedValue({ back: [{ trail: trail[0], id: 'ev_a' }], missing: 0 });
    showMovedToast('✅ 일정을 10/5(월)로 옮겼습니다.', 'group_1', trail);

    fireEvent.click(undoButton()!);

    await waitFor(() => expect(mocks.retarget).toHaveBeenCalledWith('group_1', '2026-10-05', 'ev_a', '2026-10-01', 'ev_a'));
    expect(mocks.undoMoves).toHaveBeenCalledWith('group_1', trail);
    expect(await screen.findByText(/로 되돌렸습니다/)).toBeInTheDocument();
  });

  it('개인 공간이면 personal로 되옮긴다, 옮긴 것이 없으면 단추가 없다', async () => {
    showMovedToast('옮긴 일정이 없습니다.', null, []);
    expect(undoButton()).toBeNull();

    mocks.undoMoves.mockResolvedValue({ back: [], missing: 1 });
    showMovedToast('✅ 옮김', null, [{ fromDate: '2026-10-01', toDate: '2026-10-02', id: 'x' }]);
    fireEvent.click(undoButton()!);
    await waitFor(() => expect(mocks.undoMoves).toHaveBeenCalledWith('personal', expect.any(Array)));
    expect(await screen.findByText(/찾지 못했습니다/)).toBeInTheDocument();
  });

  it('다중 선택의 완료·라벨은 고치기 전 칸 값으로 돌린다', async () => {
    const snaps = [{ dateStr: '2026-10-01', id: 'ev_a', fields: { completed: false } }];
    mocks.restoreEventFields.mockResolvedValue(1);
    showFieldsChangedToast('✅ 일정 1건을 완료로 표시했습니다.', null, snaps);
    fireEvent.click(undoButton()!);
    expect(await screen.findByText('↩️ 일정 1건을 되돌렸습니다.')).toBeInTheDocument();
    expect(mocks.restoreEventFields).toHaveBeenCalledWith('personal', snaps);
  });

  it('부르는 쪽의 되돌리기 함수가 돌려준 글을 띄운다 (메모 완료)', async () => {
    const undo = vi.fn(async () => '↩️ 메모를 진행으로 되돌렸습니다.');
    showUndoToast('✅ 메모를 완료로 옮겼습니다.', undo);
    fireEvent.click(undoButton()!);
    expect(await screen.findByText('↩️ 메모를 진행으로 되돌렸습니다.')).toBeInTheDocument();
  });
});
