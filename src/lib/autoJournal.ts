// src/lib/autoJournal.ts
//
// 알림장·출석부를 저장하면 그날 '기록' 칸에도 항목 하나를 남긴다.
//
// 항목 id를 정해 두고(notice_…, attendance_…) 저장할 때마다 같은 항목을 고쳐 쓴다.
// 내용이 비면(알림장을 다 지웠거나 모두 출석) 그 항목을 뺀다. 그래서 기록 칸에
// 같은 알림장이 여러 개 쌓이지 않는다.
//
// ⚠️ 트랜잭션으로 쓴다.
//    기록은 하루치가 문서 하나의 배열(entries)이다. 기기 캐시가 빈 채로 읽고
//    그 위에 쓰면 그날 기록이 통째로 날아간다(실제로 일정에서 그런 일이 있었다).
//    트랜잭션은 늘 서버에서 읽고, 그 사이 누가 고쳤으면 다시 읽어 쓴다.
import { doc, runTransaction } from 'firebase/firestore';
import { db, auth } from './firebase';

export type AutoJournalKind = 'notice' | 'attendance';

export const AUTO_JOURNAL_LABEL: Record<AutoJournalKind, { id: string; name: string; color: string }> = {
  notice: { id: 'j_notice', name: '알림장', color: 'yellow' },
  attendance: { id: 'j_attendance', name: '출결', color: 'red' },
};

/** 자동으로 만든 기록 항목의 id */
export function autoJournalId(kind: AutoJournalKind, key: string): string {
  return `${kind}_${key}`;
}

/**
 * 기록 라벨 목록에 '알림장'·'출결'이 없으면 더한다. 라벨의 id를 돌려준다.
 *
 * 계정에 기록 라벨 목록이 아직 없으면(V3의 옛 저장소나 기본값을 쓰는 중이면)
 * 건드리지 않는다. 여기서 목록을 새로 만들면 그 옛 라벨들을 덮어쓰게 된다.
 * 그때는 라벨 이름만 항목에 남고, 라벨 관리의 '삭제된 라벨 복구'로 등록된다.
 */
export async function ensureAutoJournalLabel(kind: AutoJournalKind): Promise<string | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  const def = AUTO_JOURNAL_LABEL[kind];
  const ref = doc(db, 'users', uid, 'settings', 'labels');
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const list = snap.exists() ? (snap.data() as any).journalLabels : undefined;
      if (!Array.isArray(list)) return null;
      const found = list.find((l: any) => l && (l.name === def.name || l.id === def.id));
      if (found) return String(found.id || def.id);
      tx.set(ref, { journalLabels: [...list, { id: def.id, name: def.name, color: def.color }], updatedAt: Date.now() }, { merge: true });
      return def.id;
    });
  } catch (err) {
    console.error('기록 라벨을 더하지 못했습니다:', err);
    return null;
  }
}

/**
 * 그날 기록에 자동 항목을 넣거나 고치거나 뺀다.
 * @param groupId 공유 그룹 id. 개인 공간이면 null.
 * @param content 비면 항목을 뺀다.
 */
export async function upsertAutoJournal(opts: {
  kind: AutoJournalKind;
  groupId: string | null;
  dateStr: string;
  entryId: string;
  content: string;
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요합니다.');
  const { kind, groupId, dateStr, entryId } = opts;
  const content = opts.content.trim();
  const labelDef = AUTO_JOURNAL_LABEL[kind];
  // 라벨 등록은 개인 라벨 목록의 일이다. 기록이 그룹에 있어도 라벨은 내 목록에서 찾는다.
  const labelId = content ? await ensureAutoJournalLabel(kind) : null;

  const ref = groupId ? doc(db, 'groups', groupId, 'journals', dateStr) : doc(db, 'users', uid, 'journals', dateStr);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const entries: any[] = snap.exists() && Array.isArray((snap.data() as any).entries) ? [...(snap.data() as any).entries] : [];
    const idx = entries.findIndex((e) => e && String(e.id) === entryId);

    if (!content) {
      if (idx < 0) return; // 뺄 것도 없다
      entries.splice(idx, 1);
    } else {
      const prev = idx >= 0 ? entries[idx] : null;
      const entry = {
        ...(prev || {}),
        id: entryId,
        content,
        // 처음 만든 시각을 지킨다. 고칠 때마다 바뀌면 카드의 시각이 흔들린다.
        createdAt: prev?.createdAt || Date.now(),
        label: labelDef.name,
        labelIds: labelId ? [labelId] : [],
        linkedItems: prev?.linkedItems || [],
        imageUrl: prev?.imageUrl || '',
        auto: kind,
      };
      if (idx >= 0) entries[idx] = entry;
      else entries.push(entry);
    }
    tx.set(ref, { entries, updatedAt: Date.now() }, { merge: true });
  });
}
