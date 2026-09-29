// src/lib/trashRetention.ts
//
// 휴지통 자동 비우기. 환경설정에서 기간(끄기 / 7·14·30·60·90일)을 고르면, 그보다 먼저
// 지운 항목을 영구 삭제한다.
//
// 기간은 계정에 하나만 둔다 (users/{uid}/settings/v4_trash). 다른 환경설정은 PC와 휴대폰을
// 따로 두지만(lib/preferenceSync), 휴지통은 계정에 하나뿐이라 기기마다 기간이 다르면
// 짧은 쪽 기기가 먼저 지워 버려 헷갈린다.
//
// 언제 비우나: 로그인해서 앱을 열 때(하루 한 번)와 휴지통을 열 때. 서버가 따로 돌지 않는
// 앱이라 '앱을 쓸 때' 비운다. 앱을 오래 안 열면 그동안은 지워지지 않고 남아 있다.
//
// 기본은 '끄기'다. 예전에는 휴지통을 비우지 않았으므로, 고르기 전에는 아무것도 지우지 않는다.
// V3는 휴지통을 스스로 비우지 않는다. V3에서 지운 항목도 같은 휴지통이라 함께 비워진다.
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { collectUploadUrls, deleteUnreferencedUploads } from '../utils/storageCleanup';
import { purgeClipTrash } from './clipboardHistory';

/** 고를 수 있는 기간(일). 0은 끄기. */
export const TRASH_RETENTION_OPTIONS = [0, 7, 14, 30, 60, 90] as const;
export type TrashRetentionDays = (typeof TRASH_RETENTION_OPTIONS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_RUN_KEY = 'sp4-trash-purge-last-run';

const settingsRef = (uid: string) => doc(db, 'users', uid, 'settings', 'v4_trash');

export function sanitizeRetention(v: unknown): TrashRetentionDays {
  const n = Number(v);
  return (TRASH_RETENTION_OPTIONS as readonly number[]).includes(n) ? (n as TrashRetentionDays) : 0;
}

export async function loadTrashRetention(uid: string): Promise<TrashRetentionDays> {
  try {
    const snap = await getDoc(settingsRef(uid));
    return sanitizeRetention(snap.exists() ? snap.data()?.retentionDays : 0);
  } catch {
    return 0;
  }
}

export async function saveTrashRetention(uid: string, days: TrashRetentionDays): Promise<void> {
  await setDoc(settingsRef(uid), { retentionDays: days, updatedAt: Date.now() }, { merge: true });
}

/**
 * days일보다 먼저 지운 항목을 영구 삭제한다 (계정 휴지통 + 이 기기의 클립보드 휴지통).
 * 지운 개수를 돌려준다. days가 0(끄기)이면 아무것도 하지 않는다.
 */
export async function purgeExpiredTrash(uid: string, days: number, now = Date.now()): Promise<number> {
  if (!days || days <= 0) return 0;
  const cutoff = now - days * DAY_MS;

  let removed = 0;
  const uploadUrls: string[] = [];
  const snap = await getDocs(query(collection(db, 'users', uid, 'trash'), where('deletedAt', '<', cutoff)));
  for (const d of snap.docs) {
    uploadUrls.push(...collectUploadUrls(d.data()?.data));
    try {
      await deleteDoc(d.ref);
      removed++;
    } catch (err) {
      console.warn('휴지통 자동 비우기 실패:', d.id, err);
    }
  }
  // 살아 있는 곳에서 더 이상 쓰지 않는 첨부 파일만 정리한다 (영구 삭제와 같은 규칙)
  if (uploadUrls.length > 0) deleteUnreferencedUploads(uploadUrls, uid).catch(console.warn);

  removed += await purgeClipTrash(cutoff);
  return removed;
}

/** 앱을 열 때 하루 한 번만 돈다 (이 기기 기준) */
export async function purgeExpiredTrashDaily(uid: string): Promise<void> {
  try {
    const last = Number(localStorage.getItem(LAST_RUN_KEY) || 0);
    if (Date.now() - last < DAY_MS) return;
    localStorage.setItem(LAST_RUN_KEY, String(Date.now()));
  } catch {
    /* 기억 못 하면 매번 돈다 - 지울 것이 없으면 조회 한 번뿐이다 */
  }
  const days = await loadTrashRetention(uid);
  if (days > 0) await purgeExpiredTrash(uid, days).catch((err) => console.warn('휴지통 자동 비우기:', err));
}
