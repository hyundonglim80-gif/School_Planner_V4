// src/lib/autoJournalSync.ts
//
// 기록 칸의 자동 항목(알림장·출결)을 고치거나 지우면, 그 원본(알림장·출석부)도 맞춘다.
//
// 알림장·출석부를 저장하면 기록에 항목이 생긴다(lib/autoJournal). 그 반대 방향이 없어서
// 기록에서 알림장 항목을 지워도 알림장은 그대로 남았고, 다음에 알림장을 저장하면 지운
// 항목이 되살아났다. 이제 기록에서 한 일이 원본에도 그대로 간다.
//
//   알림장 항목  notice_{날짜}           고치면 줄마다 알림장 항목, 지우면 그날 알림장을 비운다
//   출결 항목    attendance_{학급키}      고치면 줄을 읽어 출결로, 지우면 그날 모두 출석
//
// 출결은 글을 다시 읽어야 한다('5번 김지우 결석(질병) 1·2교시 - 감기'). 읽을 수 없는 줄이
// 있으면 출석부를 건드리지 않는다. 짐작해서 고치면 생활기록부에 옮길 출결이 틀어진다.
import { doc, setDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import {
  KIND_LABEL,
  REASON_LABEL,
  type AttendanceKind,
  type AttendanceReason,
  type AttendanceRecord,
} from './attendance';
import { loadAttendanceDay, saveAttendanceDay, type ClassInfo } from './attendanceStore';
import { splitNoticeLines } from './notices';
import { showToast, showErrorToast } from '../utils/toast';

export type AutoSource =
  | { kind: 'notice'; dateStr: string }
  | { kind: 'attendance'; classInfo: ClassInfo };

/** 기록 항목이 알림장·출결 자동 항목인가. id로 가린다 (auto 표시가 없는 옛 항목도 잡는다). */
export function autoSourceOf(entry: { id?: string | number; auto?: string } | null | undefined): AutoSource | null {
  const id = String(entry?.id ?? '');
  const notice = /^notice_(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (notice) return { kind: 'notice', dateStr: notice[1] };
  const att = /^attendance_(\d{4})_([^_]+)_([^_]+)$/.exec(id);
  if (att) {
    return {
      kind: 'attendance',
      classInfo: { classKey: `${att[1]}_${att[2]}_${att[3]}`, year: Number(att[1]), grade: att[2], classNum: att[3] },
    };
  }
  return null;
}

const KIND_BY_LABEL = Object.fromEntries(Object.entries(KIND_LABEL).map(([k, v]) => [v, k])) as Record<string, AttendanceKind>;
const REASON_BY_LABEL = Object.fromEntries(Object.entries(REASON_LABEL).map(([k, v]) => [v, k])) as Record<
  string,
  AttendanceReason
>;

/**
 * 출결 항목의 글을 출결로 되읽는다. 읽을 수 없는 줄이 하나라도 있으면 null.
 *
 *   [출결] 4학년 3반                   ← 머리글 (있어도 없어도 된다)
 *   5번 김지우 결석(질병) - 감기
 *   12번 박하늘 지각(미인정) 1·2교시
 */
export function parseAttendanceJournal(text: string): Record<string, AttendanceRecord> | null {
  const records: Record<string, AttendanceRecord> = {};
  const kinds = Object.values(KIND_LABEL).join('|');
  const reasons = Object.values(REASON_LABEL).join('|');
  const LINE = new RegExp(`^(\\d+)\\s*번\\s+(.+?)\\s+(${kinds})\\s*\\((${reasons})\\)(?:\\s+([\\d·,\\s]+)\\s*교시)?(?:\\s*-\\s*(.*))?$`);
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || /^\[출결\]/.test(line)) continue;
    const m = LINE.exec(line);
    if (!m) return null;
    const kind = KIND_BY_LABEL[m[3]];
    const periods = m[5]
      ? [...new Set(m[5].split(/[·,\s]+/).filter(Boolean).map(Number))].filter((p) => p > 0).sort((a, b) => a - b)
      : [];
    const note = (m[6] || '').trim();
    records[m[1]] = {
      num: Number(m[1]),
      name: m[2].trim(),
      kind,
      reason: REASON_BY_LABEL[m[4]],
      // 결석은 하루 전체라 교시를 두지 않는다
      ...(kind !== 'absent' && periods.length ? { periods } : {}),
      ...(note ? { note } : {}),
    };
  }
  return records;
}

