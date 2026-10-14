import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MovedToV5Banner, { MOVED_BANNER_KEY, V5_URL } from './MovedToV5Banner';

describe('MovedToV5Banner - V5로 옮겼습니다 띠', () => {
  beforeEach(() => localStorage.clear());

  it('새 주소로 가는 단추를 보인다', () => {
    const { container } = render(<MovedToV5Banner />);
    expect(container.querySelector('[data-moved-v5-banner]')).not.toBeNull();
    expect(screen.getByText('V5 열기').getAttribute('href')).toBe(V5_URL);
  });

  it('닫으면 이 기기에서는 다시 뜨지 않는다', async () => {
    const { container, unmount } = render(<MovedToV5Banner />);
    await userEvent.click(screen.getByText('닫기'));
    expect(container.querySelector('[data-moved-v5-banner]')).toBeNull();
    expect(localStorage.getItem(MOVED_BANNER_KEY)).toBe('1');
    unmount();
    const again = render(<MovedToV5Banner />);
    expect(again.container.querySelector('[data-moved-v5-banner]')).toBeNull();
  });
});
