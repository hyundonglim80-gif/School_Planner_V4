import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDocFromServer, writeBatch } from 'firebase/firestore';
import PeriodModal from './PeriodModal';

// 공휴일은 Firestore에서 읽어온다. 여기서는 표만 갈아 끼운다.
const gov = vi.hoisted(() => ({ days: {} as Record<string, string> }));
vi.mock('../hooks/useGovHolidays', () => ({
  loadHolidayYears: async () => gov.days,
}));

// 2026-09-21은 월요일이다.
const MONDAY = '2026-09-21';

const renderModal = () =>
  render(<PeriodModal isOpen onClose={vi.fn()} startDate={MONDAY} defaultContent="여름방학" />);

beforeEach(() => {
  gov.days = {};
});

describe('PeriodModal - 기간 설정', () => {
  it('일정 내용과 시작·끝 날짜 칸이 보인다', () => {
    renderModal();

    expect(screen.getByDisplayValue('여름방학')).toBeInTheDocument();
    expect(screen.getByLabelText('시작일')).toHaveValue(MONDAY);
    expect(screen.getByLabelText('종료일')).toHaveValue(MONDAY);
  });

  it('주말을 뺀 날짜 수가 등록 버튼에 나온다', () => {
    renderModal();

    // 월~일 7일 중 토·일을 빼면 평일 5일
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-27' } });

    expect(screen.getByRole('button', { name: '등록 (5일)' })).toBeInTheDocument();
  });

  it('주말 제외를 끄면 주말까지 센다', async () => {
    const user = userEvent.setup();
    renderModal();

    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-27' } });
    await user.click(screen.getByLabelText(/주말/));

    expect(screen.getByRole('button', { name: '등록 (7일)' })).toBeInTheDocument();
  });

  it('종료일이 시작일보다 빠르면 등록할 수 없다', () => {
    renderModal();

    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-01' } });

    expect(screen.getByRole('button', { name: '등록 (0일)' })).toBeDisabled();
  });
});

describe('PeriodModal - 공휴일', () => {
  // 주말을 뺄 때 공휴일도 같이 뺀다. 학교가 쉬는 날에 일정을 깔아 두면
  // 그날 할 수 없는 일이 목록에 남고, 미완료로 계속 이월된다.
  it('주말 제외를 켜면 공휴일도 빠진다', async () => {
    gov.days = { '2026-09-23': '테스트 공휴일' }; // 수요일

    renderModal();
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-27' } });

    // 평일 5일에서 공휴일 하루가 빠져 4일
    expect(await screen.findByRole('button', { name: '등록 (4일)' })).toBeInTheDocument();
  });

  it('빠지는 공휴일 이름을 알려 준다', async () => {
    gov.days = { '2026-09-23': '테스트 공휴일' };

    renderModal();
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-27' } });

    expect(await screen.findByText(/빠지는 공휴일: 테스트 공휴일/)).toBeInTheDocument();
  });

  it('주말 제외를 끄면 공휴일에도 등록한다', async () => {
    gov.days = { '2026-09-23': '테스트 공휴일' };
    const user = userEvent.setup();

    renderModal();
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-27' } });
    await screen.findByRole('button', { name: '등록 (4일)' });
    await user.click(screen.getByLabelText(/주말/));

    expect(screen.getByRole('button', { name: '등록 (7일)' })).toBeInTheDocument();
  });
});

describe('PeriodModal - 있는 일정을 기간으로 바꾸기', () => {
  // 예전에는 등록한 뒤에 원래 한 건을 따로 지웠다. 그 지우기가 화면이 들고 있던
  // 옛 목록을 통째로 덮어써서, 방금 만든 첫날 일정까지 같이 사라졌다.
  // 이제는 같은 일괄 쓰기 안에서 뺀다.
  const written: any[] = [];

  beforeEach(() => {
    written.length = 0;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // 서버에서 읽는다 (캐시 답을 믿으면 그날 일정을 통째로 덮어쓴다)
    vi.mocked(getDocFromServer).mockResolvedValue({
      exists: () => true,
      data: () => ({ eventList: [{ id: 'ev_old', content: '여름방학' }] }),
    } as any);
    vi.mocked(writeBatch).mockReturnValue({
      set: (_ref: any, data: any) => written.push(data),
      delete: vi.fn(),
      commit: async () => {},
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('첫날 문서에 원래 한 건은 빠지고 새 일정은 남는다', async () => {
    const user = userEvent.setup();
    render(
      <PeriodModal
        isOpen
        onClose={vi.fn()}
        startDate={MONDAY}
        defaultContent="여름방학"
        replace={{ dateStr: MONDAY, id: 'ev_old' }}
      />
    );

    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-25' } });
    await user.click(screen.getByRole('button', { name: '등록 (5일)' }));

    await waitFor(() => expect(written.length).toBe(5));
    const firstDay = written[0].eventList;
    expect(firstDay.some((e: any) => e.id === 'ev_old')).toBe(false);
    expect(firstDay.some((e: any) => e.content === '여름방학 (1/5)')).toBe(true);
  });

  // 인터넷 사용 기록을 지운 직후가 딱 이 상태다. 캐시는 비어 있고 서버 답은
  // 아직 없다. 그 말을 믿고 목록을 다시 쓰면 그날 일정이 통째로 지워진다.
  it('서버가 답하지 않으면 한 글자도 쓰지 않는다', async () => {
    const user = userEvent.setup();
    vi.mocked(getDocFromServer).mockRejectedValue(new Error('offline'));

    render(
      <PeriodModal
        isOpen
        onClose={vi.fn()}
        startDate={MONDAY}
        defaultContent="여름방학"
        replace={{ dateStr: MONDAY, id: 'ev_old' }}
      />
    );

    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-25' } });
    await user.click(screen.getByRole('button', { name: '등록 (5일)' }));

    // 저장이 끝나면 단추 글씨가 '등록 중...'에서 되돌아온다
    await waitFor(() => expect(screen.getByRole('button', { name: '등록 (5일)' })).toBeEnabled());
    expect(written).toEqual([]);
  });

  it('등록이 끝났다고 알린다', async () => {
    const user = userEvent.setup();
    const onRegistered = vi.fn();
    render(
      <PeriodModal
        isOpen
        onClose={vi.fn()}
        startDate={MONDAY}
        defaultContent="여름방학"
        replace={{ dateStr: MONDAY, id: 'ev_old' }}
        onRegistered={onRegistered}
      />
    );

    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-09-25' } });
    await user.click(screen.getByRole('button', { name: '등록 (5일)' }));

    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith(5));
  });
});
