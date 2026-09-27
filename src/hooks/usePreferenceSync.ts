import { useEffect } from 'react';
import { doc, getDocFromServer, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { applyFontScale } from '../lib/fontScale';
import {
  LEGACY_PREFERENCE_DOC_ID,
  detectDeviceKind,
  preferenceDocId,
  pickPreferences,
  preferencesKey,
  sanitizePreferences,
} from '../lib/preferenceSync';

// 바꾸는 대로 곧장 적으면 숫자 칸에 글자를 칠 때마다 한 번씩 쓰게 된다.
const WRITE_DELAY_MS = 1000;

/**
 * 환경설정을 계정(Firestore)과 맞춘다. 로그인한 동안 한 번만 걸어 둔다.
 *
 * - PC와 모바일은 따로 저장한다(lib/preferenceSync.ts). PC끼리, 모바일끼리 같은 값을 쓴다.
 * - 로그인하면 클라우드 값을 받아 이 기기에 입힌다.
 * - 클라우드에 아직 없으면 예전 공용 문서를 옮겨 오고, 그것도 없으면 이 기기 값을 올려 둔다.
 * - 이 기기에서 바꾸면 클라우드에 적고, 같은 종류의 다른 기기에서 바꾸면 곧바로 따라간다.
 *
 * ⚠️ 클라우드 값을 한 번 받아 보기 전에는 절대 올리지 않는다. 새 기기는 기본값으로
 *    시작하므로, 먼저 올리면 계정에 저장된 설정을 기본값으로 덮어쓴다.
 */
export function usePreferenceSync(uid: string | null | undefined) {
  useEffect(() => {
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'settings', preferenceDocId(detectDeviceKind()));
    const legacyRef = doc(db, 'users', uid, 'settings', LEGACY_PREFERENCE_DOC_ID);

    let cancelled = false;
    let ready = false;
    // 클라우드와 이 기기가 마지막으로 맞춰진 값. 같으면 다시 적지 않는다.
    let lastKey = '';
    let timer: ReturnType<typeof setTimeout> | null = null;

    const write = () => {
      timer = null;
      const prefs = pickPreferences(useAppStore.getState());
      lastKey = preferencesKey(prefs);
      // merge를 쓰지 않는다. 단축키를 기본값으로 되돌려 항목이 빠졌을 때
      // merge면 클라우드에 옛 단축키가 그대로 남는다.
      setDoc(ref, { ...prefs, updatedAt: Date.now() }).catch((e) => {
        console.warn('환경설정을 계정에 저장하지 못했습니다:', e);
      });
    };

    const applyRemote = (data: unknown) => {
      const remote = sanitizePreferences(data);
      const before = useAppStore.getState();
      // 스토어 구독보다 먼저 맞춰 둬야, 받은 값을 다시 올려 보내지 않는다.
      lastKey = preferencesKey({ ...pickPreferences(before), ...remote });
      useAppStore.setState(remote);
      if (remote.fontScale && remote.fontScale !== before.fontScale) {
        applyFontScale(remote.fontScale);
      }
      ready = true;
    };

    const unsubStore = useAppStore.subscribe((state) => {
      if (!ready) return;
      if (preferencesKey(pickPreferences(state)) === lastKey) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(write, WRITE_DELAY_MS);
    });

    // 처음 한 번은 서버에 직접 묻는다. 캐시의 '없음'은 거짓일 수 있어서,
    // 그 말을 믿고 올리면 계정 설정을 이 기기 값으로 덮어쓰게 된다.
    getDocFromServer(ref)
      .then(async (snap) => {
        if (cancelled) return;
        if (snap.exists()) {
          applyRemote(snap.data());
          return;
        }
        // 기기별로 나누기 전에 저장해 둔 값이 있으면 그것에서 시작한다.
        // 옛 문서는 지우지 않는다. PC와 모바일이 각자 처음 열 때 한 번씩 가져간다.
        const legacy = await getDocFromServer(legacyRef).catch(() => null);
        if (cancelled) return;
        if (legacy?.exists()) applyRemote(legacy.data());
        ready = true;
        write();
      })
      .catch(() => {
        /* 오프라인이면 아래 구독이 캐시나 나중에 오는 값으로 맞춘다 */
      });

    const unsubDoc = onSnapshot(
      ref,
      (snap) => {
        // 내가 방금 적은 값의 메아리는 건너뛴다
        if (cancelled || snap.metadata.hasPendingWrites || !snap.exists()) return;
        applyRemote(snap.data());
      },
      (e) => console.warn('환경설정 구독 실패:', e)
    );

    return () => {
      cancelled = true;
      unsubStore();
      unsubDoc();
      // 적기를 기다리던 값은 버리지 않고 바로 적는다
      if (timer) {
        clearTimeout(timer);
        write();
      }
    };
  }, [uid]);
}
