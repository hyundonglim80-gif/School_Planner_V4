import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DayJournal from './DayJournal';
import type { JournalEntry } from '../../hooks/useDayData';

const entries: JournalEntry[] = [
  { id: 'jr_1', content: '첫 번째 기록', createdAt: 1, labelIds: [], linkedItems: [], attachments: [] },
  { id: 'jr_2', content: '두 번째 기록', createdAt: 2, labelIds: [], linkedItems: [], attachments: [] },
];

function renderJournal() {
  return render(
    <DayJournal
      journals={entries}
      onAddJournal={vi.fn(async () => {})}
      onDeleteJournal={vi.fn(async () => {})}
      onUpdateJournal={vi.fn(async () => {})}
    />
  );
}

describe('DayJournal - 기록 추가 폼', () => {
  it('파일 추가와 링크 추가 버튼이 있고 이미지 추가 버튼은 없다', async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole('button', { name: /추가/ }));

    expect(await screen.findByRole('button', { name: /파일 추가/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /링크 추가/ })).toBeInTheDocument();
    expect(screen.queryByText(/이미지 추가/)).not.toBeInTheDocument();
  });
});

describe('DayJournal - 기록 수정 폼', () => {
  it('수정 버튼을 누르면 카드 그리드 밖, 전체 너비로 열린다', async () => {
    const user = userEvent.setup();
    const { container } = renderJournal();

    const editButtons = screen.getAllByTitle('기록 수정');
    await user.click(editButtons[0]);

    // 수정 폼의 textarea 를 찾는다
    const textarea = await screen.findByDisplayValue('첫 번째 기록');
    expect(textarea).toBeInTheDocument();

    // 카드 그리드(4단) 안에 있으면 칸이 좁다. 그리드 바깥에 있어야 한다.
    const grid = container.querySelector('.grid.grid-cols-1');
    expect(grid).not.toBeNull();
    expect(grid!.contains(textarea)).toBe(false);
  });

  it('수정 중인 기록은 목록에서 중복으로 보이지 않는다', async () => {
    const user = userEvent.setup();
    const { container } = renderJournal();

    await user.click(screen.getAllByTitle('기록 수정')[0]);

    const grid = container.querySelector('.grid.grid-cols-1')!;
    // 목록 쪽에는 수정 중인 기록의 본문이 남아 있지 않아야 한다
    expect(within(grid as HTMLElement).queryByText('첫 번째 기록')).toBeNull();
    // 수정하지 않는 기록은 그대로 보인다
    expect(within(grid as HTMLElement).getByText('두 번째 기록')).toBeInTheDocument();
  });

  it('수정 폼에도 파일 추가와 링크 추가 버튼이 있다', async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getAllByTitle('기록 수정')[0]);

    expect(await screen.findByRole('button', { name: /파일 추가/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /링크 추가/ })).toBeInTheDocument();
  });
});
