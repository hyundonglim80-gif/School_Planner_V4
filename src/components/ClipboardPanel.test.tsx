import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import ClipboardPanel, { useClipboardCapture } from './ClipboardPanel';
import { useAppStore } from '../store/useAppStore';
import {
  useClipboardHistory,
  addClipText,
  pasteClip,
  rememberEditable,
  readSystemClipboard,
  clearClips,
  removeClip,
  MAX_ITEMS,
} from '../lib/clipboardHistory';

// 왼쪽 클립보드 칸: 복사한 것을 최신 것이 위로 모아 보여 주고, 누르면 글을 쓰던 칸에 붙여넣는다.

function setWidth(px: number) {
  window.matchMedia = vi.fn((query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] || 0);
    return { matches: px >= min, media: query, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MediaQueryList;
  });
}

beforeEach(() => {
  useClipboardHistory.setState({ items: [], loaded: true });
  useAppStore.setState({ clipboardOpen: false });
  setWidth(1280);
});

afterEach(() => {
  // @ts-expect-error jsdom에는 원래 없다
  delete window.matchMedia;
  vi.restoreAllMocks();
});

describe('클립보드 목록', () => {
  it('최신 것이 위에 오고, 같은 것을 다시 복사하면 맨 위로 올라온다 (두 번 담지 않는다)', async () => {
    await addClipText('첫째');
    await addClipText('둘째');
    await addClipText('첫째');
    expect(useClipboardHistory.getState().items.map((i) => i.text)).toEqual(['첫째', '둘째']);
  });

  it('빈 글자는 담지 않고, 넘치면 오래된 것부터 버린다', async () => {
    await addClipText('   ');
    expect(useClipboardHistory.getState().items).toHaveLength(0);
    for (let i = 0; i < MAX_ITEMS + 5; i++) await addClipText(`항목 ${i}`);
    const items = useClipboardHistory.getState().items;
    expect(items).toHaveLength(MAX_ITEMS);
    expect(items[0].text).toBe(`항목 ${MAX_ITEMS + 4}`);
  });
});

describe('복사한 것 모으기', () => {
  function Capture() {
    useClipboardCapture();
    return (
      <>
        <input aria-label="보통 칸" defaultValue="안녕하세요 선생님" />
        <input aria-label="비밀번호" type="password" defaultValue="secret123" />
      </>
    );
  }

  it('앱 안에서 Ctrl+C 한 글자를 담는다', async () => {
    render(<Capture />);
    const box = screen.getByLabelText('보통 칸') as HTMLInputElement;
    box.focus();
    box.setSelectionRange(0, 5);
    await act(async () => {
      fireEvent.copy(box);
    });
    expect(useClipboardHistory.getState().items[0]?.text).toBe('안녕하세요');
  });

  it('비밀번호 칸에서 한 복사는 담지 않는다', async () => {
    render(<Capture />);
    const pw = screen.getByLabelText('비밀번호') as HTMLInputElement;
    pw.focus();
    pw.setSelectionRange(0, 6);
    await act(async () => {
      fireEvent.copy(pw);
    });
    expect(useClipboardHistory.getState().items).toHaveLength(0);
  });
});

describe('눌러서 붙여넣기', () => {
  it('마지막으로 글을 쓰던 칸의 커서 자리에 넣는다 (React 칸도 값이 바뀐다)', async () => {
    const onChange = vi.fn();
    function Box() {
      const [v, setV] = useState('오늘 ');
      return (
        <textarea
          aria-label="메모"
          value={v}
          onChange={(e) => {
            setV(e.target.value);
            onChange(e.target.value);
          }}
        />
      );
    }
    render(<Box />);
    const ta = screen.getByLabelText('메모') as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(3, 3);
    rememberEditable(ta);
    ta.blur();

    await addClipText('수업');
    const r = await act(() => pasteClip(useClipboardHistory.getState().items[0]));
    expect(r).toBe('pasted');
    expect(ta.value).toBe('오늘 수업');
    expect(onChange).toHaveBeenLastCalledWith('오늘 수업');
  });
});

describe('ClipboardPanel', () => {
  it('왼쪽 가장자리 단추로 열고, 최신 것이 위에 보인다', async () => {
    await addClipText('예전 것');
    await addClipText('최신 것');
    render(<ClipboardPanel />);
    fireEvent.click(screen.getByTitle(/클립보드 열기/));
    const rows = screen.getAllByTitle('눌러서 붙여넣기');
    expect(rows[0]).toHaveTextContent('최신 것');
    expect(rows[1]).toHaveTextContent('예전 것');
  });

  it('항목을 누르는 순간 글을 쓰던 칸의 커서를 빼앗지 않는다', async () => {
    await addClipText('붙일 글');
    useAppStore.setState({ clipboardOpen: true });
    render(<ClipboardPanel />);
    const row = screen.getByTitle('눌러서 붙여넣기');
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    row.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('칸은 스스로 스크롤한다 (왼쪽 화면과 따로)', () => {
    useAppStore.setState({ clipboardOpen: true });
    render(<ClipboardPanel />);
    const panel = screen.getByLabelText('클립보드', { selector: 'aside' });
    expect(panel.className).toContain('overflow-y-auto');
    expect(panel.className).toContain('overscroll-contain');
  });
});

describe('시스템 클립보드를 스스로 읽을 때', () => {
  // 칸이 열려 있으면 2초마다 읽는다. 예전에는 읽을 때마다 담아서, '모두 지우기'를 해도
  // 클립보드에 그대로 있는 가장 최근 것이 2초 뒤 도로 담겼다.
  let systemText = '';
  beforeEach(() => {
    localStorage.clear();
    systemText = '가장 최근 복사';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn(async () => systemText) },
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn(async () => ({ state: 'granted' })) },
    });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });

  it("'모두 지우기' 뒤에는 클립보드가 그대로면 도로 담지 않는다", async () => {
    await readSystemClipboard(false);
    expect(useClipboardHistory.getState().items.map((i) => i.text)).toEqual(['가장 최근 복사']);

    await clearClips();
    await new Promise((r) => setTimeout(r, 0));
    await readSystemClipboard(false);
    await readSystemClipboard(false);
    expect(useClipboardHistory.getState().items).toHaveLength(0);

    // 새로 복사하면(클립보드가 바뀌면) 담는다
    systemText = '새로 복사';
    await readSystemClipboard(false);
    expect(useClipboardHistory.getState().items.map((i) => i.text)).toEqual(['새로 복사']);
  });

  it('✕로 지운 것도 되살아나지 않는다', async () => {
    await readSystemClipboard(false);
    await removeClip(useClipboardHistory.getState().items[0].id);
    await new Promise((r) => setTimeout(r, 0));
    await readSystemClipboard(false);
    expect(useClipboardHistory.getState().items).toHaveLength(0);
  });

  it("'가져오기'를 누르면 그대로여도 담는다", async () => {
    await readSystemClipboard(false);
    await clearClips();
    await new Promise((r) => setTimeout(r, 0));
    await readSystemClipboard(true);
    expect(useClipboardHistory.getState().items.map((i) => i.text)).toEqual(['가장 최근 복사']);
  });
});
