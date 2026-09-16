import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchModal from './SearchModal';
import {
  getDocs as getDocsMock,
  collection as collectionMock,
  query as queryMock,
} from 'firebase/firestore';

// 한 학기치 수업 문서. 하루 6교시이고 교시마다 과목·메모·비고가 따로 잡히므로
// 검색어를 비우고 한 학기를 고르면 수업만으로 3천 건이 넘는다.
function semesterSchedules() {
  const docs: any[] = [];
  for (let i = 0; i < 168; i++) {
    const d = new Date(2026, 2, 1 + i);
    const id = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const periods: Record<string, any> = {};
    for (let p = 1; p <= 6; p++) {
      periods[p] = { subject: `국어 ${p}교시`, memo: `${p}교시 메모`, supplies: `${p}교시 준비물` };
    }
    docs.push({ id, data: () => ({ periods }) });
  }
  return { forEach: (cb: any) => docs.forEach(cb), docs };
}

// 결과 카드마다 하나씩 들어 있는 '이동 ➔' 표시로 센다
const resultCards = () => screen.queryAllByText('이동 ➔');

const ms = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

// 메모는 한 건에 문서 하나라 문서 이름으로 기간을 자를 수 없다. 만든 날로 거른다.
function memoDocs() {
  return {
    forEach: (cb: any) =>
      [
        { id: 'm_before', data: () => ({ text: '작년 메모', createdAt: ms(2025, 12, 20) }) },
        { id: 'm_inside', data: () => ({ text: '1학기 메모', createdAt: ms(2026, 4, 10) }) },
        { id: 'm_after', data: () => ({ text: '겨울 메모', createdAt: ms(2026, 12, 3) }) },
        // createdAt이 없던 옛 메모. order에서 만든 때를 되살린다.
        { id: 'm_legacy', data: () => ({ text: '옛 메모', order: -ms(2026, 5, 2) }) },
        // 만든 때를 알 길이 없는 메모는 기간 때문에 사라지면 안 된다.
        { id: 'm_unknown', data: () => ({ text: '날짜 없는 메모' }) },
      ].forEach(cb),
    docs: [],
  };
}

beforeEach(() => {
  (collectionMock as any).mockImplementation((...args: any[]) => ({ path: args.slice(1).join('/') }));
  (queryMock as any).mockImplementation((col: any) => col);
  (getDocsMock as any).mockImplementation(async (ref: any) =>
    String(ref?.path || '').includes('schedules')
      ? semesterSchedules()
      : { forEach: () => {}, docs: [] }
  );
});

describe('검색 - 결과가 아주 많을 때', () => {
  it('찾은 건수는 다 세되 화면에는 앞에서부터 조금씩만 그린다', async () => {
    const user = userEvent.setup();
    render(<SearchModal isOpen onClose={vi.fn()} />);

    await user.selectOptions(screen.getByRole('combobox'), 'sem1');
    await user.click(screen.getByRole('button', { name: '데이터 찾기' }));

    // 건수는 그대로 알려 준다
    expect(await screen.findByText(/총 3024건/)).toBeInTheDocument();
    // 3천 개를 한꺼번에 만들지 않는다 (예전에는 이 때문에 화면이 한참 멈췄다)
    expect(resultCards().length).toBe(50);
  }, 30000);

  it("'더 보기'를 누르면 이어서 더 그린다", async () => {
    const user = userEvent.setup();
    render(<SearchModal isOpen onClose={vi.fn()} />);

    await user.selectOptions(screen.getByRole('combobox'), 'sem1');
    await user.click(screen.getByRole('button', { name: '데이터 찾기' }));
    await screen.findByText(/총 3024건/);

    await user.click(screen.getByRole('button', { name: /더 보기/ }));

    expect(resultCards().length).toBe(100);
  }, 30000);
});

describe('검색 - 메모 기간', () => {
  it('고른 기간 안에 만든 메모만 나온다', async () => {
    (getDocsMock as any).mockImplementation(async (ref: any) =>
      String(ref?.path || '').includes('tasks') ? memoDocs() : { forEach: () => {}, docs: [] }
    );

    const user = userEvent.setup();
    render(<SearchModal isOpen onClose={vi.fn()} />);

    await user.selectOptions(screen.getByRole('combobox'), 'sem1'); // 3월 ~ 8월 15일
    await user.click(screen.getByRole('button', { name: '데이터 찾기' }));

    await screen.findByText('1학기 메모');
    expect(screen.getByText('메모 (2026-04-10)')).toBeInTheDocument();
    // createdAt이 없어도 order로 되살려 기간 안이면 나온다
    expect(screen.getByText('옛 메모')).toBeInTheDocument();
    // 만든 때를 알 수 없는 메모는 기간 때문에 빠지지 않는다
    expect(screen.getByText('날짜 없는 메모')).toBeInTheDocument();

    expect(screen.queryByText('작년 메모')).not.toBeInTheDocument();
    expect(screen.queryByText('겨울 메모')).not.toBeInTheDocument();
  }, 30000);

  it("기간이 '해당 학년도 전체'면 모든 메모가 나온다", async () => {
    (getDocsMock as any).mockImplementation(async (ref: any) =>
      String(ref?.path || '').includes('tasks') ? memoDocs() : { forEach: () => {}, docs: [] }
    );

    const user = userEvent.setup();
    render(<SearchModal isOpen onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '데이터 찾기' }));

    await screen.findByText('1학기 메모');
    expect(screen.getByText('작년 메모')).toBeInTheDocument();
    expect(screen.getByText('겨울 메모')).toBeInTheDocument();
  }, 30000);
});
