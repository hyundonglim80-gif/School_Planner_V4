//src/components/LabelModal.tsx
import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { DEFAULT_EVENT_LABELS, type EventLabel } from '../hooks/useLabels';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useGroups } from '../hooks/useGroups';
import { scanForMissingLabels, pickRecoveryColor } from '../utils/labelRecovery';
import { moveToTrash } from '../utils/trashHelper';

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
  const { groups } = useGroups();
  const [activeTab, setActiveTab] = useState<'event' | 'journal' | 'memo'>(initialTab);
  const [scanning, setScanning] = useState(false);

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
  // 💡 불러오기가 실제로 성공하기 전까지는 저장을 막아서, 로드 실패 시
  // 화면 표시용으로 채운 기본값이 실수로 클라우드에 덮어써지는 것을 방지한다.
  const [labelsLoaded, setLabelsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // 저장 시점에 삭제된 라벨을 찾아내기 위한, 불러온 시점의 원본 스냅샷
  const originalEventLabelsRef = React.useRef<EventLabel[]>([]);
  const originalJournalLabelsRef = React.useRef<JournalLabel[]>([]);
  const originalMemoLabelsRef = React.useRef<MemoLabel[]>([]);

  const fetchLabels = async () => {
    const user = auth.currentUser;
    if (!user) return;

    setLoadError(false);
    try {
      const docRef = doc(db, 'users', user.uid, 'settings', 'labels');
      const snap = await getDoc(docRef);

      if (snap.exists()) {
        const data = snap.data();
        const rawEvents = data.eventLabels || data.labels || DEFAULT_EVENT_LABELS;
        const nextEventLabels = rawEvents.map((l: any, i: number) => ({
          id: l.id || `ev_${i}_${l.name || ''}`,
          name: l.name || '',
          color: l.color || 'blue',
          calendar: l.calendar !== false,
          skip: !!l.skip,
          forward: !!(l.forward || l.isForward),
          period: !!l.period,
          recur: !!l.recur,
        }));
        setEventLabels(nextEventLabels);
        originalEventLabelsRef.current = nextEventLabels;

        const rawMemos = data.memoLabels || DEFAULT_MEMO_LABELS;
        const nextMemoLabels = rawMemos.map((l: any, i: number) => ({
          id: (typeof l === 'object' && l.id) ? l.id : `memo_${i}_${typeof l === 'string' ? l : l.name || ''}`,
          name: typeof l === 'string' ? l : (l.name || ''),
          color: (typeof l === 'object' && l.color) ? l.color : 'green',
        }));
        setMemoLabels(nextMemoLabels);
        originalMemoLabelsRef.current = nextMemoLabels;

        const rawJournals = data.journalLabels || DEFAULT_JOURNAL_LABELS;
        const nextJournalLabels = rawJournals.map((l: any, i: number) => ({
          id: l.id || `j_${i}_${l.name || ''}`,
          name: l.name || '',
          color: l.color || 'green',
        }));
        setJournalLabels(nextJournalLabels);
        originalJournalLabelsRef.current = nextJournalLabels;
      } else {
        // 신규 계정이라 저장된 라벨이 아직 없는 정상적인 경우 -> 기본값을 보여주고 저장도 허용
        setEventLabels(DEFAULT_EVENT_LABELS);
        setMemoLabels(DEFAULT_MEMO_LABELS);
        setJournalLabels(DEFAULT_JOURNAL_LABELS);
        originalEventLabelsRef.current = DEFAULT_EVENT_LABELS;
        originalMemoLabelsRef.current = DEFAULT_MEMO_LABELS;
        originalJournalLabelsRef.current = DEFAULT_JOURNAL_LABELS;
      }
      setLabelsLoaded(true);
    } catch (e) {
      console.error('라벨 불러오기 오류:', e);
      // 불러오기 자체가 실패한 경우 -> 화면에는 기본값을 임시로 보여주되,
      // labelsLoaded를 true로 만들지 않아 저장(클라우드 덮어쓰기)은 막는다.
      setEventLabels(DEFAULT_EVENT_LABELS);
      setMemoLabels(DEFAULT_MEMO_LABELS);
      setJournalLabels(DEFAULT_JOURNAL_LABELS);
      setLoadError(true);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setLabelsLoaded(false);
    setLoadError(false);
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

  // 저장 직전, 불러온 시점과 비교해 삭제된 라벨을 찾아 휴지통으로 보낸다.
  const trashRemovedLabels = async () => {
    const removedEvents = originalEventLabelsRef.current.filter(
      (orig) => !eventLabels.some((l) => l.id === orig.id)
    );
    const removedJournals = originalJournalLabelsRef.current.filter(
      (orig) => !journalLabels.some((l) => l.id === orig.id)
    );
    const removedMemos = originalMemoLabelsRef.current.filter(
      (orig) => !memoLabels.some((l) => l.id === orig.id)
    );

    for (const lbl of removedEvents) {
      try {
        await moveToTrash({ id: lbl.id, type: 'label', content: `[일정] ${lbl.name}`, data: { kind: 'event', label: lbl } });
      } catch (err) {
        console.error('라벨 휴지통 이동 실패:', err);
      }
    }
    for (const lbl of removedJournals) {
      try {
        await moveToTrash({ id: lbl.id, type: 'label', content: `[기록] ${lbl.name}`, data: { kind: 'journal', label: lbl } });
      } catch (err) {
        console.error('라벨 휴지통 이동 실패:', err);
      }
    }
    for (const lbl of removedMemos) {
      try {
        await moveToTrash({ id: lbl.id, type: 'label', content: `[메모] ${lbl.name}`, data: { kind: 'memo', label: lbl } });
      } catch (err) {
        console.error('라벨 휴지통 이동 실패:', err);
      }
    }
  };

  // --- 전체 라벨 저장 ---
  const handleSaveAll = async () => {
    const user = auth.currentUser;
    if (!user) return;
    if (!labelsLoaded) {
      alert('라벨 정보를 아직 불러오지 못했습니다. 다시 불러온 뒤 저장해주세요.');
      return;
    }

    setSaving(true);
    try {
      await trashRemovedLabels();

      const docRef = doc(db, 'users', user.uid, 'settings', 'labels');
      const payload = {
        eventLabels,
        memoLabels,
        journalLabels,
        labels: eventLabels, // V3 호환성
        updatedAt: Date.now(),
      };

      await setDoc(docRef, payload, { merge: true });
      originalEventLabelsRef.current = eventLabels;
      originalJournalLabelsRef.current = journalLabels;
      originalMemoLabelsRef.current = memoLabels;

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
        journalLabels.map((l) => l.name),
        memoLabels.map((l) => l.name)
      );

      const totalMissing =
        result.missingEventNames.length + result.missingJournalNames.length + result.missingMemoNames.length;

      if (totalMissing === 0) {
        alert('✅ 검사 완료: 삭제되었거나 누락된 라벨이 없습니다.');
        return;
      }

      const lines: string[] = [];
      if (result.missingEventNames.length > 0) lines.push(`일정: ${result.missingEventNames.join(', ')}`);
      if (result.missingJournalNames.length > 0) lines.push(`기록: ${result.missingJournalNames.join(', ')}`);
      if (result.missingMemoNames.length > 0) lines.push(`메모: ${result.missingMemoNames.join(', ')}`);

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

      let jColorIdx = journalLabels.length;
      const restoredJournalLabels = [
        ...journalLabels,
        ...result.missingJournalNames.map((name) => ({
          id: `j_recovered_${Date.now()}_${jColorIdx++}`,
          name,
          color: pickRecoveryColor(jColorIdx),
        })),
      ];

      let mColorIdx = memoLabels.length;
      const restoredMemoLabels = [
        ...memoLabels,
        ...result.missingMemoNames.map((name) => ({
          id: `memo_recovered_${Date.now()}_${mColorIdx++}`,
          name,
          color: pickRecoveryColor(mColorIdx),
        })),
      ];

      setEventLabels(restoredEventLabels);
      setJournalLabels(restoredJournalLabels);
      setMemoLabels(restoredMemoLabels);

      // 복구된 목록을 바로 저장
      const docRef = doc(db, 'users', user.uid, 'settings', 'labels');
      await setDoc(
        docRef,
        {
          eventLabels: restoredEventLabels,
          memoLabels: restoredMemoLabels,
          journalLabels: restoredJournalLabels,
          labels: restoredEventLabels, // V3 호환성
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      originalEventLabelsRef.current = restoredEventLabels;
      originalJournalLabelsRef.current = restoredJournalLabels;
      originalMemoLabelsRef.current = restoredMemoLabels;

      alert(`✅ ${totalMissing}개의 라벨을 복구하고 저장했습니다.`);
    } catch (e) {
      console.error('라벨 복구 스캔 오류:', e);
      alert('라벨 복구 중 오류가 발생했습니다.');
    } finally {
      setScanning(false);
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
        <div className="p-6 overflow-y-auto space-y-4 flex-1 min-h-0" data-scroll-lock>
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
            onClick={handleSaveAll}
            disabled={saving || !labelsLoaded}
            title={!labelsLoaded ? '라벨 정보를 불러오는 중에는 저장할 수 없습니다' : undefined}
            className="px-5 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            <span>💾</span> {saving ? '저장 중...' : '클라우드 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}