export interface SyncResult {
  /** 원본을 맞췄는가 */
  synced: boolean;
  /** 사용자에게 알릴 말 (맞추지 못했을 때) */
  message?: string;
}

/**
 * 기록의 자동 항목이 바뀐 뒤 원본을 맞춘다.
 * @param dateStr 그 기록이 있는 날짜
 * @param content 고친 뒤의 글. 항목을 지웠으면 null.
 */
export async function syncAutoSource(opts: {
  entry: { id?: string | number; auto?: string };
  groupId: string | null;
  dateStr: string;
  content: string | null;
}): Promise<SyncResult> {
  const { entry, groupId, dateStr: date, content } = opts;
  const src = autoSourceOf(entry);
  if (!src) return { synced: false };
  const uid = auth.currentUser?.uid;
  if (!uid) return { synced: false };

  if (src.kind === 'notice') {
    const lines = content ? splitNoticeLines(content) : [];
    // 알림장 문서만 고친다. 기록 쪽은 이미 사용자가 고친 그대로다 (다시 쓰면 번호가 바뀐다).
    const ref = groupId
      ? doc(db, 'groups', groupId, 'notices', src.dateStr)
      : doc(db, 'users', uid, 'notices', src.dateStr);
    await setDoc(ref, { date: src.dateStr, lines, updatedAt: Date.now() });
    announceSourceChanged({ kind: 'notice', groupId, dateStr: src.dateStr });
    return { synced: true };
  }

  // 출결은 개인 공간에만 있다
  if (groupId) return { synced: false };
  const after = content ? parseAttendanceJournal(content) : {};
  if (!after) {
    return {
      synced: false,
      message:
        "출결 줄을 읽지 못해 출석부는 그대로 두었습니다. '5번 김지우 결석(질병) - 감기'처럼 적거나 출석부에서 고쳐 주세요.",
    };
  }
  const before = (await loadAttendanceDay(src.classInfo, date)).records;
  // 출석부를 저장하면 기록 항목도 출석부 모양으로 다시 쓴다 (모두 출석이면 뺀다)
  await saveAttendanceDay(src.classInfo, date, before, after);
  announceSourceChanged({ kind: 'attendance', groupId: null, dateStr: date, classKey: src.classInfo.classKey });
  return { synced: true };
}

/**
 * 기록 쪽에서 알림장·출석부를 고쳤다고 알린다.
 * 오른쪽 칸에 그 알림장·출석부가 열려 있으면 다시 읽는다. 옛 글을 들고 있다가
 * 저장하면 방금 지운 알림장이 되살아난다.
 */
export const SOURCE_CHANGED_EVENT = 'sp4-auto-source-changed';
export interface SourceChangedDetail {
  kind: 'notice' | 'attendance';
  groupId: string | null;
  dateStr: string;
  classKey?: string;
}
function announceSourceChanged(detail: SourceChangedDetail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SOURCE_CHANGED_EVENT, { detail }));
}

/**
 * 기록을 고치거나 지운 쪽(하루 화면, 연결된 항목 편집기, 휴지통)이 부른다.
 * 자동 항목이 아니면 아무것도 하지 않는다. 결과는 안내로 알린다.
 */
export async function syncAutoSourceAndTell(
  opts: Parameters<typeof syncAutoSource>[0] & { restored?: boolean }
): Promise<void> {
  const src = autoSourceOf(opts.entry);
  if (!src) return;
  const what = src.kind === 'notice' ? '알림장' : '출석부';
  try {
    const r = await syncAutoSource(opts);
    if (r.message) showToast(r.message, 6000);
    else if (r.synced) {
      showToast(
        opts.restored
          ? `♻️ ${what}도 함께 되살렸습니다.`
          : opts.content === null
          ? src.kind === 'notice'
            ? '🗑️ 기록을 지워 그날 알림장도 비웠습니다. 휴지통에서 되살리면 알림장도 돌아옵니다.'
            : '🗑️ 기록을 지워 그날 출결을 모두 출석으로 되돌렸습니다. 휴지통에서 되살리면 출결도 돌아옵니다.'
          : `✅ ${what}에도 고친 내용을 반영했습니다.`,
        4000
      );
    }
  } catch (err) {
    showErrorToast(`${what}을(를) 기록에 맞추지 못했습니다. ${what}에서 직접 고쳐 주세요.`, err);
  }
}
