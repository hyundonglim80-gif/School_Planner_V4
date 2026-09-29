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
import React, { Suspense, useRef, useState } from 'react';
import { PanelRaiseContext } from './panelRaise';
import MoveEntryModal from './MoveEntryModal';
import { isMovableJournal, moveJournalToMemo, moveMemoToJournal } from '../lib/moveEntry';
import { findStudentTags } from '../lib/studentTag';
import { formatDateStr } from '../lib/dateUtils';
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
import { showToast, showErrorToast } from '../utils/toast';

// 알림장·출석부는 열 때만 내려받는다 (학급 운영을 안 쓰는 날에는 필요 없다)
const NoticeDrawer = lazyWithReload(() => import('./NoticeDrawer'));
const AttendanceDrawer = lazyWithReload(() => import('./AttendanceDrawer'));

/** 이 폭 이상이면 화면 옆에 붙인다. 그보다 좁으면(휴대폰) 예전처럼 화면을 덮는 배너. */
export const DOCK_MIN_WIDTH = 768;

// 칸의 폭은 팝업과 같은 오른쪽 줄의 폭 하나를 쓴다 (PopupFrame.RIGHT_COLUMN_WIDTH, 경계선을 끌어 바꾼다).
// 출석부의 누계 표(17칸)는 칸 안에서 가로로 밀어 본다.

/**
 * 오른쪽 칸을 연다. 화면들은 store를 직접 부르지 말고 이것을 부른다.
 *
 * 예전에는 칸이 하나뿐이라, 쓰던 칸을 먼저 저장하고 새 칸으로 바꿨다. 그래서 새 일정 칸을
 * 연 채 새 기록을 열면 일정 칸이 사라졌다. 이제 다른 팝업 칸처럼 새 칸이 맨 위에 쌓이고,
 * 먼저 연 칸은 적던 것을 그대로 가진 채 아래로 내려간다(저장하지 않는다 - 쓰던 중이다).
 * 이미 열린 항목을 다시 열면 새 칸을 만들지 않고 그 칸을 맨 위로 올린다.
 */
export async function openEntryPanel(target: EntryPanelTarget): Promise<void> {
  useAppStore.getState().openEntryPanel(target);
}


export default function EntryPanelHost() {
  const panels = useAppStore((s) => s.entryPanels);
  return (
    <>
      {panels.map((target) => (
        // 칸마다 따로 산다(openedAt). 위로 올려도 다시 그리지 않아 적던 것이 남는다.
        <PanelRaiseContext.Provider key={target.openedAt} value={target.raisedAt}>
          <PanelFor target={target} />
        </PanelRaiseContext.Provider>
      ))}
    </>
  );
}

function PanelFor({ target }: { target: EntryPanelTarget }) {
  if (target.kind === 'event') return <EventPanel target={target} />;
  if (target.kind === 'notice' || target.kind === 'attendance') {
    return (
      <Suspense fallback={null}>
        <ClassroomPanel target={target} />
      </Suspense>
    );
  }
  return target.kind === 'journal' ? <JournalPanel target={target} /> : <MemoPanel target={target} />;
}

/** 칸마다의 '고친 것 있으면 저장' 자리. 칸(EntryDrawer 등)이 채운다. */
function useFlushRegistration() {
  return useRef<(() => Promise<boolean>) | null>(null);
}

/** 이 칸만 닫기 / 이 칸이 새로 만든 항목의 id 알리기 */
function usePanelActions(target: EntryPanelTarget) {
  const closeEntryPanel = useAppStore((s) => s.closeEntryPanel);
  const setEntryPanelIdFor = useAppStore((s) => s.setEntryPanelId);
  return {
    closeEntryPanel: () => closeEntryPanel(target.openedAt),
    setEntryPanelId: (id: string, initial?: any) => setEntryPanelIdFor(id, initial, target.openedAt),
  };
}

function useSpaceName(groupId: string | null) {
  const { groups } = useGroups();
  return groupId ? `👥 ${groups.find((g) => g.id === groupId)?.name || '그룹'}` : '🔒 개인';
}

