// src/lib/sound.ts
//
// 앱이 내는 소리(수업 종·일정 알림)가 함께 쓰는 소리 장치. 소리는 Web Audio로 만든다(파일 없이).
// 브라우저는 사용자가 이 페이지를 한 번 누르거나 키를 치기 전에는 소리를 막는다 - wakeAudioOnGesture로
// 처음 누를 때 깨워 둔다. 한 번도 누르지 않은 탭에서는 소리가 나지 않을 수 있다(화면 알림은 뜬다).

let audio: AudioContext | null = null;

export function audioContext(): AudioContext | null {
  try {
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    if (!audio) audio = new Ctor();
    return audio;
  } catch {
    return null;
  }
}

/** 처음 누르거나 키를 칠 때 소리 장치를 깨운다. 돌려준 함수로 듣기를 그만둔다 */
export function wakeAudioOnGesture(): () => void {
  const wake = () => void audioContext()?.resume?.();
  window.addEventListener('pointerdown', wake, { once: true });
  window.addEventListener('keydown', wake, { once: true });
  return () => {
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
  };
}

/** 음 하나 (at: ctx 시각, len: 초) */
function tone(ctx: AudioContext, freq: number, at: number, len: number, peak: number, type: OscillatorType = 'sine') {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + len + 0.05);
}

/** 학교 종처럼 네 음 두 번 (딩동댕동). 몇 번 울렸는지는 점검이 window.__spBellCount로 본다 */
export function playBell() {
  (window as any).__spBellCount = ((window as any).__spBellCount || 0) + 1;
  const ctx = audioContext();
  if (!ctx) return;
  void ctx.resume?.();
  const notes = [659.25, 523.25, 587.33, 392.0, 392.0, 587.33, 659.25, 523.25]; // 미 도 레 솔 / 솔 레 미 도
  const t0 = ctx.currentTime + 0.05;
  notes.forEach((f, i) => tone(ctx, f, t0 + i * 0.55 + (i >= 4 ? 0.4 : 0), 1.1, 0.35));
}

/** 일정 알림 한 번 (삐삐삐 - 삐삐삐). 몇 번 울렸는지는 점검이 window.__spAlarmSoundCount로 본다 */
export function playAlarmChime() {
  (window as any).__spAlarmSoundCount = ((window as any).__spAlarmSoundCount || 0) + 1;
  const ctx = audioContext();
  if (!ctx) return;
  void ctx.resume?.();
  const t0 = ctx.currentTime + 0.05;
  [0, 0.18, 0.36, 0.8, 0.98, 1.16].forEach((dt) => tone(ctx, 1046.5, t0 + dt, 0.14, 0.3, 'square'));
}
