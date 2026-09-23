import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import ModalShell from '../components/ModalShell';

// 휴대폰에서 팝업을 열어 두고 뒤로가기를 누르면 앱이 통째로 닫혔다.
// 이 앱은 주소가 하나뿐이라, 팝업을 열어도 브라우저가 기억하는 자리는 그대로다.
// 그래서 뒤로가기가 곧 '앱에서 나가기'였다.
//
// jsdom은 history.pushState/back과 popstate를 실제로 흉내 낸다. 다만 back()이
// 비동기라 popstate가 바로 오지 않으므로, 여기서는 popstate를 직접 쏘아 확인한다.
const back = () => act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });

function Host() {
  const [open, setOpen] = useState(true);
  return open ? <Popup title="첫 팝업" onClose={() => setOpen(false)} /> : <p>닫힘</p>;
}

function Popup({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <ModalShell isOpen onClose={onClose} title={title}>
      <p>{title} 내용</p>
    </ModalShell>
  );
}

// 앞 검사에서 부른 history.back()의 popstate가 뒤늦게 와서 다음 검사의
// 뒤로가기를 삼키지 않도록, 검사마다 한 박자 흘려보낸다.
beforeEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('뒤로가기로 팝업 닫기', () => {
  it('팝업을 열면 브라우저 기록에 자리를 하나 만든다', () => {
    render(<Popup title="첫 팝업" onClose={vi.fn()} />);

    expect((history.state as any)?.sp4Modal).toBe(true);
  });

  it('팝업을 겹쳐 열어도 자리는 하나만 만든다', () => {
    // 팝업마다 하나씩 쌓으면 되돌릴 자리 수를 세어 맞춰야 하고,
    // 한 번 어긋나면 그 뒤의 진짜 뒤로가기를 통째로 삼킨다.
    render(<Popup title="첫 팝업" onClose={vi.fn()} />);
    const after1 = history.length;
    render(<Popup title="둘째 팝업" onClose={vi.fn()} />);

    expect(history.length).toBe(after1);
  });

  it('뒤로가기는 맨 위 팝업만 닫는다', () => {
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    render(
      <>
        <Popup title="첫 팝업" onClose={closeFirst} />
        <Popup title="둘째 팝업" onClose={closeSecond} />
      </>
    );

    back();

    // 나중에 연 것만 닫힌다. 아래 팝업은 그대로 남아 보인다.
    expect(closeSecond).toHaveBeenCalledTimes(1);
    expect(closeFirst).not.toHaveBeenCalled();
    expect(screen.getByText('첫 팝업 내용')).toBeInTheDocument();
  });

  it('팝업이 없을 때의 뒤로가기는 건드리지 않는다', () => {
    // 팝업을 열지 않았으면 뒤로가기는 앱에서 나가는 것이 맞다.
    // 여기서 아무 일도 일어나지 않는 것이 곧 '막지 않는다'는 뜻이다.
    const onClose = vi.fn();
    const { unmount } = render(<Popup title="첫 팝업" onClose={onClose} />);
    unmount();

    back();

    expect(onClose).not.toHaveBeenCalled();
  });

  it('닫기 단추로 닫으면 만들어 둔 자리도 치운다', async () => {
    // 안 치우면 열었다 닫기만 되풀이해도 기록이 쌓여, 나중에 뒤로가기를
    // 그만큼 눌러야 앱에서 나갈 수 있다.
    const user = userEvent.setup();
    const backSpy = vi.spyOn(history, 'back');

    render(<Host />);

    await user.click(screen.getByTitle('닫기'));

    expect(await screen.findByText('닫힘')).toBeInTheDocument();
    expect(backSpy).toHaveBeenCalledTimes(1);
  });
});
