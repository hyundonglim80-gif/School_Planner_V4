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

// 기록 배너는 메모와 같은 컴포넌트(EntryDrawer)이므로, 여기서 검증하는 동작이
// 곧 메모 배너의 동작이기도 하다.
describe('DayJournal - 기록 추가/수정 배너', () => {
  it('+ 추가를 누르면 새 기록 배너가 열린다', async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole('button', { name: /추가/ }));

    expect(await screen.findByRole('heading', { name: '새 기록' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/기록/)).toBeInTheDocument();
  });

  it('카드를 한 번 클릭하면 그 기록의 수정 배너가 열린다', async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByText('첫 번째 기록'));

    expect(await screen.findByRole('heading', { name: '기록 수정' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('첫 번째 기록')).toBeInTheDocument();
  });

  it('수정 아이콘으로도 같은 배너가 열린다', async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getAllByTitle('기록 수정')[0]);

    expect(await screen.findByDisplayValue('첫 번째 기록')).toBeInTheDocument();
  });

  it('배너에 파일 첨부와 링크 추가가 있다', async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getAllByTitle('기록 수정')[0]);

    expect(await screen.findByText(/파일 첨부/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /링크 추가/ })).toBeInTheDocument();
  });

  it('빠른 저장 단축키 안내가 Ctrl + S 이다', async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole('button', { name: /추가/ }));

    expect(await screen.findByText(/Ctrl \+ S/)).toBeInTheDocument();
    expect(screen.queryByText(/Ctrl \+ Enter/)).toBeNull();
  });

  it('라벨은 여러 개 고를 수 있다', async () => {
    const user = userEvent.setup();
    renderJournal();
    await user.click(screen.getAllByTitle('기록 수정')[0]);
    await screen.findByDisplayValue('첫 번째 기록');

    const labelButtons = screen
      .getAllByRole('button')
      .filter((b) => /학급활동|학생상담|업무전달|수업기록/.test(b.textContent || '') && b.className.includes('rounded-lg'));
    expect(labelButtons.length).toBeGreaterThanOrEqual(2);

    await user.click(labelButtons[0]);
    await user.click(labelButtons[1]);
    expect(labelButtons[0].className).toContain('bg-blue-600');
    expect(labelButtons[1].className).toContain('bg-blue-600');
  });
});

describe('DayJournal - 카드 아이콘', () => {
  it('수정과 삭제 아이콘만 있고 파일/링크 아이콘은 없다', () => {
    const { container } = renderJournal();

    expect(screen.getAllByTitle('기록 수정').length).toBe(entries.length);
    expect(screen.getAllByTitle('기록 삭제').length).toBe(entries.length);
    expect(screen.queryAllByTitle('파일 추가').length).toBe(0);
    expect(screen.queryAllByTitle('링크 연결').length).toBe(0);

    // 카드 목록은 그대로 남아 있다
    const grid = container.querySelector('.grid.grid-cols-1')!;
    expect(within(grid as HTMLElement).getByText('두 번째 기록')).toBeInTheDocument();
  });

  it('수정 중에도 카드는 목록에 그대로 보인다', async () => {
    const user = userEvent.setup();
    const { container } = renderJournal();

    await user.click(screen.getAllByTitle('기록 수정')[0]);
    await screen.findByDisplayValue('첫 번째 기록');

    // 배너가 따로 뜨므로 목록에서 항목을 빼지 않는다
    const grid = container.querySelector('.grid.grid-cols-1')!;
    expect(within(grid as HTMLElement).getByText('첫 번째 기록')).toBeInTheDocument();
  });
});
