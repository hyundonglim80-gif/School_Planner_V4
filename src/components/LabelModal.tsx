//src/components/LabelModal.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { DEFAULT_EVENT_LABELS, normalizeEventLabel, type EventLabel, toSharedEventLabel } from '../hooks/useLabels';
import {
  readLegacyEventLabels,
  readLegacyJournalLabels,
  readLegacyMemoLabels,
} from '../lib/legacyLabels';
import { closeAllModals } from '../hooks/useModalLayer';
import { useGroups } from '../hooks/useGroups';
import { scanForMissingLabels, pickRecoveryColor } from '../utils/labelRecovery';
import { applyLabelRenames, diffLabelNames } from '../utils/labelRename';
import { orderByTree, sanitizeParents, saveLabelTree, useLabelTree } from '../lib/labelTree';
import { moveToTrash } from '../utils/trashHelper';
import { countEntryLabelUsage, emptyEntryLabels, loadEntryLabelUsageInput, usageTotal, type LabelUsage } from '../lib/labelUsage';
import {
  mergeEntryLabels,
  toJournalLabels,
  toMemoLabels,
  type EntryLabel,
  type RawJournalLabel,
} from '../lib/entryLabels';
import PopupFrame from './PopupFrame';
import { showToast, showErrorToast } from '../utils/toast';

interface MemoLabel {
  id: string;
  name: string;
  color: string;
}

export interface JournalLabel {
  id: string;
  name: string;
  color: string;
}

const COLOR_PALETTE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  blue: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd', label: '파랑' },
  green: { bg: '#dcfce7', text: '#166534', border: '#86efac', label: '초록' },
  red: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5', label: '빨강' },
  orange: { bg: '#ffedd5', text: '#9a3412', border: '#fdba74', label: '주황' },
  yellow: { bg: '#fef9c3', text: '#854d0e', border: '#fde047', label: '노랑' },
  indigo: { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc', label: '남색' },
  purple: { bg: '#f3e8ff', text: '#6b21a8', border: '#d8b4fe', label: '보라' },
  gray: { bg: '#f1f5f9', text: '#334155', border: '#cbd5e1', label: '회색' },
};

const DEFAULT_MEMO_LABELS: MemoLabel[] = [
  { id: 'memo_1', name: '긴급', color: 'red' },
  { id: 'memo_2', name: '중요', color: 'orange' },
  { id: 'memo_3', name: '학급운영', color: 'green' },
  { id: 'memo_4', name: '학부모상담', color: 'yellow' },
  { id: 'memo_5', name: '수업준비', color: 'blue' },
  { id: 'memo_6', name: '행정업무', color: 'indigo' },
  { id: 'memo_7', name: '개인', color: 'gray' },
];

export const DEFAULT_JOURNAL_LABELS: JournalLabel[] = [
  { id: 'j_1', name: '학급활동', color: 'green' },
  { id: 'j_2', name: '학생상담', color: 'yellow' },
  { id: 'j_3', name: '업무전달', color: 'blue' },
  { id: 'j_4', name: '수업기록', color: 'purple' },
];

