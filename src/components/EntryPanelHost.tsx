// src/components/EntryPanelHost.tsx
//
// 메모·기록·일정·알림장·출석부를 쓰는 오른쪽 칸. 화면(하루·메모·주간·월간·년간)이 아니라 Layout이 그린다.
//
// 예전에는 각 화면이 배너를 들고 있어서, 배너가 뜨면 뒤 화면이 어두워져 볼 수 없었고
// 다른 날짜·다른 화면으로 옮기면 배너가 같이 사라졌다. 이제 배너는 화면 옆에
// 붙어서(화면은 그만큼 왼쪽으로 줄어든다) 왼쪽 화면과 따로 움직인다.
//
// 저장 로직도 여기로 옮겼다. 배너가 화면보다 오래 살기 때문에, 저장하는 쪽도
// 화면이 아니라 배너 곁에 있어야 한다.
import React, { Suspense, useEffect, useRef } from 'react';
import EntryDrawer, { type EntryDraft } from './EntryDrawer';
import EventDrawer from './EventDrawer';
import { lazyWithReload } from '../lib/lazyWithReload';
import { useAppStore, type EntryPanelTarget } from '../store/useAppStore';
import { useDayData, type Attachment, type JournalEntry } from '../hooks/useDayData';
import { useMemos, type Memo } from '../hooks/useMemos';
import { useLabels } from '../hooks/useLabels';
import { useMinWidth } from '../hooks/useMinWidth';
import { useGroups } from '../hooks/useGroups';
import { shortDateLabel } from '../lib/notices';
import { showToast } from '../utils/toast';

// 알림장·출석부는 열 때만 내려받는다 (학급 운영을 안 쓰는 날에는 필요 없다)
const NoticeDrawer = lazyWithReload(() => import('./NoticeDrawer'));
const AttendanceDrawer = lazyWithReload(() => import('./AttendanceDrawer'));

/** 이 폭 이상이면 화면 옆에 붙인다. 그보다 좁으면(휴대폰) 예전처럼 화면을 덮는 배너. */
export const DOCK_MIN_WIDTH = 768;

// 칸의 폭은 팝업과 같은 오른쪽 줄의 폭 하나를 쓴다 (PopupFrame.RIGHT_COLUMN_WIDTH, 경계선을 끌어 바꾼다).
// 출석부의 누계 표(17칸)는 칸 안에서 가로로 밀어 본다.

/** 지금 칸에서 '고친 것 있으면 저장'. 다른 항목을 열기 전에 부른다. */
let flushCurrent: (() => Promise<boolean>) | null = null;

/**
 * 오른쪽 칸을 연다. 이미 쓰던 것이 있으면 먼저 저장한다(저장이 실패하면 열지 않는다).
 * 화면들은 store를 직접 부르지 말고 이것을 부른다.
 */
export async function openEntryPanel(target: EntryPanelTarget): Promise<void> {
  const store = useAppStore.getState();
  if (store.entryPanel && flushCurrent && !(await flushCurrent())) return;
  store.openEntryPanel(target);
}

export default function EntryPanelHost() {
  const target = useAppStore((s) => s.entryPanel);
  if (!target) return null;
  // 열 때마다 새로 그린다(openedAt). 다른 항목을 열었는데 앞의 글이 남아 있으면 안 된다.
  if (target.kind === 'event') return <EventPanel key={target.openedAt} target={target} />;
  if (target.kind === 'notice' || target.kind === 'attendance') {
    return (
      <Suspense fallback={null}>
        <ClassroomPanel key={target.openedAt} target={target} />
      </Suspense>
    );
  }
  return target.kind === 'journal' ? (
    <JournalPanel key={target.openedAt} target={target} />
  ) : (
    <MemoPanel key={target.openedAt} target={target} />
  );
}

