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
  // 앱에서처럼 같은 값을 돌려준다 (그리는 때마다 새 객체면 트리를 채우는 effect가 끝없이 돈다)
  const tree = { memo: {}, journal: {} };
  return { ...real, useLabelTree: () => tree, saveLabelTree: vi.fn(async () => {}) };
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

// 2026-09-30: 새 라벨을 더할 때 상위 라벨도 고른다. 라벨은 더하는 즉시 저장되므로 트리도 곧바로 저장한다.
describe('통합 라벨 관리 - 새 라벨에 상위 고르기', () => {
  it('기록 라벨을 더할 때 상위를 고르면 그 밑에 들어가고, 트리가 곧바로 저장된다', async () => {
    render(<LabelModal isOpen onClose={vi.fn()} initialTab="journal" />);
    const parentSelect = await screen.findByLabelText('새 기록 라벨의 상위 라벨');
    // 후보는 맨 위 단계 라벨만
    expect([...parentSelect.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['없음', '학교', 'A초', '업무']);
    fireEvent.change(parentSelect, { target: { value: 'j_1' } });

    const nameBox = screen.getByPlaceholderText('새 기록 라벨 이름...');
    fireEvent.change(nameBox, { target: { value: 'B초' } });
    fireEvent.click(screen.getAllByRole('button', { name: '추가' }).at(-1)!);

    await waitFor(() => expect(saveLabelTree).toHaveBeenCalled());
    expect(vi.mocked(saveLabelTree).mock.calls[0][0]).toEqual({ journal: { B초: '학교' }, memo: {} });
    await waitFor(() => expect(document.querySelector('[data-label-row="B초"]')!.className).toContain('ml-6'));
    // 하위가 생긴 '학교'는 이제 상위를 둘 수 없다
    expect(screen.getByLabelText('학교 상위 라벨')).toBeDisabled();
  });

  it('상위를 고르지 않으면 트리는 건드리지 않는다', async () => {
    render(<LabelModal isOpen onClose={vi.fn()} initialTab="memo" />);
    const nameBox = await screen.findByPlaceholderText('새 메모 라벨 태그 이름...');
    fireEvent.change(nameBox, { target: { value: '개인' } });
    fireEvent.click(screen.getAllByRole('button', { name: '추가' }).at(-1)!);
    await waitFor(() => expect(document.querySelector('[data-label-row="개인"]')).not.toBeNull());
    expect(saveLabelTree).not.toHaveBeenCalled();
  });

  it('메모 라벨도 상위를 골라 더한다', async () => {
    render(<LabelModal isOpen onClose={vi.fn()} initialTab="memo" />);
    fireEvent.change(await screen.findByLabelText('새 메모 라벨의 상위 라벨'), { target: { value: 'm_1' } });
    fireEvent.change(screen.getByPlaceholderText('새 메모 라벨 태그 이름...'), { target: { value: '공문' } });
    fireEvent.click(screen.getAllByRole('button', { name: '추가' }).at(-1)!);
    await waitFor(() => expect(saveLabelTree).toHaveBeenCalled());
    expect(vi.mocked(saveLabelTree).mock.calls[0][0]).toEqual({ journal: {}, memo: { 공문: '업무' } });
  });
});
