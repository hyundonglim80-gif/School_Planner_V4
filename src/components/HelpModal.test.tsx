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

type User = ReturnType<typeof userEvent.setup>;
/** 첫 화면의 분류 카드 → 그 분류의 세부 기능 */
/** 항목 이름의 괄호 등을 글자 그대로 찾게 ('진도 관리 (차시 목록 · 밀기)') */
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const openCategory = (user: User, title: string) =>
  user.click(screen.getByRole('button', { name: new RegExp(`${title}.*개 기능`) }));

describe('사용 설명서 - 기능별 분류 → 세부 기능 → 설명·사용 예', () => {
  it('첫 화면에는 기능별 분류만 보이고, 세부 기능은 보이지 않는다', () => {
    render(<HelpModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '기능별 분류' })).toBeInTheDocument();
    for (const category of HELP_CATEGORIES) {
      const card = screen.getByRole('button', { name: new RegExp(`${category.title}.*${category.topics.length}개 기능`) });
      expect(card).toHaveTextContent(category.summary);
    }
    // 세부 기능은 분류를 눌러야 나온다
    expect(screen.queryByRole('button', { name: /캡처 이미지 붙여넣기 \(Ctrl/ })).toBeNull();
  });

  it('분류를 누르면 그 분류의 세부 기능 목록만 나온다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await openCategory(user, '첨부 · 캡처 · 링크');

    const category = HELP_CATEGORIES.find((c) => c.id === 'attachments')!;
    expect(screen.getByRole('heading', { name: /첨부 · 캡처 · 링크/ })).toBeInTheDocument();
    for (const topic of category.topics) {
      expect(screen.getByRole('button', { name: new RegExp(topic.title.replace(/[()+]/g, '.')) })).toBeInTheDocument();
    }
    // 다른 분류의 기능은 없다
    expect(screen.queryByRole('button', { name: /출석부/ })).toBeNull();
  });

  it('세부 기능을 누르면 세부 설명과 사용 예가 나온다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await openCategory(user, '첨부 · 캡처 · 링크');
    await user.click(screen.getByRole('button', { name: /캡처 이미지 붙여넣기/ }));

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
    await user.click(screen.getByRole('button', { name: /일정 속성 5가지/ }));

    const nav = screen.getByRole('navigation', { name: '설명서 위치' });
    expect(nav).toHaveTextContent('사용 설명서');
    expect(nav).toHaveTextContent('일정 속성 5가지');

    await user.click(within(nav).getByRole('button', { name: '← 일정' }));
    expect(screen.getByRole('button', { name: /일정 추가하기/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '← 기능별 분류' }));
    expect(screen.getByRole('heading', { name: '기능별 분류' })).toBeInTheDocument();
  });

  it('이전 · 다음은 같은 분류 안에서만 오간다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    const category = HELP_CATEGORIES.find((c) => c.id === 'find')!;
    await openCategory(user, category.title);
    await user.click(screen.getByRole('button', { name: new RegExp(escapeRe(category.topics[0].title)) }));

    // 분류의 첫 항목에는 '이전'이 없다 (앞 분류로 넘어가지 않는다)
    expect(screen.queryByText('‹ 이전')).toBeNull();
    await user.click(screen.getByText('다음 ›'));
    expect(screen.getByRole('heading', { name: new RegExp(escapeRe(category.topics[1].title)) })).toBeInTheDocument();
  });

  it('설명 안의 연결을 누르면 다른 분류의 항목으로도 간다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await openCategory(user, '일정');
    await user.click(screen.getByRole('button', { name: /일정 속성 5가지/ }));
    await user.click(screen.getByRole('button', { name: '시간표 적용' }));

    expect(screen.getByRole('heading', { name: /시간표 적용 \(주간 템플릿\)/ })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '설명서 위치' })).toHaveTextContent('수업 · 시간표');
  });

  it('찾기 칸에 적으면 분류와 상관없이 그 말이 들어 있는 기능만 남는다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('설명서에서 찾기'), '초성');
    expect(screen.getByRole('button', { name: /명렬표 - 검색 · 암기/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /구글 캘린더로 보내기/ })).not.toBeInTheDocument();
  });

  it('사용 예의 글도 찾기에 걸린다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('설명서에서 찾기'), '독서 감상문');
    expect(screen.getByRole('button', { name: /조사표/ })).toBeInTheDocument();
  });

  it('환경설정에서 바꾼 단축키와 이월 기간을 그대로 보여준다', async () => {
    useAppStore.setState({
      shortcutOverrides: { scopeDay: { ctrl: false, alt: true, shift: false, key: 'D' } },
      forwardLookbackDays: 21,
    });
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await openCategory(user, '시작하기');
    await user.click(screen.getByRole('button', { name: /화면 전환과 날짜 이동/ }));
    // 세부 설명과 사용 예 모두 바꾼 키를 따른다
    expect(screen.getAllByText('Alt + D').length).toBeGreaterThan(1);

    // 위치 표시의 '사용 설명서'는 곧장 첫 화면으로 간다
    const nav = screen.getByRole('navigation', { name: '설명서 위치' });
    await user.click(within(nav).getByRole('button', { name: '사용 설명서' }));
    await openCategory(user, '일정');
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
    expect(screen.getByText('모든 팝업창·오른쪽 칸 저장 없이 닫기')).toBeInTheDocument();
  });
});

describe('사용 설명서 - 찾기 차례', () => {
  it('제목에 찾는 말이 든 항목이 먼저 나온다', async () => {
    const user = userEvent.setup();
    render(<HelpModal isOpen onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('설명서에서 찾기'), '링크');
    const first = screen.getByText(/개 항목$/).nextElementSibling!;
    expect(first.textContent).toMatch(/링크/);
    expect(first.textContent).not.toMatch(/하루 화면 구성/);
  });
});
