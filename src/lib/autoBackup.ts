// src/lib/autoBackup.ts
//
// 드라이브 자동 백업 (docs/ROADMAP.md 3번).
//
// - PC에서 앱을 열었을 때, 마지막 백업이 정한 날 수(기본 7일)를 넘었고 구글 권한(토큰)이 이미 있으면
//   개인 공간 전체를 JSON으로 만들어(lib/backupJson) 드라이브 School_Planner/백업 폴더에 **공개하지 않고** 올린다.
//   최근 N개(기본 8개)만 남기고 오래된 것은 드라이브 휴지통으로.
// - 권한이 없을 때 창을 띄우지 않는다(사용자가 시키지 않은 일로 로그인 창이 뜨면 안 된다 - lib/googleApi).
//   대신 오래 밀리면 화면 위에 '지금 백업' 띠를 띄워 한 번 누르게 한다(AutoBackupBanner).
// - 설정·마지막 백업: users/{uid}/settings/v4_autoBackup (V4 전용, 계정에 하나).
import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { buildBackupPayload, describeBackup } from './backupJson';
import { formatDate } from './dateUtils';
import {
  BACKUP_FILE_PREFIX,
  getOrCreateBackupFolder,
  listBackupFiles,
  trashDriveFile,
  uploadPrivateJson,
} from './driveApi';

export interface AutoBackupSettings {
  enabled: boolean;
  /** 며칠마다 */
  intervalDays: number;
  /** 몇 개까지 남기나 */
  keep: number;
  /** 마지막으로 백업한 때 (ms) */
  lastAt?: number;
  lastName?: string;
  /** 무엇이 몇 건 들었나 (안내용) */
  lastSummary?: string;
  /** 백업 폴더 주소 (드라이브에서 열기) */
  folderLink?: string;
}

export const DEFAULT_AUTO_BACKUP: AutoBackupSettings = { enabled: true, intervalDays: 7, keep: 8 };
export const INTERVAL_CHOICES = [7, 14, 30] as const;
export const KEEP_CHOICES = [4, 8, 12] as const;
/** 할 때가 지나고도 이만큼 더 밀리면 화면 위에 '지금 백업' 띠를 띄운다 */
export const NAG_AFTER_DAYS = 3;

const DAY = 86_400_000;

export const autoBackupRef = (uid: string) => doc(db, 'users', uid, 'settings', 'v4_autoBackup');

/** 저장된 모양을 믿지 않고 고쳐 읽는다 */
export function sanitizeAutoBackup(raw: any): AutoBackupSettings {
  const pick = <T extends number>(v: unknown, choices: readonly T[], dflt: T): T =>
    choices.includes(Number(v) as T) ? (Number(v) as T) : dflt;
  return {
    enabled: raw?.enabled !== false,
    intervalDays: pick(raw?.intervalDays, INTERVAL_CHOICES, 7),
    keep: pick(raw?.keep, KEEP_CHOICES, 8),
    ...(typeof raw?.lastAt === 'number' ? { lastAt: raw.lastAt } : {}),
    ...(raw?.lastName ? { lastName: String(raw.lastName) } : {}),
    ...(raw?.lastSummary ? { lastSummary: String(raw.lastSummary) } : {}),
    ...(raw?.folderLink ? { folderLink: String(raw.folderLink) } : {}),
  };
}

/** 지금 백업할 때인가 (한 번도 안 했으면 그렇다) */
export function isBackupDue(s: AutoBackupSettings, now: number): boolean {
  if (!s.enabled) return false;
  return !s.lastAt || now - s.lastAt >= s.intervalDays * DAY;
}

/** 할 때가 지나고 며칠 더 밀렸나 (할 때가 아니면 0). 한 번도 안 했으면 Infinity */
export function overdueDays(s: AutoBackupSettings, now: number): number {
  if (!isBackupDue(s, now)) return 0;
  if (!s.lastAt) return Infinity;
  return Math.floor((now - s.lastAt - s.intervalDays * DAY) / DAY);
}

/** 띠를 띄울 만큼 밀렸나 */
export function shouldNag(s: AutoBackupSettings, now: number): boolean {
  return overdueDays(s, now) >= NAG_AFTER_DAYS;
}

/** 오늘 이미 같은 이름이 있으면 시각을 붙인다 ('지금 백업'을 하루에 여러 번 눌러도 덮지 않게) */
export function backupFileName(now: Date, existing: string[]): string {
  const base = `${BACKUP_FILE_PREFIX}${formatDate(now)}`;
  if (!existing.includes(`${base}.json`)) return `${base}.json`;
  const hhmm = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `${base}_${hhmm}.json`;
}

/** 남길 것보다 오래된 것들 (목록은 최신 것부터) */
export function backupsToTrash<T>(newestFirst: T[], keep: number): T[] {
  return newestFirst.slice(Math.max(1, keep));
}

export interface BackupRunResult {
  name: string;
  summary: string;
  trashed: number;
  folderLink?: string;
}

/**
 * 지금 백업한다. 토큰은 부르는 쪽이 구해 온다(자동이면 창 없이, '지금 백업'이면 창을 띄워도 된다).
 * 실패하면 던진다 - 마지막 백업 시각은 성공했을 때만 고친다.
 */
export async function runDriveBackup(opts: {
  uid: string;
  token: string;
  keep: number;
  onProgress?: (msg: string) => void;
}): Promise<BackupRunResult> {
  const { uid, token, keep, onProgress } = opts;
  onProgress?.('백업할 자료를 모으는 중...');
  const payload = await buildBackupPayload({
    uid,
    scope: 'personal',
    scopeName: '개인',
    include: { events: true, schedules: true, journals: true, evaluations: true, memos: true, rosters: true },
    onProgress,
  });
  payload.autoBackup = true;
  const summary = describeBackup(payload);

  onProgress?.('드라이브에 올리는 중...');
  const folder = await getOrCreateBackupFolder(token);
  const before = await listBackupFiles(token, folder.id);
  const name = backupFileName(new Date(), before.map((f) => f.name));
  await uploadPrivateJson(token, folder.id, name, JSON.stringify(payload));

  // 오래된 것 정리 - 실패해도 백업은 됐다
  let trashed = 0;
  try {
    const after = await listBackupFiles(token, folder.id);
    for (const f of backupsToTrash(after, keep)) {
      await trashDriveFile(token, f.id);
      trashed += 1;
    }
  } catch (e) {
    console.warn('오래된 자동 백업을 정리하지 못했습니다:', e);
  }

  await setDoc(
    autoBackupRef(uid),
    { lastAt: Date.now(), lastName: name, lastSummary: summary, ...(folder.webViewLink ? { folderLink: folder.webViewLink } : {}) },
    { merge: true }
  );
  return { name, summary, trashed, folderLink: folder.webViewLink };
}

/** 설정을 고친다 (켜기·주기·남길 개수). 누르는 즉시 저장한다 */
export async function saveAutoBackupSettings(uid: string, patch: Partial<AutoBackupSettings>): Promise<void> {
  await setDoc(autoBackupRef(uid), patch, { merge: true });
}
