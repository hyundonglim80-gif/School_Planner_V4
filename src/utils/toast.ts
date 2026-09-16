/**
 * Global Toast Notification Utility for V4
 */

export function showToast(message: string, duration: number = 2500, type: 'info' | 'error' = 'info') {
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
  toastEl.innerText = message;

  toastContainer.appendChild(toastEl);

  // Trigger animation
  requestAnimationFrame(() => {
    toastEl.classList.remove('translate-y-2', 'opacity-0');
    toastEl.classList.add('translate-y-0', 'opacity-100');
  });

  setTimeout(() => {
    toastEl.classList.remove('translate-y-0', 'opacity-100');
    toastEl.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => {
      if (toastEl.parentNode) {
        toastEl.parentNode.removeChild(toastEl);
      }
    }, 300);
  }, duration);
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
