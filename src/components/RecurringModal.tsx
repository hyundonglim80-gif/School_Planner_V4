import React, { useState } from 'react';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface RecurringModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultContent?: string;
  defaultLabelName?: string;
  defaultStartDate?: string;
}

type RecurType = 'weekly' | 'biweekly' | 'monthly' | 'monthday';

function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export default function RecurringModal({ isOpen, onClose, defaultContent = '', defaultLabelName = '', defaultStartDate }: RecurringModalProps) {
  useBodyScrollLock(isOpen);
  const { selectedGroupId } = useAppStore();
  const [content, setContent] = useState(defaultContent);
  const [labelName, setLabelName] = useState(defaultLabelName);
  const [recurType, setRecurType] = useState<RecurType>('weekly');
  const [selectedDays, setSelectedDays] = useState<number[]>([1]); // 0=일, 1=월, ...
  const [selectedMonthDays, setSelectedMonthDays] = useState<number[]>([]);
  const [startDate, setStartDate] = useState(defaultStartDate || formatDate(new Date()));
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewDates, setPreviewDates] = useState<string[]>([]);

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

  const toggleDay = (d: number) => {
    setSelectedDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  };

  const toggleMonthDay = (d: number) => {
    setSelectedMonthDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  };

  const calculateDates = (): string[] => {
    if (!startDate || !endDate) return [];
    const start = parseLocalDate(startDate);
    const end = parseLocalDate(endDate);
    if (start > end) return [];
    const dates: string[] = [];
    const cur = new Date(start);
    let weekCount = 0;
    const startWeekDay = start.getDay();

    while (cur <= end) {
      const dayOfWeek = cur.getDay();
      const dayOfMonth = cur.getDate();

      if (recurType === 'weekly' && selectedDays.includes(dayOfWeek)) {
        dates.push(formatDate(cur));
      } else if (recurType === 'biweekly') {
        const weeksSinceStart = Math.floor((cur.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
        if (weeksSinceStart % 2 === 0 && selectedDays.includes(dayOfWeek)) {
          dates.push(formatDate(cur));
        }
      } else if (recurType === 'monthly' && selectedDays.includes(dayOfWeek)) {
        // 매월 첫째/셋째 등 특정 주차 요일
        const weekInMonth = Math.ceil(dayOfMonth / 7);
        if (weekInMonth === 1) dates.push(formatDate(cur));
      } else if (recurType === 'monthday' && selectedMonthDays.includes(dayOfMonth)) {
        dates.push(formatDate(cur));
      }

      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  };

  const handlePreview = () => {
    const dates = calculateDates();
    setPreviewDates(dates);
  };

  const handleSave = async () => {
    if (!content.trim()) return alert('일정 내용을 입력하세요.');
    if (!endDate) return alert('종료일을 선택해주세요.');

    const dates = calculateDates();
    if (dates.length === 0) return alert('생성할 날짜가 없습니다. 반복 조건을 확인해주세요.');
    if (!confirm(`총 ${dates.length}개의 날짜에 일정을 생성합니다. 계속하시겠습니까?`)) return;

    setSaving(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      const batch = writeBatch(db);
      for (const dateStr of dates) {
        const colPath = selectedGroupId && selectedGroupId !== 'personal'
          ? `groups/${selectedGroupId}/events`
          : `users/${uid}/events`;
        const ref = doc(db, colPath, dateStr);
        const snap = await getDoc(ref);
        const existing = snap.exists() ? snap.data() : {};
        const eventList = existing.eventList || [];

        eventList.push({
          id: 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
          text: content.trim(),
          labelIds: labelName ? [labelName] : [],
          completed: false,
          createdAt: Date.now()
        });

        batch.set(ref, { ...existing, eventList, updatedAt: Date.now() }, { merge: true });
      }

      await batch.commit();
      alert(`✅ ${dates.length}개 날짜에 반복 일정이 생성되었습니다!`);
      onClose();
    } catch (e: any) {
      console.error(e);
      alert('반복 일정 생성 중 오류가 발생했습니다: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col border border-slate-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-black text-slate-800">🔄 반복 일정 생성</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* 일정 내용 */}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">일정 내용</label>
            <input type="text" value={content} onChange={e => setContent(e.target.value)} placeholder="예: 학년 협의회, 부장 회의, 안전점검" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none" />
          </div>

          {/* 라벨 */}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">라벨 (선택)</label>
            <input type="text" value={labelName} onChange={e => setLabelName(e.target.value)} placeholder="라벨명" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none" />
          </div>

          {/* 반복 주기 */}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-2">반복 주기</label>
            <div className="flex gap-2 flex-wrap">
              {([['weekly', '매주'], ['biweekly', '격주'], ['monthly', '매월(첫째 주)'], ['monthday', '매월(특정 일)']] as [RecurType, string][]).map(([val, label]) => (
                <button key={val} onClick={() => setRecurType(val)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${recurType === val ? 'bg-primary text-white border-primary' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-primary/50'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 요일 선택 */}
          {recurType !== 'monthday' && (
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-2">반복 요일</label>
              <div className="flex gap-2">
                {dayNames.map((name, idx) => (
                  <button key={idx} onClick={() => toggleDay(idx)}
                    className={`w-9 h-9 rounded-full text-xs font-black border-2 transition-all ${selectedDays.includes(idx) ? 'bg-primary text-white border-primary' : 'bg-white text-slate-500 border-slate-200 hover:border-primary/50'}`}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 매월 특정 일 */}
          {recurType === 'monthday' && (
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-2">반복할 날짜</label>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({length: 31}, (_, i) => i + 1).map(d => (
                  <button key={d} onClick={() => toggleMonthDay(d)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold border transition-all ${selectedMonthDays.includes(d) ? 'bg-primary text-white border-primary' : 'bg-white text-slate-500 border-slate-200 hover:border-primary/50'}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 기간 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">시작일</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">종료일</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none" />
            </div>
          </div>

          {/* 미리보기 */}
          <button onClick={handlePreview} className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all">
            📅 미리보기 ({previewDates.length > 0 ? `${previewDates.length}개 날짜` : '클릭하여 확인'})
          </button>

          {previewDates.length > 0 && (
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 max-h-32 overflow-y-auto">
              <div className="flex flex-wrap gap-1">
                {previewDates.map(d => (
                  <span key={d} className="px-2 py-0.5 bg-white border border-slate-200 rounded text-xs text-slate-600">{d}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-slate-100 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold">취소</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-primary text-white rounded-xl text-xs font-bold shadow-xs hover:bg-primary/90 transition-all">
            {saving ? '생성 중...' : `반복 일정 생성 (${previewDates.length}개)`}
          </button>
        </div>
      </div>
    </div>
  );
}
