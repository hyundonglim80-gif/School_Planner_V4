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
  localStorage.removeItem('sp4-help-tree-hidden');
});

/** 오른쪽 내용 칸 (왼쪽 목차에도 같은 이름의 단추가 있어서 내용 칸 안에서 찾는다) */
const content = () => within(screen.getByRole('region', { name: '설명서 내용' }));
/** 왼쪽 목차 */
const tree = () => within(screen.getByRole('navigation', { name: '설명서 목차' }));

type User = ReturnType<typeof userEvent.setup>;
/** 첫 화면의 분류 카드 → 그 분류의 세부 기능 */
/** 항목 이름의 괄호 등을 글자 그대로 찾게 ('진도 관리 (차시 목록 · 밀기)') */
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const openCategory = (user: User, title: string) =>
  user.click(content().getByRole('button', { name: new RegExp(`${title}.*개 기능`) }));

describe('사용 설명서 - 기능별 분류 → 세부 기능 → 설명·사용 예', () => {
  it('첫 화면에는 기능별 분류만 보이고, 세부 기능은 보이지 않는다', () => {
    render(<HelpModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '기능별 분류' })).toBeInTheDocument();
    for (const category of HELP_CATEGORIES) {
      const card = content().getByRole('button', { name: new RegExp(`${category.title}.*${category.topics.length}개 기능`) });
      expect(card).toHaveTextContent(category.summary);
    }
    // 세부 기능은 분류를 눌러야 나온다 (목차도 분류가 접혀 있다)
    expect(screen.queryByRole('button', { name: /캡처 이미지 붙여넣기 \(Ctrl/ })).toBeNull();
  });

  it('분류를 누르면 그 분류의 세부 기능 목록만 나온다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await openCategory(user, '첨부 · 캡처 · 링크');

    const category = HELP_CATEGORIES.find((c) => c.id === 'attachments')!;
    expect(screen.getByRole('heading', { name: /첨부 · 캡처 · 링크/ })).toBeInTheDocument();
    for (const topic of category.topics) {
      expect(content().getByRole('button', { name: new RegExp(topic.title.replace(/[()+]/g, '.')) })).toBeInTheDocument();
    }
    // 다른 분류의 기능은 없다
    expect(content().queryByRole('button', { name: /출석부/ })).toBeNull();
  });

  it('세부 기능을 누르면 세부 설명과 사용 예가 나온다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await openCategory(user, '첨부 · 캡처 · 링크');
    await user.click(content().getByRole('button', { name: /캡처 이미지 붙여넣기/ }));

    expect(screen.getByRole('heading', { name: /캡처 이미지 붙여넣기/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /세부 설명/ })).toBeInTheDocument();
    expect(screen.getByText(/붙여넣은 이미지 업로드 중/)).toBeInTheDocument();

    const examples = screen.getByRole('region', { name: /사용 예/ });
    expect(within(examples).getByText(/공문 화면을 캡처해 기록에 붙이기/)).toBeInTheDocument();
    expect(within(examples).getAllByRole('listitem').length).toBeGreaterThan(1);
  });

  it('위치 표시로 분류 목록과 첫 화면으로 돌아온다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await openCategory(user, '일정');
    await user.click(content().getByRole('button', { name: /일정 속성 5가지/ }));

    const nav = screen.getByRole('navigation', { name: '설명서 위치' });
    expect(nav).toHaveTextContent('사용 설명서');
    expect(nav).toHaveTextContent('일정 속성 5가지');

    await user.click(within(nav).getByRole('button', { name: '← 일정' }));
    expect(content().getByRole('button', { name: /일정 추가하기/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '← 기능별 분류' }));
    expect(screen.getByRole('heading', { name: '기능별 분류' })).toBeInTheDocument();
  });

  it('이전 · 다음은 같은 분류 안에서만 오간다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    const category = HELP_CATEGORIES.find((c) => c.id === 'find')!;
    await openCategory(user, category.title);
    await user.click(content().getByRole('button', { name: new RegExp(escapeRe(category.topics[0].title)) }));

    // 분류의 첫 항목에는 '이전'이 없다 (앞 분류로 넘어가지 않는다)
    expect(screen.queryByText('‹ 이전')).toBeNull();
    await user.click(screen.getByText('다음 ›'));
    expect(screen.getByRole('heading', { name: new RegExp(escapeRe(category.topics[1].title)) })).toBeInTheDocument();
  });

  it('설명 안의 연결을 누르면 다른 분류의 항목으로도 간다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await openCategory(user, '일정');
    await user.click(content().getByRole('button', { name: /일정 속성 5가지/ }));
    await user.click(content().getByRole('button', { name: '시간표 적용' }));

    expect(screen.getByRole('heading', { name: /^\S*\s*시간표$/ })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '설명서 위치' })).toHaveTextContent('수업 · 시간표');
  });

  it('찾기 칸에 적으면 분류와 상관없이 그 말이 들어 있는 기능만 남는다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('설명서에서 찾기'), '초성');
    expect(content().getByRole('button', { name: /명렬표 - 검색 · 암기/ })).toBeInTheDocument();
    expect(content().queryByRole('button', { name: /구글 캘린더로 보내기/ })).not.toBeInTheDocument();
  });

  it('사용 예의 글도 찾기에 걸린다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('설명서에서 찾기'), '독서 감상문');
    expect(content().getByRole('button', { name: /조사표/ })).toBeInTheDocument();
  });

  it('환경설정에서 바꾼 단축키와 이월 기간을 그대로 보여준다', async () => {
    useAppStore.setState({
      shortcutOverrides: { scopeDay: { ctrl: false, alt: true, shift: false, key: 'D' } },
      forwardLookbackDays: 21,
    });
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await openCategory(user, '시작하기');
    await user.click(content().getByRole('button', { name: /화면 전환과 날짜 이동/ }));
    // 세부 설명과 사용 예 모두 바꾼 키를 따른다
    expect(screen.getAllByText('Alt + D').length).toBeGreaterThan(1);

    // 위치 표시의 '사용 설명서'는 곧장 첫 화면으로 간다
    const nav = screen.getByRole('navigation', { name: '설명서 위치' });
    await user.click(within(nav).getByRole('button', { name: '사용 설명서' }));
    await openCategory(user, '일정');
    await user.click(content().getByRole('button', { name: /이월 \(못 끝낸 일정/ }));
    expect(screen.getAllByText('21').length).toBeGreaterThan(0);
  });

  it('단축키 목록은 지금 설정값으로 그린다', async () => {
    useAppStore.setState({
      shortcutOverrides: { trash: { ctrl: true, alt: false, shift: true, key: 'T' } },
    });
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await user.click(content().getByRole('button', { name: /단축키 한눈에 보기/ }));
    const row = content().getByText('휴지통').closest('div')!;
    expect(within(row).getByText('Ctrl + Shift + T')).toBeInTheDocument();
    expect(screen.getByText('모든 팝업창·오른쪽 칸 저장 없이 닫기')).toBeInTheDocument();
  });
});

