// src/lib/todayScroll.ts
//
// 상단 2행의 가운데 날짜(또는 '오늘 날짜로' 단축키)를 누르면 오늘로 돌아오고, 오늘 칸이 보이게 화면을 옮긴다.
//
// 찾는 차례
//   1. 오늘 칸            [data-today="true"]       주간 요일 카드, 월간 날짜 칸, 년간 학사력·자세히의 오늘
//   2. 오늘이 든 구역     [data-today-area="true"]  오늘 칸이 없을 때 - 주간의 이번 주, 월간의 이번 주 줄, 년간의 이번 달.
//                                                   (년간 자세히는 일정·수업이 있는 날만 그리고 휴대폰에서 접은 달은 날을 그리지 않는다.
//                                                   주말을 감추면 토·일 칸도 없다)
//   3. 맨 위
// 하루 화면은 화면 전체가 오늘이라 곧바로 맨 위로 간다.
//
// ⚠️ 날짜를 바꾼 직후에는 새 화면(다른 달·학년도)이 아직 없고, 년간은 달을 몇 프레임에 나눠 그린다.
//    예전에는 여섯 프레임(약 0.1초)만 찾고 맨 위로 올라가서, 휴대폰 년간에서는 오늘로 가지 않았다
//    (게다가 학사력은 오늘 칸에 표시가 없었다, 2026-10-04 사용자 신고). 그래서 잠시(기본 2.5초) 기다리며 찾는다.
// ⚠️ 찾아서 옮긴 뒤에도 자료가 늦게 들어오면(다른 학년도에서 돌아올 때 - 달 아래 목록·'불러오는 중') 위쪽 칸의 높이가 바뀌어
//    오늘 칸이 밀려났다. 그래서 오늘 칸의 자리가 잠시(settleMs) 그대로일 때까지 지켜보며, 밀리면 다시 맞춘다.
//    그동안 사용자가 스스로 스크롤하면(휠·터치·키) 곧바로 그만둔다.

export type TodayScrollScope = 'day' | 'week' | 'month' | 'year' | 'memo' | 'class';

export interface TodayScrollOptions {
  /** 이만큼 기다려도 못 찾으면 맨 위로 (ms) */
  timeoutMs?: number;
  /** 찾은 칸이 이만큼 제자리에 있으면 끝 (ms) */
  settleMs?: number;
  /** 아무리 길어도 이만큼 지나면 끝 (ms) */
  maxMs?: number;
  /** 보이는 칸인가 (시험에서 바꾼다 - jsdom은 크기가 늘 0이다) */
  isVisible?: (el: HTMLElement) => boolean;
  /** 지금 시각 (시험에서 바꾼다) */
  now?: () => number;
  /** 다음 프레임에 (시험에서 바꾼다) */
  nextFrame?: (cb: () => void) => void;
}

const defaultVisible = (el: HTMLElement) => el.getClientRects().length > 0;

/** 문서 맨 위에서 그 칸의 위까지 (스크롤해도 바뀌지 않는다 - 자리가 밀렸는지 견줄 때 쓴다) */
const docTopOf = (el: HTMLElement) => el.getBoundingClientRect().top + window.scrollY;

/** 오늘 칸은 가운데로, 오늘이 든 구역은 붙어 있는 머리줄 바로 아래로 */
function scrollTo(el: HTMLElement, kind: 'day' | 'area') {
  if (kind === 'day') {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const header = document.querySelector('header');
  const gap = (header?.getBoundingClientRect().height || 0) + 8;
  window.scrollTo({ top: Math.max(0, docTopOf(el) - gap), behavior: 'smooth' });
}

/**
 * 오늘 칸으로 화면을 옮긴다. 찾아서 자리가 굳으면(또는 맨 위로 가면) 끝난다.
 * 돌려주는 함수를 부르면 그만둔다 (잇달아 누를 때).
 */
export function scrollToToday(scope: TodayScrollScope, opts: TodayScrollOptions = {}): () => void {
  const {
    timeoutMs = 2500,
    settleMs = 700,
    maxMs = 5000,
    isVisible = defaultVisible,
    now = () => Date.now(),
    nextFrame = (cb) => requestAnimationFrame(cb),
  } = opts;

  if (scope === 'day' || scope === 'memo' || scope === 'class') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return () => {};
  }

  let stopped = false;
  const start = now();
  const find = (selector: string) =>
    [...document.querySelectorAll<HTMLElement>(selector)].find((el) => isVisible(el)) || null;

  // 사용자가 스스로 움직이면 그만둔다 (지켜보는 동안 맞서지 않게)
  const userEvents = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    userEvents.forEach((type) => window.removeEventListener(type, stop));
  };
  userEvents.forEach((type) => window.addEventListener(type, stop, { passive: true }));

  let target: HTMLElement | null = null;
  let targetTop = 0;
  let stableSince = 0;

  const step = () => {
    if (stopped) return;
    const t = now();
    const day = find('[data-today="true"]');
    const area = day ? null : find('[data-today-area="true"]');
    const el = day || area;

    if (!el) {
      // 아직 그려지지 않았다. 끝내 못 찾으면(다른 학기만 보이게 거른 년간 등) 맨 위로
      if (!target && t - start >= timeoutMs) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        stop();
        return;
      }
      if (t - start >= maxMs) return stop();
      nextFrame(step);
      return;
    }

    const top = docTopOf(el);
    if (el !== target || Math.abs(top - targetTop) > 24) {
      // 처음 찾았거나, 오늘 칸이 새로 생겼거나(구역 → 칸), 늦게 들어온 자료에 밀렸다 - 다시 맞춘다
      scrollTo(el, day ? 'day' : 'area');
      target = el;
      targetTop = top;
      stableSince = t;
    }
    if (t - stableSince >= settleMs || t - start >= maxMs) return stop();
    nextFrame(step);
  };
  step();
  return stop;
}
