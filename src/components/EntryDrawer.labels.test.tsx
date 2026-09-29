import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EntryDrawer from './EntryDrawer';

// 기록을 눌러 칸을 열면 붙어 있던 라벨이 체크되지 않은 채 보이던 것.
// 기록은 라벨을 id로 들고 있어 라벨 목록으로 이름을 푸는데, 칸을 여는 순간에는 목록이
// 아직 기본값이라 이름이 안 풀렸다. 칸은 대상이 바뀔 때만 폼을 채워 다시 채우지 않았다.

vi.mock('../hooks/useMinWidth', () => ({ useMinWidth: () => true }));

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  kind: 'journal' as const,
  labelOptions: ['학급활동', '학생상담'],
  onSave: vi.fn(async () => {}),
  docked: true,
};

const entry = (labels: string[]) => ({
  id: 'jr_1',
  content: '상담 내용',
  createdAt: 1,
  labels,
  labelIds: labels,
  label: labels[0] || '',
});

const chip = (name: string) => screen.getByRole('button', { name: new RegExp(`^(✓ )?${name}$`) });

describe('기록 칸 - 라벨이 늦게 풀릴 때', () => {
  it('열 때 안 풀렸던 라벨이 풀리면 체크된다', () => {
    const { rerender } = render(<EntryDrawer {...baseProps} entry={entry([]) as any} />);
    expect(chip('학급활동')).toHaveTextContent(/^학급활동$/);

    // 라벨 목록이 도착해 이름이 풀렸다 (같은 기록)
    rerender(<EntryDrawer {...baseProps} entry={entry(['학급활동']) as any} />);
    expect(chip('학급활동')).toHaveTextContent('✓ 학급활동');
  });

  it('그 사이에 사용자가 라벨을 골랐으면 덮어쓰지 않는다', () => {
    const { rerender } = render(<EntryDrawer {...baseProps} entry={entry([]) as any} />);
    fireEvent.click(chip('학생상담'));
    expect(chip('학생상담')).toHaveTextContent('✓ 학생상담');

    rerender(<EntryDrawer {...baseProps} entry={entry(['학급활동']) as any} />);
    expect(chip('학생상담')).toHaveTextContent('✓ 학생상담');
    expect(chip('학급활동')).toHaveTextContent(/^학급활동$/);
  });
});
