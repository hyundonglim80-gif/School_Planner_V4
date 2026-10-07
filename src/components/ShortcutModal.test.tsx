import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShortcutModal from './ShortcutModal';
import { useAppStore } from '../store/useAppStore';

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ shortcutOverrides: {} });
});

const keyBox = (label: string) => screen.getByLabelText(`${label} 키`);

describe('단축키 팝업 - 목록', () => {
  it('바꿀 수 있는 기능과 고정 단축키를 모두 보여준다', () => {
    render(<ShortcutModal isOpen onClose={vi.fn()} />);

    expect(screen.getByText('검색 열기')).toBeInTheDocument();
    expect(screen.getByText('일정 보이기 / 숨기기')).toBeInTheDocument();
    expect(screen.getByText('여러 개 고르기')).toBeInTheDocument();
    expect(screen.getByText('모든 팝업창·오른쪽 칸 저장 없이 닫기')).toBeInTheDocument();
    expect(screen.getByText('ESC')).toBeInTheDocument();
  });

  it('없애기로 한 고정 단축키는 더 이상 보이지 않는다', () => {
    render(<ShortcutModal isOpen onClose={vi.fn()} />);
    expect(screen.queryByText('검색 (빠른 키)')).not.toBeInTheDocument();
    expect(screen.queryByText('일정 빠른 등록')).not.toBeInTheDocument();
    // 저장(Ctrl+S)에는 쓰는 칸·조사표와 저장 단추가 있는 모든 팝업이 포함된다
    expect(screen.getByText('저장 (일정·메모·기록·알림장·출석부 칸, 조사표, 그리고 저장 단추가 있는 모든 팝업)')).toBeInTheDocument();
  });

  it('ESC에는 키 입력칸이 없다 (바꿀 수 없다)', () => {
    render(<ShortcutModal isOpen onClose={vi.fn()} />);
    expect(screen.queryByLabelText('모든 팝업창·오른쪽 칸 저장 없이 닫기 키')).not.toBeInTheDocument();
  });

  it('지금 설정된 조합이 입력칸에 들어 있다', () => {
    render(<ShortcutModal isOpen onClose={vi.fn()} />);
    expect(keyBox('검색 열기')).toHaveValue('F');
    expect(keyBox('일정 보이기 / 숨기기')).toHaveValue('↑');
  });
});

describe('단축키 팝업 - 고치기', () => {
  it('입력칸에서 키를 누르면 그 키가 들어간다', () => {
    render(<ShortcutModal isOpen onClose={vi.fn()} />);
    const box = keyBox('검색 열기');

    fireEvent.keyDown(box, { key: 'k', code: 'KeyK', ctrlKey: true });

    expect(box).toHaveValue('K');
  });

  it('화살표나 Space처럼 글자가 없는 키도 들어간다', () => {
    render(<ShortcutModal isOpen onClose={vi.fn()} />);
    const box = keyBox('검색 열기');

    fireEvent.keyDown(box, { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, shiftKey: true });

    expect(box).toHaveValue('→');
  });

  it('수식키만 누른 것은 들어가지 않는다', () => {
    render(<ShortcutModal isOpen onClose={vi.fn()} />);
    const box = keyBox('검색 열기');

    fireEvent.keyDown(box, { key: 'Control', code: 'ControlLeft', ctrlKey: true });

    expect(box).toHaveValue('F');
  });

  it('Backspace로 지울 수 있다', () => {
    render(<ShortcutModal isOpen onClose={vi.fn()} />);
    const box = keyBox('검색 열기');

    fireEvent.keyDown(box, { key: 'Backspace', code: 'Backspace' });

    expect(box).toHaveValue('');
  });
});

