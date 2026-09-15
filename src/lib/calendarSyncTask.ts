// src/lib/calendarSyncTask.ts
//
// 캘린더 동기화를 창 밖에서 돌린다.
//
// 예전에는 동기화가 CalendarSyncModal 안에서 시작됐다. 창을 닫아도 약속(Promise)은
// 계속 돌긴 했지만, 진행 상황이 창에만 있어서 닫는 순간 아무것도 알 수 없었고
// 창이 사라진 컴포넌트에 setState를 부르고 있었다. 창을 두 번 열어 두 번 누르면
// 같은 동기화가 두 번 돌 수도 있었다.
//
// 진행 상황을 여기 두고 창은 구경만 한다. 끝나면 창이 열려 있든 아니든 알린다.
import { showToast, showErrorToast } from '../utils/toast';
import { exportCalendarData, type ExportArgs, type SyncKind } from './calendarSync';

export interface SyncProgress {
  running: boolean;
  message: string;
  percent: number;
  /** 마지막으로 끝난 동기화의 결과 요약. 창을 다시 열었을 때 보여준다. */
  lastResult: string;
}

const IDLE: SyncProgress = { running: false, message: '', percent: 0, lastResult: '' };

let state: SyncProgress = IDLE;
const listeners = new Set<() => void>();

function setState(next: Partial<SyncProgress>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

export function subscribeSyncProgress(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getSyncProgress(): SyncProgress {
  return state;
}

const KIND_NAME: Record<SyncKind, string> = { event: '일정', class: '수업', journal: '기록' };

/**
 * 동기화를 시작한다. 이미 돌고 있으면 아무것도 하지 않는다.
 * 창을 닫아도 끝까지 돌고, 끝나면 토스트로 알린다.
 */
export async function startCalendarSync(args: Omit<ExportArgs, 'onProgress'>): Promise<void> {
  if (state.running) {
    showToast('이미 동기화가 돌고 있습니다. 끝나면 알려드립니다.');
    return;
  }

  setState({ running: true, message: '준비 중...', percent: 0, lastResult: '' });

  try {
    const result = await exportCalendarData({
      ...args,
      onProgress: (message, percent) => setState({ message, percent: Math.round(percent) }),
    });

    const summary = (Object.keys(KIND_NAME) as SyncKind[])
      .filter((k) => args.include[k])
      .map((k) => `${KIND_NAME[k]} ${result.counts[k]}건`)
      .join(', ');

    setState({ running: false, message: '', percent: 0, lastResult: summary });
    showToast(`✅ 구글 캘린더 동기화를 마쳤습니다. (${summary})`);
  } catch (e: any) {
    console.error(e);
    const message = String(e?.message || e);
    setState({ running: false, message: '', percent: 0, lastResult: '' });
    showErrorToast(
      message.includes('401') || message.includes('403')
        ? '구글 캘린더 권한이 없습니다. 로그아웃 후 다시 로그인할 때 캘린더 접근을 허용해 주세요.'
        : `동기화에 실패했습니다: ${message}`
    );
  }
}

/** 테스트용 */
export function resetSyncProgress() {
  state = IDLE;
  listeners.clear();
}
