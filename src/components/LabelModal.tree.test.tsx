import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { getDoc as getDocMock } from 'firebase/firestore';
import LabelModal from './LabelModal';
import { saveLabelTree } from '../lib/labelTree';

// 통합 라벨 관리 - 메모·기록 라벨에 '상위 라벨'을 고른다 (2단계). 저장하면 트리도 함께 저장한다.

vi.mock('../hooks/useGroups', () => ({ useGroups: () => ({ groups: [] }) }));
vi.mock('../utils/labelRename', async (importOriginal) => {
  const real = await importOriginal<typeof import('../utils/labelRename')>();
  return { ...real, applyLabelRenames: vi.fn(async () => ({ events: 0, journals: 0, memos: 0 })) };
});
vi.mock('../lib/labelTree', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/labelTree')>();
  return { ...real, useLabelTree: () => ({ memo: {}, journal: {} }), saveLabelTree: vi.fn(async () => {}) };
});

const SAVED = {
  eventLabels: [{ id: 'ev_1', name: '달력', color: 'red', calendar: true }],
  journalLabels: [
    { id: 'j_1', name: '학교', color: 'green' },
    { id: 'j_2', name: 'A초', color: 'blue' },
    { id: 'j_3', name: '업무', color: 'yellow' },
  ],
  memoLabels: [{ id: 'm_1', name: '업무', color: 'blue' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDocMock).mockResolvedValue({ exists: () => true, data: () => SAVED } as any);
});

const saveButton = () =>
  screen.getAllByRole('button').find((b) => /클라우드 저장/.test(b.textContent || '') && !(b as HTMLButtonElement).disabled)!;

describe('통합 라벨 관리 - 상위 라벨', () => {
  it('상위를 고르면 하위로 들여 보이고, 저장하면 이름으로 트리를 저장한다 (이름을 고친 것도 따라간다)', async () => {
    render(<LabelModal isOpen onClose={vi.fn()} initialTab="journal" />);
    const select = await screen.findByLabelText('A초 상위 라벨');
    fireEvent.change(select, { target: { value: 'j_1' } });

    // 하위로 들여 보인다
    await waitFor(() => expect(document.querySelector('[data-label-row="A초"]')!.className).toContain('ml-6'));
    // 하위가 생긴 '학교'는 상위를 둘 수 없다 (2단계)
    expect(screen.getByLabelText('학교 상위 라벨')).toBeDisabled();
    // '학교'의 후보에는 하위인 'A초'가 없다
    expect([...screen.getByLabelText('업무 상위 라벨').querySelectorAll('option')].map((o) => o.textContent)).toEqual(['없음', '학교']);

    // 저장 전에 하위 이름을 고친다
    const box = screen.getAllByRole('textbox').find((el) => (el as HTMLInputElement).value === 'A초')!;
    fireEvent.change(box, { target: { value: 'A초등' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(saveLabelTree).toHaveBeenCalled());
    expect(vi.mocked(saveLabelTree).mock.calls[0][0]).toEqual({ journal: { A초등: '학교' }, memo: {} });
  });
});
