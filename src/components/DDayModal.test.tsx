import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DDayModal from './DDayModal';
import type { DDayItem } from '../hooks/useDDay';

const addDDay = vi.fn(async () => {});
const deleteDDay = vi.fn(async () => {});
const selectDDay = vi.fn(async () => {});

let dDayList: DDayItem[] = [];
let selectedDDayId: string | null = null;

vi.mock('../hooks/useDDay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useDDay')>();
  return {
    ...actual,
    useDDay: () => ({
      dDayList,
      selectedDDayId,
      primaryDDay: null,
      loading: false,
      addDDay,
      deleteDDay,
      selectDDay,
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  dDayList = [
    { id: 'dday_1', title: '여름방학', date: '2026-07-20' },
    { id: 'dday_2', title: '수능', date: '2026-11-19' },
  ];
  selectedDDayId = 'dday_1';
});

describe('DDayModal - 레이아웃과 버튼', () => {
  it('추가 버튼과 항목별 삭제 버튼이 있다', () => {
    render(<DDayModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /추가/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '삭제' })).toHaveLength(2);
  });

  it('닫기 버튼이 따로 있다', () => {
    const onClose = vi.fn();
    render(<DDayModal isOpen onClose={onClose} />);

    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument();
  });

  it('제목과 날짜를 모두 채워야 추가할 수 있다', async () => {
    const user = userEvent.setup();
    render(<DDayModal isOpen onClose={vi.fn()} />);

    const addButton = screen.getByRole('button', { name: /추가/ });
    expect(addButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/일정명/), '체육대회');
    expect(addButton).toBeDisabled(); // 날짜가 아직 없다

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    await user.type(dateInput, '2026-05-15');
    expect(addButton).toBeEnabled();

    await user.click(addButton);
    expect(addDDay).toHaveBeenCalledWith('체육대회', '2026-05-15');
  });

  it('삭제를 누르면 확인창 없이 지운다', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<DDayModal isOpen onClose={vi.fn()} />);

    await user.click(screen.getAllByRole('button', { name: '삭제' })[0]);

    expect(deleteDDay).toHaveBeenCalledWith('dday_1');
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('항목을 누르면 상단 표시 대상으로 고른다', async () => {
    const user = userEvent.setup();
    render(<DDayModal isOpen onClose={vi.fn()} />);

    await user.click(screen.getByText('수능'));
    expect(selectDDay).toHaveBeenCalledWith('dday_2');
  });

  it('이미 고른 항목을 다시 누르면 선택을 해제한다', async () => {
    const user = userEvent.setup();
    render(<DDayModal isOpen onClose={vi.fn()} />);

    await user.click(screen.getByText('여름방학'));
    expect(selectDDay).toHaveBeenCalledWith(null);
  });

  it('팝업은 위(상단)를 기준으로 붙는다', () => {
    const { container } = render(<DDayModal isOpen onClose={vi.fn()} />);
    // 내용이 늘어날 때 아래로만 자라도록 items-start 로 둔다
    expect(container.firstElementChild!.className).toContain('items-start');
    expect(container.firstElementChild!.className).not.toContain('items-center');
  });

  it('등록된 D-Day가 없으면 안내를 보여준다', () => {
    dDayList = [];
    render(<DDayModal isOpen onClose={vi.fn()} />);
    expect(screen.getByText(/등록된 D-Day 일정이 없습니다/)).toBeInTheDocument();
  });
});
