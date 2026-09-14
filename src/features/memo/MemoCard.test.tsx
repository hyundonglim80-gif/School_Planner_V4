import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MemoCard from './MemoCard';
import type { Memo } from '../../hooks/useMemos';

const memo: Memo = {
  firestoreId: 'memo_1',
  content: '메모 본문',
  createdAt: Date.UTC(2026, 8, 14, 1, 0),
  labels: ['업무'],
  linkedItems: [],
  attachments: [],
};

describe('MemoCard', () => {
  it('가리켰을 때 나오는 아이콘에 링크가 없다', () => {
    render(<MemoCard memo={memo} onEdit={vi.fn()} onDelete={vi.fn()} onToggleComplete={vi.fn()} />);

    expect(screen.getByTitle('메모 수정')).toBeInTheDocument();
    expect(screen.getByTitle('삭제')).toBeInTheDocument();
    expect(screen.queryByTitle('링크 추가')).toBeNull();
  });

  it('한 번 클릭하면 수정 배너가 열린다', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<MemoCard memo={memo} onEdit={onEdit} onDelete={vi.fn()} onToggleComplete={vi.fn()} />);

    await user.click(screen.getByText('메모 본문'));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(memo);
  });

  it('완료 체크박스를 눌러도 수정 배너는 열리지 않는다', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onToggleComplete = vi.fn();
    render(
      <MemoCard memo={memo} onEdit={onEdit} onDelete={vi.fn()} onToggleComplete={onToggleComplete} />
    );

    await user.click(screen.getByRole('checkbox'));

    expect(onToggleComplete).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });
});
