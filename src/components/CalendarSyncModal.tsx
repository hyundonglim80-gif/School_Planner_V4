// src/components/CalendarSyncModal.tsx
//
// 상단의 '캘린더' 버튼이 여는 창. 일정·수업·기록을 구글 캘린더로 보낸다.
//
// 한 방향으로만 간다. 여기에서 구글로 보내기만 하고 가져오지는 않는다.
// 양쪽에서 고칠 수 있게 하면 어느 쪽이 맞는지 정할 수가 없다. V3도 같다.
import React, { useState, useEffect } from 'react';
import { showToast, showErrorToast } from '../utils/toast';
import { useAppStore } from '../store/useAppStore';
import { useLabels } from '../hooks/useLabels';
import { useTimetableTemplate } from '../hooks/useTimetableTemplate';
import { auth } from '../lib/firebase';
import { getValidGoogleToken } from '../lib/googleApi';
import { exportCalendarData, type SyncKind, type SyncMode } from '../lib/calendarSync';
import { formatDateStr } from '../lib/dateUtils';
import ModalShell, { ModalCloseButton } from './ModalShell';

interface CalendarSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const KIND_LABEL: Record<SyncKind, { title: string; desc: string }> = {
  event: { title: '일정', desc: 'SP(work) 캘린더' },
  class: { title: '수업', desc: 'SP(class) 캘린더' },
  journal: { title: '기록', desc: 'SP(commentary) 캘린더' },
};

/** 지금 보고 있는 화면에 맞는 기간을 고른다 (V3의 빠른 동기화와 같은 규칙) */
function rangeForScope(scope: string, currentDate: string): { start: string; end: string } {
  const d = new Date(currentDate);

  if (scope === 'week') {
    const start = new Date(d);
    start.setDate(d.getDate() - d.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: formatDateStr(start), end: formatDateStr(end) };
  }
  if (scope === 'month') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start: formatDateStr(start), end: formatDateStr(end) };
  }
  if (scope === 'year') {
    // 학년도는 3월에 시작한다. 1~2월이면 지난해 3월부터 본다.
    const baseYear = d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear();
    return {
      start: formatDateStr(new Date(baseYear, 2, 1)),
      end: formatDateStr(new Date(baseYear + 1, 1, 28)),
    };
  }
  // 하루·메모는 오늘 하루
  const today = formatDateStr(d);
  return { start: today, end: today };
}

