import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useGroupDelete } from './useGroupDelete';

function Harness({ item, deleteOne }: { item: any; deleteOne: (...args: any[]) => void }) {
  const { requestDelete, groupDeleteModal } = useGroupDelete({ fId: 'personal', deleteOne });
  return (
    <>
      <button type="button" onClick={() => requestDelete('2026-09-22', 'ev_1', item)}>
        지우기
      </button>
      {groupDeleteModal}
    </>
  );
}

describe('useGroupDelete', () => {
  it('묶인 일정은 어디까지 지울지 먼저 묻는다', async () => {
    const user = userEvent.setup();
    const deleteOne = vi.fn();
    render(<Harness item={{ id: 'ev_1', content: '여름방학 (2/5)', groupId: 'group_x' }} deleteOne={deleteOne} />);

    await user.click(screen.getByRole('button', { name: '지우기' }));

    expect(await screen.findByRole('heading', { name: /연결된 일정 삭제/ })).toBeInTheDocument();
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it('묶이지 않은 일정은 묻지 않고 바로 지운다', async () => {
    const user = userEvent.setup();
    const deleteOne = vi.fn();
    render(<Harness item={{ id: 'ev_1', content: '교직원 회의' }} deleteOne={deleteOne} />);

    await user.click(screen.getByRole('button', { name: '지우기' }));

    expect(deleteOne).toHaveBeenCalledWith('2026-09-22', 'ev_1', expect.anything());
    expect(screen.queryByRole('heading', { name: /연결된 일정 삭제/ })).toBeNull();
  });
});

// 지우는 자리가 네 곳이라, 한 곳만 고치고 나머지를 잊기 쉽다. 실제로 수정 팝업의
// '삭제'만 범위를 묻고, 항목을 가리켰을 때 나오는 🗑 는 묻지 않고 한 건만 지웠다.
describe('🗑 를 그리는 화면은 모두 이 길을 지난다', () => {
  const sources = import.meta.glob('../features/**/*.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  /** 삭제를 직접 하지 않고 부모가 넘겨주는 화면 */
  const PASSED_FROM_PARENT: Record<string, string> = {
    'YearMonthCard.tsx': 'YearScreen이 requestDelete를 넘겨준다',
  };

  it('EventItemActions를 쓰는 곳은 requestDelete를 지난다', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes('.test.'))
      .filter(([, src]) => src.includes('<EventItemActions'))
      .filter(([path, src]) => {
        const name = path.split('/').pop()!;
        return !src.includes('requestDelete') && !(name in PASSED_FROM_PARENT);
      })
      .map(([path]) => path);

    expect(offenders, offenders.join(' / ')).toEqual([]);
  });

  it('년간은 화면 쪽에서 지난다', () => {
    const year = Object.entries(sources).find(([p]) => p.endsWith('YearScreen.tsx'))![1];
    expect(year).toContain('requestDelete');
  });
});
