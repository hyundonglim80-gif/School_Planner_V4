import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HelpModal from './HelpModal';
import { useAppStore } from '../store/useAppStore';
import { HELP_CATEGORIES } from '../lib/helpTopics';

beforeEach(() => {
  // jsdom에는 scrollIntoView가 없다 (항목을 열 때 맨 위로 올린다)
  Element.prototype.scrollIntoView = vi.fn();
  useAppStore.setState({ shortcutOverrides: {}, forwardLookbackDays: 14 });
});

describe('사용 설명서', () => {
  it('처음에는 갈래별 기능 목록을 보여준다', () => {
    render(<HelpModal isOpen onClose={vi.fn()} />);
    for (const category of HELP_CATEGORIES) {
      expect(screen.getByRole('heading', { name: new RegExp(category.title) })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /캡처 이미지 붙여넣기/ })).toBeInTheDocument();
  });

  it('목록에서 누르면 자세한 설명이 나오고, ← 목록으로 돌아온다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /캡처 이미지 붙여넣기/ }));
    expect(screen.getByRole('heading', { name: /캡처 이미지 붙여넣기/ })).toBeInTheDocument();
    expect(screen.getByText(/붙여넣은 이미지 업로드 중/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '← 목록' }));
    expect(screen.getByRole('button', { name: /단축키 한눈에 보기/ })).toBeInTheDocument();
  });

  it('설명 안의 연결을 누르면 그 항목으로 간다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /일정 속성 5가지/ }));
    await user.click(screen.getByRole('button', { name: '기간 일정' }));
    expect(screen.getByRole('heading', { name: /기간 일정 \(여러 날 연속\)/ })).toBeInTheDocument();
  });

  it('찾기 칸에 적으면 그 말이 들어 있는 항목만 남는다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('설명서에서 찾기'), '초성');
    expect(screen.getByRole('button', { name: /명렬표 - 검색 · 암기/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /구글 캘린더로 보내기/ })).not.toBeInTheDocument();
  });

  it('환경설정에서 바꾼 단축키와 이월 기간을 그대로 보여준다', async () => {
    useAppStore.setState({
      shortcutOverrides: { scopeDay: { ctrl: false, alt: true, shift: false, key: 'D' } },
      forwardLookbackDays: 21,
    });
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /화면 전환과 날짜 이동/ }));
    expect(screen.getByText('Alt + D')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '← 목록' }));
    await user.click(screen.getByRole('button', { name: /이월 \(못 끝낸 일정/ }));
    expect(screen.getAllByText('21').length).toBeGreaterThan(0);
  });

  it('단축키 목록은 지금 설정값으로 그린다', async () => {
    useAppStore.setState({
      shortcutOverrides: { trash: { ctrl: true, alt: false, shift: true, key: 'T' } },
    });
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /단축키 한눈에 보기/ }));
    const row = screen.getByText('휴지통').closest('div')!;
    expect(within(row).getByText('Ctrl + Shift + T')).toBeInTheDocument();
    expect(screen.getByText('모든 팝업창 저장 없이 닫기')).toBeInTheDocument();
  });
});

describe('사용 설명서 - 찾기 차례', () => {
  it('제목에 찾는 말이 든 항목이 먼저 나온다', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('설명서에서 찾기'), '링크');
    const first = screen.getByText(/개 항목$/).nextElementSibling!;
    expect(first.textContent).toMatch(/링크/);
    expect(first.textContent).not.toMatch(/하루 화면 구성/);
  });
});
