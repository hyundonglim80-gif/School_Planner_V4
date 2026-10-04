import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrollToToday } from './todayScroll';

// 상단 날짜를 누르면 오늘 칸으로. 휴대폰 년간에서는 오늘로 가지 않았다(2026-10-04 신고) -
// 학사력의 오늘 칸에 표시가 없었고, 여섯 프레임만 찾고 맨 위로 올라갔다.

/** 프레임을 손으로 넘기는 시계 */
function fakeFrames() {
  let t = 0;
  const queue: Array<() => void> = [];
  return {
    now: () => t,
    nextFrame: (cb: () => void) => queue.push(cb),
    /** 한 프레임(16ms) 넘긴다 */
    tick(ms = 16) {
      t += ms;
      const run = queue.splice(0);
      run.forEach((cb) => cb());
    },
    pending: () => queue.length,
  };
}

const visible = () => true;
let scrollTo: ReturnType<typeof vi.fn>;
let intoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = '';
  scrollTo = vi.fn();
  intoView = vi.fn();
  window.scrollTo = scrollTo as any;
  Element.prototype.scrollIntoView = intoView as any;
});

const add = (html: string) => {
  const box = document.createElement('div');
  box.innerHTML = html;
  document.body.appendChild(box);
  return box;
};

describe('상단 날짜 → 오늘로', () => {
  it('오늘 칸이 있으면 그 칸을 가운데로', () => {
    add('<div data-today-area="true"><div id="t" data-today="true"></div></div>');
    const f = fakeFrames();
    scrollToToday('year', { isVisible: visible, now: f.now, nextFrame: f.nextFrame });
    expect(intoView).toHaveBeenCalledTimes(1);
    expect(intoView.mock.contexts[0]).toBe(document.getElementById('t'));
    expect(intoView.mock.calls[0][0]).toMatchObject({ block: 'center' });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('새 화면이 늦게 그려져도(년간은 달을 몇 프레임에 나눠 그린다) 기다렸다가 찾는다', () => {
    const f = fakeFrames();
    scrollToToday('year', { isVisible: visible, now: f.now, nextFrame: f.nextFrame });
    for (let i = 0; i < 20; i++) f.tick(); // 예전에는 여섯 프레임 뒤 맨 위로 갔다
    expect(scrollTo).not.toHaveBeenCalled();
    add('<div data-today-area="true"><div data-today="true"></div></div>');
    f.tick();
    expect(intoView).toHaveBeenCalledTimes(1);
    // 자리가 그대로면 잠시 지켜본 뒤 끝난다
    for (let i = 0; i < 60 && f.pending(); i++) f.tick();
    expect(f.pending()).toBe(0);
    expect(intoView).toHaveBeenCalledTimes(1);
  });

  it('옮긴 뒤 늦게 들어온 자료에 오늘 칸이 밀리면 다시 맞춘다 (다른 학년도에서 돌아올 때)', () => {
    add('<div id="t" data-today="true"></div>');
    const el = document.getElementById('t')!;
    let top = 300;
    el.getBoundingClientRect = () => ({ top } as DOMRect);
    const f = fakeFrames();
    scrollToToday('year', { isVisible: visible, now: f.now, nextFrame: f.nextFrame });
    expect(intoView).toHaveBeenCalledTimes(1);
    f.tick();
    top = 900; // 위쪽 달 아래 목록이 늦게 그려져 밀림
    f.tick();
    expect(intoView).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 60 && f.pending(); i++) f.tick();
    expect(intoView).toHaveBeenCalledTimes(2);
  });

  it('지켜보는 동안 사용자가 스스로 스크롤하면 그만둔다', () => {
    add('<div id="t" data-today="true"></div>');
    const el = document.getElementById('t')!;
    let top = 300;
    el.getBoundingClientRect = () => ({ top } as DOMRect);
    const f = fakeFrames();
    scrollToToday('year', { isVisible: visible, now: f.now, nextFrame: f.nextFrame });
    window.dispatchEvent(new Event('wheel'));
    top = 900;
    f.tick();
    expect(intoView).toHaveBeenCalledTimes(1);
    expect(f.pending()).toBe(0);
  });

  it('오늘이 든 구역은 있는데 오늘 칸이 없으면(년간 자세히의 일정 없는 날·접은 달, 감춘 주말) 그 구역으로', () => {
    const area = add('<div data-today-area="true"><div data-date="2026-10-02"></div></div>');
    (area.firstElementChild as HTMLElement).getBoundingClientRect = () => ({ top: 600 } as DOMRect);
    const f = fakeFrames();
    scrollToToday('year', { isVisible: visible, now: f.now, nextFrame: f.nextFrame });
    expect(intoView).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ behavior: 'smooth' });
  });

  it('끝내 못 찾으면(다른 학기만 보이게 거른 년간 등) 맨 위로', () => {
    const f = fakeFrames();
    scrollToToday('month', { isVisible: visible, now: f.now, nextFrame: f.nextFrame, timeoutMs: 500 });
    for (let i = 0; i < 40 && f.pending(); i++) f.tick();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(f.pending()).toBe(0);
  });

  it('보이지 않는 칸(접힌 곳)은 건너뛴다', () => {
    add('<div data-today="true" class="hidden-one"></div><div id="shown" data-today="true"></div>');
    const f = fakeFrames();
    scrollToToday('week', {
      isVisible: (el) => !el.classList.contains('hidden-one'),
      now: f.now,
      nextFrame: f.nextFrame,
    });
    expect(intoView.mock.contexts[0]).toBe(document.getElementById('shown'));
  });

  it('하루 화면은 화면 전체가 오늘이라 곧바로 맨 위', () => {
    add('<div data-today="true"></div>');
    scrollToToday('day');
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(intoView).not.toHaveBeenCalled();
  });

  it('그만두면 더 찾지 않는다 (잇달아 누를 때)', () => {
    const f = fakeFrames();
    const stop = scrollToToday('year', { isVisible: visible, now: f.now, nextFrame: f.nextFrame });
    stop();
    add('<div data-today="true"></div>');
    f.tick();
    expect(intoView).not.toHaveBeenCalled();
  });
});