function JournalPanel({ target }: { target: EntryPanelTarget }) {
  const { closeEntryPanel, setEntryPanelId } = usePanelActions(target);
  // 메모로 옮기기 창 (고치던 내용째 옮긴다)
  const [moveDraft, setMoveDraft] = useState<EntryDraft | null>(null);
  const docked = useMinWidth(DOCK_MIN_WIDTH);
  const flushRef = useFlushRegistration();

  const dateStr = target.dateStr || '';
  const { journals, addJournalEntry, updateJournalEntry, deleteJournalEntry } = useDayData(dateStr, target.groupId);
  const { journalLabels, memoLabels } = useLabels();
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

  const moveToMemo = async ({ labelChoices }: { labelChoices: any[] }) => {
    if (!current || !moveDraft) return;
    try {
      const { newId } = await moveJournalToMemo({
        entry: { ...current, content: moveDraft.content, attachments: moveDraft.attachments as any, linkedItems: moveDraft.linkedItems },
        groupId: target.groupId,
        dateStr,
        labelChoices,
        memoLabels,
      });
      setMoveDraft(null);
      closeEntryPanel();
      showToast('🗒️ 메모로 옮겼습니다. 원본 기록은 휴지통에 있습니다.');
      void openEntryPanel({ kind: 'memo', groupId: target.groupId, entryId: newId });
    } catch (e) {
      showErrorToast('메모로 옮기지 못했습니다.', e);
    }
  };

  return (
    <>
    <EntryDrawer
      isOpen
      docked={docked}
      flushRef={flushRef}
      onClose={closeEntryPanel}
      onMove={current && isMovableJournal(current) ? setMoveDraft : undefined}
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
    {moveDraft && (
      <MoveEntryModal
        isOpen
        onClose={() => setMoveDraft(null)}
        from="journal"
        fromLabels={moveDraft.labels}
        targetLabelNames={memoLabels}
        dateStr={dateStr}
        hasStudentTag={findStudentTags(moveDraft.content).length > 0}
        onConfirm={moveToMemo}
      />
    )}
    </>
  );
}

function MemoPanel({ target }: { target: EntryPanelTarget }) {
  const { closeEntryPanel, setEntryPanelId } = usePanelActions(target);
  // 기록으로 옮기기 창 (고치던 내용째 옮긴다). 날짜는 처음에 지금 보는 날.
  const [moveDraft, setMoveDraft] = useState<EntryDraft | null>(null);
  const viewedDate = useAppStore((s) => s.currentDate);
  const docked = useMinWidth(DOCK_MIN_WIDTH);
  const flushRef = useFlushRegistration();

  const { memos, addMemo, updateMemo, deleteMemo } = useMemos(target.groupId);
  const { memoLabels, journalLabels: journalLabelList } = useLabels();
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

  const moveToJournal = async ({ dateStr, labelChoices }: { dateStr: string; labelChoices: any[] }) => {
    if (!current || !moveDraft) return;
    try {
      const { newId } = await moveMemoToJournal({
        memo: { ...current, content: moveDraft.content, attachments: moveDraft.attachments as any, linkedItems: moveDraft.linkedItems, imageUrl: moveDraft.imageUrl },
        groupId: target.groupId,
        dateStr,
        labelChoices,
        journalLabels: journalLabelList,
      });
      setMoveDraft(null);
      closeEntryPanel();
      showToast(`📔 ${shortDateLabel(dateStr)} 기록으로 옮겼습니다. 원본 메모는 휴지통에 있습니다.`);
      void openEntryPanel({ kind: 'journal', groupId: target.groupId, dateStr, entryId: newId });
    } catch (e) {
      showErrorToast('기록으로 옮기지 못했습니다.', e);
    }
  };

  return (
    <>
    <EntryDrawer
      isOpen
      docked={docked}
      flushRef={flushRef}
      onClose={closeEntryPanel}
      onMove={current ? setMoveDraft : undefined}
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
    {moveDraft && (
      <MoveEntryModal
        isOpen
        onClose={() => setMoveDraft(null)}
        from="memo"
        fromLabels={moveDraft.labels}
        targetLabelNames={journalLabelList.map((l) => l.name)}
        dateStr={formatDateStr(new Date(viewedDate))}
        onConfirm={moveToJournal}
      />
    )}
    </>
  );
}

function EventPanel({ target }: { target: EntryPanelTarget }) {
  const { closeEntryPanel } = usePanelActions(target);
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
  const { closeEntryPanel } = usePanelActions(target);
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
