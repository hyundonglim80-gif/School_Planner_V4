// src/lib/backupJson.ts
//
// JSON 백업 한 덩이를 만든다. 내보내기 창(BackupModal)과 드라이브 자동 백업(lib/autoBackup)이 같은 것을 쓴다.
//
// ⚠️ 예전 'JSON 전체 백업'에는 알림장(notices)과 출석부(attendance)가 빠져 있었다. 이제 함께 담는다:
//    알림장은 기록과 함께(저장하면 그날 기록에 알림장 항목이 생기는 짝이다),
//    출석부는 명렬표와 함께(둘 다 개인 공간에만 있는 학생 정보다).
//    파일 모양(version: SP4-UNIFIED-BACKUP)은 그대로라 예전 파일도 그대로 되돌린다.
import { collection, getDocs, query, where, documentId, type CollectionReference } from 'firebase/firestore';
import { db } from './firebase';

export const BACKUP_VERSION = 'SP4-UNIFIED-BACKUP';

export interface BackupInclude {
  events?: boolean;
  schedules?: boolean;
  /** 기록. 알림장도 함께 담는다 */
  journals?: boolean;
  evaluations?: boolean;
  memos?: boolean;
  /** 명렬표. 개인 공간이면 출석부도 함께 담는다 */
  rosters?: boolean;
}

export interface BuildBackupOptions {
  uid: string;
  /** 'personal' 또는 공유 그룹 id */
  scope: string;
  scopeName: string;
  /** 둘 다 있으면 그 기간만 (날짜가 이름인 문서). 없으면 전체 */
  startDate?: string;
  endDate?: string;
  include: BackupInclude;
  onProgress?: (msg: string) => void;
}

/** 공간의 컬렉션 (개인: users/{uid}/…, 그룹: groups/{gid}/…) */
export function spaceCol(uid: string, scope: string, name: string): CollectionReference {
  return scope === 'personal' ? collection(db, 'users', uid, name) : collection(db, 'groups', scope, name);
}

export async function buildBackupPayload(o: BuildBackupOptions): Promise<Record<string, any>> {
  const { uid, scope, scopeName, startDate, endDate, include } = o;
  const personal = scope === 'personal';
  const payload: Record<string, any> = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    scope,
    scopeName,
    period: startDate && endDate ? { startDate, endDate } : 'all',
    events: {},
    schedules: {},
    journals: {},
    tasks: {},
    evaluations: {},
    notices: {},
    attendance: {},
    rosters: {},
    settings: {},
  };

  const inRange = (cRef: CollectionReference) =>
    startDate && endDate ? query(cRef, where(documentId(), '>=', startDate), where(documentId(), '<=', endDate)) : cRef;
  const take = async (name: string, bag: string, ranged = true) => {
    o.onProgress?.(`${bag} 읽는 중...`);
    const ref = spaceCol(uid, scope, name);
    const snap = await getDocs(ranged ? inRange(ref) : ref);
    snap.forEach((d) => (payload[bag][d.id] = d.data()));
  };

  if (include.events) await take('events', 'events');
  if (include.schedules) await take('schedules', 'schedules');
  if (include.journals) {
    await take('journals', 'journals');
    await take('notices', 'notices');
  }
  if (include.evaluations) await take('evaluations', 'evaluations');
  if (include.memos) await take('tasks', 'tasks', false);

  if (personal) {
    // 설정(라벨·시간표·환경설정·D-Day…)도 담는다. 구글 시트 주소 같은 기기에 매인 연결 정보는 뺀다
    o.onProgress?.('설정 읽는 중...');
    const snap = await getDocs(collection(db, 'users', uid, 'settings'));
    snap.forEach((d) => {
      if (d.id === 'backup_config') return;
      payload.settings[d.id] = d.data();
      if (include.rosters && (d.id === 'rosters' || d.id === 'roster')) payload.rosters[d.id] = d.data();
    });
    if (include.rosters) {
      // 출석부 문서 이름은 '학급키_날짜'라 이름으로 기간을 거를 수 없다 - 안의 date로 거른다
      o.onProgress?.('출석부 읽는 중...');
      const att = await getDocs(collection(db, 'users', uid, 'attendance'));
      att.forEach((d) => {
        const date = String(d.data()?.date || '');
        if (startDate && endDate && date && (date < startDate || date > endDate)) return;
        payload.attendance[d.id] = d.data();
      });
    }
  }
  return payload;
}

/** 백업에 든 것을 세어 한 줄로 (안내용) */
export function describeBackup(payload: Record<string, any>): string {
  const n = (bag: string) => Object.keys(payload?.[bag] || {}).length;
  const parts = [
    ['일정', n('events'), '일'],
    ['수업', n('schedules'), '일'],
    ['기록', n('journals'), '일'],
    ['알림장', n('notices'), '일'],
    ['메모', n('tasks'), '건'],
    ['조사표', n('evaluations'), '일'],
    ['출석부', n('attendance'), '건'],
  ] as const;
  return parts
    .filter(([, c]) => c > 0)
    .map(([label, c, unit]) => `${label} ${c}${unit}`)
    .join(', ');
}
