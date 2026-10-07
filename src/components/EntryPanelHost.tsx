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
import { ensureEntryLabelsQuietly } from '../lib/entryLabelSync';
import { entryJournalId } from '../lib/entryLabels';
import React, { Suspense, useEffect, useRef } from 'react';
import { PanelRaiseContext } from './panelRaise';
import { useLabelTree } from '../lib/labelTree';
import { isMovableJournal, relocateEntry, undoRelocate, type EntryPlace } from '../lib/moveEntry';
import { showUndoToast } from '../lib/undoToast';
import { findStudentTags } from '../lib/studentTag';
import { TABLE_ONLY_CONTENT } from '../lib/entryTable';
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
import { showDeletedToast } from '../lib/undoToast';

// 알림장·출석부는 열 때만 내려받는다 (학급 운영을 안 쓰는 날에는 필요 없다)
const NoticeDrawer = lazyWithReload(() => import('./NoticeDrawer'));
const AttendanceDrawer = lazyWithReload(() => import('./AttendanceDrawer'));
const SubjectAttendancePanel = lazyWithReload(() => import('./SubjectAttendancePanel'));

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
  if (target.kind === 'subjectAttendance') {
    return (
      <Suspense fallback={null}>
        <SubjectAttendanceHost target={target} />
      </Suspense>
    );
  }
  if (target.kind === 'notice' || target.kind === 'attendance') {
    return (
      <Suspense fallback={null}>
        <ClassroomPanel target={target} />
      </Suspense>
    );
  }
  return target.kind === 'journal' ? <JournalPanel target={target} /> : <MemoPanel target={target} />;
}

/** 칸마다 '저장 안 한 것이 있나'. 칸(EntryDrawer 등)이 채우고, ESC로 모두 닫기 전에 본다. */
const unsavedChecks = new Set<React.MutableRefObject<(() => boolean) | null>>();

/** 열린 쓰는 칸 가운데 저장 안 한 것이 있는가 */
export function anyEntryPanelUnsaved(): boolean {
  for (const ref of unsavedChecks) {
    try {
      if (ref.current?.()) return true;
    } catch {
      /* 확인을 못 하면 없는 것으로 */
    }
  }
  return false;
}

/**
 * 쓰는 칸을 모두 닫는다 (ESC). 저장 안 한 것이 있으면 먼저 묻는다 - ESC 한 번에 적던 글이
 * 사라지면 되돌릴 길이 없다. 닫았으면 true.
 */
export function closeAllEntryPanels(): boolean {
  const st = useAppStore.getState();
  if (st.entryPanels.length === 0) return true;
  if (anyEntryPanelUnsaved() && !window.confirm('저장하지 않은 내용이 있는 칸이 있습니다. 저장하지 않고 모두 닫을까요?')) {
    return false;
  }
  useAppStore.setState({ entryPanels: [], entryPanel: null });
  return true;
}

/** 칸마다의 '고친 것 있으면 저장' 자리. 칸(EntryDrawer 등)이 채운다. */
function useFlushRegistration() {
  return useRef<(() => Promise<boolean>) | null>(null);
}

/** 칸마다의 '저장 안 한 것이 있나' 자리. 칸이 열려 있는 동안 목록에 올린다. */
function useUnsavedRegistration() {
  const ref = useRef<(() => boolean) | null>(null);
  useEffect(() => {
    unsavedChecks.add(ref);
    return () => {
      unsavedChecks.delete(ref);
    };
  }, []);
  return ref;
}

/** 이 칸만 닫기 / 이 칸이 새로 만든 항목의 id 알리기 */
function usePanelActions(target: EntryPanelTarget) {
  const closeEntryPanel = useAppStore((s) => s.closeEntryPanel);
  const setEntryPanelIdFor = useAppStore((s) => s.setEntryPanelId);
  const setEntryPanelDateFor = useAppStore((s) => s.setEntryPanelDate);
  return {
    closeEntryPanel: () => closeEntryPanel(target.openedAt),
    setEntryPanelId: (id: string, initial?: any) => setEntryPanelIdFor(id, initial, target.openedAt),
    setEntryPanelDate: (dateStr: string, id?: string, initial?: any) =>
      setEntryPanelDateFor(dateStr, target.openedAt, id, initial),
  };
}

