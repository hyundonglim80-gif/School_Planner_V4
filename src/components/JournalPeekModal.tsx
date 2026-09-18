// src/components/JournalPeekModal.tsx
//
// 주간·월간·년간에서 날짜 옆의 기록 아이콘을 눌렀을 때 그날 기록을 보여 주는 창.
//
// 달력 화면들은 기록의 '개수'만 들고 있다(달력마다 기록 본문까지 실어 나르면
// 화면이 무거워진다). 그래서 내용은 여기서 그날 문서 하나만 읽어 온다.
// 고치고 싶으면 항목을 눌러 기록·메모 화면과 같은 편집 배너를 연다.
import { useEffect, useState } from 'react';
import { doc, getDoc, getDocFromServer } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { useLabels } from '../hooks/useLabels';
import { formatDisplayDate } from '../lib/dateUtils';
import { isLongEntry, previewLine } from '../lib/entryCollapse';
import ModalShell from './ModalShell';

// 기록 화면(DayJournal)이 쓰는 것과 같은 색 표다. 두 곳이 다르면 같은 라벨이
// 화면마다 다른 색으로 보인다.
const JOURNAL_LABEL_COLOR: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  green: 'bg-green-50 text-green-700 border-green-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  orange: 'bg-orange-50 text-orange-700 border-orange-200',
  yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
  gray: 'bg-slate-50 text-slate-700 border-slate-200',
};

interface PeekEntry {
  id: string;
  content: string;
  labelIds?: string[];
  label?: string;
  attachments?: unknown[];
  imageUrl?: string;
}

export default function JournalPeekModal({
  dateStr,
  fId,
  onClose,
}: {
  dateStr: string;
  fId?: string | null;
  onClose: () => void;
}) {
  const { openEntryEditor } = useAppStore();
  const { journalLabels } = useLabels();
  const [entries, setEntries] = useState<PeekEntry[] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !dateStr) return;
    const path = !fId || fId === 'personal' ? `users/${uid}/journals` : `groups/${fId}/journals`;
    const ref = doc(db, path, dateStr);
    let alive = true;

    const apply = (data: any) => {
      const list: PeekEntry[] = (data?.entries || [])
        .map((j: any, idx: number) => ({
          id: j.id || `jr_${idx}`,
          content: j.content || '',
          labelIds: j.labelIds || [],
          label: j.label,
          attachments: j.attachments || [],
          imageUrl: j.imageUrl || '',
        }))
        .filter(
          (j: PeekEntry) =>
            j.content.trim().length > 0 || !!j.imageUrl || (j.attachments || []).length > 0
        );
      if (alive) setEntries(list);
    };

    getDoc(ref)
      .then((snap) => {
        if (snap.exists()) apply(snap.data());
        // '문서 없음'은 기기 캐시가 비었을 때 거짓일 수 있다. 한 번은 서버에 확인한다.
        else return getDocFromServer(ref).then((s) => apply(s.exists() ? s.data() : null));
      })
      .catch(() => { if (alive) setEntries([]); });

    return () => { alive = false; };
  }, [dateStr, fId]);

  const d = formatDisplayDate(dateStr);

  return (
    <ModalShell
      isOpen
      onClose={onClose}
      width="lg"
      title={
        <span className="flex items-center gap-2">
          <span>📝</span>
          {d.year}년 {d.month}월 {d.day}일 기록
          {entries && <span className="text-xs font-bold text-slate-400">{entries.length}건</span>}
        </span>
      }
    >
      <div className="flex flex-col gap-2">
        {entries === null && (
          <p className="text-xs text-slate-400 py-6 text-center">불러오는 중...</p>
        )}
        {entries?.length === 0 && (
          <p className="text-xs text-slate-400 py-6 text-center">이 날짜에 기록이 없습니다.</p>
        )}
        {entries?.map((j) => {
          const names = (j.label ? j.label.split(',') : j.labelIds || []).filter(Boolean);
          const long = isLongEntry(j.content);
          const open = expanded[j.id];
          return (
            <div
              key={j.id}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1 min-w-0">
                  {names.map((key) => {
                    // 기록 화면과 같은 방식으로 푼다. 라벨을 id로만 들고 있는 항목도
                    // 있어서 id와 이름을 둘 다 맞춰 본다. 못 찾으면 칩을 숨긴다.
                    const found = journalLabels.find(
                      (l) => l.id === String(key) || l.name === String(key)
                    );
                    if (!found) return null;
                    return (
                      <span
                        key={found.name}
                        className={`text-2xs font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${
                          JOURNAL_LABEL_COLOR[found.color || 'gray'] || JOURNAL_LABEL_COLOR.gray
                        }`}
                      >
                        {found.name}
                      </span>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {long && (
                    <button
                      onClick={() => setExpanded((p) => ({ ...p, [j.id]: !p[j.id] }))}
                      title={open ? '접기' : '펼치기'}
                      className="w-6 h-6 rounded text-slate-400 hover:bg-slate-200 text-xs font-bold"
                    >
                      {open ? '▲' : '▼'}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      openEntryEditor({ kind: 'journal', dateStr, id: j.id, fId: fId || 'personal' });
                      onClose();
                    }}
                    className="text-2xs font-bold text-primary hover:bg-blue-50 px-2 py-1 rounded"
                  >
                    수정
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-700 whitespace-pre-wrap break-words mt-1 leading-relaxed">
                {long && !open ? previewLine(j.content) : j.content}
              </p>
              {(j.attachments || []).length > 0 && (
                <p className="text-2xs text-slate-400 mt-1">📎 첨부 {(j.attachments || []).length}개</p>
              )}
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
}

export function JournalPeekHost() {
  const { journalPeek, closeJournalPeek } = useAppStore();
  if (!journalPeek) return null;
  return (
    <JournalPeekModal
      key={`${journalPeek.fId || 'personal'}-${journalPeek.dateStr}`}
      dateStr={journalPeek.dateStr}
      fId={journalPeek.fId}
      onClose={closeJournalPeek}
    />
  );
}
