// src/components/ClassBellPanel.tsx
//
// 수업 종 설정 (hooks/useClassBell, lib/classBell) - 하루 화면 '⏰ 수업' 옆 🔔 단추로 펼친다(2026-10-07 시간표 창에서 옮김). 고르는 즉시 저장한다.
// 시작·끝 종을 따로 켜고, 그 시각보다 몇 분/초 전·후에 울릴지 고른다. '이 기기에서 울리기'는 이 기기에만(교실 PC만 울리게).
import { useEffect, useState } from 'react';
import { saveClassBell, useClassBellSettings, isBellMutedHere, setBellMutedHere, playBell } from '../hooks/useClassBell';
import type { BellPoint, ClassBellSettings } from '../lib/classBell';
import { showErrorToast } from '../utils/toast';

export default function ClassBellPanel({ hasTimes }: { hasTimes: boolean }) {
  const { bell: saved, loaded } = useClassBellSettings();
  // 누르는 즉시 보이게 (저장은 뒤에서) - 서버 값이 오면 맞춘다
  const [bell, setBell] = useState(saved);
  useEffect(() => setBell(saved), [saved]);
  const [mutedHere, setMutedHere] = useState(isBellMutedHere);

  const save = async (next: ClassBellSettings) => {
    setBell(next);
    try {
      await saveClassBell(next);
    } catch (e) {
      showErrorToast('수업 종 설정을 저장하지 못했습니다.', e);
    }
  };
  const setPoint = (key: 'start' | 'end', patch: Partial<BellPoint>) => void save({ ...bell, [key]: { ...bell[key], ...patch } });

  const sel = 'px-1.5 py-1 text-xs border border-slate-200 rounded-lg font-bold bg-white disabled:opacity-50';
  const row = (key: 'start' | 'end', label: string) => {
    const p = bell[key];
    return (
      <div className="flex items-center gap-1.5 flex-wrap text-xs" data-bell-row={key}>
        <label className="flex items-center gap-1.5 font-bold text-slate-700 w-24">
          <input type="checkbox" data-bell-on={key} checked={p.on} disabled={!loaded || !bell.enabled} onChange={(e) => setPoint(key, { on: e.target.checked })} />
          {label}
        </label>
        <input
          type="number"
          min={0}
          max={3600}
          aria-label={`${label} 얼마나`}
          data-bell-amount={key}
          value={p.amount}
          disabled={!loaded || !bell.enabled || !p.on}
          onChange={(e) => setPoint(key, { amount: Math.max(0, Number(e.target.value) || 0) })}
          className={`${sel} w-16 text-right`}
        />
        <select aria-label={`${label} 단위`} data-bell-unit={key} value={p.unit} disabled={!loaded || !bell.enabled || !p.on} onChange={(e) => setPoint(key, { unit: e.target.value as BellPoint['unit'] })} className={sel}>
          <option value="min">분</option>
          <option value="sec">초</option>
        </select>
        <select aria-label={`${label} 전후`} data-bell-when={key} value={p.when} disabled={!loaded || !bell.enabled || !p.on} onChange={(e) => setPoint(key, { when: e.target.value as BellPoint['when'] })} className={sel}>
          <option value="before">전</option>
          <option value="after">후</option>
        </select>
        <span className="text-slate-400">{p.amount === 0 ? '(그 시각에)' : ''}</span>
      </div>
    );
  };

  return (
    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2.5" data-class-bell>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
          <input type="checkbox" data-bell-enabled checked={bell.enabled} disabled={!loaded} onChange={(e) => void save({ ...bell, enabled: e.target.checked })} />
          🔔 수업 종 울리기
        </label>
        <button
          type="button"
          data-bell-preview
          onClick={() => playBell()}
          className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-600"
        >
          ▶ 미리 듣기
        </button>
      </div>
      {!hasTimes && <p className="text-2xs text-amber-700 font-bold">⏰ 시간표 창(수업 ⚙️ 설정)의 '교시 시각'을 먼저 적어야 울립니다.</p>}
      {row('start', '시작 시각')}
      {row('end', '종료 시각')}
      <div className="flex items-center gap-4 flex-wrap text-xs text-slate-600">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" data-bell-weekdays checked={bell.weekdaysOnly} disabled={!loaded || !bell.enabled} onChange={(e) => void save({ ...bell, weekdaysOnly: e.target.checked })} />
          토·일에는 울리지 않기
        </label>
        <label className="flex items-center gap-1.5" title="이 기기(브라우저)에만 저장 - 교실 PC에서만 울리고 집 PC·휴대폰은 조용히">
          <input
            type="checkbox"
            data-bell-here
            checked={!mutedHere}
            onChange={(e) => {
              setBellMutedHere(!e.target.checked);
              setMutedHere(!e.target.checked);
            }}
          />
          이 기기에서 울리기
        </label>
      </div>
      <p className="text-2xs text-slate-400">V4가 열려 있을 때만 울립니다(탭을 닫으면 울리지 않습니다). 처음 한 번 화면을 누르면 소리가 납니다(브라우저 규칙).</p>
    </div>
  );
}
