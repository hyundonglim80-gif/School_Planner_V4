import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LinkerModal from './LinkerModal';
import { getDocs as getDocsMock, getDoc as getDocMock } from 'firebase/firestore';

vi.mock('../hooks/useLabels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useLabels')>();
  return {
    ...actual,
    useLabels: () => ({
      eventLabels: [{ id: 'ev_1', name: '수업', color: 'blue' }],
      journalLabels: [{ id: 'j_1', name: '상담', color: 'green' }],
      memoLabels: ['업무'],
      getLabelColor: () => 'blue',
    }),
  };
});

const props = {
  isOpen: true,
  onClose: vi.fn(),
  sourceType: 'event',
  sourceDateStr: '2026-09-15',
  sourceId: 'src-1',
  sourceFId: 'personal',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('링크 추가 - 조회 범위', () => {
  it('열면 목록을 불러온다', async () => {
    render(<LinkerModal {...props} />);
    await waitFor(() => expect(getDocsMock).toHaveBeenCalled());
  });

  it('고른 범위가 ±1주일로 되돌아가지 않는다', async () => {
    const user = userEvent.setup();
    render(<LinkerModal {...props} />);

    const select = await screen.findByDisplayValue('±1주일');
    await user.selectOptions(select, '1month');

    await waitFor(() => expect(select).toHaveValue('1month'));
  });

  it('기준 날짜가 ISO 시각 문자열이어도 날짜 칸이 채워진다', async () => {
    const user = userEvent.setup();
    // Layout은 기준 날짜가 없으면 store의 currentDate(= toISOString())를 그대로 넘긴다
    const { container } = render(
      <LinkerModal {...props} sourceDateStr="2026-09-15T10:23:45.123Z" />
    );

    const select = await screen.findByDisplayValue('±1주일');
    await user.selectOptions(select, 'custom');

    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="date"]');
    await waitFor(() => expect(inputs.length).toBe(2));
    expect(inputs[0].value).toBe('2026-09-15');
    expect(inputs[1].value).toBe('2026-09-15');
  });

  it("'기간 설정'을 고르면 시작·끝 날짜 칸이 나온다", async () => {
    const user = userEvent.setup();
    const { container } = render(<LinkerModal {...props} />);

    const select = await screen.findByDisplayValue('±1주일');
    await user.selectOptions(select, 'custom');

    await waitFor(() =>
      expect(container.querySelectorAll('input[type="date"]').length).toBe(2)
    );
  });
});

// 링크 추가가 '데이터를 불러오는 중'에서 1분 넘게 멈춰 있었다. 시작일부터
// 종료일까지 하루씩 돌면서 일정 문서와 기록 문서를 하나씩 줄 세워 기다렸기
// 때문이다. 1년 범위면 왕복이 700번을 넘었다. 에뮬레이터에서 재 보니
// 예전 방식 10.7초 / 범위 조회 0.1초였고, 실제 인터넷에서는 그 차이가 훨씬 크다.
// 날짜가 곧 문서 이름이므로 범위 조회로 한 번에 받아야 한다.
describe('링크 추가 - 날짜마다 한 건씩 읽지 않는다', () => {
  it('범위를 넓게 골라도 문서를 하나씩 읽지 않는다', async () => {
    const user = userEvent.setup();
    render(<LinkerModal {...props} />);

    const wide = screen.queryByRole('button', { name: /1개월/ });
    if (wide) await user.click(wide);

    await waitFor(() => expect(getDocsMock).toHaveBeenCalled());

    // 하루씩 읽으면 getDoc이 날짜 수만큼 불린다. 범위 조회는 그럴 일이 없다.
    expect((getDocMock as unknown as { mock: { calls: unknown[] } }).mock.calls.length)
      .toBeLessThan(10);
  });
});

// 드롭다운만 있으면 '±1주일'이 실제로 며칠부터 며칠까지인지 알 수 없고,
// 하루만 늘리려 해도 '기간 설정'을 고른 뒤 두 날짜를 처음부터 다시 찍어야 했다.
describe('링크 추가 - 고른 범위의 날짜를 보여 주고 고칠 수 있다', () => {
  it('±1주일을 고르면 그 범위의 날짜가 칸에 들어 있다', async () => {
    render(<LinkerModal {...props} />);

    // 기준 2026-09-15의 앞뒤 7일
    expect(await screen.findByLabelText('시작일')).toHaveValue('2026-09-08');
    expect(screen.getByLabelText('종료일')).toHaveValue('2026-09-22');
  });

  it('범위를 바꾸면 날짜도 따라 바뀐다', async () => {
    const user = userEvent.setup();
    render(<LinkerModal {...props} />);

    const select = await screen.findByDisplayValue('±1주일');
    await user.selectOptions(select, 'sem1');

    await waitFor(() => expect(screen.getByLabelText('시작일')).toHaveValue('2026-03-01'));
    expect(screen.getByLabelText('종료일')).toHaveValue('2026-08-31');
  });

  it("날짜를 직접 고치면 '기간 설정'으로 넘어간다", async () => {
    render(<LinkerModal {...props} />);

    const start = await screen.findByLabelText('시작일');
    fireEvent.change(start, { target: { value: '2026-09-01' } });

    await waitFor(() => expect(screen.getByLabelText('시작일')).toHaveValue('2026-09-01'));
    // 고친 날짜가 드롭다운 이름과 어긋난 채로 남지 않는다
    expect(screen.getByDisplayValue('기간 설정')).toBeInTheDocument();
    // 건드리지 않은 종료일은 그대로다
    expect(screen.getByLabelText('종료일')).toHaveValue('2026-09-22');
  });
});
