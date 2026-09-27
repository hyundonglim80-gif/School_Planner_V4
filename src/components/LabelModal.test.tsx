import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { getDoc as getDocMock } from 'firebase/firestore';
import LabelModal from './LabelModal';
import { applyLabelRenames } from '../utils/labelRename';

vi.mock('../hooks/useGroups', () => ({ useGroups: () => ({ groups: [] }) }));
vi.mock('../utils/labelRename', async (importOriginal) => {
  const real = await importOriginal<typeof import('../utils/labelRename')>();
  return { ...real, applyLabelRenames: vi.fn(async () => ({ events: 0, journals: 0, memos: 0 })) };
});

const SAVED = {
  eventLabels: [
    { id: 'ev_1', name: '달력', color: 'red', calendar: true, skip: false, forward: false, period: false, recur: false },
    { id: 'ev_3', name: '이월', color: 'green', calendar: false, skip: false, forward: true, period: false, recur: false },
  ],
  journalLabels: [{ id: 'j_1', name: '학급활동', color: 'green' }],
  memoLabels: [{ id: 'm_1', name: '업무', color: 'blue' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDocMock).mockResolvedValue({ exists: () => true, data: () => SAVED } as any);
});

/** 이름 칸 중 지금 값이 name 인 것 */
const nameBox = (name: string) =>
  screen.getAllByRole('textbox').find((el) => (el as HTMLInputElement).value === name) as HTMLInputElement;

async function renameAndSave(tab: '일정' | '기록' | '메모' | null, from: string, to: string) {
  render(<LabelModal isOpen onClose={vi.fn()} initialTab={tab === '기록' ? 'journal' : tab === '메모' ? 'memo' : 'event'} />);
  await waitFor(() => expect(nameBox(from)).toBeTruthy());
  fireEvent.change(nameBox(from), { target: { value: to } });
  const save = screen.getAllByRole('button').find((b) => /저장/.test(b.textContent || '') && !(b as HTMLButtonElement).disabled)!;
  fireEvent.click(save);
  await waitFor(() => expect(applyLabelRenames).toHaveBeenCalled());
  return vi.mocked(applyLabelRenames).mock.calls[0][2];
}

describe('라벨 이름 바꾸기', () => {
  // 예전에는 이름 칸이 라벨 객체를 제자리에서 고쳐서, '불러온 시점의 원본'까지
  // 같이 바뀌었다. 저장할 때 바뀐 이름을 하나도 못 찾아 기존 항목에 반영되지 않았고,
  // 이름으로 라벨을 들고 있던 일정의 칩이 사라졌다.
  it('일정 라벨 이름을 바꾸면 기존 항목에 반영하라고 넘긴다', async () => {
    const renames = await renameAndSave('일정', '달력', '달력표시');
    expect(renames.event).toEqual([{ from: '달력', to: '달력표시' }]);
  });

  it('기록 라벨도 같다', async () => {
    const renames = await renameAndSave('기록', '학급활동', '학급 활동');
    expect(renames.journal).toEqual([{ from: '학급활동', to: '학급 활동' }]);
  });

  it('메모 라벨도 같다', async () => {
    const renames = await renameAndSave('메모', '업무', '학교 업무');
    expect(renames.memo).toEqual([{ from: '업무', to: '학교 업무' }]);
  });
});