/** 이 칸의 '고친 것 있으면 저장'을 openEntryPanel이 부를 수 있게 등록한다 */
function useFlushRegistration() {
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);
  useEffect(() => {
    const flush = () => (flushRef.current ? flushRef.current() : Promise.resolve(true));
    flushCurrent = flush;
    return () => {
      if (flushCurrent === flush) flushCurrent = null;
    };
  }, []);
  return flushRef;
}

function useSpaceName(groupId: string | null) {
  const { groups } = useGroups();
  return groupId ? `👥 ${groups.find((g) => g.id === groupId)?.name || '그룹'}` : '🔒 개인';
}

function JournalPanel({ target }: { target: EntryPanelTarget }) {
  const { closeEntryPanel, setEntryPanelId } = useAppStore();
  const docked = useMinWidth(DOCK_MIN_WIDTH);
  const flushRef = useFlushRegistration();

  const dateStr = target.dateStr || '';
  const { journals, addJournalEntry, updateJournalEntry, deleteJournalEntry } = useDayData(dateStr, target.groupId);
  const { journalLabels } = useLabels();
  const spaceName = useSpaceName(target.groupId);

  // 기록은 라벨을 이름으로도, ID로도 들고 있다. 이름으로 풀어 배너에 넘긴다 (DayJournal과 같은 규칙).
  const resolveLabelNames = (entry: JournalEntry): string[] => {
    const keys = [...(entry.labelIds || []), ...(entry.label ? [entry.label] : [])];
    const names: string[] = [];
    for (const key of keys) {
      if (!key) continue;
      const found = journalLabels.find((l) => l.id === key || l.name === key);
      if (found && !names.includes(found.name)) names.push(found.name);
    }
    return names;
  };

  const current: JournalEntry | null = target.entryId
    ? journals.find((j) => String(j.id) === String(target.entryId)) || target.initial || null
    : null;
  const drawerEntry = current
    ? (() => {
        const names = resolveLabelNames(current);
        return { ...current, labels: names, labelIds: names, label: names[0] || '' };
      })()
    : null;

  const handleSave = async (draft: EntryDraft) => {
    // 라벨을 고르지 않았으면 빈 값으로 둔다 ('일반'은 어떤 라벨에도 없는 이름이다)
    const mainLabel = draft.labels.length > 0 ? draft.labels[0] : '';
    // labelIds는 ID로 저장한다. V3는 기록 라벨을 ID로만 찾는다.
    const labelIds = draft.labels
      .map((name) => journalLabels.find((l) => l.name === name)?.id)
      .filter((id): id is string => !!id);
    // 없는 값은 키째로 뺀다 (Firestore는 배열 안의 undefined를 거부한다)
    const attachments: Attachment[] = draft.attachments.map((att) => ({
      name: att.name,
      url: att.url,
      type: att.type || 'file',
      ...(att.id !== undefined ? { id: att.id } : {}),
      ...(att.size !== undefined ? { size: att.size } : {}),
      ...(att.driveId !== undefined ? { driveId: att.driveId } : {}),
    }));

    if (target.entryId) {
      await updateJournalEntry(target.entryId, {
        content: draft.content,
        label: mainLabel,
        labelIds,
        imageUrl: '', // 구버전 imageUrl은 첨부 목록으로 옮겨 담았다
        attachments,
        linkedItems: draft.linkedItems,
      });
      return;
    }
    const newId = await addJournalEntry(draft.content, mainLabel, labelIds, undefined, {
      attachments,
      linkedItems: draft.linkedItems,
    });
    if (typeof newId === 'string') {
      // 이어서 저장하면 방금 만든 기록을 고친다 (새로 하나 더 생기지 않게)
      setEntryPanelId(newId, {
        id: newId,
        content: draft.content,
        createdAt: Date.now(),
        label: mainLabel,
        labelIds,
        imageUrl: '',
        attachments,
        linkedItems: draft.linkedItems,
      } as JournalEntry);
    }
  };

  return (
    <EntryDrawer
      isOpen
      docked={docked}
      flushRef={flushRef}
      onClose={closeEntryPanel}
      kind="journal"
      entry={drawerEntry}
      labelOptions={journalLabels.map((l) => l.name)}
      onSave={handleSave}
      onDelete={
        target.entryId
          ? async () => {
              await deleteJournalEntry(target.entryId!);
              showToast('🗑️ 기록을 삭제했습니다. 휴지통에서 복원할 수 있습니다.');
            }
          : undefined
      }
      defaultLabel={target.defaultLabel}
      subtitle={`${shortDateLabel(dateStr)} 기록 · ${spaceName}`}
    />
  );
}

