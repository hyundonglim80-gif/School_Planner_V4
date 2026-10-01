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

// 긴 메모 하나가 목록 한 칸을 통째로 차지해 아래 것들을 보려면 한참 내려야 했다.
// 기록 카드와 같은 삼각형 토글을 달고, 긴 것은 접은 채로 시작한다.
const longMemo: Memo = {
  ...memo,
  firestoreId: 'memo_long',
  content: '가'.repeat(400),
};

describe('MemoCard - 접기/펼치기', () => {
  it('짧은 메모는 펼친 채로 나온다', () => {
    render(<MemoCard memo={memo} onEdit={vi.fn()} />);

    expect(screen.getByText('메모 본문')).toBeInTheDocument();
    expect(screen.getByTitle('접기')).toBeInTheDocument();
  });

  it('긴 메모는 접은 채로 시작하고 한 줄만 보여 준다', () => {
    render(<MemoCard memo={longMemo} onEdit={vi.fn()} />);

    // 본문 전체는 안 보이고
    expect(screen.queryByText('가'.repeat(400))).toBeNull();
    // 펼칠 수 있다는 표시가 있다
    expect(screen.getByTitle('펼치기')).toBeInTheDocument();
    // 어느 메모인지 알 수 있게 앞부분은 보인다
    expect(screen.getByText(/가{10,}…/)).toBeInTheDocument();
  });

  it('펼치면 본문 전체가 나오고, 다시 접으면 줄어든다', async () => {
    const user = userEvent.setup();
    render(<MemoCard memo={longMemo} onEdit={vi.fn()} />);

    await user.click(screen.getByTitle('펼치기'));
    expect(screen.getByText('가'.repeat(400))).toBeInTheDocument();

    await user.click(screen.getByTitle('접기'));
    expect(screen.queryByText('가'.repeat(400))).toBeNull();
  });

  it('접었다 펴는 것으로 수정 배너가 열리지는 않는다', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<MemoCard memo={longMemo} onEdit={onEdit} />);

    await user.click(screen.getByTitle('펼치기'));

    expect(onEdit).not.toHaveBeenCalled();
  });
});

// 로드맵 6-6: 구글 Keep 목록 메모는 '☐ 우유' 줄로 들어온다
describe('MemoCard - 체크 줄(☐/☑)', () => {
  const list: Memo = { ...memo, content: '장보기\n☐ 우유\n☑ 빵' };

  it('체크 줄을 누르면 그 줄 번호와 글로 체크하고, 수정 배너는 열지 않는다', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onToggleCheckLine = vi.fn().mockResolvedValue(true);
    render(<MemoCard memo={list} onEdit={onEdit} onToggleCheckLine={onToggleCheckLine} />);

    await user.click(screen.getByRole('checkbox', { name: '☐ 우유' }));

    expect(onToggleCheckLine).toHaveBeenCalledWith(list, 1, '☐ 우유');
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('☑ 줄은 체크된 것으로 보이고, 체크 줄이 아닌 줄을 누르면 수정 배너가 열린다', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<MemoCard memo={list} onEdit={onEdit} onToggleCheckLine={vi.fn()} />);

    expect(screen.getByRole('checkbox', { name: '☑ 빵' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: '☐ 우유' })).toHaveAttribute('aria-checked', 'false');
    await user.click(screen.getByText('장보기', { exact: false }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('저장하는 동안 같은 줄을 또 눌러도 한 번만 보낸다', async () => {
    const user = userEvent.setup();
    let finish: (v: boolean) => void = () => {};
    const onToggleCheckLine = vi.fn(() => new Promise<boolean>((r) => (finish = r)));
    render(<MemoCard memo={list} onToggleCheckLine={onToggleCheckLine} />);

    const line = screen.getByRole('checkbox', { name: '☐ 우유' });
    await user.click(line);
    await user.click(line);
    expect(onToggleCheckLine).toHaveBeenCalledTimes(1);
    finish(true);
  });

  it('체크 함수를 주지 않으면 그냥 글로 보인다', () => {
    render(<MemoCard memo={list} />);
    expect(screen.queryByRole('checkbox', { name: '☐ 우유' })).toBeNull();
  });
});