describe('단축키 팝업 - 저장', () => {
  it('저장을 눌러야 적용된다', async () => {
    const user = userEvent.setup();
    render(<ShortcutModal isOpen onClose={vi.fn()} />);

    // 비어 있는 조합으로
    fireEvent.keyDown(keyBox('검색 열기'), { key: 'j', code: 'KeyJ', ctrlKey: true });
    expect(useAppStore.getState().shortcutOverrides.search).toBeUndefined();

    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(useAppStore.getState().shortcutOverrides.search).toEqual({
        ctrl: true,
        alt: false,
        shift: false,
        key: 'J',
      })
    );
  });

  it('저장해도 창이 닫히지 않는다', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ShortcutModal isOpen onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(screen.getByText(/저장되었습니다/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('기본값과 같은 것은 저장하지 않는다', async () => {
    const user = userEvent.setup();
    render(<ShortcutModal isOpen onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(useAppStore.getState().shortcutOverrides).toEqual({}));
  });

  it('겹치는 조합은 저장되지 않는다', async () => {
    const user = userEvent.setup();
    render(<ShortcutModal isOpen onClose={vi.fn()} />);

    // 검색을 '이전 날짜'(Ctrl+←)와 같은 조합으로 바꾼다
    fireEvent.keyDown(keyBox('검색 열기'), { key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true });
    expect(screen.getByText(/겹치는 단축키가 있습니다/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(useAppStore.getState().shortcutOverrides).toEqual({});
  });

  it('키를 비우면 그 기능은 단축키 없이 쓴다', async () => {
    const user = userEvent.setup();
    render(<ShortcutModal isOpen onClose={vi.fn()} />);

    fireEvent.keyDown(keyBox('검색 열기'), { key: 'Backspace', code: 'Backspace' });
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(useAppStore.getState().shortcutOverrides.search?.key).toBe(''));
  });

  it('기본값이 없는 메뉴 항목도 목록에 있고 키를 정할 수 있다', async () => {
    const user = userEvent.setup();
    render(<ShortcutModal isOpen onClose={vi.fn()} />);

    const box = keyBox('여러 개 고르기');
    expect(box).toHaveValue('');

    fireEvent.keyDown(box, { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true });
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(useAppStore.getState().shortcutOverrides.multiSelect).toEqual({
        ctrl: true,
        alt: true,
        shift: false,
        key: 'M',
      })
    );
  });

  it("'기본값으로'는 누른 즉시가 아니라 저장할 때 적용된다", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ shortcutOverrides: { search: { ctrl: true, alt: false, shift: false, key: 'K' } } });
    render(<ShortcutModal isOpen onClose={vi.fn()} />);
    expect(keyBox('검색 열기')).toHaveValue('K');

    await user.click(screen.getByRole('button', { name: '기본값으로' }));
    expect(keyBox('검색 열기')).toHaveValue('F');
    expect(useAppStore.getState().shortcutOverrides.search).toBeDefined();

    await user.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(useAppStore.getState().shortcutOverrides).toEqual({}));
  });

  it('닫기로 나가면 고친 것을 버린다', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<ShortcutModal isOpen onClose={onClose} />);

    fireEvent.keyDown(keyBox('검색 열기'), { key: 'k', code: 'KeyK', ctrlKey: true });
    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalled();

    // 다시 열면 저장하지 않은 수정은 남아 있지 않다
    rerender(<ShortcutModal isOpen={false} onClose={onClose} />);
    rerender(<ShortcutModal isOpen onClose={onClose} />);
    expect(keyBox('검색 열기')).toHaveValue('F');
  });
});

describe('단축키 팝업 - 화면 전체 단축키와 겹치지 않기', () => {
  it('입력칸에서 누른 조합은 화면 전체 단축키로 올라가지 않는다', () => {
    // 예전에는 휴지통에 준 Alt+T를 다른 칸에 넣으려 하면 휴지통이 열렸다
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    try {
      render(<ShortcutModal isOpen onClose={vi.fn()} />);
      fireEvent.keyDown(keyBox('환경설정'), { key: 't', code: 'KeyT', altKey: true });
      expect(keyBox('환경설정')).toHaveValue('T');
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });

  it('ESC는 그대로 올라가 팝업을 닫을 수 있다', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    try {
      render(<ShortcutModal isOpen onClose={vi.fn()} />);
      fireEvent.keyDown(keyBox('환경설정'), { key: 'Escape', code: 'Escape' });
      expect(onWindowKey).toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });
});
