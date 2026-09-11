//src/components/LabelModal.tsx
import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { DEFAULT_EVENT_LABELS, type EventLabel } from '../hooks/useLabels';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

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

interface LabelModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'event' | 'journal' | 'memo';
}

export default function LabelModal({ isOpen, onClose, initialTab = 'event' }: LabelModalProps) {
  useBodyScrollLock(isOpen);
  const [activeTab, setActiveTab] = useState<'event' | 'journal' | 'memo'>(initialTab);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
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

  // 메모 라벨 상태
  const [memoLabels, setMemoLabels] = useState<MemoLabel[]>([]);
  const [newMemoName, setNewMemoName] = useState('');
  const [newMemoColor, setNewMemoColor] = useState('green');

  // 기록 라벨 상태
  const [journalLabels, setJournalLabels] = useState<JournalLabel[]>([]);
  const [newJournalName, setNewJournalName] = useState('');
  const [newJournalColor, setNewJournalColor] = useState('green');

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const fetchLabels = async () => {
      const user = auth.currentUser;
      if (!user) return;

      try {
        const docRef = doc(db, 'users', user.uid, 'settings', 'labels');
        const snap = await getDoc(docRef);

        if (snap.exists()) {
          const data = snap.data();
          const rawEvents = data.eventLabels || data.labels || DEFAULT_EVENT_LABELS;
          setEventLabels(rawEvents.map((l: any, i: number) => ({
            id: l.id || `ev_${i}_${l.name || ''}`,
            name: l.name || '',
            color: l.color || 'blue',
            calendar: l.calendar !== false,
            skip: !!l.skip,
            forward: !!(l.forward || l.isForward),
            period: !!l.period,
            recur: !!l.recur,
          })));

          const rawMemos = data.memoLabels || DEFAULT_MEMO_LABELS;
          setMemoLabels(rawMemos.map((l: any, i: number) => ({
            id: (typeof l === 'object' && l.id) ? l.id : `memo_${i}_${typeof l === 'string' ? l : l.name || ''}`,
            name: typeof l === 'string' ? l : (l.name || ''),
            color: (typeof l === 'object' && l.color) ? l.color : 'green',
          })));

          const rawJournals = data.journalLabels || DEFAULT_JOURNAL_LABELS;
          setJournalLabels(rawJournals.map((l: any, i: number) => ({
            id: l.id || `j_${i}_${l.name || ''}`,
            name: l.name || '',
            color: l.color || 'green',
          })));
        } else {
          setEventLabels(DEFAULT_EVENT_LABELS);
          setMemoLabels(DEFAULT_MEMO_LABELS);
          setJournalLabels(DEFAULT_JOURNAL_LABELS);
        }
      } catch (e) {
        console.error('라벨 불러오기 오류:', e);
        setEventLabels(DEFAULT_EVENT_LABELS);
        setMemoLabels(DEFAULT_MEMO_LABELS);
        setJournalLabels(DEFAULT_JOURNAL_LABELS);
      }
    };

    fetchLabels();
  }, [isOpen]);

  if (!isOpen) return null;

  // --- 일정 라벨 핸들러 ---
  const handleAddEventLabel = () => {
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
    setEventLabels([...eventLabels, newLbl]);
    setNewEventName('');
    setNewEventPeriod(false);
    setNewEventRecur(false);
  };

  const handleDeleteEventLabel = (id: string) => {
    setEventLabels(eventLabels.filter((l) => l.id !== id));
  };

  // --- 메모 라벨 핸들러 ---
  const handleAddMemoLabel = () => {
    if (!newMemoName.trim()) return;
    const newLbl: MemoLabel = {
      id: `memo_${Date.now()}`,
      name: newMemoName.trim(),
      color: newMemoColor,
    };
    setMemoLabels([...memoLabels, newLbl]);
    setNewMemoName('');
  };

  const handleDeleteMemoLabel = (id: string) => {
    setMemoLabels(memoLabels.filter((l) => l.id !== id));
  };

  const handleMoveMemoLabel = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= memoLabels.length) return;
    const updated = [...memoLabels];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setMemoLabels(updated);
  };

  // --- 기록 라벨 핸들러 ---
  const handleAddJournalLabel = () => {
    if (!newJournalName.trim()) return;
    const newLbl: JournalLabel = {
      id: `j_${Date.now()}`,
      name: newJournalName.trim(),
      color: newJournalColor,
    };
    setJournalLabels([...journalLabels, newLbl]);
    setNewJournalName('');
  };

  const handleDeleteJournalLabel = (id: string) => {
    setJournalLabels(journalLabels.filter((l) => l.id !== id));
  };

  // --- 전체 라벨 저장 ---
  const handleSaveAll = async () => {
    const user = auth.currentUser;
    if (!user) return;

    setSaving(true);
    try {
      const docRef = doc(db, 'users', user.uid, 'settings', 'labels');
      const payload = {
        eventLabels,
        memoLabels,
        journalLabels,
        labels: eventLabels, // V3 호환성
        updatedAt: Date.now(),
      };

      await setDoc(docRef, payload, { merge: true });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      // alert는 삭제하고 우측 하단 체크 표시로만 남김. 모달은 수동 닫기.
    } catch (e) {
      console.error('라벨 저장 오류:', e);
      alert('라벨 저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in backdrop-blur-xs">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏷️</span>
            <h2 className="text-base font-extrabold text-slate-800">통합 라벨 관리</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-black text-lg p-1 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 탭 네비게이션 (일정, 기록, 메모) */}
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
            onClick={() => setActiveTab('journal')}
            className={`flex-1 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'journal'
                ? 'bg-white text-amber-700 shadow-xs border border-amber-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>📔</span> 기록(일지) 라벨 ({journalLabels.length})
          </button>
          <button
            onClick={() => setActiveTab('memo')}
            className={`flex-1 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'memo'
                ? 'bg-white text-emerald-700 shadow-xs border border-emerald-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>📝</span> 메모 라벨 ({memoLabels.length})
          </button>
        </div>

        {/* 내용 영역 */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* TAB 1: 일정 라벨 */}
          {activeTab === 'event' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border-l-4 border-blue-500 p-3 rounded-r-xl text-xs text-blue-900 leading-relaxed">
                <strong>💡 일정 라벨 속성 안내</strong>
                <ul className="list-disc list-inside mt-1 space-y-0.5 text-blue-800">
                  <li><strong>달력표시</strong>: 체크 시 월간/년간 캘린더 화면에 해당 일정이 강조 표시됩니다.</li>
                  <li><strong>수업X</strong>: 해당 일정 등록 시 그 날짜의 시간표 과목을 자동으로 비웁니다.</li>
                  <li><strong>이월</strong>: 완료 체크되지 않으면 다음 날로 자동 이월됩니다.</li>
                  <li><strong>기간</strong>: 연속 기간 일정 등록 시 팝업이 지원됩니다.</li>
                  <li><strong>반복</strong>: 매주/매월 반복 일정 등록이 지원됩니다.</li>
                </ul>
              </div>

              {/* 일정 라벨 목록 */}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {eventLabels.map((lbl, idx) => {
                  const style = COLOR_PALETTE[lbl.color] || COLOR_PALETTE.blue;
                  return (
                    <div
                      key={lbl.id || `ev_key_${idx}`}
                      className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl hover:border-slate-300 transition-all text-xs gap-2 flex-wrap"
                    >
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <span
                          className="px-2.5 py-1 rounded-md font-bold text-xs shadow-2xs border"
                          style={{ backgroundColor: style.bg, color: style.text, borderColor: style.border }}
                        >
                          {lbl.name}
                        </span>
                      </div>

                      {/* 5대 속성 체크박스 (달력, 수업X, 이월, 기간, 반복) */}
                      <div className="flex items-center gap-3 text-[16.5px] text-slate-600 flex-wrap">
                        <label className="flex items-center gap-1 cursor-pointer" title="월간/년간 달력에 표시">
                          <input
                            type="checkbox"
                            checked={lbl.calendar !== false}
                            onChange={(e) => {
                              const updated = [...eventLabels];
                              updated[idx].calendar = e.target.checked;
                              setEventLabels(updated);
                            }}
                            className="rounded text-blue-600 focus:ring-0 w-3.5 h-3.5"
                          />
                          <span>달력</span>
                        </label>

                        <label className="flex items-center gap-1 cursor-pointer" title="지정 날짜의 수업 과목 비움">
                          <input
                            type="checkbox"
                            checked={!!lbl.skip}
                            onChange={(e) => {
                              const updated = [...eventLabels];
                              updated[idx].skip = e.target.checked;
                              setEventLabels(updated);
                            }}
                            className="rounded text-amber-600 focus:ring-0 w-3.5 h-3.5"
                          />
                          <span>수업X</span>
                        </label>

                        <label className="flex items-center gap-1 cursor-pointer" title="미완료 시 다음 날로 자동 이월">
                          <input
                            type="checkbox"
                            checked={!!lbl.forward}
                            onChange={(e) => {
                              const updated = [...eventLabels];
                              updated[idx].forward = e.target.checked;
                              setEventLabels(updated);
                            }}
                            className="rounded text-emerald-600 focus:ring-0 w-3.5 h-3.5"
                          />
                          <span>이월</span>
                        </label>

                        <label className="flex items-center gap-1 cursor-pointer" title="연속 기간 등록">
                          <input
                            type="checkbox"
                            checked={!!lbl.period}
                            onChange={(e) => {
                              const updated = [...eventLabels];
                              updated[idx].period = e.target.checked;
                              setEventLabels(updated);
                            }}
                            className="rounded text-indigo-600 focus:ring-0 w-3.5 h-3.5"
                          />
                          <span>기간</span>
                        </label>

                        <label className="flex items-center gap-1 cursor-pointer" title="매주/매월 반복">
                          <input
                            type="checkbox"
                            checked={!!lbl.recur}
                            onChange={(e) => {
                              const updated = [...eventLabels];
                              updated[idx].recur = e.target.checked;
                              setEventLabels(updated);
                            }}
                            className="rounded text-purple-600 focus:ring-0 w-3.5 h-3.5"
                          />
                          <span>반복</span>
                        </label>
                      </div>

                      <button
                        onClick={() => handleDeleteEventLabel(lbl.id)}
                        className="text-slate-400 hover:text-red-500 font-black px-1.5 py-0.5 rounded transition-colors ml-auto"
                        title="라벨 삭제"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* 새 일정 라벨 등록 박스 */}
              <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newEventName}
                    onChange={(e) => setNewEventName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddEventLabel()}
                    placeholder="새 일정 라벨 이름..."
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500"
                  />
                  <select
                    value={newEventColor}
                    onChange={(e) => setNewEventColor(e.target.value)}
                    className="px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none"
                  >
                    {Object.entries(COLOR_PALETTE).map(([key, val]) => (
                      <option key={key} value={key}>
                        {val.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleAddEventLabel}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                  >
                    추가
                  </button>
                </div>

                <div className="flex flex-wrap gap-4 text-xs font-medium text-slate-600 pt-1">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEventCalendar}
                      onChange={(e) => setNewEventCalendar(e.target.checked)}
                      className="rounded text-blue-600 focus:ring-0"
                    />
                    <span>달력</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEventSkip}
                      onChange={(e) => setNewEventSkip(e.target.checked)}
                      className="rounded text-blue-600 focus:ring-0"
                    />
                    <span>수업X</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEventForward}
                      onChange={(e) => setNewEventForward(e.target.checked)}
                      className="rounded text-blue-600 focus:ring-0"
                    />
                    <span>이월</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEventPeriod}
                      onChange={(e) => setNewEventPeriod(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-0"
                    />
                    <span>기간</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEventRecur}
                      onChange={(e) => setNewEventRecur(e.target.checked)}
                      className="rounded text-purple-600 focus:ring-0"
                    />
                    <span>반복</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 기록(일지) 라벨 */}
          {activeTab === 'journal' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border-l-4 border-amber-500 p-3 rounded-r-xl text-xs text-amber-900 leading-relaxed">
                <strong>💡 기록(일지) 라벨 안내</strong>
                <p className="mt-0.5 text-amber-800">
                  하루 뷰의 일지/상담/업무 기록에 붙이는 분류 라벨입니다.
                </p>
              </div>

              {/* 기록 라벨 목록 */}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {journalLabels.map((lbl, idx) => {
                  const style = COLOR_PALETTE[lbl.color] || COLOR_PALETTE.green;
                  return (
                    <div
                      key={lbl.id || `j_key_${idx}`}
                      className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl hover:border-slate-300 transition-all text-xs"
                    >
                      <span
                        className="px-2.5 py-1 rounded-md font-bold text-xs shadow-2xs border"
                        style={{ backgroundColor: style.bg, color: style.text, borderColor: style.border }}
                      >
                        {lbl.name}
                      </span>
                      <button
                        onClick={() => handleDeleteJournalLabel(lbl.id)}
                        className="text-slate-400 hover:text-red-500 font-black px-1.5 py-0.5 rounded transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* 새 기록 라벨 추가 */}
              <div className="flex gap-2 bg-slate-50 border border-slate-200 p-3 rounded-xl">
                <input
                  type="text"
                  value={newJournalName}
                  onChange={(e) => setNewJournalName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddJournalLabel()}
                  placeholder="새 기록 라벨 이름..."
                  className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none focus:border-amber-500"
                />
                <select
                  value={newJournalColor}
                  onChange={(e) => setNewJournalColor(e.target.value)}
                  className="px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none"
                >
                  {Object.entries(COLOR_PALETTE).map(([key, val]) => (
                    <option key={key} value={key}>
                      {val.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAddJournalLabel}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                >
                  추가
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: 메모 라벨 */}
          {activeTab === 'memo' && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border-l-4 border-emerald-500 p-3 rounded-r-xl text-xs text-emerald-900 leading-relaxed">
                <strong>💡 메모 라벨(태그) 안내</strong>
                <p className="mt-0.5 text-emerald-800">
                  메모 화면 상단의 필터 칩과 메모 작성 시 붙일 수 있는 태그입니다. 순서를 위/아래로 이동할 수 있습니다.
                </p>
              </div>

              {/* 메모 라벨 목록 */}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {memoLabels.map((lbl, idx) => {
                  const style = COLOR_PALETTE[lbl.color] || COLOR_PALETTE.green;
                  return (
                    <div
                      key={lbl.id || `memo_key_${idx}`}
                      className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl hover:border-slate-300 transition-all text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col gap-0.5">
                          <button
                            disabled={idx === 0}
                            onClick={() => handleMoveMemoLabel(idx, 'up')}
                            className={`text-[15px] px-1 rounded ${idx === 0 ? 'text-slate-200' : 'text-slate-400 hover:text-slate-700'}`}
                          >
                            ▲
                          </button>
                          <button
                            disabled={idx === memoLabels.length - 1}
                            onClick={() => handleMoveMemoLabel(idx, 'down')}
                            className={`text-[15px] px-1 rounded ${idx === memoLabels.length - 1 ? 'text-slate-200' : 'text-slate-400 hover:text-slate-700'}`}
                          >
                            ▼
                          </button>
                        </div>
                        <input
                          type="text"
                          value={lbl.name}
                          onChange={(e) => {
                            const updated = [...memoLabels];
                            updated[idx].name = e.target.value;
                            setMemoLabels(updated);
                          }}
                          className="px-2 py-1 bg-white border border-slate-200 rounded text-xs font-bold text-slate-800 w-32 focus:outline-none"
                        />
                        <select
                          value={lbl.color}
                          onChange={(e) => {
                            const updated = [...memoLabels];
                            updated[idx].color = e.target.value;
                            setMemoLabels(updated);
                          }}
                          className="px-2 py-1 bg-white border border-slate-200 rounded text-xs font-bold text-slate-700 focus:outline-none"
                        >
                          {Object.entries(COLOR_PALETTE).map(([key, val]) => (
                            <option key={key} value={key}>
                              {val.label}
                            </option>
                          ))}
                        </select>
                        <span
                          className="w-4 h-4 rounded-full border shadow-2xs"
                          style={{ backgroundColor: style.bg, borderColor: style.border }}
                        />
                      </div>
                      <button
                        onClick={() => handleDeleteMemoLabel(lbl.id)}
                        className="text-slate-400 hover:text-red-500 font-black px-1.5 py-0.5 rounded transition-colors"
                        title="메모 라벨 삭제"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* 새 메모 라벨 추가 */}
              <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMemoName}
                    onChange={(e) => setNewMemoName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddMemoLabel()}
                    placeholder="새 메모 라벨 태그 이름..."
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none focus:border-emerald-500"
                  />
                  <select
                    value={newMemoColor}
                    onChange={(e) => setNewMemoColor(e.target.value)}
                    className="px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none"
                  >
                    {Object.entries(COLOR_PALETTE).map(([key, val]) => (
                      <option key={key} value={key}>
                        {val.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleAddMemoLabel}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                  >
                    추가
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 푸터 버튼 */}
        <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-slate-100 bg-slate-50">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all"
          >
            닫기
          </button>
          {saveSuccess && <span className="text-emerald-500 text-xs font-bold mr-2">✅ 저장되었습니다</span>}
          <button
            onClick={handleSaveAll}
            disabled={saving}
            className="px-5 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            <span>💾</span> {saving ? '저장 중...' : '클라우드 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}