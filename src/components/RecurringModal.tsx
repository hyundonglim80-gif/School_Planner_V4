import React, { useState } from 'react';
import { doc, runTransaction, type DocumentSnapshot } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { showToast, showErrorToast } from '../utils/toast';
import { useAppStore } from '../store/useAppStore';
import { readEventList } from '../lib/eventText';
import { useLabels } from '../hooks/useLabels';

/** 한 트랜잭션에 담는 날짜 수 (Firestore는 트랜잭션 하나에 문서 500개까지) */
const RECUR_CHUNK = 200;
import ModalShell, { ModalCloseButton } from './ModalShell';
import { setEventDoc } from '../lib/gcalNote';

interface RecurringModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultContent?: string;
  defaultLabelName?: string;
  defaultStartDate?: string;
  /** 처음 고른 요일 (0=일 … 6=토). 새 일정 빠른 입력의 '매주 화'에서 연다 */
  defaultDays?: number[];
  /** 처음 반복 방식 (격주 등) */
  defaultType?: RecurType;
  /** 만들고 나서 (몇 날짜에 만들었나) - 부른 쪽이 칸을 닫는다 */
  onRegistered?: (count: number) => void;
}

export type RecurType = 'weekly' | 'biweekly' | 'monthly' | 'monthday';

function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 그 주의 일요일 0시 */
function sundayOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
}

function formatDate(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** 반복 조건으로 만들어질 날짜들 (YYYY-MM-DD). 화면과 떼어 두어 시험할 수 있게 했다. */
export function computeRecurringDates(opts: {
  startDate: string;
  endDate: string;
  recurType: RecurType;
  selectedDays: number[];
  selectedMonthDays: number[];
}): string[] {
  const { startDate, endDate, recurType, selectedDays, selectedMonthDays } = opts;
  if (!startDate || !endDate) return [];
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (start > end) return [];
  const dates: string[] = [];
  const cur = new Date(start);

  while (cur <= end) {
    const dayOfWeek = cur.getDay();
    const dayOfMonth = cur.getDate();

    if (recurType === 'weekly' && selectedDays.includes(dayOfWeek)) {
      dates.push(formatDate(cur));
    } else if (recurType === 'biweekly') {
      // 격주는 달력의 주(일요일 시작)로 센다 - V3(recurring.js)와 같다.
      // 예전엔 시작일부터 7일씩 끊어서, 수요일에 시작해 '격주 월·금'을 고르면
      // 이번 주 금요일과 다음 주 월요일이 한 묶음으로 들어갔다.
      const weekDiff = Math.round((sundayOf(cur).getTime() - sundayOf(start).getTime()) / (7 * 24 * 60 * 60 * 1000));
      if (weekDiff % 2 === 0 && selectedDays.includes(dayOfWeek)) {
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
}

export default function RecurringModal({
  isOpen,
  onClose,
  defaultContent = '',
  defaultLabelName = '',
  defaultStartDate,
  defaultDays,
  defaultType,
  onRegistered,
}: RecurringModalProps) {
  const { selectedGroupId } = useAppStore();
  const { eventLabels } = useLabels();
  const [content, setContent] = useState(defaultContent);
  const [labelName, setLabelName] = useState(defaultLabelName);
  const [recurType, setRecurType] = useState<RecurType>(defaultType || 'weekly');
  const [selectedDays, setSelectedDays] = useState<number[]>(defaultDays?.length ? defaultDays : [1]); // 0=일, 1=월, ...
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

  const calculateDates = (): string[] =>
    computeRecurringDates({ startDate, endDate, recurType, selectedDays, selectedMonthDays });

  const handlePreview = () => {
    const dates = calculateDates();
    setPreviewDates(dates);
  };

  const handleSave = async () => {
    if (!content.trim()) return showToast('일정 내용을 입력하세요.');
    if (!endDate) return showErrorToast('종료일을 선택해주세요.');

    const dates = calculateDates();
    if (dates.length === 0) return showErrorToast('생성할 날짜가 없습니다. 반복 조건을 확인해주세요.');
    if (!confirm(`총 ${dates.length}개의 날짜에 일정을 생성합니다. 계속하시겠습니까?`)) return;

    setSaving(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      // 한 번에 만든 것끼리 묶어 둔다. 나중에 '이 날부터 뒤로' 처럼 범위를 골라
      // 지울 수 있는 것은 이 id가 있을 때뿐이다 (lib/eventGroups).
      const seriesId = `group_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

      const colPath = selectedGroupId && selectedGroupId !== 'personal'
        ? `groups/${selectedGroupId}/events`
        : `users/${uid}/events`;
      // 적은 라벨 이름이 있는 라벨이면 id로 푼다. labelIds에는 id를 둔다(V3는 id로 찾는다 - 이름을 넣으면
      // V3의 이월 판단이 그 라벨을 못 알아본다). 없는 이름이면 이름만 남긴다.
      const wantedLabel = labelName.trim();
      const matched = wantedLabel ? eventLabels.find((l) => l.name === wantedLabel) : undefined;

      // ⚠️ 날짜마다 그날 목록을 읽어 새 일정을 얹어 다시 쓴다. 트랜잭션으로 서버의 지금 목록을 읽고 곧바로 쓴다.
      //    예전에는 날짜를 하나씩 서버에서 읽은 뒤 맨 끝에 한꺼번에 써서, 읽는 동안(40주면 몇 초) 다른 곳에서
      //    더한 일정을 덮을 수 있었다. 서버가 답하지 않으면 트랜잭션이 실패하고 그 묶음은 쓰지 않는다.
      //    한 트랜잭션에 너무 많은 문서를 담지 않게 나눈다(Firestore 한도 500).
      for (let i = 0; i < dates.length; i += RECUR_CHUNK) {
        const chunk = dates.slice(i, i + RECUR_CHUNK);
        await runTransaction(db, async (tx) => {
          const refs = chunk.map((dateStr) => doc(db, colPath, dateStr));
          const snaps: DocumentSnapshot[] = [];
          for (const ref of refs) snaps.push(await tx.get(ref));
          refs.forEach((ref, k) => {
            const snap = snaps[k];
            const eventList = snap.exists() ? readEventList(snap.data()) : [];
            // 💡 예전에는 text만 쓰고 content를 빼먹어서, 읽기 쪽 필터(content가 비면 제외)에
            // 걸려 반복 일정이 저장은 되지만 화면에 아예 나타나지 않았다.
            eventList.push({
              id: 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
              content: content.trim(),
              text: content.trim(),
              label: matched ? matched.name : wantedLabel,
              labelIds: matched ? [matched.id] : [],
              completed: false,
              groupId: seriesId,
              recur: true,
              createdAt: Date.now()
            });
            setEventDoc(tx, ref, eventList);
          });
        });
      }

      showToast(`✅ ${dates.length}개 날짜에 반복 일정이 생성되었습니다.`);
      onRegistered?.(dates.length);
    } catch (e: any) {
      console.error(e);
      showErrorToast('반복 일정 생성 중 오류가 발생했습니다: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      // Ctrl+S = 저장 단추 (누를 수 없을 때는 하지 않는다)
      onSave={() => { if (!saving) void handleSave(); }}
      width="lg"
      title="🔄 반복 일정 생성"
      footer={
        <>
          <ModalCloseButton onClose={onClose} />
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-primary text-white rounded-xl text-xs font-bold shadow-xs hover:bg-primary/90 transition-all">
            {saving ? '생성 중...' : `반복 일정 생성 (${previewDates.length}개)`}
          </button>
        </>
      }
    >
        <div className="space-y-4">
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
    </ModalShell>
  );
}
