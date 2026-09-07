/**
 * Global Toast Notification Utility for V4
 */

export function showToast(message: string, duration: number = 2500) {
  let toastContainer = document.getElementById('sp4-toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'sp4-toast-container';
    toastContainer.className = 'fixed bottom-8 left-1/2 -translate-x-1/2 z-[999999] pointer-events-none flex flex-col items-center gap-2 transition-all duration-300';
    document.body.appendChild(toastContainer);
  }

  const toastEl = document.createElement('div');
  toastEl.className = 'pointer-events-auto flex items-center gap-2 px-5 py-2.5 bg-slate-900/90 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-xl backdrop-blur-sm border border-slate-700/50 transform transition-all duration-300 translate-y-2 opacity-0';
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

// Window global registration for convenience
if (typeof window !== 'undefined') {
  (window as any).showToast = showToast;
}
