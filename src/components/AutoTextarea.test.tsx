import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import AutoTextarea from './AutoTextarea';

// jsdom은 레이아웃을 계산하지 않아 scrollHeight가 언제나 0이다.
// 줄 수에 비례하는 값을 돌려주도록 대신 세워두고 높이 계산만 확인한다.
beforeAll(() => {
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      const lines = (this.value || '').split('\n').length;
      return lines * 20;
    },
  });
});

function Controlled({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <AutoTextarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="내용"
    />
  );
}

describe('AutoTextarea', () => {
  it('처음 열릴 때부터 내용 높이에 맞춘다', async () => {
    render(<Controlled initial={'한 줄\n두 줄\n세 줄'} />);
    const el = screen.getByPlaceholderText('내용') as HTMLTextAreaElement;

    await waitFor(() => expect(el.style.height).toBe('60px'));
  });

  it('내용이 늘어나면 높이도 늘어난다', async () => {
    render(<Controlled initial={'한 줄'} />);
    const el = screen.getByPlaceholderText('내용') as HTMLTextAreaElement;

    await waitFor(() => expect(el.style.height).toBe('20px'));

    // 값이 바뀌면(=입력) 높이도 다시 계산된다
    render(<Controlled initial={'한 줄\n두 줄\n세 줄\n네 줄'} />);
    const grown = screen.getAllByPlaceholderText('내용')[1] as HTMLTextAreaElement;
    await waitFor(() => expect(grown.style.height).toBe('80px'));
  });

  it('스크롤바가 생기지 않도록 overflow를 감춘다', () => {
    render(<Controlled initial="한 줄" />);
    const el = screen.getByPlaceholderText('내용');

    expect(el.className).toContain('overflow-hidden');
    expect(el.className).toContain('resize-none');
  });
});
