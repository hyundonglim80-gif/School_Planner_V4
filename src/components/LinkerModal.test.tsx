import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LinkerModal from './LinkerModal';
import { getDocs as getDocsMock } from 'firebase/firestore';

vi.mock('../hooks/useLabels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useLabels')>();
  return {
    ...actual,
    useLabels: () => ({
      eventLabels: [{ id: 'ev_1', name: '수업', color: 'blue' }],
      journalLabels: [{ id: 'j_1', name: '상담', color: 'green' }],
      memoLabels: ['업무'],
      getLabelColor: () => 'blue',
    }),
  };
});

const props = {
  isOpen: true,
  onClose: vi.fn(),
  sourceType: 'event',
  sourceDateStr: '2026-09-15',
  sourceId: 'src-1',
  sourceFId: 'personal',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('링크 추가 - 조회 범위', () => {
  it('열면 목록을 불러온다', async () => {
    render(<LinkerModal {...props} />);
    await waitFor(() => expect(getDocsMock).toHaveBeenCalled());
  });

  it('고른 범위가 ±1주일로 되돌아가지 않는다', async () => {
    const user = userEvent.setup();
    render(<LinkerModal {...props} />);

    const select = await screen.findByDisplayValue('±1주일');
    await user.selectOptions(select, '1month');

    await waitFor(() => expect(select).toHaveValue('1month'));
  });

  it('기준 날짜가 ISO 시각 문자열이어도 날짜 칸이 채워진다', async () => {
    const user = userEvent.setup();
    // Layout은 기준 날짜가 없으면 store의 currentDate(= toISOString())를 그대로 넘긴다
    const { container } = render(
      <LinkerModal {...props} sourceDateStr="2026-09-15T10:23:45.123Z" />
    );

    const select = await screen.findByDisplayValue('±1주일');
    await user.selectOptions(select, 'custom');

    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="date"]');
    await waitFor(() => expect(inputs.length).toBe(2));
    expect(inputs[0].value).toBe('2026-09-15');
    expect(inputs[1].value).toBe('2026-09-15');
  });

  it("'기간 설정'을 고르면 시작·끝 날짜 칸이 나온다", async () => {
    const user = userEvent.setup();
    const { container } = render(<LinkerModal {...props} />);

    const select = await screen.findByDisplayValue('±1주일');
    await user.selectOptions(select, 'custom');

    await waitFor(() =>
      expect(container.querySelectorAll('input[type="date"]').length).toBe(2)
    );
  });
});