/**
 * '📅 날짜' 칸으로 자리를 옮긴다 (19번 U7). 글은 부르는 쪽이 먼저 저장했다. 옮긴 뒤 이 칸은 새 자리를 가리키고,
 * 안내의 '되돌리기'는 새 항목을 지우고 휴지통의 원본을 되살린다(칸도 원래 자리로).
 */
function useRelocate(target: EntryPanelTarget) {
  const { journalLabels } = useLabels();
  return async (from: EntryPlace, toDate: string | null, justCreated = false) => {
    const r = await relocateEntry({ from, toDate, groupId: target.groupId, journalLabels, justCreated });
    if (!r) return;
    const retarget = useAppStore.getState().retargetEntryPanel;
    const point = (place: EntryPlace, item: any) =>
      retarget(
        target.openedAt,
        place.kind === 'memo'
          ? { kind: 'memo', entryId: place.id, initial: item }
          : { kind: 'journal', entryId: place.id, dateStr: place.dateStr, initial: item }
      );
    point(r.place, r.item);
    const where = r.place.kind === 'memo' ? '🗒️ 메모로' : `📔 ${shortDateLabel(r.place.dateStr)} 기록으로`;
    if (justCreated || !r.trashId) {
      showToast(`✅ ${where} 저장했습니다.`);
      return;
    }
    showUndoToast(`✅ ${where} 옮겼습니다. 원래 자리의 것은 휴지통에 있습니다.`, async () => {
      await undoRelocate(r);
      // 칸이 아직 새 자리를 보고 있으면 원래 자리로
      const still = useAppStore.getState().entryPanels.some((p) => p.openedAt === target.openedAt && p.entryId === r.place.id);
      if (still) point(r.from, r.src);
      return '↩️ 원래 자리로 되돌렸습니다.';
    });
  };
}

/** 학생 태그가 든 기록을 메모로 옮기면 누가기록에서 빠진다 - 한 번 묻는다 */
const confirmStudentTagMove = (content: string) =>
  findStudentTags(content).length === 0 ||
  window.confirm('학생 태그가 든 기록을 메모로 옮기면 학생 기록(누가기록)에 더 이상 모이지 않습니다. 메모로 옮길까요?');

function useSpaceName(groupId: string | null) {
  const { groups } = useGroups();
  return groupId ? `👥 ${groups.find((g) => g.id === groupId)?.name || '그룹'}` : '🔒 개인';
}

