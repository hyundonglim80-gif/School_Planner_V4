// src/components/PeriodTimesEditor.tsx
//
// 시간표 설정(⚙️) 안의 '교시 시각' 칸 (docs/ROADMAP.md 2-2).
// 교시마다 시작·끝 시각을 적으면 하루 화면이 지금 몇 교시인지 짚어 준다. 비워 두면 아무것도 보이지 않는다.
// 방학 기간처럼 이 칸만의 저장 단추가 있다(V4 전용 문서 settings/v4_periodTimes).
import { useState } from 'react';
import { usePeriodTimes, savePeriodTimes } from '../hooks/usePeriodTimes';
import { fillPeriodTimes, toMinutes, type PeriodTimes } from '../lib/periodTimes';
import { showToast, showErrorToast } from '../utils/toast';

export default function PeriodTimesEditor({ periodNames }: { periodNames: string[] }) {
  const { times, loaded } = usePeriodTimes();
  const [draft, setDraft] = useState<PeriodTimes>({});
  const [baseline, setBaseline] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  // 빠르게 채우기 (초등 40분·중학교 45분·고등학교 50분 수업이 흔하다)
  const [firstStart, setFirstStart] = useState('09:00');
  const [classMin, setClassMin] = useState(40);
  const [breakMin, setBreakMin] = useState(10);
  const [lunchAfter, setLunchAfter] = useState(4);
  const [lunchMin, setLunchMin] = useState(50);

  // 저장된 값으로 한 번만 채운다 - 적는 중에 구독이 다시 와도 되돌리지 않는다
  if (loaded && !hydrated) {
    setDraft(times);
    setBaseline(JSON.stringify(times));
    setHydrated(true);
  }

  const count = periodNames.length;
  const dirty = hydrated && JSON.stringify(draft) !== baseline;

  const setTime = (period: number, field: 'start' | 'end', value: string) => {
    setDraft((prev) => {
      const key = String(period);
      const cur = prev[key] || { start: '', end: '' };
      return { ...prev, [key]: { ...cur, [field]: value } };
    });
  };

  const fill = () => {
    const filled = fillPeriodTimes({
      count,
      firstStart,
      classMinutes: Number(classMin) || 0,
      breakMinutes: Number(breakMin) || 0,
      lunchAfter: Number(lunchAfter) || 0,
      lunchMinutes: Number(lunchMin) || 0,
    });
    if (!filled) {
      showToast('1교시 시작 시각과 수업 길이를 적어 주세요.');
      return;
    }
    setDraft(filled);
  };

  const save = async () => {
    if (!hydrated || saving) return;
    // 교시 수보다 뒤의 칸은 버린다 (교시를 줄였을 때 남은 시각)
    const kept: PeriodTimes = {};
    for (let p = 1; p <= count; p++) {
      const t = draft[String(p)];
      if (t && (t.start || t.end)) kept[String(p)] = t;
    }
    const bad = Object.entries(kept).filter(([, t]) => {
      const s = toMinutes(t.start);
      const e = toMinutes(t.end);
      return s === null || e === null || e <= s;
    });
    if (bad.length > 0) {
      showToast(`${bad.map(([p]) => `${p}교시`).join(', ')}의 시각이 비었거나 끝이 시작보다 이릅니다.`);
      return;
    }
    setSaving(true);
    try {
      await savePeriodTimes(kept);
      setBaseline(JSON.stringify(kept));
      setDraft(kept);
      showToast('✅ 교시 시각을 저장했습니다. 하루 화면에서 지금 몇 교시인지 짚어 줍니다.');
    } catch (e) {
      showErrorToast('교시 시각을 저장하지 못했습니다.', e);
    } finally {
      setSaving(false);
    }
  };

  const num = (v: number, set: (n: number) => void, label: string) => (
    <input
      type="number"
      min={0}
      max={180}
      value={v}
      onChange={(e) => set(Number(e.target.value))}
      aria-label={label}
      className="w-12 border border-slate-200 rounded px-1 py-0.5 text-center font-bold text-slate-700"
    />
  );

  return (
    <div className="bg-violet-50/60 p-4 rounded-xl border border-violet-200 space-y-3" data-period-times>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <span className="text-xs font-extrabold text-violet-900 block">🕘 교시 시각</span>
          <span className="text-xs text-violet-700">
            적어 두면 오늘 하루 화면에서 지금 몇 교시인지, 쉬는 시간에는 다음 교시를 짚어 줍니다. 비워 두면 보이지 않습니다.
          </span>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!hydrated || saving || !dirty}
          title={!hydrated ? '저장된 시각을 불러오는 중입니다' : undefined}
          className="px-3 py-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors"
        >
          {saving ? '저장 중...' : '교시 시각 저장'}
        </button>
      </div>

      {/* 빠르게 채우기 */}
      <div className="flex items-center gap-1.5 flex-wrap text-xs bg-white border border-violet-200 rounded-lg px-2.5 py-1.5">
        <span className="font-bold text-violet-800">빠르게 채우기</span>
        <span>1교시 시작</span>
        <input
          type="time"
          value={firstStart}
          onChange={(e) => setFirstStart(e.target.value)}
          aria-label="빠르게 채우기 - 1교시 시작"
          className="border border-slate-200 rounded px-1 py-0.5 font-bold text-slate-700"
        />
        <span>수업</span>
        {num(classMin, setClassMin, '수업 길이(분)')}
        <span>분 · 쉬는 시간</span>
        {num(breakMin, setBreakMin, '쉬는 시간(분)')}
        <span>분 · 점심</span>
        <select
          value={lunchAfter}
          onChange={(e) => setLunchAfter(Number(e.target.value))}
          aria-label="점심 앞 교시"
          className="border border-slate-200 rounded px-1 py-0.5 font-bold text-slate-700"
        >
          <option value={0}>없음</option>
          {periodNames.map((name, i) => (
            <option key={i} value={i + 1}>
              {name} 뒤
            </option>
          ))}
        </select>
        {num(lunchMin, setLunchMin, '점심 시간(분)')}
        <span>분</span>
        <button
          type="button"
          onClick={fill}
          disabled={!hydrated}
          className="ml-auto px-2 py-0.5 bg-violet-100 hover:bg-violet-200 text-violet-800 border border-violet-300 rounded font-bold disabled:opacity-40"
        >
          채우기
        </button>
      </div>

      {/* 한 줄에 교시 하나. 오른쪽 칸(약 480px)에서 두 줄로 나누면 '오전 09:00' 칸이 좁아 잘렸다 */}
      <div className="grid grid-cols-1 gap-y-1.5 text-xs">
        {periodNames.map((name, i) => {
          const t = draft[String(i + 1)] || { start: '', end: '' };
          return (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-14 shrink-0 font-bold text-slate-700 truncate" title={name}>
                {name}
              </span>
              <input
                type="time"
                value={t.start}
                onChange={(e) => setTime(i + 1, 'start', e.target.value)}
                aria-label={`${name} 시작`}
                className="w-32 shrink-0 border border-slate-200 rounded px-1.5 py-0.5 font-bold text-slate-700 bg-white"
              />
              <span>~</span>
              <input
                type="time"
                value={t.end}
                onChange={(e) => setTime(i + 1, 'end', e.target.value)}
                aria-label={`${name} 끝`}
                className="w-32 shrink-0 border border-slate-200 rounded px-1.5 py-0.5 font-bold text-slate-700 bg-white"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
