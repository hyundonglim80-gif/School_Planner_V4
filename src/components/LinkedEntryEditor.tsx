// src/components/LinkedEntryEditor.tsx
//
// 연결된 링크 팝업에서 기록·메모의 '수정'을 눌렀을 때 여는 옆 배너.
//
// 예전에는 거기서 글자만 고칠 수 있는 칸이 열렸다. 그래서 캡처 이미지를 붙이거나
// 파일을 달거나 라벨을 고치는 일은, 그 기록이 있는 날짜로 직접 옮겨 가야만 할 수
// 있었다. 기록·메모 화면에서 쓰는 배너(EntryDrawer)를 그대로 연다.
//
// 기록·메모 화면의 배너와 다른 점은 딱 하나다. 그 화면들은 자기가 보고 있는
// 날짜의 것만 다루지만, 링크는 다른 날짜(그리고 다른 공유 공간)를 가리킬 수 있다.
// 그래서 대상 문서를 여기서 직접 읽고 쓴다.
import React, { useEffect, useState } from 'react';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { useLabels } from '../hooks/useLabels';
import { showErrorToast, showToast } from '../utils/toast';
import { syncReverseLinks } from '../utils/linkUtils';
import EntryDrawer, { type EntryDraft, type EntrySource } from './EntryDrawer';

export interface LinkedEntryTarget {
  kind: 'journal' | 'memo';
  dateStr: string;
  id: string;
  fId?: string;
}

const colPath = (col: string, fId?: string) => {
  const uid = auth.currentUser?.uid;
  return !fId || fId === 'personal' ? `users/${uid}/${col}` : `groups/${fId}/${col}`;
};

export default function LinkedEntryEditor({
  target,
  onClose,
}: {
  target: LinkedEntryTarget;
  onClose: () => void;
}) {
  const { journalLabels, memoLabels } = useLabels();
  const [entry, setEntry] = useState<EntrySource | null>(null);
  const [notFound, setNotFound] = useState(false);

  const { kind, dateStr, id, fId } = target;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (kind === 'journal') {
          const snap = await getDoc(doc(db, colPath('journals', fId), dateStr));
          const found = (snap.exists() ? snap.data().entries || [] : []).find(
            (j: any) => String(j.id) === String(id)
          );
          if (cancelled) return;
          if (!found) { setNotFound(true); return; }
          setEntry(found);
        } else {
          const snap = await getDoc(doc(db, colPath('tasks', fId), id));
          if (cancelled) return;
          if (!snap.exists()) { setNotFound(true); return; }
          const d = snap.data();
          setEntry({
            id,
            firestoreId: id,
            content: d.text || d.content || '',
            labels: d.labels || [],
            imageUrl: d.imageUrl || '',
            attachments: d.attachments || [],
            linkedItems: d.linkedItems || [],
          });
        }
      } catch (err) {
        if (!cancelled) {
          showErrorToast('연결된 항목을 불러오지 못했습니다.', err);
          onClose();
        }
      }
    })();
    return () => { cancelled = true; };
    // 대상이 바뀔 때만 다시 읽는다
  }, [kind, dateStr, id, fId]);

  useEffect(() => {
    if (notFound) {
      showErrorToast('연결된 항목을 찾을 수 없습니다. 이미 지워졌을 수 있습니다.');
      onClose();
    }
  }, [notFound]);

  const handleSave = async (draft: EntryDraft) => {
    const previousLinks = entry?.linkedItems;
    if (kind === 'journal') {
      const ref = doc(db, colPath('journals', fId), dateStr);
      const snap = await getDoc(ref);
      const list = snap.exists() ? snap.data().entries || [] : [];
      const idx = list.findIndex((j: any) => String(j.id) === String(id));
      if (idx < 0) {
        showErrorToast('고치려던 기록이 사라졌습니다.');
        return;
      }
      const mainLabel = draft.labels[0] || '';
      // labelIds는 ID로 저장한다. V3는 기록의 라벨을 ID로만 찾는다.
      const labelIds = draft.labels
        .map((n) => journalLabels.find((l) => l.name === n)?.id)
        .filter((v): v is string => !!v);
      list[idx] = {
        ...list[idx],
        content: draft.content,
        label: mainLabel,
        labelIds,
        imageUrl: '',
        attachments: draft.attachments,
        linkedItems: draft.linkedItems,
        updatedAt: Date.now(),
      };
      await setDoc(ref, { entries: list, updatedAt: Date.now() }, { merge: true });
      await syncReverseLinks(
        previousLinks,
        draft.linkedItems,
        {
          targetType: 'journal',
          targetId: id,
          targetDate: dateStr,
          title: `[${dateStr}] ${draft.content.substring(0, 20)}`,
          targetFId: fId || 'personal',
        } as any,
        fId || 'personal'
      );
    } else {
      const ref = doc(db, colPath('tasks', fId), id);
      await updateDoc(ref, {
        text: draft.content,
        content: draft.content,
        labels: draft.labels,
        imageUrl: draft.imageUrl || '',
        attachments: draft.attachments,
        linkedItems: draft.linkedItems,
      });
      await syncReverseLinks(
        previousLinks,
        draft.linkedItems,
        {
          targetType: 'memo',
          targetId: id,
          targetDate: '',
          title: `[메모] ${draft.content.substring(0, 20)}`,
          targetFId: fId || 'personal',
        } as any,
        fId || 'personal'
      );
    }
    // 방금 저장한 내용을 기준선으로 삼아, 이어지는 저장이 링크를 다시 붙이지 않게 한다
    setEntry((prev) => (prev ? { ...prev, linkedItems: draft.linkedItems } : prev));
    showToast('✅ 수정한 내용을 저장했습니다.');
  };

  if (!entry) return null;

  return (
    <EntryDrawer
      isOpen
      onClose={onClose}
      kind={kind}
      entry={entry}
      labelOptions={kind === 'journal' ? journalLabels.map((l) => l.name) : memoLabels}
      onSave={handleSave}
    />
  );
}

/** Layout에서 그리기 위한 껍데기. 열려 있을 때만 대상을 읽는다. */
export function LinkedEntryEditorHost() {
  const { isEntryEditorOpen, entryEditorTarget, closeEntryEditor } = useAppStore();
  if (!isEntryEditorOpen || !entryEditorTarget) return null;
  return (
    <LinkedEntryEditor
      key={`${entryEditorTarget.kind}-${entryEditorTarget.dateStr}-${entryEditorTarget.id}`}
      target={entryEditorTarget}
      onClose={closeEntryEditor}
    />
  );
}