export default function CalendarSyncModal({ isOpen, onClose }: CalendarSyncModalProps) {
  const { scope, currentDate, selectedGroupId } = useAppStore();
  const { eventLabels, journalLabels } = useLabels();
  const { templates, currentTemplateName } = useTimetableTemplate();

  const [startStr, setStartStr] = useState('');
  const [endStr, setEndStr] = useState('');
  const [include, setInclude] = useState<Record<SyncKind, boolean>>({ event: true, class: true, journal: false });
  const [mode, setMode] = useState<SyncMode>('merge');

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const range = rangeForScope(scope, currentDate);
    setStartStr(range.start);
    setEndStr(range.end);
    setStatus('');
    setPercent(0);
  }, [isOpen, scope, currentDate]);

  const colPathOf = (col: 'events' | 'schedules' | 'journals') => {
    const uid = auth.currentUser?.uid;
    return selectedGroupId && selectedGroupId !== 'personal'
      ? `groups/${selectedGroupId}/${col}`
      : `users/${uid}/${col}`;
  };

  const handleSync = async () => {
    if (!startStr || !endStr) return showToast('기간을 정해 주세요.');
    if (startStr > endStr) return showToast('시작일이 종료일보다 늦습니다.');
    if (!include.event && !include.class && !include.journal) {
      return showToast('보낼 대상을 하나 이상 골라 주세요.');
    }

    setRunning(true);
    setStatus('구글 권한을 확인하는 중...');
    setPercent(0);

    try {
      const token = await getValidGoogleToken();
      if (!token) {
        setRunning(false);
        return showErrorToast('구글 권한을 받지 못했습니다.');
      }

      const result = await exportCalendarData({
        token,
        startStr,
        endStr,
        mode,
        include,
        colPathOf,
        periodNames: templates[currentTemplateName]?.names || ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시'],
        eventLabels,
        journalLabels,
        onProgress: (msg, pct) => {
          setStatus(msg);
          setPercent(Math.round(pct));
        },
      });

      const summary = (['event', 'class', 'journal'] as SyncKind[])
        .filter((k) => include[k])
        .map((k) => `${KIND_LABEL[k].title} ${result.counts[k]}건`)
        .join(', ');
      showToast(`✅ 구글 캘린더에 반영했습니다. (${summary})`);
    } catch (e: any) {
      console.error(e);
      const message = String(e?.message || e);
      showErrorToast(
        message.includes('401') || message.includes('403')
          ? '구글 캘린더 권한이 없습니다. 로그아웃 후 다시 로그인할 때 캘린더 접근을 허용해 주세요.'
          : `동기화에 실패했습니다: ${message}`
      );
      setStatus('');
    } finally {
      setRunning(false);
      setPercent(0);
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="lg"
      title="📅 구글 캘린더로 보내기"
      footer={
        <>
          <ModalCloseButton onClose={onClose} />
          <button
            onClick={handleSync}
            disabled={running}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
          >
            {running ? '보내는 중...' : '구글 캘린더로 보내기'}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-xs">
        <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-3 text-slate-600 leading-relaxed">
          고른 기간의 내용을 구글 캘린더로 보냅니다. 종류마다 전용 캘린더(SP(work) / SP(class) / SP(commentary))가
          따로 만들어집니다.
          <br />
          <strong className="text-slate-800">보내기만 합니다.</strong> 구글에서 고친 내용은 이곳으로 돌아오지 않습니다.
        </div>

        <div>
          <h3 className="text-sm font-black text-slate-800 mb-2">기간</h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              aria-label="시작일"
              value={startStr}
              onChange={(e) => setStartStr(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg font-bold text-slate-800 focus:outline-none focus:border-primary"
            />
            <span className="text-slate-400">~</span>
            <input
              type="date"
              aria-label="종료일"
              value={endStr}
              onChange={(e) => setEndStr(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg font-bold text-slate-800 focus:outline-none focus:border-primary"
            />
            <button
              onClick={() => {
                const range = rangeForScope(scope, currentDate);
                setStartStr(range.start);
                setEndStr(range.end);
              }}
              className="px-3 py-2 bg-white border border-slate-200 hover:border-primary hover:text-primary text-slate-600 rounded-lg font-bold transition-colors"
            >
              지금 화면 기간으로
            </button>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-black text-slate-800 mb-2">보낼 대상</h3>
          <div className="space-y-1.5">
            {(['event', 'class', 'journal'] as SyncKind[]).map((kind) => (
              <label
                key={kind}
                className="flex items-center gap-2.5 bg-slate-50 border border-slate-100 rounded-xl p-2.5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={include[kind]}
                  onChange={(e) => setInclude((prev) => ({ ...prev, [kind]: e.target.checked }))}
                  className="w-4 h-4 rounded text-primary focus:ring-primary border-slate-300 accent-primary cursor-pointer"
                />
                <span className="font-bold text-slate-700">{KIND_LABEL[kind].title}</span>
                <span className="text-slate-400 ml-auto">{KIND_LABEL[kind].desc}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-black text-slate-800 mb-2">방식</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              onClick={() => setMode('merge')}
              aria-pressed={mode === 'merge'}
              className={`text-left p-3 rounded-xl border transition-all ${
                mode === 'merge' ? 'bg-primary/5 border-primary' : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className={`font-bold ${mode === 'merge' ? 'text-primary' : 'text-slate-700'}`}>병합</div>
              <p className="text-slate-500 mt-0.5 leading-relaxed">
                없는 것은 넣고 달라진 것은 고칩니다. 구글에만 있는 것은 그대로 둡니다.
              </p>
            </button>
            <button
              onClick={() => setMode('overwrite')}
              aria-pressed={mode === 'overwrite'}
              className={`text-left p-3 rounded-xl border transition-all ${
                mode === 'overwrite' ? 'bg-rose-50 border-rose-300' : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className={`font-bold ${mode === 'overwrite' ? 'text-rose-700' : 'text-slate-700'}`}>교체</div>
              <p className="text-slate-500 mt-0.5 leading-relaxed">
                이곳과 똑같이 맞춥니다. 이 앱이 올렸던 것 중 지금 없는 것은 구글에서도 지웁니다.
              </p>
            </button>
          </div>
          {mode === 'overwrite' && (
            <p className="text-rose-600 font-bold mt-2">
              직접 구글에서 만든 일정은 지우지 않습니다. 이 앱이 올린 것만 정리합니다.
            </p>
          )}
        </div>

        {(running || status) && (
          <div className="border-t border-slate-100 pt-3">
            <p className="text-slate-600 font-bold">{status}</p>
            <div className="mt-1.5 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${percent}%` }}
                role="progressbar"
                aria-valuenow={percent}
              />
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
