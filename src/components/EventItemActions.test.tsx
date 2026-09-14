import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventItemActions from './EventItemActions';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EventItemActions', () => {
  it('수정과 삭제 아이콘을 보여준다', () => {
    render(<EventItemActions onEdit={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByTitle('일정 수정')).toBeInTheDocument();
    expect(screen.getByTitle('일정 삭제')).toBeInTheDocument();
  });

  it('수정 아이콘은 항목 클릭으로 번지지 않는다', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onItemClick = vi.fn();

    render(
      <div onClick={onItemClick}>
        <EventItemActions onEdit={onEdit} onDelete={vi.fn()} />
      </div>
    );

    await user.click(screen.getByTitle('일정 수정'));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onItemClick).not.toHaveBeenCalled();
  });

  it('삭제는 확인을 받은 뒤에만 지운다', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<EventItemActions onEdit={vi.fn()} onDelete={onDelete} />);

    await user.click(screen.getByTitle('일정 삭제'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByTitle('일정 삭제'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
