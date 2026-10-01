/**
 * Global Toast Notification Utility for V4
 */

/** 안내 옆에 붙는 단추 (되돌리기 등). 누르면 안내를 닫고 run을 부른다. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export function showToast(message: string, duration: number = 2500, type: 'info' | 'error' = 'info', action?: ToastAction) {
  let toastContainer = document.getElementById('sp4-toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'sp4-toast-container';
    // 좁은 화면에서는 하단 탭바 위로 올린다 (bottom-24 -> sm 이상에서 bottom-8)
    toastContainer.className = 'fixed bottom-24 sm:bottom-8 left-1/2 -translate-x-1/2 z-[999999] pointer-events-none flex flex-col items-center gap-2 transition-all duration-300 px-4 max-w-full';
    document.body.appendChild(toastContainer);
  }

  const toastEl = document.createElement('div');
  const tone =
    type === 'error'
      ? 'bg-red-600/95 border-red-400/50'
      : 'bg-slate-900/90 border-slate-700/50';
  toastEl.className = `pointer-events-auto flex items-center gap-2 px-5 py-2.5 ${tone} text-white text-xs sm:text-sm font-semibold rounded-xl shadow-xl backdrop-blur-sm border transform transition-all duration-300 translate-y-2 opacity-0`;
  toastEl.setAttribute('role', 'status');

  // 여러 줄 안내도 줄을 바꿔 보이게 (innerText 대신 - 테스트 환경 jsdom은 innerText를 모른다)
  const textEl = document.createElement('span');
  textEl.className = 'whitespace-pre-line';
  textEl.textContent = message;
  toastEl.appendChild(textEl);

  toastContainer.appendChild(toastEl);

  // Trigger animation
  requestAnimationFrame(() => {
    toastEl.classList.remove('translate-y-2', 'opacity-0');
    toastEl.classList.add('translate-y-0', 'opacity-100');
  });

  let closed = false;
  const dismiss = () => {
    if (closed) return;
    closed = true;
    toastEl.classList.remove('translate-y-0', 'opacity-100');
    toastEl.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => {
      if (toastEl.parentNode) {
        toastEl.parentNode.removeChild(toastEl);
      }
    }, 300);
  };
  let timer = setTimeout(dismiss, duration);

  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.dataset.toastAction = action.label;
    btn.className =
      'shrink-0 ml-1 px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/30 text-amber-200 hover:text-white font-bold cursor-pointer transition-colors';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (closed) return;
      clearTimeout(timer);
      dismiss();
      action.run();
    });
    toastEl.appendChild(btn);
    // 단추를 누르려고 마우스를 올린 사이에 사라지지 않게, 올려 둔 동안은 기다린다
    toastEl.addEventListener('mouseenter', () => clearTimeout(timer));
    toastEl.addEventListener('mouseleave', () => {
      clearTimeout(timer);
      if (!closed) timer = setTimeout(dismiss, 2000);
    });
  }
}

/**
 * 저장 실패 등 사용자가 반드시 알아야 하는 오류를 띄운다.
 * 예전에는 쓰기 실패가 console.error로만 남아, 사용자는 그냥
 * "데이터가 없네"로 오인했다.
 */
export function showErrorToast(message: string, error?: unknown) {
  if (error) console.error(message, error);
  // 잘된 알림은 ✅로 시작하는데 실패 알림에는 아무 표시가 없어, 빛깔로만
  // 구분됐다. 색을 잘 못 가리는 경우나 눈에 안 띄는 자리에서는 실패가
  // 성공처럼 지나간다. 표시를 붙여 한눈에 갈리게 한다.
  const marked = /^[✅❌⚠️]/.test(message.trim()) ? message : `❌ ${message}`;
  showToast(marked, 4000, 'error');
}

/**
 * 이미 사용자에게 알린 실패. 부르는 쪽은 '실패했다'만 알면 되고 안내를 또 띄우지 않는다.
 *
 * ⚠️ 저장 함수(useDayData 등)가 실패를 안내만 하고 삼키면, 쓰는 칸은 성공으로 알고 '✅ 저장했습니다'를 띄우고
 *    적던 글을 저장된 것으로 여겨 ESC·배경 누르기에 묻지도 않고 닫았다. 새 일정은 없는 일정의 수정 칸이 되어
 *    적던 글이 화면에서 사라졌다. 안내한 뒤 이것을 던져 부르는 쪽이 멈추게 한다.
 */
export class ShownError extends Error {
  readonly shown = true;
  readonly original?: unknown;
  constructor(message: string, original?: unknown) {
    super(message);
    this.name = 'ShownError';
    this.original = original;
  }
}

/** 실패를 안내하고 ShownError로 던진다 */
export function failWithToast(message: string, error?: unknown): never {
  showErrorToast(message, error);
  throw new ShownError(message, error);
}

/** 아직 안내하지 않은 실패만 안내한다 (ShownError는 이미 안내했다) */
export function showErrorToastOnce(message: string, error?: unknown) {
  if (error instanceof ShownError) return;
  showErrorToast(message, error);
}

const AFTER_RELOAD_KEY = 'sp4_toast_after_reload';

/**
 * 화면을 새로 그린 다음에 알린다.
 *
 * 백업 복원은 showToast 바로 다음 줄에서 window.location.reload()를 부른다.
 * 그래서 '복원이 완료되었습니다'가 뜨자마자 새로고침에 쓸려 사라졌다.
 * 사용자 입장에서는 화면만 깜빡이고 됐는지 안 됐는지 알 수 없었다.
 * 새로고침을 건너온 뒤에 띄우도록 맡겨 둔다.
 */
export function showToastAfterReload(message: string) {
  try {
    sessionStorage.setItem(AFTER_RELOAD_KEY, message);
  } catch {
    /* 저장을 못 하면 그냥 지금 띄운다 */
    showToast(message);
  }
}

/** 앱이 처음 뜰 때 한 번 불러, 맡겨 둔 알림이 있으면 띄운다 */
export function flushPendingToast() {
  try {
    const msg = sessionStorage.getItem(AFTER_RELOAD_KEY);
    if (!msg) return;
    sessionStorage.removeItem(AFTER_RELOAD_KEY);
    showToast(msg, 4000);
  } catch {
    /* 못 읽으면 넘어간다 */
  }
}

// Window global registration for convenience
if (typeof window !== 'undefined') {
  (window as any).showToast = showToast;
}
