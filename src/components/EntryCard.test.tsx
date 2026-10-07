import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EntryCard from './EntryCard';

// 메모·기록 한 카드 (19번 U6): 라벨 칩은 머리줄(위), 카드 아래 '#라벨' 없음, 완료·즐겨찾기
vi.mock('../hooks/useLabels', () => {
  const entryLabels = [
    { id: 'j_1', name: '학급활동', color: 'green', inJournal: true },
    { id: 'jm_긴급', name: '긴급', color: 'red', inJournal: false },
  ];
  return { useLabels: () => ({ entryLabels, memoLabels: entryLabels.map((l) => l.name) }) };
});

const base = {
  focusKey: 'memo:m1',
  content: '본문 첫 줄\n둘째 줄',
  dateText: '10월 7일',
};

describe('EntryCard', () => {
  it('라벨 칩은 머리줄에 (본문보다 위), 지운 라벨은 빼고, #라벨은 없다', () => {
    const { container } = render(<EntryCard kind="memo" {...base} labels={['긴급', '지운라벨', '학급활동']} />);
    const chips = [...container.querySelectorAll('[data-entry-card-label]')].map((e) => e.getAttribute('data-entry-card-label'));
    expect(chips).toEqual(['긴급', '학급활동']);
    expect(container.textContent).not.toContain('#긴급');
    const chip = container.querySelector('[data-entry-card-label="긴급"]')!;
    const body = screen.getByText(/본문 첫 줄/);
    expect(chip.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 색은 한 목록의 색
    expect(chip.className).toContain('bg-red-50');
  });

  it('완료·즐겨찾기를 누르면 부르고(카드는 열리지 않는다), 완료면 줄 긋기', () => {
    const onToggleComplete = vi.fn();
    const onToggleFavorite = vi.fn();
    const onOpen = vi.fn();
    const { container, rerender } = render(
      <EntryCard kind="journal" {...base} labels={[]} onToggleComplete={onToggleComplete} onToggleFavorite={onToggleFavorite} onOpen={onOpen} />
    );
    fireEvent.click(screen.getByLabelText('기록 완료'));
    fireEvent.click(container.querySelector('[data-entry-card-favorite]')!);
    expect(onToggleComplete).toHaveBeenCalledTimes(1);
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    rerender(<EntryCard kind="journal" {...base} labels={[]} completed favorite onToggleComplete={onToggleComplete} onToggleFavorite={onToggleFavorite} />);
    expect(screen.getByText(/본문 첫 줄/).className).toContain('line-through');
    expect(container.querySelector('[data-entry-card-favorite]')!.textContent).toBe('★');
    expect(container.firstElementChild!.getAttribute('data-completed')).toBe('true');
  });

  it("삭제 단추 이름: 메모 '삭제', 기록 '기록 삭제' (점검 스크립트가 찾는 이름)", () => {
    render(<EntryCard kind="journal" {...base} labels={[]} onDelete={vi.fn()} />);
    expect(screen.getByTitle('기록 삭제')).toBeTruthy();
  });
});
