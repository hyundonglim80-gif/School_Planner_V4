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

describe('DayJournal - 추가 폼과 수정 폼의 모양이 같다', () => {
  // 각 폼의 컨테이너를 찾아 구조를 비교한다.
  const formShape = (root: HTMLElement) => {
    const ta = root.querySelector('textarea')!;
    const container = ta.closest('div.p-4') || ta.closest('form');
    return {
      container: (container as HTMLElement).className,
      textarea: ta.className,
      rows: ta.getAttribute('rows'),
      placeholder: ta.getAttribute('placeholder'),
      // 하단 버튼 줄 구조
      buttonRow: (root.querySelector('.flex.justify-between.items-center') as HTMLElement)?.className,
    };
  };

  it('컨테이너/입력칸/버튼줄 클래스가 동일하다', async () => {
    const user = userEvent.setup();

    const add = renderJournal();
    await user.click(screen.getByRole('button', { name: /추가/ }));
    await screen.findByPlaceholderText(/기록 내용/);
    const addShape = formShape(add.container as HTMLElement);
    add.unmount();

    const edit = renderJournal();
    await user.click(screen.getAllByTitle('기록 수정')[0]);
    await screen.findByDisplayValue('첫 번째 기록');
    const editShape = formShape(edit.container as HTMLElement);

    expect(editShape.textarea).toBe(addShape.textarea);
    expect(editShape.rows).toBe(addShape.rows);
    expect(editShape.placeholder).toBe(addShape.placeholder);
    expect(editShape.buttonRow).toBe(addShape.buttonRow);
    // 컨테이너는 form/div 로 태그가 다르지만 클래스는 같아야 한다
    expect(editShape.container).toBe(addShape.container);
  });

  it('수정 폼의 라벨도 추가 폼처럼 여러 개 고를 수 있다', async () => {
    const user = userEvent.setup();
    renderJournal();
    await user.click(screen.getAllByTitle('기록 수정')[0]);
    await screen.findByDisplayValue('첫 번째 기록');

    // 상단 필터 칩이 아니라 수정 폼 안의 라벨 버튼만 고른다
    const form = screen.getByDisplayValue('첫 번째 기록').closest('div.p-4') as HTMLElement;
    const labelButtons = within(form)
      .getAllByRole('button')
      .filter((b) => b.className.includes('rounded-lg') && /학급활동|학생상담|업무전달|수업기록/.test(b.textContent || ''));
    expect(labelButtons.length).toBeGreaterThanOrEqual(2);

    await user.click(labelButtons[0]);
    await user.click(labelButtons[1]);
    // 둘 다 선택된 상태(파란 배경)로 남아야 한다 - 하나만 고를 수 있으면 실패한다
    expect(labelButtons[0].className).toContain('bg-blue-600');
    expect(labelButtons[1].className).toContain('bg-blue-600');
  });
});