function ColorPickerDropdown({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const activeStyle = COLOR_PALETTE[color] || COLOR_PALETTE.blue;

  const PANEL_HEIGHT = 300; // 색상 9개 + 여백. 아래로 펼 자리가 있는지 판단할 때만 쓴다.

  // 라벨 목록은 세로 스크롤되는 상자 안에 있다. 드롭다운을 absolute로 두면 그 상자의
  // overflow에 잘려서, z-index를 아무리 올려도 아래쪽이 보이지 않는다.
  // 그래서 body로 빼내(portal) 화면 기준(fixed)으로 띄운다.
  const updatePosition = useCallback(() => {
    const btn = wrapRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const openUpward = rect.bottom + PANEL_HEIGHT > window.innerHeight && rect.top > PANEL_HEIGHT;
    setPos({
      top: openUpward ? Math.max(8, rect.top - PANEL_HEIGHT - 6) : rect.bottom + 6,
      left: Math.min(rect.left, Math.max(8, window.innerWidth - 140)),
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const close = () => setIsOpen(false);

    document.addEventListener('mousedown', handleOutside);
    // 스크롤하면 버튼이 움직이므로 붙어 있던 자리가 어긋난다. 그냥 닫는다.
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [isOpen, updatePosition]);

  return (
    <div className="relative inline-block shrink-0" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
        title="색상 변경"
      >
        <span
          className="w-5 h-5 rounded-full border shadow-2xs shrink-0"
          style={{ backgroundColor: activeStyle.bg, borderColor: activeStyle.border }}
        />
        <span className="text-2xs text-slate-400 font-black leading-none select-none">▼</span>
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={listRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 100000 }}
            className="bg-white border border-slate-200 rounded-xl shadow-2xl p-1.5 min-w-[130px] flex flex-col gap-0.5 animate-fade-in"
          >
            {Object.entries(COLOR_PALETTE).map(([key, val]) => {
              const isSelected = key === color;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onChange(key);
                    setIsOpen(false);
                  }}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all text-left cursor-pointer ${
                    isSelected ? 'bg-slate-100 text-slate-900 font-black' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <span
                    className="w-4 h-4 rounded-full border shadow-2xs shrink-0"
                    style={{ backgroundColor: val.bg, borderColor: val.border }}
                  />
                  <span>{val.label}</span>
                  {isSelected && <span className="ml-auto text-blue-600 text-xs font-bold">✓</span>}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}

interface LabelModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 'journal'·'memo'는 예전 이름 - 19번 U5부터 메모·기록 라벨은 한 탭('entry') */
  initialTab?: 'event' | 'journal' | 'memo' | 'entry';
}

type LabelTab = 'event' | 'entry';
const tabOf = (t: LabelModalProps['initialTab']): LabelTab => (t === 'event' || !t ? 'event' : 'entry');
/** 저장한 뒤의 목록: 두 배열의 i번째가 목록의 i번째다 */
const rebaseEntries = (list: EntryLabel[]): EntryLabel[] => list.map((l, i) => ({ ...l, inJournal: true, memoIndex: i }));

/** 같은 상위 아래(또는 맨 위 단계)에서 한 칸 위/아래로. 하위는 제 상위 밑을 벗어나지 않는다. */
function moveSibling<T extends { id: string }>(list: T[], id: string, dir: 'up' | 'down', parentIds: Record<string, string>): T[] {
  const parentOf = (x: string) => parentIds[x] || '';
  const siblings = list.filter((l) => parentOf(l.id) === parentOf(id));
  const i = siblings.findIndex((l) => l.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= siblings.length) return list;
  const a = list.findIndex((l) => l.id === id);
  const b = list.findIndex((l) => l.id === siblings[j].id);
  const next = [...list];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/**
 * 새 기록·메모 라벨을 더할 때 둘 상위 라벨. 후보는 맨 위 단계 라벨(상위가 없는 것)만 - 2단계까지.
 * 고른 상위는 다음에 더할 때도 그대로 남는다 (같은 상위 밑에 여러 개를 잇달아 더하기 쉽게).
 */
function NewLabelParentSelect({
  labels,
  parentIds,
  value,
  onChange,
  noun,
}: {
  labels: { id: string; name: string }[];
  parentIds: Record<string, string>;
  value: string;
  onChange: (id: string) => void;
  noun: string;
}) {
  const candidates = labels.filter((l) => !parentIds[l.id]);
  // 고른 상위가 지워졌거나 하위가 되었으면 '없음'으로 보인다
  const current = candidates.some((l) => l.id === value) ? value : '';
  return (
    <label className="flex items-center gap-1 text-2xs font-bold text-slate-500 shrink-0">
      상위
      <select
        aria-label={`새 ${noun} 라벨의 상위 라벨`}
        title="새 라벨을 어느 라벨 밑에 둘지 (없음이면 맨 위 단계)"
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="px-1.5 py-2 border border-slate-200 rounded-lg text-2xs font-bold text-slate-700 bg-white max-w-28"
      >
        <option value="">없음</option>
        {candidates.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * 기록·메모 라벨 목록. 상위 밑에 하위를 들여 써서 보여 주고, 줄마다 '상위 라벨'을 고른다(2단계).
 * 상위/하위는 id로 다루고, 저장할 때 이름으로 바꿔 둔다(lib/labelTree) - 이름을 고치는 중에도 끊기지 않게.
 */
function TreeLabelRows({
  labels,
  setLabels,
  parentIds,
  setParentIds,
  onDelete,
  noun,
  focusClass,
  usage,
}: {
  /** '항목 수 세기'를 했으면 라벨 이름 → 수 (19번 U10) */
  usage?: Record<string, LabelUsage> | null;
  labels: { id: string; name: string; color: string }[];
  setLabels: (next: any[]) => void;
  parentIds: Record<string, string>;
  setParentIds: (next: Record<string, string>) => void;
  onDelete: (id: string) => void;
  noun: string;
  focusClass: string;
}) {
  const rows = orderByTree(labels.map((l) => l.id), parentIds);
  const topIds = labels.map((l) => l.id).filter((id) => !parentIds[id]);
  return (
    <>
      {rows.map((row) => {
        const idx = labels.findIndex((l) => l.id === row.name);
        const lbl = labels[idx];
        if (!lbl) return null;
        const parentOf = (x: string) => parentIds[x] || '';
        const siblings = labels.filter((l) => parentOf(l.id) === parentOf(lbl.id));
        const sibIdx = siblings.findIndex((l) => l.id === lbl.id);
        const isFirst = sibIdx <= 0;
        const isLast = sibIdx === siblings.length - 1;
        const candidates = row.hasChildren ? [] : topIds.filter((id) => id !== lbl.id);
        return (
          <div
            key={lbl.id || `key_${idx}`}
            data-label-row={lbl.name}
            className={`flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl hover:border-slate-300 transition-all text-xs ${
              row.depth === 1 ? 'ml-6 border-l-4 border-l-slate-300' : ''
            }`}
          >
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <div className="flex flex-col gap-0.5">
                <button
                  disabled={isFirst}
                  onClick={() => setLabels(moveSibling(labels, lbl.id, 'up', parentIds))}
                  title="위로 (같은 상위 안에서)"
                  className={`text-xs px-1 rounded ${isFirst ? 'text-slate-200' : 'text-slate-400 hover:text-slate-700 cursor-pointer'}`}
                >
                  ▲
                </button>
                <button
                  disabled={isLast}
                  onClick={() => setLabels(moveSibling(labels, lbl.id, 'down', parentIds))}
                  title="아래로 (같은 상위 안에서)"
                  className={`text-xs px-1 rounded ${isLast ? 'text-slate-200' : 'text-slate-400 hover:text-slate-700 cursor-pointer'}`}
                >
                  ▼
                </button>
              </div>
              {row.depth === 1 && <span className="text-slate-400" aria-hidden>└</span>}
              <input
                type="text"
                value={lbl.name}
                aria-label={`${noun} 라벨 이름`}
                onChange={(e) => {
                  const updated = [...labels];
                  updated[idx] = { ...updated[idx], name: e.target.value };
                  setLabels(updated);
                }}
                className={`px-2 py-1 bg-white border border-slate-200 rounded text-xs font-bold text-slate-800 w-28 focus:outline-none ${focusClass}`}
              />
              <ColorPickerDropdown
                color={lbl.color}
                onChange={(newColor) => {
                  const updated = [...labels];
                  updated[idx] = { ...updated[idx], color: newColor };
                  setLabels(updated);
                }}
              />
              <label className="flex items-center gap-1 text-2xs font-bold text-slate-500">
                상위
                <select
                  aria-label={`${lbl.name} 상위 라벨`}
                  value={parentIds[lbl.id] || ''}
                  disabled={row.hasChildren}
                  title={row.hasChildren ? '하위 라벨이 있어 상위를 둘 수 없습니다 (2단계까지)' : '이 라벨을 어느 라벨 밑에 둘지'}
                  onChange={(e) => {
                    const next = { ...parentIds };
                    if (e.target.value) next[lbl.id] = e.target.value;
                    else delete next[lbl.id];
                    setParentIds(next);
                  }}
                  className="px-1.5 py-1 border border-slate-200 rounded-lg text-2xs font-bold text-slate-700 bg-white disabled:opacity-50"
                >
                  <option value="">없음</option>
                  {candidates.map((id) => (
                    <option key={id} value={id}>
                      {labels.find((l) => l.id === id)?.name || id}
                    </option>
                  ))}
                </select>
              </label>
              {usage && (
                <span
                  data-label-usage={lbl.name}
                  title={row.hasChildren ? '하위 라벨이 붙은 항목도 셉니다' : undefined}
                  className={`text-2xs font-bold ${usageTotal(usage[lbl.name]) === 0 ? 'text-rose-500' : 'text-slate-500'}`}
                >
                  메모 {usage[lbl.name]?.memo ?? 0} · 기록 {usage[lbl.name]?.journal ?? 0} · 휴지통 {usage[lbl.name]?.trash ?? 0}
                </span>
              )}
            </div>
            <button
              onClick={() => onDelete(lbl.id)}
              className="text-slate-400 hover:text-red-500 font-black px-1.5 py-0.5 rounded transition-colors cursor-pointer shrink-0"
              title={`${noun} 라벨 삭제`}
            >
              ✕
            </button>
          </div>
        );
      })}
    </>
  );
}

export default function LabelModal({ isOpen, onClose, initialTab = 'event' }: LabelModalProps) {
  const { groups } = useGroups();
  const [activeTab, setActiveTab] = useState<LabelTab>(tabOf(initialTab));
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(tabOf(initialTab));
    }
  }, [isOpen, initialTab]);

  // 일정 라벨 상태
  const [eventLabels, setEventLabels] = useState<EventLabel[]>([]);
  const [newEventName, setNewEventName] = useState('');
  const [newEventColor, setNewEventColor] = useState('blue');
  const [newEventCalendar, setNewEventCalendar] = useState(true);
  const [newEventSkip, setNewEventSkip] = useState(false);
  const [newEventForward, setNewEventForward] = useState(false);
  const [newEventPeriod, setNewEventPeriod] = useState(false);
  const [newEventRecur, setNewEventRecur] = useState(false);

  // 메모·기록 라벨 한 목록 (19번 U5, lib/entryLabels). 저장은 V3와 같이 쓰는 두 배열(memoLabels·journalLabels)에 같은 목록을
  // 원래 모양 그대로 - 불러온 두 배열을 들고 있다가 toMemoLabels·toJournalLabels로 쓴다.
  const [entryLabels, setEntryLabels] = useState<EntryLabel[]>([]);
  const rawMemoRef = useRef<unknown[]>([]);
  const rawJournalRef = useRef<RawJournalLabel[]>([]);
  // 상위/하위 (하위 id → 상위 id). 저장된 트리는 이름으로 있어서 열 때 id로 바꾼다.
  const labelTree = useLabelTree();
  const [entryParentIds, setEntryParentIds] = useState<Record<string, string>>({});
  /** 이번에 연 뒤 상위/하위를 손댔나. 손댔으면 늦게 도착한 트리로 덮지 않는다. */
  const treeTouchedRef = useRef(false);
  const [newEntryName, setNewEntryName] = useState('');
  const [newEntryColor, setNewEntryColor] = useState('green');
  // 새 라벨을 더할 때 고르는 상위 라벨 (id, 없으면 '')
  const [newEntryParent, setNewEntryParent] = useState('');

  // 항목 수 세기·빈 라벨 정리 (19번 U10, lib/labelUsage) - 누를 때만 서버를 한 번 훑는다
  const [usage, setUsage] = useState<Record<string, LabelUsage> | null>(null);
  const [counting, setCounting] = useState<{ done: number; total: number } | null>(null);
  const [pruneList, setPruneList] = useState<{ id: string; name: string; checked: boolean }[] | null>(null);

  const [saving, setSaving] = useState(false);
  // 이름이 바뀐 라벨을 기존 항목에 반영하는 중 (저장보다 오래 걸릴 수 있다)
  const [renaming, setRenaming] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  // 💡 불러오기가 실제로 성공하기 전까지는 저장을 막아서, 로드 실패 시
  // 화면 표시용으로 채운 기본값이 실수로 클라우드에 덮어써지는 것을 방지한다.
  const [labelsLoaded, setLabelsLoaded] = useState(false);

  // 저장된 트리(이름)를 지금 라벨의 id로 바꿔 채운다. 창을 열 때마다 처음부터.
  useEffect(() => {
    if (!isOpen) {
      treeTouchedRef.current = false;
      return;
    }
    if (treeTouchedRef.current || !labelsLoaded) return;
    const toIds = (parents: Record<string, string>, list: { id: string; name: string }[]) => {
      const idOf = (n: string) => list.find((l) => l.name === n)?.id;
      const out: Record<string, string> = {};
      for (const [child, parent] of Object.entries(parents)) {
        const c = idOf(child);
        const pr = idOf(parent);
        if (c && pr && c !== pr) out[c] = pr;
      }
      return out;
    };
    setEntryParentIds(toIds(labelTree.entry || labelTree.journal, entryLabels));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, labelsLoaded, labelTree]);
  const [loadError, setLoadError] = useState(false);
  // 저장 시점에 삭제된 라벨을 찾아내기 위한, 불러온 시점의 원본 스냅샷
  const originalEventLabelsRef = React.useRef<EventLabel[]>([]);
  const originalEntryLabelsRef = React.useRef<EntryLabel[]>([]);

  const fetchLabels = async () => {
    const user = auth.currentUser;
    if (!user) return;

    setLoadError(false);
    try {
      const docRef = doc(db, 'users', user.uid, 'settings', 'labels');
      const snap = await getDoc(docRef);

      const data = snap.exists() ? snap.data() : {};

      // 클라우드 -> V3 localStorage -> 기본값 순으로 고른다.
      // 라벨 설정 화면이 useLabels와 다른 경로로 읽으면, V3가 localStorage에만
      // 남긴 라벨이 기본값으로 보이고 저장하는 순간 클라우드까지 덮어써진다.
      const pick = (cloud: any, legacy: any[] | null, fallback: any[]) =>
        (Array.isArray(cloud) && cloud.length > 0 && cloud) || legacy || fallback;

      const rawEvents = pick(
        (Array.isArray(data.eventLabels) && data.eventLabels.length > 0 && data.eventLabels) || data.labels,
        readLegacyEventLabels(),
        DEFAULT_EVENT_LABELS
      );
      // V3의 isSkip/isPeriod/isRecur/showInCalendar를 그대로 인식해야
      // 저장할 때 휴일/기간/반복 속성이 꺼진 채로 덮어써지지 않는다.
      const nextEventLabels = rawEvents.map(normalizeEventLabel);
      setEventLabels(nextEventLabels);
      originalEventLabelsRef.current = nextEventLabels;

      const rawMemos = pick(data.memoLabels, readLegacyMemoLabels(), DEFAULT_MEMO_LABELS);
      const rawJournals = pick(data.journalLabels, readLegacyJournalLabels(), DEFAULT_JOURNAL_LABELS);
      rawMemoRef.current = rawMemos;
      rawJournalRef.current = rawJournals;
      const nextEntryLabels = mergeEntryLabels(rawMemos, rawJournals);
      setEntryLabels(nextEntryLabels);
      originalEntryLabelsRef.current = nextEntryLabels;

      setLabelsLoaded(true);
    } catch (e) {
      console.error('라벨 불러오기 오류:', e);
      // 불러오기 자체가 실패한 경우 -> 화면에는 기본값을 임시로 보여주되,
      // labelsLoaded를 true로 만들지 않아 저장(클라우드 덮어쓰기)은 막는다.
      setEventLabels(DEFAULT_EVENT_LABELS);
      setEntryLabels(mergeEntryLabels(DEFAULT_MEMO_LABELS, DEFAULT_JOURNAL_LABELS));
      setLoadError(true);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setLabelsLoaded(false);
    setLoadError(false);
    setUsage(null);
    setPruneList(null);
    fetchLabels();
  }, [isOpen]);

  if (!isOpen) return null;

  // --- 클라우드 저장 함수 ---
  /** 라벨 문서에 쓸 모양: 일정은 두 이름으로, 메모·기록은 같은 목록을 두 배열에 원래 모양으로 */
  const labelsPayload = (nextEvents: EventLabel[], nextEntries: EntryLabel[]) => {
    const memoLabels = toMemoLabels(nextEntries, rawMemoRef.current);
    const journalLabels = toJournalLabels(nextEntries, rawJournalRef.current);
    return {
      payload: {
        eventLabels: nextEvents.map(toSharedEventLabel),
        memoLabels,
        journalLabels,
        labels: nextEvents.map(toSharedEventLabel), // V3 호환성 (두 이름으로 - normalizeEventLabel 참고)
        updatedAt: Date.now(),
      },
      memoLabels,
      journalLabels,
    };
  };
  /** 쓴 뒤: 들고 있는 두 배열과 목록을 쓴 것으로 맞춘다 (다음 저장이 같은 항목을 고치게) */
  const afterWrite = (nextEvents: EventLabel[], nextEntries: EntryLabel[], memoLabels: unknown[], journalLabels: RawJournalLabel[]) => {
    rawMemoRef.current = memoLabels;
    rawJournalRef.current = journalLabels;
    const rebased = rebaseEntries(nextEntries);
    setEntryLabels(rebased);
    originalEventLabelsRef.current = nextEvents;
    originalEntryLabelsRef.current = rebased;
    return rebased;
  };

  const saveLabelsToCloud = async (nextEvents: EventLabel[], nextEntries: EntryLabel[]) => {
    const user = auth.currentUser;
    if (!user || !labelsLoaded) return;

    try {
      const docRef = doc(db, 'users', user.uid, 'settings', 'labels');
      const { payload, memoLabels, journalLabels } = labelsPayload(nextEvents, nextEntries);
      await setDoc(docRef, payload, { merge: true });
      afterWrite(nextEvents, nextEntries, memoLabels, journalLabels);

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      console.error('라벨 자동 클라우드 저장 오류:', e);
    }
  };

  // --- 일정 라벨 핸들러 ---
  const handleAddEventLabel = async () => {
    if (!newEventName.trim()) return;
    const newLbl: EventLabel = {
      id: `ev_${Date.now()}`,
      name: newEventName.trim(),
      color: newEventColor,
      calendar: newEventCalendar,
      skip: newEventSkip,
      forward: newEventForward,
      period: newEventPeriod,
      recur: newEventRecur,
    };
    const next = [...eventLabels, newLbl];
    setEventLabels(next);
    setNewEventName('');
    setNewEventPeriod(false);
    setNewEventRecur(false);
    await saveLabelsToCloud(next, entryLabels);
  };

  const handleDeleteEventLabel = (id: string) => {
    setEventLabels(eventLabels.filter((l) => l.id !== id));
  };

  const handleMoveEventLabel = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= eventLabels.length) return;
    const updated = [...eventLabels];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setEventLabels(updated);
  };

  /** 상위/하위(id)를 지금 이름으로 바꿔 저장한다 (lib/labelTree - 메모·기록 한 트리) */
  const saveTree = (parentIds: Record<string, string>, list: { id: string; name: string }[]) => {
    const nameOf = (id: string) => list.find((l) => l.id === id)?.name?.trim();
    const out: Record<string, string> = {};
    for (const [c, pr] of Object.entries(parentIds)) {
      const cn = nameOf(c);
      const pn = nameOf(pr);
      if (cn && pn && cn !== pn) out[cn] = pn;
    }
    return saveLabelTree({ entry: sanitizeParents(out) });
  };

  // --- 메모·기록 라벨 핸들러 ---
  const handleAddEntryLabel = async () => {
    const name = newEntryName.trim();
    if (!name) return;
    if (entryLabels.some((l) => l.name.trim() === name)) {
      showErrorToast(`'${name}' 라벨이 이미 있습니다.`);
      return;
    }
    // 기록 라벨 id를 새로 만든다 (있던 id는 절대 새로 만들지 않는다 - 새 라벨만)
    const newLbl: EntryLabel = { id: `j_${Date.now()}`, name, color: newEntryColor, inJournal: false };
    const next = [...entryLabels, newLbl];
    setEntryLabels(next);
    setNewEntryName('');
    // 상위를 골랐으면 그 밑에 둔다. 라벨은 더하는 즉시 저장되므로 상위/하위도 함께 저장한다
    // (저장 단추를 안 누르고 닫아도 라벨만 남고 상위가 빠지지 않게).
    const parent = entryLabels.some((l) => l.id === newEntryParent && !entryParentIds[l.id]) ? newEntryParent : '';
    const nextParents = parent ? { ...entryParentIds, [newLbl.id]: parent } : entryParentIds;
    if (parent) {
      treeTouchedRef.current = true;
      setEntryParentIds(nextParents);
    }
    await saveLabelsToCloud(eventLabels, next);
    if (parent) {
      try {
        await saveTree(nextParents, next);
      } catch (err) {
        console.error('라벨 상위/하위 저장 실패:', err);
        showErrorToast('상위 라벨을 저장하지 못했습니다. 저장 단추를 눌러 다시 저장해 주세요.');
      }
    }
  };

  const handleDeleteEntryLabel = (id: string) => {
    setEntryLabels(entryLabels.filter((l) => l.id !== id));
  };

  // 저장 직전, 불러온 시점과 비교해 삭제된 라벨을 찾아 휴지통으로 보낸다.
  const trashRemovedLabels = async (nextEntries: EntryLabel[]) => {
    const removedEvents = originalEventLabelsRef.current.filter(
      (orig) => !eventLabels.some((l) => l.id === orig.id)
    );
    const removedEntries = originalEntryLabelsRef.current.filter(
      (orig) => !nextEntries.some((l) => l.id === orig.id)
    );

    for (const lbl of removedEvents) {
      try {
        await moveToTrash({ id: lbl.id, type: 'label', content: `[일정] ${lbl.name}`, data: { kind: 'event', label: lbl } });
      } catch (err) {
        console.error('라벨 휴지통 이동 실패:', err);
      }
    }
    // 메모·기록 라벨은 기록 라벨 모양({id,name,color})으로 휴지통에 - 되살리면 journalLabels에 들어가고(기록이 id로 찾는다)
    // 화면은 한 목록이라 메모에도 보인다. 기록 배열에 없던 라벨(메모에만 있던 것)은 메모 라벨로.
    for (const lbl of removedEntries) {
      const label = { id: lbl.id, name: lbl.name, color: lbl.color };
      try {
        await moveToTrash({
          id: lbl.id,
          type: 'label',
          content: `[메모·기록] ${lbl.name}`,
          data: { kind: lbl.inJournal ? 'journal' : 'memo', label },
        });
      } catch (err) {
        console.error('라벨 휴지통 이동 실패:', err);
      }
    }
  };

  // --- 전체 라벨 저장 ---
  /** 모두 저장. nextEntries·nextParents를 주면 그 목록으로(빈 라벨 정리 - state가 아직 바뀌기 전) */
  const handleSaveAll = async (nextEntries: EntryLabel[] = entryLabels, nextParents: Record<string, string> = entryParentIds) => {
    const user = auth.currentUser;
    if (!user) return;
    if (!labelsLoaded) {
      showErrorToast('라벨 정보를 아직 불러오지 못했습니다. 다시 불러온 뒤 저장해주세요.');
      return;
    }

    setSaving(true);
    try {
      await trashRemovedLabels(nextEntries);

      // 이름이 바뀐 라벨을 먼저 추려둔다. 저장된 항목들은 라벨을 "이름"으로 들고
      // 있어서, 이름만 바꾸고 두면 그 항목들의 라벨 칩이 사라진다.
      // 메모·기록 라벨은 한 목록이라 이름 바꾸기도 메모·기록 둘 다에 (기록은 id라 항목은 그대로지만 옛 [이름] 글 형식)
      const entryRenames = diffLabelNames(originalEntryLabelsRef.current, nextEntries);
      const renames = {
        event: diffLabelNames(originalEventLabelsRef.current, eventLabels),
        journal: entryRenames,
        memo: entryRenames,
      };

      const docRef = doc(db, 'users', user.uid, 'settings', 'labels');
      // 일정 라벨은 V3 이름(isForward 등)도 함께 쓴다 - 예전에는 이 저장만 V4 이름으로 써서 V3가 속성을 못 읽었다(19번 U5에서 고침)
      const { payload, memoLabels, journalLabels } = labelsPayload(eventLabels, nextEntries);
      await setDoc(docRef, payload, { merge: true });
      const saved = afterWrite(eventLabels, nextEntries, memoLabels, journalLabels);

      // 상위/하위도 함께 저장한다. id로 들고 있던 것을 지금 이름으로 바꿔 두므로 이름을 고친 것도 따라간다.
      await saveTree(nextParents, saved);
      treeTouchedRef.current = false;

      const renameCount = renames.event.length + entryRenames.length;
      if (renameCount > 0) {
        setRenaming(true);
        try {
          const applied = await applyLabelRenames(
            user.uid,
            groups.map((g) => g.id),
            renames
          );
          const touched = applied.events + applied.journals + applied.memos;
          if (touched > 0) {
            showToast(`✅ 바뀐 라벨 이름을 기존 항목 ${touched}건에 반영했습니다.`);
          }
        } finally {
          setRenaming(false);
        }
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      // alert는 삭제하고 우측 하단 체크 표시로만 남김. 모달은 수동 닫기.
    } catch (e) {
      showErrorToast('라벨 저장 중 오류가 발생했습니다.', e);
    } finally {
      setSaving(false);
    }
  };

  // --- 항목 수 세기 · 빈 라벨 정리 (19번 U10) ---
  /** 상위/하위를 이름으로 (하위 이름 → 상위 이름) */
  const parentNames = () => {
    const nameOf = (id: string) => entryLabels.find((l) => l.id === id)?.name;
    const out: Record<string, string> = {};
    for (const [c, p] of Object.entries(entryParentIds)) {
      const cn = nameOf(c);
      const pn = nameOf(p);
      if (cn && pn) out[cn] = pn;
    }
    return out;
  };
  const handleCountUsage = async () => {
    const user = auth.currentUser;
    if (!user || counting) return;
    setPruneList(null);
    setCounting({ done: 0, total: 1 });
    try {
      const input = await loadEntryLabelUsageInput(user.uid, groups.map((g) => g.id), (done, total) => setCounting({ done, total }));
      setUsage(countEntryLabelUsage(input, entryLabels, parentNames()));
    } catch (e) {
      // 덜 센 채로 '비었다'고 보이면 쓰는 라벨을 지운다 - 아무것도 보이지 않는다
      setUsage(null);
      showErrorToast('항목 수를 세지 못했습니다. 인터넷 연결을 보고 다시 눌러 주세요.', e);
    } finally {
      setCounting(null);
    }
  };
  const emptyCount = usage ? entryLabels.filter((l) => usageTotal(usage[l.name]) === 0).length : 0;
  const handlePrune = async () => {
    if (!pruneList) return;
    const drop = new Set(pruneList.filter((x) => x.checked).map((x) => x.id));
    if (drop.size === 0) return;
    const nextEntries = entryLabels.filter((l) => !drop.has(l.id));
    // 지운 라벨이 상위였거나 하위였던 연결도 뗀다
    const nextParents = Object.fromEntries(Object.entries(entryParentIds).filter(([c, p]) => !drop.has(c) && !drop.has(p)));
    treeTouchedRef.current = true;
    setEntryParentIds(nextParents);
    setPruneList(null);
    await handleSaveAll(nextEntries, nextParents);
    setUsage((u) => {
      if (!u) return u;
      const next = { ...u };
      for (const l of entryLabels) if (drop.has(l.id)) delete next[l.name];
      return next;
    });
    showToast(`🧹 빈 라벨 ${drop.size}개를 지웠습니다. 휴지통에서 되살릴 수 있습니다.`);
  };

  // --- 삭제된(또는 누락된) 라벨 자동 복구 ---
  // 실제 저장된 일정/기록/메모 데이터를 전부 훑어서, 현재 라벨 목록에 없는 라벨 이름을 찾아
  // 기본값으로 다시 등록한다. 찾기만 하고 저장은 사용자가 확인한 뒤에만 진행한다.
  const handleScanMissingLabels = async () => {
    const user = auth.currentUser;
    if (!user) return;

    setScanning(true);
    try {
      const groupIds = groups.map((g) => g.id);
      const result = await scanForMissingLabels(
        user.uid,
        groupIds,
        eventLabels.map((l) => l.name),
        entryLabels.map((l) => l.name),
        entryLabels.map((l) => l.name)
      );
      // 메모·기록은 한 목록 - 두 쪽에서 찾은 이름을 하나로
      const missingEntryNames = [...new Set([...result.missingJournalNames, ...result.missingMemoNames])];

      const totalMissing = result.missingEventNames.length + missingEntryNames.length;

      if (totalMissing === 0) {
        showErrorToast('✅ 검사 완료: 삭제되었거나 누락된 라벨이 없습니다.');
        return;
      }

      const lines: string[] = [];
      if (result.missingEventNames.length > 0) lines.push(`일정: ${result.missingEventNames.join(', ')}`);
      if (missingEntryNames.length > 0) lines.push(`메모·기록: ${missingEntryNames.join(', ')}`);

      const proceed = window.confirm(
        `다음 라벨이 실제 데이터에는 남아있지만 라벨 목록에는 없습니다. 기본값으로 복구할까요?\n\n${lines.join('\n')}\n\n(색상/속성은 나중에 목록에서 직접 조정할 수 있습니다)`
      );
      if (!proceed) return;

      let colorIdx = eventLabels.length;
      const restoredEventLabels = [
        ...eventLabels,
        ...result.missingEventNames.map((name) => ({
          id: `ev_recovered_${Date.now()}_${colorIdx++}`,
          name,
          color: pickRecoveryColor(colorIdx),
          calendar: true,
          skip: false,
          forward: false,
          period: false,
          recur: false,
        })),
      ];

      let jColorIdx = entryLabels.length;
      const restoredEntryLabels: EntryLabel[] = [
        ...entryLabels,
        ...missingEntryNames.map((name) => ({
          id: `j_recovered_${Date.now()}_${jColorIdx++}`,
          name,
          color: pickRecoveryColor(jColorIdx),
          inJournal: false,
        })),
      ];

      setEventLabels(restoredEventLabels);

      // 복구된 목록을 바로 저장
      const docRef = doc(db, 'users', user.uid, 'settings', 'labels');
      const { payload, memoLabels, journalLabels } = labelsPayload(restoredEventLabels, restoredEntryLabels);
      await setDoc(docRef, payload, { merge: true });
      afterWrite(restoredEventLabels, restoredEntryLabels, memoLabels, journalLabels);

      showToast(`✅ ${totalMissing}개의 라벨을 복구하고 저장했습니다.`);
    } catch (e) {
      console.error('라벨 복구 스캔 오류:', e);
      showErrorToast('라벨 복구 중 오류가 발생했습니다.');
    } finally {
      setScanning(false);
    }
  };

  return (
    <PopupFrame
      isOpen={isOpen}
      onClose={onClose}
      width="2xl"
      // Ctrl+S = 클라우드 저장
      onSave={() => { if (!saving && labelsLoaded) void handleSaveAll(); }}
    >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏷️</span>
            <h2 className="text-base font-extrabold text-slate-800">통합 라벨 관리</h2>
          </div>
          <button
            title="닫기"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-black text-lg p-1 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 탭 네비게이션 (일정, 메모·기록) */}
        <div className="flex border-b border-slate-200 bg-slate-100/70 p-1.5 gap-1">
          <button
            onClick={() => setActiveTab('event')}
            className={`flex-1 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'event'
                ? 'bg-white text-blue-700 shadow-xs border border-blue-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>📅</span> 일정 라벨 ({eventLabels.length})
          </button>
          <button
            onClick={() => setActiveTab('entry')}
            data-label-tab="entry"
            className={`flex-1 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'entry'
                ? 'bg-white text-emerald-700 shadow-xs border border-emerald-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>📝</span> 메모·기록 라벨 ({entryLabels.length})
          </button>
        </div>

        {/* 내용 영역 */}
        <div className="p-6 overflow-y-auto overscroll-contain space-y-4 flex-1 min-h-0" data-scroll-lock>
          {/* TAB 1: 일정 라벨 */}
          {activeTab === 'event' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border-l-4 border-blue-500 p-3 rounded-r-xl text-xs text-blue-900 leading-relaxed">
                <strong>💡 일정 라벨 속성 안내</strong>
                <ul className="list-disc list-inside mt-1 space-y-0.5 text-blue-800">
                  <li><strong>달력표시</strong>: 체크한 라벨의 일정만 월간/년간 달력에 나옵니다. 끄면 하루·주간 화면에만 보입니다.</li>
                  <li><strong>이월</strong>: 완료 체크되지 않으면 다음 날로 자동 이월됩니다.</li>
                  <li><strong>기간</strong>: 연속 기간 일정 등록 시 팝업이 지원됩니다.</li>
                  <li><strong>반복</strong>: 매주/매월 반복 일정 등록이 지원됩니다.</li>
                  <li><strong>수업X</strong>: 해당 일정 등록 시 그 날짜의 시간표 과목을 자동으로 비웁니다.</li>
                </ul>
              </div>

              {/* 일정 라벨 목록 (한 줄 배열) */}
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {eventLabels.map((lbl, idx) => {
                  return (
                    <div
                      key={lbl.id || `ev_key_${idx}`}
                      className="flex items-center justify-between gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl hover:border-slate-300 transition-all text-xs"
                    >
                      {/* 좌측: 이동 / 이름 / 색상 드롭다운 */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="flex flex-col gap-0.5">
                          <button
                            disabled={idx === 0}
                            onClick={() => handleMoveEventLabel(idx, 'up')}
                            className={`text-xs px-0.5 rounded leading-none ${idx === 0 ? 'text-slate-200' : 'text-slate-400 hover:text-slate-700 cursor-pointer'}`}
                          >
                            ▲
                          </button>
                          <button
                            disabled={idx === eventLabels.length - 1}
                            onClick={() => handleMoveEventLabel(idx, 'down')}
                            className={`text-xs px-0.5 rounded leading-none ${idx === eventLabels.length - 1 ? 'text-slate-200' : 'text-slate-400 hover:text-slate-700 cursor-pointer'}`}
                          >
                            ▼
                          </button>
                        </div>
                        <input
                          type="text"
                          value={lbl.name}
                          onChange={(e) => {
                            const updated = [...eventLabels];
                            updated[idx] = { ...updated[idx], name: e.target.value };
                            setEventLabels(updated);
                          }}
                          className="px-2 py-1 bg-white border border-slate-200 rounded text-xs font-bold text-slate-800 w-24 focus:outline-none focus:border-blue-500"
                        />
                        <ColorPickerDropdown
                          color={lbl.color}
                          onChange={(newColor) => {
                            const updated = [...eventLabels];
                            updated[idx] = { ...updated[idx], color: newColor };
                            setEventLabels(updated);
                          }}
                        />
                      </div>

                      {/* 중간: 5대 속성 (달력 -> 이월 -> 기간 -> 반복 -> 수업X) */}
                      <div className="flex items-center gap-2.5 text-xs text-slate-600 flex-nowrap shrink-0">
                        <label className="flex items-center gap-1 cursor-pointer select-none hover:text-slate-900" title="월간/년간 달력에 표시">
                          <input
                            type="checkbox"
                            checked={lbl.calendar !== false}
                            onChange={(e) => {
                              const updated = [...eventLabels];
                              updated[idx] = { ...updated[idx], calendar: e.target.checked };
                              setEventLabels(updated);
                            }}
                            className="rounded text-blue-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                          />
                          <span className="font-semibold text-xs">달력</span>
                        </label>

                        <label className="flex items-center gap-1 cursor-pointer select-none hover:text-slate-900" title="미완료 시 다음 날로 자동 이월">
                          <input
                            type="checkbox"
                            checked={!!lbl.forward}
                            onChange={(e) => {
                              const updated = [...eventLabels];
                              updated[idx] = { ...updated[idx], forward: e.target.checked };
                              setEventLabels(updated);
                            }}
                            className="rounded text-emerald-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                          />
                          <span className="font-semibold text-xs">이월</span>
                        </label>

                        <label className="flex items-center gap-1 cursor-pointer select-none hover:text-slate-900" title="연속 기간 등록">
                          <input
                            type="checkbox"
                            checked={!!lbl.period}
                            onChange={(e) => {
                              const updated = [...eventLabels];
                              updated[idx] = { ...updated[idx], period: e.target.checked };
                              setEventLabels(updated);
                            }}
                            className="rounded text-indigo-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                          />
                          <span className="font-semibold text-xs">기간</span>
                        </label>

                        <label className="flex items-center gap-1 cursor-pointer select-none hover:text-slate-900" title="매주/매월 반복">
                          <input
                            type="checkbox"
                            checked={!!lbl.recur}
                            onChange={(e) => {
                              const updated = [...eventLabels];
                              updated[idx] = { ...updated[idx], recur: e.target.checked };
                              setEventLabels(updated);
                            }}
                            className="rounded text-purple-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                          />
                          <span className="font-semibold text-xs">반복</span>
                        </label>

                        <label className="flex items-center gap-1 cursor-pointer select-none hover:text-slate-900" title="지정 날짜의 수업 과목 비움">
                          <input
                            type="checkbox"
                            checked={!!lbl.skip}
                            onChange={(e) => {
                              const updated = [...eventLabels];
                              updated[idx] = { ...updated[idx], skip: e.target.checked };
                              setEventLabels(updated);
                            }}
                            className="rounded text-amber-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                          />
                          <span className="font-semibold text-xs">수업X</span>
                        </label>
                      </div>

                      {/* 우측: 삭제 버튼 */}
                      <button
                        type="button"
                        onClick={() => handleDeleteEventLabel(lbl.id)}
                        className="text-slate-400 hover:text-red-500 font-black px-1.5 py-0.5 rounded transition-colors cursor-pointer shrink-0"
                        title="라벨 삭제"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* 새 일정 라벨 등록 박스 */}
              <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl space-y-2.5">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newEventName}
                    onChange={(e) => setNewEventName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddEventLabel()}
                    placeholder="새 일정 라벨 이름..."
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500"
                  />
                  <ColorPickerDropdown
                    color={newEventColor}
                    onChange={setNewEventColor}
                  />
                  <button
                    onClick={handleAddEventLabel}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer"
                  >
                    추가
                  </button>
                </div>

                <div className="flex items-center gap-4 text-xs font-medium text-slate-600 pt-0.5 flex-wrap sm:flex-nowrap">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900">
                    <input
                      type="checkbox"
                      checked={newEventCalendar}
                      onChange={(e) => setNewEventCalendar(e.target.checked)}
                      className="rounded text-blue-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                    />
                    <span className="font-semibold text-xs">달력</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900">
                    <input
                      type="checkbox"
                      checked={newEventForward}
                      onChange={(e) => setNewEventForward(e.target.checked)}
                      className="rounded text-emerald-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                    />
                    <span className="font-semibold text-xs">이월</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900">
                    <input
                      type="checkbox"
                      checked={newEventPeriod}
                      onChange={(e) => setNewEventPeriod(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                    />
                    <span className="font-semibold text-xs">기간</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900">
                    <input
                      type="checkbox"
                      checked={newEventRecur}
                      onChange={(e) => setNewEventRecur(e.target.checked)}
                      className="rounded text-purple-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                    />
                    <span className="font-semibold text-xs">반복</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900">
                    <input
                      type="checkbox"
                      checked={newEventSkip}
                      onChange={(e) => setNewEventSkip(e.target.checked)}
                      className="rounded text-amber-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                    />
                    <span className="font-semibold text-xs">수업X</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 메모·기록 라벨 (한 목록, 19번 U5) */}
          {activeTab === 'entry' && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border-l-4 border-emerald-500 p-3 rounded-r-xl text-xs text-emerald-900 leading-relaxed">
                <strong>💡 메모·기록 라벨 안내</strong>
                <p className="mt-0.5 text-emerald-800">
                  메모와 기록에 함께 쓰는 라벨입니다. 쓰는 칸과 메모 화면·하루 화면의 거르개가 이 목록을 봅니다. 순서를 위/아래로, 상위 라벨 밑에 둘 수 있습니다.
                </p>
              </div>
              {(labelTree.conflicts || []).length > 0 && (
                <p data-label-tree-conflicts className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  메모와 기록에서 상위가 달랐던 라벨: <b>{labelTree.conflicts!.join(', ')}</b> - 기록 쪽 상위로 합쳤습니다. 다르면 아래에서 고치고 저장하세요.
                </p>
              )}

              {/* 메모·기록 라벨 목록 - 상위 밑에 하위를 들여 쓴다 */}
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                <TreeLabelRows
                  labels={entryLabels}
                  setLabels={setEntryLabels}
                  parentIds={entryParentIds}
                  setParentIds={(next) => {
                    treeTouchedRef.current = true;
                    setEntryParentIds(next);
                  }}
                  onDelete={handleDeleteEntryLabel}
                  noun="메모·기록"
                  focusClass="focus:border-emerald-500"
                  usage={usage}
                />
              </div>

              {/* 항목 수 세기 · 빈 라벨 정리 (19번 U10) - 빈 라벨은 저절로 지우지 않는다 */}
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <button
                  type="button"
                  data-label-count
                  onClick={handleCountUsage}
                  disabled={!!counting || !labelsLoaded}
                  title="메모·기록(개인 + 내 그룹)과 휴지통을 훑어 라벨마다 붙은 항목 수를 셉니다"
                  className="px-3 py-1.5 bg-white hover:bg-slate-50 disabled:opacity-50 border border-slate-300 rounded-lg font-bold text-slate-600"
                >
                  {counting ? `세는 중… ${counting.done}/${counting.total}` : usage ? '🔢 다시 세기' : '🔢 항목 수 세기'}
                </button>
                {usage && (
                  <button
                    type="button"
                    data-label-prune
                    disabled={emptyCount === 0}
                    onClick={() => setPruneList(emptyEntryLabels(entryLabels, usage, parentNames()))}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 border border-rose-200 rounded-lg font-bold text-rose-700"
                  >
                    🧹 빈 라벨 정리 ({emptyCount}개)
                  </button>
                )}
              </div>
              {pruneList && (
                <div data-label-prune-list className="border border-rose-200 bg-rose-50/50 rounded-xl p-3 space-y-2 text-xs">
                  <p className="text-slate-600">
                    메모·기록·휴지통 어디에도 붙지 않은 라벨입니다. 남길 것은 체크를 빼세요. 하위가 있는 상위·맨 위(기본) 라벨은 처음부터 빼 두었습니다.
                    지운 라벨은 휴지통으로 가고, 저장하지 않은 고침도 함께 저장합니다.
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {pruneList.map((x) => (
                      <label key={x.id} className="flex items-center gap-1.5 font-bold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          data-label-prune-item={x.name}
                          checked={x.checked}
                          onChange={(e) => setPruneList((list) => list && list.map((y) => (y.id === x.id ? { ...y, checked: e.target.checked } : y)))}
                        />
                        {x.name}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setPruneList(null)} className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-bold text-slate-600">
                      그만두기
                    </button>
                    <button
                      type="button"
                      data-label-prune-confirm
                      disabled={saving || !pruneList.some((x) => x.checked)}
                      onClick={handlePrune}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg font-bold"
                    >
                      고른 {pruneList.filter((x) => x.checked).length}개 지우기
                    </button>
                  </div>
                </div>
              )}

              {/* 새 메모·기록 라벨 추가 */}
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 p-3 rounded-xl">
                <input
                  type="text"
                  value={newEntryName}
                  onChange={(e) => setNewEntryName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddEntryLabel()}
                  placeholder="새 메모·기록 라벨 이름..."
                  aria-label="새 메모·기록 라벨 이름"
                  className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none focus:border-emerald-500"
                />
                <ColorPickerDropdown
                  color={newEntryColor}
                  onChange={setNewEntryColor}
                />
                <NewLabelParentSelect
                  labels={entryLabels}
                  parentIds={entryParentIds}
                  value={newEntryParent}
                  onChange={setNewEntryParent}
                  noun="메모·기록"
                />
                <button
                  onClick={handleAddEntryLabel}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer"
                >
                  추가
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 푸터 버튼 */}
        <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-slate-100 bg-slate-50">
          {loadError ? (
            <div className="mr-auto flex items-center gap-2 text-rose-600 text-xs font-bold">
              <span>⚠️ 라벨 정보를 불러오지 못했습니다. 지금 저장하면 안 됩니다.</span>
              <button
                type="button"
                onClick={fetchLabels}
                className="px-2.5 py-1 bg-rose-100 hover:bg-rose-200 text-rose-700 rounded-lg text-xs font-bold"
              >
                다시 불러오기
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleScanMissingLabels}
              disabled={scanning || !labelsLoaded}
              title="저장된 일정/기록/메모를 검사해서 삭제된 라벨을 다시 등록합니다"
              className="mr-auto px-3 py-2 bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-600 border border-slate-300 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
            >
              <span>🔍</span> {scanning ? '검사 중...' : '삭제된 라벨 복구'}
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all"
          >
            닫기
          </button>
          {saveSuccess && <span className="text-emerald-500 text-xs font-bold mr-2">✅ 저장되었습니다</span>}
          <button
            onClick={() => void handleSaveAll()}
            disabled={saving || !labelsLoaded}
            title={!labelsLoaded ? '라벨 정보를 불러오는 중에는 저장할 수 없습니다' : undefined}
            className="px-5 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            <span>💾</span> {renaming ? '이름 반영 중...' : saving ? '저장 중...' : '클라우드 저장'}
          </button>
        </div>
      </PopupFrame>
  );
}