function JournalPanel({ target }: { target: EntryPanelTarget }) {
  const { closeEntryPanel, setEntryPanelId } = usePanelActions(target);
  const relocate = useRelocate(target);
  const docked = useMinWidth(DOCK_MIN_WIDTH);
  const flushRef = useFlushRegistration();
  const unsavedRef = useUnsavedRegistration();

  const dateStr = target.dateStr || '';
  const { journals, addJournalEntry, updateJournalEntry, deleteJournalEntry, setJournalFlags } = useDayData(dateStr, target.groupId);
  const { journalLabels } = useLabels();
  const labelTree = useLabelTree();
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
        const tableOnly = current.content === TABLE_ONLY_CONTENT && (current.tables || []).length > 0;
        return { ...current, content: tableOnly ? '' : current.content, labels: names, labelIds: names, label: names[0] || '' };
      })()
    : null;

  const handleSave = async (draft: EntryDraft) => {
    // '📅 날짜'를 바꿨으면 글을 먼저 저장하고 그 자리로 옮긴다 (19번 U7)
    const toDate = draft.targetDate === undefined ? dateStr : draft.targetDate;
    const moving = toDate !== dateStr;
    if (moving && toDate === null && !confirmStudentTagMove(draft.content)) throw new Error('옮기지 않았습니다. 날짜를 되돌리거나 다시 저장해 주세요.');
    // 메모에만 있던 라벨이면 기록 라벨 목록에도 채운다 - V3는 기록 라벨을 id로만 찾는다 (19번 U5, lib/entryLabelSync)
    await ensureEntryLabelsQuietly(draft.labels);
    // 표만 있고 글이 없으면 '[표]'로 둔다. V3는 글·라벨·첨부가 없는 기록을 그날 저장할 때 빼 버린다.
    const content = !draft.content.trim() && draft.tables.length > 0 ? TABLE_ONLY_CONTENT : draft.content;
    // 라벨을 고르지 않았으면 빈 값으로 둔다 ('일반'은 어떤 라벨에도 없는 이름이다)
    const mainLabel = draft.labels.length > 0 ? draft.labels[0] : '';
    // labelIds는 ID로 저장한다. V3는 기록 라벨을 ID로만 찾는다.
    // 목록에 아직 없는 이름('#새라벨'로 막 만든 것, 19번 U10)은 ensureEntryLabels가 채운 id(entryJournalId)로
    const labelIds = draft.labels.map((name) => journalLabels.find((l) => l.name === name)?.id || entryJournalId(name));
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
        content,
        label: mainLabel,
        labelIds,
        imageUrl: '', // 구버전 imageUrl은 첨부 목록으로 옮겨 담았다
        attachments,
        linkedItems: draft.linkedItems,
        linkedItemsBase: draft.linkedItemsBase,
        tables: draft.tables,
      });
      if (moving) await relocate({ kind: 'journal', id: target.entryId, dateStr }, toDate);
      return;
    }
    const flags = { ...(draft.completed ? { completed: true } : {}), ...(draft.favorite ? { favorite: true } : {}) };
    const newId = await addJournalEntry(content, mainLabel, labelIds, undefined, {
      attachments,
      linkedItems: draft.linkedItems,
      ...(draft.tables.length > 0 ? { tables: draft.tables } : {}),
      ...flags,
    });
    if (typeof newId === 'string') {
      target.onCreated?.({ id: newId, type: 'journal', title: draft.content, date: dateStr, fId: target.groupId || 'personal' });
      // 이어서 저장하면 방금 만든 기록을 고친다 (새로 하나 더 생기지 않게)
      setEntryPanelId(newId, {
        id: newId,
        content,
        createdAt: Date.now(),
        label: mainLabel,
        labelIds,
        imageUrl: '',
        attachments,
        linkedItems: draft.linkedItems,
        tables: draft.tables,
        ...flags,
      } as JournalEntry);
      // 새로 쓰며 날짜를 바꿨으면 방금 만든 기록을 그 자리로 (휴지통을 거치지 않는다)
      if (moving) await relocate({ kind: 'journal', id: newId, dateStr }, toDate, true);
    }
  };

  return (
    <>
    <EntryDrawer
      isOpen
      docked={docked}
      flushRef={flushRef}
      unsavedRef={unsavedRef}
      onClose={closeEntryPanel}
      placeDate={dateStr}
      placeLocked={current && !isMovableJournal(current) ? '알림장·출석부가 만든 기록은 날짜를 바꿀 수 없습니다' : undefined}
      kind="journal"
      entry={drawerEntry}
      showFlags
      onToggleFlag={
        target.entryId ? (flag, value) => setJournalFlags(target.entryId!, { [flag]: value }) : undefined
      }
      labelOptions={journalLabels.map((l) => l.name)}
      labelParents={labelTree.journal}
      onSave={handleSave}
      onDelete={
        target.entryId
          ? async () => {
              const trashId = await deleteJournalEntry(target.entryId!);
              showDeletedToast('🗑️ 기록을 삭제했습니다. 휴지통에서 복원할 수 있습니다.', trashId);
            }
          : undefined
      }
      defaultLabel={target.defaultLabel}
      subtitle={`${shortDateLabel(dateStr)} 기록 · ${spaceName}`}
    />
    </>
  );
}