function MemoPanel({ target }: { target: EntryPanelTarget }) {
  const { closeEntryPanel, setEntryPanelId } = useAppStore();
  const docked = useMinWidth(DOCK_MIN_WIDTH);
  const flushRef = useFlushRegistration();

  const { memos, addMemo, updateMemo, deleteMemo } = useMemos(target.groupId);
  const { memoLabels } = useLabels();
  const spaceName = useSpaceName(target.groupId);

  const current: Memo | null = target.entryId
    ? memos.find((m) => m.firestoreId === target.entryId) || target.initial || null
    : null;

  const handleSave = async (draft: EntryDraft) => {
    if (target.entryId) {
      await updateMemo(target.entryId, draft);
      return;
    }
    const ref = await addMemo(draft);
    if (ref?.id) {
      setEntryPanelId(ref.id, {
        firestoreId: ref.id,
        content: draft.content,
        createdAt: Date.now(),
        labels: draft.labels,
        imageUrl: draft.imageUrl,
        attachments: draft.attachments,
        linkedItems: draft.linkedItems,
      } as Memo);
    }
  };

  return (
    <EntryDrawer
      isOpen
      docked={docked}
      flushRef={flushRef}
      onClose={closeEntryPanel}
      kind="memo"
      entry={current}
      labelOptions={memoLabels}
      onSave={handleSave}
      onDelete={
        target.entryId
          ? async () => {
              await deleteMemo(target.entryId!);
              showToast('🗑️ 메모를 삭제했습니다. 휴지통에서 복원할 수 있습니다.');
            }
          : undefined
      }
      defaultLabel={target.defaultLabel}
      subtitle={`메모 · ${spaceName}`}
    />
  );
}

function EventPanel({ target }: { target: EntryPanelTarget }) {
  const { closeEntryPanel } = useAppStore();
  const docked = useMinWidth(DOCK_MIN_WIDTH);
  const flushRef = useFlushRegistration();
  const spaceName = useSpaceName(target.groupId);
  const dateStr = target.dateStr || '';

  return (
    <EventDrawer
      dateStr={dateStr}
      groupId={target.groupId}
      entryId={target.entryId}
      initial={target.initial}
      docked={docked}
      flushRef={flushRef}
      onClose={closeEntryPanel}
      subtitle={`${shortDateLabel(dateStr)} 일정 · ${spaceName}`}
    />
  );
}

/** 알림장·출석부. 날짜는 칸 안에서 ◀ ▶ 로 옮긴다 (칸마다 자기 날짜를 들고 있다). */
function ClassroomPanel({ target }: { target: EntryPanelTarget }) {
  const { closeEntryPanel } = useAppStore();
  const docked = useMinWidth(DOCK_MIN_WIDTH);
  const flushRef = useFlushRegistration();
  const spaceName = useSpaceName(target.groupId);
  const dateStr = target.dateStr || '';

  if (target.kind === 'notice') {
    return (
      <NoticeDrawer
        dateStr={dateStr}
        groupId={target.groupId}
        spaceName={spaceName}
        initialTab={target.tab === 'list' ? 'list' : 'write'}
        docked={docked}
        flushRef={flushRef}
        onClose={closeEntryPanel}
      />
    );
  }
  return (
    <AttendanceDrawer
      dateStr={dateStr}
      initialTab={target.tab === 'summary' ? 'summary' : 'check'}
      docked={docked}
      flushRef={flushRef}
      onClose={closeEntryPanel}
    />
  );
}