describe('사용 설명서 - 찾기 차례', () => {
  it('제목에 찾는 말이 든 항목이 먼저 나온다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('설명서에서 찾기'), '링크');
    const first = content().getByText(/개 항목$/).nextElementSibling!;
    expect(first.textContent).toMatch(/링크/);
    expect(first.textContent).not.toMatch(/하루 화면 구성/);
  });
});

// 설명서 왼쪽의 목차 트리 (2026-10-02 사용자 요청). 분류 › 기능을 어디서든 곧장 고른다.
describe('사용 설명서 - 왼쪽 목차', () => {
  it('목차에 처음 화면·단축키와 모든 분류가 있고, 분류를 펴면 세부 기능이 나온다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    expect(tree().getByRole('button', { name: /처음 화면/ })).toHaveAttribute('aria-current', 'page');
    expect(tree().getByRole('button', { name: /단축키 한눈에 보기/ })).toBeInTheDocument();
    for (const category of HELP_CATEGORIES) {
      expect(tree().getByRole('button', { name: new RegExp(`${escapeRe(category.title)}\\s*${category.topics.length}$`) })).toBeInTheDocument();
    }
    // 처음에는 분류가 접혀 있다
    expect(tree().queryByRole('button', { name: /일정 속성 5가지/ })).toBeNull();

    const events = HELP_CATEGORIES.find((c) => c.id === 'events')!;
    await user.click(tree().getByRole('button', { name: '일정 펴기' }));
    for (const topic of events.topics) {
      expect(tree().getByRole('button', { name: new RegExp(escapeRe(topic.title)) })).toBeInTheDocument();
    }
    // 펴기만 해서는 내용이 바뀌지 않는다
    expect(screen.getByRole('heading', { name: '기능별 분류' })).toBeInTheDocument();
    await user.click(tree().getByRole('button', { name: '일정 접기' }));
    expect(tree().queryByRole('button', { name: /일정 속성 5가지/ })).toBeNull();
  });

  it('목차의 기능을 누르면 그 설명이 열리고, 목차에서 지금 기능이 짚인다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await user.click(tree().getByRole('button', { name: '첨부 · 캡처 · 링크 펴기' }));
    await user.click(tree().getByRole('button', { name: /캡처 이미지 붙여넣기/ }));

    expect(content().getByRole('heading', { name: /캡처 이미지 붙여넣기/ })).toBeInTheDocument();
    expect(tree().getByRole('button', { name: /캡처 이미지 붙여넣기/ })).toHaveAttribute('aria-current', 'page');
    expect(tree().getByRole('button', { name: /처음 화면/ })).not.toHaveAttribute('aria-current');

    // 목차의 분류 이름은 그 분류의 기능 목록을 연다
    await user.click(tree().getByRole('button', { name: /^📅\s*일정\s*\d+$/ }));
    expect(content().getByRole('heading', { name: /일정/ })).toBeInTheDocument();
    expect(content().getByRole('button', { name: /일정 추가하기/ })).toBeInTheDocument();
    // 그 분류가 목차에서도 펼쳐진다
    expect(tree().getByRole('button', { name: /일정 추가하기/ })).toBeInTheDocument();

    await user.click(tree().getByRole('button', { name: /처음 화면/ }));
    expect(screen.getByRole('heading', { name: '기능별 분류' })).toBeInTheDocument();
  });

  it('내용 칸에서 고르거나 설명 안의 연결로 다른 분류에 가도 목차가 그 분류를 펴서 짚는다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await openCategory(user, '일정');
    await user.click(content().getByRole('button', { name: /일정 속성 5가지/ }));
    expect(tree().getByRole('button', { name: /일정 속성 5가지/ })).toHaveAttribute('aria-current', 'page');

    await user.click(content().getByRole('button', { name: '시간표 적용' }));
    expect(tree().getByRole('button', { name: /^\S*\s*시간표$/ })).toHaveAttribute('aria-current', 'page');
    // 앞서 연 분류도 펼친 채 남는다
    expect(tree().getByRole('button', { name: /일정 속성 5가지/ })).not.toHaveAttribute('aria-current');
  });

  it('모두 펴기 · 모두 접기', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await user.click(tree().getByRole('button', { name: '모두 펴기' }));
    expect(tree().getAllByRole('button', { name: /펴기$|접기$/ }).filter((b) => b.getAttribute('aria-expanded') === 'true')).toHaveLength(HELP_CATEGORIES.length);
    expect(tree().getByRole('button', { name: /휴지통/ })).toBeInTheDocument();

    await user.click(tree().getByRole('button', { name: '모두 접기' }));
    expect(tree().queryByRole('button', { name: /휴지통/ })).toBeNull();
  });

  it('머리말의 📚 목차 단추로 목차를 접고 다시 보이며, 접은 것을 이 기기에 기억한다', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<HelpModal isOpen onClose={vi.fn()} />);

    const toggle = screen.getByRole('button', { name: '📚 목차' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(screen.queryByRole('navigation', { name: '설명서 목차' })).toBeNull();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('sp4-help-tree-hidden')).toBe('1');
    // 내용은 그대로 보인다
    expect(screen.getByRole('heading', { name: '기능별 분류' })).toBeInTheDocument();

    // 다시 열어도 접힌 채
    unmount();
    render(<HelpModal isOpen onClose={vi.fn()} />);
    expect(screen.queryByRole('navigation', { name: '설명서 목차' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '📚 목차' }));
    expect(screen.getByRole('navigation', { name: '설명서 목차' })).toBeInTheDocument();
    expect(localStorage.getItem('sp4-help-tree-hidden')).toBe('0');
  });
});