function MemoPanel({ target }: { target: EntryPanelTarget }) {
  const { closeEntryPanel, setEntryPanelId } = usePanelActions(target);
  const relocate = useRelocate(target);
  const docked = useMinWidth(DOCK_MIN_WIDTH);
  const flushRef = useFlushRegistration();
  const unsavedRef = useUnsavedRegistration();

  const { memos, addMemo, updateMemo, deleteMemo } = useMemos(target.groupId);
  const { memoLabels } = useLabels();
  const labelTree = useLabelTree();
  const spaceName = useSpaceName(target.groupId);

  const current: Memo | null = target.entryId
    ? memos.find((m) => m.firestoreId === target.entryId) || target.initial || null
    : null;

  const handleSave = async (draft: EntryDraft) => {
    // 기록에만 있던 라벨이면 메모 라벨 목록에도 채운다 (19번 U5 - V3 메모 라벨 목록에 보이게)
    await ensureEntryLabelsQuietly(draft.labels);
    // '📅 날짜'를 넣었으면 글을 먼저 저장하고 그날 기록으로 옮긴다 (19번 U7)
    const toDate = draft.targetDate ?? null;
    if (target.entryId) {
      await updateMemo(target.entryId, draft);
      if (toDate) await relocate({ kind: 'memo', id: target.entryId }, toDate);
      return;
    }
    const ref = await addMemo(draft);
    if (ref?.id) {
      target.onCreated?.({ id: ref.id, type: 'memo', title: draft.content, date: '', fId: target.groupId || 'personal' });
      setEntryPanelId(ref.id, {
        firestoreId: ref.id,
        content: draft.content,
        createdAt: Date.now(),
        labels: draft.labels,
        imageUrl: draft.imageUrl,
        attachments: draft.attachments,
        linkedItems: draft.linkedItems,
        tables: draft.tables,
        completed: !!draft.completed,
        favorite: !!draft.favorite,
      } as Memo);
      // 새로 쓰며 날짜를 넣었으면 방금 만든 메모를 그날 기록으로 (휴지통을 거치지 않는다)
      if (toDate) await relocate({ kind: 'memo', id: ref.id }, toDate, true);
    }
  };

  return (
    <>
    <EntryDrawer
      isOpen
      docked={docked}
      flushRef={flushRef}
      unsavedRef={unsavedRef}
      onClose={closeEntryPanel}
      placeDate={null}
      kind="memo"
      entry={current}
      showFlags
      onToggleFlag={
        target.entryId
          ? async (flag, value) => {
              await updateMemo(target.entryId!, { [flag]: value });
            }
          : undefined
      }
      labelOptions={memoLabels}
      labelParents={labelTree.memo}
      onSave={handleSave}
      onDelete={
        target.entryId
          ? async () => {
              const trashId = await deleteMemo(target.entryId!);
              showDeletedToast('🗑️ 메모를 삭제했습니다. 휴지통에서 복원할 수 있습니다.', trashId);
            }
          : undefined
      }
      defaultLabel={target.defaultLabel}
      draftText={target.entryId ? undefined : target.draftText}
      draftFiles={target.entryId ? undefined : target.draftFiles}
      subtitle={`메모 · ${spaceName}`}
    />
    </>
  );
}

function EventPanel({ target }: { target: EntryPanelTarget }) {
  const { closeEntryPanel, setEntryPanelId, setEntryPanelDate } = usePanelActions(target);
  const docked = useMinWidth(DOCK_MIN_WIDTH);
  const flushRef = useFlushRegistration();
  const unsavedRef = useUnsavedRegistration();
  const spaceName = useSpaceName(target.groupId);
  const dateStr = target.dateStr || '';

  return (
    <EventDrawer
      dateStr={dateStr}
      groupId={target.groupId}
      entryId={target.entryId}
      initial={target.initial}
      draftText={target.entryId ? undefined : target.draftText}
      onCreated={(id, item) => {
        setEntryPanelId(id, item);
        target.onCreated?.({ id, type: 'event', title: item.content || '', date: dateStr, fId: target.groupId || 'personal' });
      }}
      // 새 일정은 저장할 날짜가 곧바로 바뀌고, 고치던 일정은 옮긴 날짜의 수정 칸으로 이어진다
      onDateChange={(next) => setEntryPanelDate(next)}
      onMoved={(next, id, item) => setEntryPanelDate(next, id, item)}
      docked={docked}
      flushRef={flushRef}
      unsavedRef={unsavedRef}
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
  const unsavedRef = useUnsavedRegistration();
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
        unsavedRef={unsavedRef}
        onClose={closeEntryPanel}
      />
    );
  }
  return (
    <AttendanceDrawer
      dateStr={dateStr}
      initialTab={target.tab === 'summary' ? 'summary' : 'check'}
      initialClassKey={target.classKey}
      docked={docked}
      flushRef={flushRef}
      unsavedRef={unsavedRef}
      onClose={closeEntryPanel}
    />
  );
}

/** 교과 출결 칸 (교과 모드 수업 칸의 '출결', ROADMAP-SUBJECT S6). 누를 때마다 저장하므로 저장 안 한 것이 없다 */
function SubjectAttendanceHost({ target }: { target: EntryPanelTarget }) {
  const { closeEntryPanel } = usePanelActions(target);
  const docked = useMinWidth(DOCK_MIN_WIDTH);
  return (
    <SubjectAttendancePanel
      dateStr={target.dateStr || ''}
      period={target.period || 1}
      classKey={target.classKey || ''}
      subject={target.slotSubject}
      docked={docked}
      onClose={closeEntryPanel}
    />
  );
}
