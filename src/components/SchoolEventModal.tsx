// src/components/SchoolEventModal.tsx
//
// 날짜 칸의 학사일정 이름(SchoolEventName·하루 화면 '📚 학사')을 눌렀을 때 그날 학사일정을 보여 주는 창
// (나이스, docs/ROADMAP.md 4-5). 학사일정은 표시만 하므로(V3와 함께 쓰는 일정 문서에 쓰지 않는다),
// 필요한 것만 하나씩 담는다.
// - 'D-Day로': D-Day 목록에 곧바로 더한다. 이미 같은 이름·날짜가 있으면 'D-Day에 있음'.
// - '일정으로 담기': 하루 화면과 같은 새 일정 칸을 이름을 적어 둔 채 연다 - 라벨·알림을 골라 저장한다.
import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDDay, calculateDDay } from '../hooks/useDDay';
import { shortDateLabel } from '../lib/notices';
import type { NeisScheduleItem } from '../lib/neis';
import ModalShell, { ModalCloseButton } from './ModalShell';

export default function SchoolEventModal({
  dateStr,
  items,
  onClose,
}: {
  dateStr: string;
  items: NeisScheduleItem[];
  onClose: () => void;
}) {
  const { selectedGroupId, openEntryPanel } = useAppStore();
  const { dDayList, addDDay } = useDDay();
  const [adding, setAdding] = useState<string | null>(null);
  const dday = calculateDDay(dateStr);

  const inDDay = (it: NeisScheduleItem) => dDayList.some((d) => d.date === it.date && d.title.trim() === it.name);

  const toDDay = async (it: NeisScheduleItem) => {
    if (adding) return;
    setAdding(it.name);
    try {
      await addDDay(it.name, it.date);
    } finally {
      setAdding(null);
    }
  };

  const toEvent = (it: NeisScheduleItem) => {
    // 쓰는 칸이 오른쪽 줄에 서므로 이 창은 닫는다 (같은 날을 다시 누르면 또 열린다)
    onClose();
    openEntryPanel({ kind: 'event', groupId: selectedGroupId, dateStr: it.date, draftText: it.name });
  };

  return (
    <ModalShell
      isOpen
      onClose={onClose}
      width="sm"
      title={
        <span>
          📚 학사일정 <span className="text-sm font-bold text-slate-500">· {shortDateLabel(dateStr)}</span>
        </span>
      }
      footer={<ModalCloseButton onClose={onClose} />}
    >
      <div className="space-y-2.5" data-school-event-modal>
        {items.map((it) => {
          const has = inDDay(it);
          return (
            <div key={`${it.date}|${it.name}`} className="p-3 rounded-xl border border-teal-100 bg-teal-50/50 space-y-2">
              <div className="min-w-0">
                <div className="text-sm font-bold text-teal-800 break-words">{it.name}</div>
                {(it.grades.length > 0 || it.content) && (
                  <div className="mt-0.5 text-xs text-slate-500 break-words">
                    {it.grades.length > 0 && <span>{it.grades.join('·')}학년</span>}
                    {it.grades.length > 0 && it.content && <span> · </span>}
                    {it.content}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  data-school-event-dday
                  onClick={() => toDDay(it)}
                  disabled={has || !!adding}
                  title={has ? '이미 D-Day 목록에 있습니다' : `D-Day 목록에 더합니다 (${dday.text})`}
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-colors bg-white border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-60 disabled:cursor-default disabled:hover:bg-white"
                >
                  {has ? '✓ D-Day에 있음' : adding === it.name ? '더하는 중…' : `⏳ D-Day로 (${dday.text})`}
                </button>
                <button
                  type="button"
                  data-school-event-to-event
                  onClick={() => toEvent(it)}
                  title="이 날짜의 새 일정 칸을 이름을 적어 둔 채 엽니다 - 라벨을 골라 저장하세요"
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-colors bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  📅 일정으로 담기
                </button>
              </div>
            </div>
          );
        })}
        <p className="text-xs text-slate-400 leading-relaxed">
          학사일정은 나이스에서 받아 보여 주기만 합니다. 담은 D-Day·일정은 내 것이라 학교가 학사일정을 바꿔도 따라 바뀌지 않습니다.
        </p>
      </div>
    </ModalShell>
  );
}

export function SchoolEventPeekHost() {
  const { schoolEventPeek, closeSchoolEventPeek } = useAppStore();
  if (!schoolEventPeek) return null;
  return (
    <SchoolEventModal
      key={schoolEventPeek.dateStr}
      dateStr={schoolEventPeek.dateStr}
      items={schoolEventPeek.items}
      onClose={closeSchoolEventPeek}
    />
  );
}
