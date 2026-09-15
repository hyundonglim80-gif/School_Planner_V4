// src/components/LinkCreateModal.tsx
//
// '새 데이터 연결하기'에서 '+ 새로 만들어 연결'을 눌렀을 때 뜨는 작은 등록창.
//
// 예전에는 연결창 안의 한 줄 입력칸에 글자만 넣고 바로 만들었다. 그래서 날짜도
// 라벨도 정할 수 없었고, 그렇게 만든 항목은 나중에 해당 화면에 가서 다시 고쳐야
// 했다. 여기서 한 번에 정하고, 저장하면 연결까지 마친 뒤 연결창으로 돌아간다.
import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, addDoc, collection } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { showToast, showErrorToast } from '../utils/toast';
import { useLabels } from '../hooks/useLabels';
import { eventDocPayload, readEventList } from '../lib/eventText';
import AutoTextarea from './AutoTextarea';
import ModalShell, { ModalCloseButton } from './ModalShell';

export type CreatableType = 'event' | 'journal' | 'memo';

export interface CreatedItem {
  id: string;
  type: CreatableType;
  title: string;
  date: string;
  fId: string;
}

interface LinkCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: CreatableType;
  /** 일정·기록이 들어갈 날짜의 기본값 */
  defaultDate: string;
  /** 개인이면 'personal', 그룹이면 그룹 id */
  fId: string;
  /** 컬렉션 경로를 정하는 쪽은 연결창이다 (그룹/개인 판단이 거기 있다) */
  colPathOf: (type: 'events' | 'journals' | 'tasks') => string;
  onCreated: (item: CreatedItem) => void;
}

const TYPE_LABEL: Record<CreatableType, string> = {
  event: '일정',
  journal: '기록',
  memo: '메모',
};

const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`;

export default function LinkCreateModal({
  isOpen,
  onClose,
  type,
  defaultDate,
  fId,
  colPathOf,
  onCreated,
}: LinkCreateModalProps) {
  const { eventLabels, journalLabels, memoLabels } = useLabels();

  const [content, setContent] = useState('');
  const [dateStr, setDateStr] = useState(defaultDate);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  // 열 때마다 빈 칸에서 시작한다
  useEffect(() => {
    if (!isOpen) return;
    setContent('');
    setDateStr(defaultDate);
    setLabel('');
  }, [isOpen, defaultDate]);

  // 라벨은 종류마다 담긴 모양이 다르다. 여기서 이름만 뽑아 한 줄로 맞춘다.
  const labelNames: string[] =
    type === 'event'
      ? eventLabels.map((l) => l.name)
      : type === 'journal'
        ? journalLabels.map((l) => l.name)
        : memoLabels;

  const handleSave = async () => {
    const text = content.trim();
    if (!text) return showToast(`${TYPE_LABEL[type]} 내용을 입력하세요.`);
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    setSaving(true);
    try {
      let created: CreatedItem;

      if (type === 'memo') {
        const ref = await addDoc(collection(db, colPathOf('tasks')), {
          content: text,
          text, // V3 호환
          createdAt: Date.now(),
          completed: false,
          labels: label ? [label] : [],
          authorId: uid,
          authorName: auth.currentUser?.displayName || '',
        });
        created = { id: ref.id, type, title: text, date: dateStr, fId };
      } else if (type === 'journal') {
        const ref = doc(db, colPathOf('journals'), dateStr);
        const snap = await getDoc(ref);
        const existing = snap.exists() ? snap.data() : {};
        const entries = [...(existing.entries || [])];
        const id = newId('jr');
        entries.push({ id, content: text, createdAt: Date.now(), label: label || '기본' });
        await setDoc(ref, { ...existing, entries, updatedAt: Date.now() }, { merge: true });
        created = { id, type, title: text, date: dateStr, fId };
      } else {
        const ref = doc(db, colPathOf('events'), dateStr);
        const snap = await getDoc(ref);
        // V3가 쓰던 eventText 형식도 같이 읽어준다
        const eventList = snap.exists() ? readEventList(snap.data()) : [];
        const id = newId('ev');
        eventList.push({
          id,
          content: text,
          text, // V3 호환
          completed: false,
          createdAt: Date.now(),
          labelIds: label ? [label] : [],
        });
        await setDoc(ref, eventDocPayload(eventList), { merge: true });
        created = { id, type, title: text, date: dateStr, fId };
      }

      onCreated(created);
      showToast(`${TYPE_LABEL[type]}을(를) 만들고 연결 목록에 담았습니다.`);
      onClose();
    } catch (e: any) {
      console.error(e);
      showErrorToast('생성 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="md"
      title={`+ 새 ${TYPE_LABEL[type]} 만들어 연결`}
      footer={
        <>
          <ModalCloseButton onClose={onClose} />
          <button
            onClick={handleSave}
            disabled={saving || !content.trim()}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="link-create-content" className="block text-xs font-bold text-slate-600 mb-1">
            내용
          </label>
          <AutoTextarea
            id="link-create-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            autoFocus
            placeholder={`새 ${TYPE_LABEL[type]} 내용`}
            className="w-full min-h-[64px] px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 resize-none focus:outline-none focus:border-primary"
          />
        </div>

        {/* 메모는 날짜에 매이지 않는다 */}
        {type !== 'memo' && (
          <div>
            <label htmlFor="link-create-date" className="block text-xs font-bold text-slate-600 mb-1">
              날짜
            </label>
            <input
              id="link-create-date"
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-800 focus:outline-none focus:border-primary"
            />
          </div>
        )}

        <div>
          <span className="block text-xs font-bold text-slate-600 mb-1">라벨</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setLabel('')}
              aria-pressed={label === ''}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
                label === ''
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-primary'
              }`}
            >
              없음
            </button>
            {labelNames.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setLabel(name)}
                aria-pressed={label === name}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
                  label === name
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-primary'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-slate-400">
          저장하면 연결 목록에 담기고 이 창이 닫힙니다. 연결창에서 '연결하기'를 눌러야 최종 저장됩니다.
        </p>
      </div>
    </ModalShell>
  );
}
