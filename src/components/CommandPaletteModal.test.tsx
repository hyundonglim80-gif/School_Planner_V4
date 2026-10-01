import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommandPaletteModal from './CommandPaletteModal';
import SearchModal from './SearchModal';
import { useAppStore } from '../store/useAppStore';
import { formatDateStr } from '../lib/dateUtils';
import { getDocs as getDocsMock } from 'firebase/firestore';

const setup = () => {
  const props = { onClose: vi.fn(), onCommand: vi.fn(), onSearch: vi.fn(), keyHint: vi.fn(() => '') };
  render(<CommandPaletteModal isOpen {...props} />);
  return props;
};
const input = () => screen.getByRole('combobox', { name: '명령 창' });
const selected = () => screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')!;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  // 2026-10-01(목)을 오늘로
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 1, 9, 0));
  useAppStore.setState({ scope: 'day', currentDate: new Date(2026, 9, 1).toISOString() });
});
afterEach(() => vi.useRealTimers());

describe('명령 창', () => {
  it('열면 글 칸에 커서가 있고, 비어 있으면 기능 목록이 보인다', () => {
    setup();
    expect(input()).toHaveFocus();
    expect(screen.getByRole('option', { name: /출석부/ })).toBeInTheDocument();
    expect(screen.queryByText(/통합 검색$/)).toBeNull();
  });

  it("'다음 주 목' + Enter → 그 날의 하루 화면", () => {
    const p = setup();
    useAppStore.setState({ scope: 'week' });
    fireEvent.change(input(), { target: { value: '다음 주 목' } });
    expect(selected()).toHaveTextContent('2026년 10월 8일 (목) · 7일 뒤');
    fireEvent.keyDown(input(), { key: 'Enter' });

    const s = useAppStore.getState();
    expect(formatDateStr(new Date(s.currentDate))).toBe('2026-10-08');
    expect(s.scope).toBe('day');
    expect(p.onClose).toHaveBeenCalled();
  });

  it('주간을 보던 중이면 ↓로 주간 화면에 남은 채 그 날짜로 갈 수 있다', () => {
    setup();
    useAppStore.setState({ scope: 'week' });
    fireEvent.change(input(), { target: { value: '10/15' } });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(selected()).toHaveTextContent('주간 화면에서');
    fireEvent.keyDown(input(), { key: 'Enter' });

    const s = useAppStore.getState();
    expect(formatDateStr(new Date(s.currentDate))).toBe('2026-10-15');
    expect(s.scope).toBe('week');
  });

  it("'출석' + Enter → 출석부 기능을 한다", () => {
    const p = setup();
    fireEvent.change(input(), { target: { value: '출석' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(p.onCommand).toHaveBeenCalledWith('attendance');
  });

  it('↑는 맨 위에서 맨 아래(통합 검색)로 돌아간다', () => {
    const p = setup();
    fireEvent.change(input(), { target: { value: '출석' } });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(selected()).toHaveTextContent('"출석" 통합 검색');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(p.onSearch).toHaveBeenCalledWith('출석');
    expect(p.onCommand).not.toHaveBeenCalled();
  });

  it('한글 조합 중의 Enter는 무시한다 (조합이 끝난 뒤 한 번 더 온다)', () => {
    const p = setup();
    fireEvent.change(input(), { target: { value: '출석' } });
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
    expect(p.onCommand).not.toHaveBeenCalled();
  });

  it('줄을 누르면 그것을 한다', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const p = setup();
    await user.type(input(), '진도');
    await user.click(screen.getByRole('option', { name: /진도 관리/ }));
    expect(p.onCommand).toHaveBeenCalledWith('progress');
  });
});

describe('통합 검색 - 명령 창에서 넘겨받은 검색어', () => {
  it('검색어를 넣고 열리면 곧바로 찾는다', async () => {
    vi.useRealTimers();
    (getDocsMock as any).mockClear();
    render(<SearchModal isOpen onClose={vi.fn()} initialKeyword="공문" />);
    expect(screen.getByPlaceholderText(/검색어 입력/)).toHaveValue('공문');
    await vi.waitFor(() => expect(getDocsMock).toHaveBeenCalled());
  });

  it('검색어 없이 열리면 찾지 않는다', async () => {
    vi.useRealTimers();
    (getDocsMock as any).mockClear();
    render(<SearchModal isOpen onClose={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(getDocsMock).not.toHaveBeenCalled();
  });
});
