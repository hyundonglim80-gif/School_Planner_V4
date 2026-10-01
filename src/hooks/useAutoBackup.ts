// src/hooks/useAutoBackup.ts
//
// 드라이브 자동 백업을 돌린다 (lib/autoBackup, docs/ROADMAP.md 3-3).
//
// - PC에서만. 휴대폰은 데이터·배터리를 쓰고, 백업은 PC 한 곳에서 되면 충분하다.
// - 할 때가 됐고 구글 권한(토큰)이 **이미** 있으면 조용히 백업한다. 권한 창은 띄우지 않는다.
//   토큰은 로그인 때 받아 그 탭이 살아 있는 동안만 남으므로, 앱을 연 채 30분마다 다시 본다.
// - 정한 날보다 3일 넘게 밀리면 nag - 화면 위 띠(AutoBackupBanner)가 '지금 백업'을 권한다. '나중에'는 하루 미룬다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '../lib/firebase';
import { subscribeDocWithServerFallback } from '../lib/firestoreSubscribe';
import { detectDeviceKind } from '../lib/preferenceSync';
import { getGoogleTokenQuietly, getValidGoogleToken } from '../lib/googleApi';
import {
  autoBackupRef,
  DEFAULT_AUTO_BACKUP,
  isBackupDue,
  overdueDays,
  runDriveBackup,
  sanitizeAutoBackup,
  shouldNag,
  type AutoBackupSettings,
} from '../lib/autoBackup';
import { showToast, showErrorToast } from '../utils/toast';

const RECHECK_MS = 30 * 60 * 1000;
const SNOOZE_KEY = 'sp4_autoBackupSnoozeUntil';

/** 설정과 마지막 백업 (계정에 하나) */
export function useAutoBackupSettings(): { settings: AutoBackupSettings; loaded: boolean } {
  const [state, setState] = useState<{ settings: AutoBackupSettings; loaded: boolean }>({
    settings: DEFAULT_AUTO_BACKUP,
    loaded: false,
  });
  const uid = auth.currentUser?.uid;
  useEffect(() => {
    if (!uid) return;
    return subscribeDocWithServerFallback(
      autoBackupRef(uid),
      (data) => setState({ settings: sanitizeAutoBackup(data), loaded: true }),
      (err) => console.warn('자동 백업 설정을 불러오지 못했습니다:', err)
    );
  }, [uid]);
  return state;
}

/** 한 번에 하나만 (자동과 '지금 백업'이 겹치지 않게, 탭 안에서) */
let inFlight: Promise<unknown> | null = null;

/** '지금 백업' - 사용자가 눌렀을 때. 권한 창을 띄워도 된다. keep: 남길 개수(설정 값). 성공하면 true */
export async function backupNow(keep: number = DEFAULT_AUTO_BACKUP.keep): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  if (inFlight) {
    showToast('백업이 이미 진행 중입니다.');
    return false;
  }
  try {
    const token = await getValidGoogleToken();
    if (!token) throw new Error('구글 권한을 받지 못했습니다.');
    showToast('💾 드라이브에 백업하는 중...', 4000);
    const job = runDriveBackup({ uid, token, keep });
    inFlight = job;
    const r = await job;
    showToast(`✅ 드라이브에 백업했습니다: ${r.name}${r.summary ? ` (${r.summary})` : ''}`, 5000);
    return true;
  } catch (e) {
    showErrorToast('드라이브에 백업하지 못했습니다.', e);
    return false;
  } finally {
    inFlight = null;
  }
}

function snoozedNow(): boolean {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

/**
 * Layout이 한 번 부른다. 띠를 띄울지(nag)와 '나중에'(snooze)를 준다.
 */
export function useAutoBackupRunner() {
  const { settings, loaded } = useAutoBackupSettings();
  const isPc = detectDeviceKind() === 'pc';
  const [snoozed, setSnoozed] = useState(snoozedNow);
  const [tick, setTick] = useState(0);
  const failedAt = useRef(0);

  // 앱을 연 채로 두면 30분마다 다시 본다 (그 사이 토큰이 생겼을 수 있다)
  useEffect(() => {
    if (!isPc) return;
    const id = window.setInterval(() => setTick((t) => t + 1), RECHECK_MS);
    return () => window.clearInterval(id);
  }, [isPc]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!isPc || !loaded || !uid || inFlight) return;
    if (!isBackupDue(settings, Date.now())) return;
    // 방금 실패했으면 다음 판까지 기다린다 (실패를 되풀이하며 드라이브를 두드리지 않게)
    if (Date.now() - failedAt.current < RECHECK_MS) return;
    let cancelled = false;
    (async () => {
      const token = await getGoogleTokenQuietly();
      if (!token || cancelled || inFlight) return;
      const job = runDriveBackup({ uid, token, keep: settings.keep });
      inFlight = job;
      try {
        const r = await job;
        showToast(`💾 드라이브에 자동 백업했습니다${r.summary ? ` (${r.summary})` : ''}`, 4000);
      } catch (e) {
        failedAt.current = Date.now();
        console.warn('자동 백업에 실패했습니다:', e);
      } finally {
        inFlight = null;
      }
    })();
    return () => {
      cancelled = true;
    };
    // tick: 30분마다 다시 본다
  }, [isPc, loaded, settings, tick]);

  const snooze = useCallback(() => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
    } catch {
      /* 시크릿 모드 등 - 이번 화면에서만 */
    }
    setSnoozed(true);
  }, []);

  const now = Date.now();
  return {
    settings,
    nag: isPc && loaded && !snoozed && shouldNag(settings, now),
    overdue: overdueDays(settings, now),
    snooze,
  };
}
