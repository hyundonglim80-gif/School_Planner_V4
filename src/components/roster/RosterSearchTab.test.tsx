import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import RosterSearchTab from './RosterSearchTab';
import type { ClassRoster } from '../../hooks/useRoster';

const st = (num: number, name: string, isActive = true) => ({
  num,
  name,
  gender: num % 2 ? 'M' : 'F',
  isActive,
  note: '',
});

const classes: ClassRoster[] = [
  {
    year: 2026,
    grade: '3',
    classNum: '1',
    students: [st(3, '강지훈'), st(12, '김지민'), st(20, '배유나')],
  },
  {
    year: 2026,
    grade: '3',
    classNum: '2',
    students: [st(4, '김지우'), st(9, '서지호'), st(15, '문하준', false)],
  },
  {
    year: 2026,
    grade: '4',
    classNum: '1',
    students: [st(1, '김지환')],
  },
];

const pick = { year: '2026', grade: '3', classNum: '2' };

function setup(overrides: Partial<React.ComponentProps<typeof RosterSearchTab>> = {}) {
  const onOpenStudent = vi.fn();
  render(
    <RosterSearchTab
      classes={classes}
      pick={pick}
      photos={new Map()}
      photoFolderReady={false}
      onOpenStudent={onOpenStudent}
      {...overrides}
    />
  );
  return { onOpenStudent };
}

/** 지금 화면에 보이는 학생 이름들 */
const shownNames = () =>
  screen
    .getAllByRole('button')
    .map((b) => b.getAttribute('title'))
    .filter((t): t is string => !!t && /\d+번/.test(t));

describe('검색 탭 - 처음 열었을 때', () => {
  it('위에서 고른 학급만 보여준다', () => {
    setup();
    expect(screen.getByText('2026학년도 3학년 2반')).toBeInTheDocument();
    expect(screen.queryByText('2026학년도 3학년 1반')).not.toBeInTheDocument();
  });

  it('재학생만 켜져 있어 전출생은 빠진다', () => {
    setup();
    expect(shownNames()).toEqual(['4번 김지우', '9번 서지호']);
  });
});

describe('검색 탭 - 이름으로 찾기', () => {
  it('초성으로 찾는다', () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText('예: 김지우 · ㄱㅈㅇ'), {
      target: { value: 'ㄱㅈ' },
    });
    expect(shownNames()).toEqual(['4번 김지우']);
    expect(screen.getByText('초성으로 찾는 중')).toBeInTheDocument();
  });

  it('반을 전체로 넓히면 그 학년에서 모두 찾는다', () => {
    setup();
    fireEvent.change(screen.getByLabelText('반'), { target: { value: '' } });
    fireEvent.change(screen.getByPlaceholderText('예: 김지우 · ㄱㅈㅇ'), {
      target: { value: 'ㄱㅈ' },
    });
    // 3학년 1반의 강지훈·김지민까지 들어오고, 4학년 김지환은 빠진다
    expect(shownNames()).toEqual(['3번 강지훈', '12번 김지민', '4번 김지우']);
    expect(screen.getByText('2026학년도 3학년 1반')).toBeInTheDocument();
  });

  it('이름 글자로도 찾는다', () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText('예: 김지우 · ㄱㅈㅇ'), {
      target: { value: '지호' },
    });
    expect(shownNames()).toEqual(['9번 서지호']);
  });

  it('맞는 학생이 없으면 그렇다고 말한다', () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText('예: 김지우 · ㄱㅈㅇ'), {
      target: { value: 'ㅎㅎㅎ' },
    });
    expect(screen.getByText('조건에 맞는 학생이 없습니다.')).toBeInTheDocument();
  });
});

describe('검색 탭 - 번호로 찾기', () => {
  it('번호가 딱 맞는 학생만 남긴다', () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText('전체'), { target: { value: '9' } });
    expect(shownNames()).toEqual(['9번 서지호']);
  });

  it('숫자가 아닌 것은 번호 칸에 들어가지 않는다', () => {
    setup();
    const numBox = screen.getByPlaceholderText('전체') as HTMLInputElement;
    fireEvent.change(numBox, { target: { value: '9가' } });
    expect(numBox.value).toBe('9');
  });
});

describe('검색 탭 - 그 밖의 손잡이', () => {
  it('재학생만을 끄면 전출생도 나온다', () => {
    setup();
    fireEvent.click(screen.getByLabelText('재학생만'));
    expect(shownNames()).toContain('15번 문하준');
  });

  it('이름 가리기를 켜면 이름 자리에 물음표가 뜬다', () => {
    setup();
    fireEvent.click(screen.getByLabelText('이름 가리기'));
    expect(screen.queryByText('김지우')).not.toBeInTheDocument();
    expect(screen.getAllByText('?').length).toBeGreaterThan(0);
    // 번호는 그대로 보여야 짚어 볼 수 있다
    expect(shownNames()).toEqual(['4번 김지우', '9번 서지호']);
  });

  it("'조건 지우기'를 누르면 위에서 고른 학급으로 돌아온다", () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText('예: 김지우 · ㄱㅈㅇ'), {
      target: { value: 'ㄱㅈ' },
    });
    fireEvent.click(screen.getByText('조건 지우기'));
    expect(shownNames()).toEqual(['4번 김지우', '9번 서지호']);
  });

  it('학생을 누르면 그 학급과 학생을 올려 보낸다', () => {
    const { onOpenStudent } = setup();
    fireEvent.click(screen.getByTitle('9번 서지호'));
    expect(onOpenStudent).toHaveBeenCalledTimes(1);
    const [cls, student] = onOpenStudent.mock.calls[0];
    expect(cls.classNum).toBe('2');
    expect(student.name).toBe('서지호');
  });
});

describe('검색 탭 - 사진', () => {
  it('고른 학급의 사진만 띄운다', () => {
    setup({
      photoFolderReady: true,
      photos: new Map([[4, { url: 'blob:김지우', exact: true, fileName: '2026-3-2-4-김지우.png' }]]),
    });
    const card = screen.getByTitle('4번 김지우');
    expect(within(card).getByRole('img')).toHaveAttribute('src', 'blob:김지우');
  });

  it('다른 학급을 함께 볼 때는 사진이 그 학급 것만이라고 알린다', () => {
    setup({ photoFolderReady: true });
    fireEvent.change(screen.getByLabelText('반'), { target: { value: '' } });
    expect(screen.getAllByText('사진은 위에서 이 학급을 골라야 보입니다').length).toBeGreaterThan(0);
  });
});
