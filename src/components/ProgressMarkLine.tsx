// src/components/ProgressMarkLine.tsx
//
// 수업 칸에 겹쳐 보이는 진도 한 줄 (docs/ROADMAP.md 5-3). 하루 화면 교시 카드와 'N교시 수정' 팝업이 쓴다.
//   📘 5/12차시 · 비유 표현   🎒 교과서   [밀기]
// 진도는 화면에만 겹친다 - 수업 문서(V3와 함께 씀)에는 쓰지 않는다. 밀기는 진도 문서(v4_progress)의 bumps 한 칸만 바꾼다.
// 줄을 누르면 진도 관리 창이 그 진도로 열린다.
import React, { useState } from 'react';
import { auth } from '../lib/firebase';
import { setProgressBump, type ProgressMark } from '../lib/progress';
import { useAppStore } from '../store/useAppStore';
import { showErrorToast, showToast } from '../utils/toast';

interface ProgressMarkLineProps {
  mark: ProgressMark;
  dateStr: string;
  period: number;
  /** 밀기 단추를 늘 보인다 (팝업·수정 중). 아니면 PC에서는 마우스를 올렸을 때만 (밀린 교시의 되돌리기는 늘) */
  alwaysShowAction?: boolean;
}

export default function ProgressMarkLine({ mark, dateStr, period, alwaysShowAction = false }: ProgressMarkLineProps) {
  const [busy, setBusy] = useState(false);
  const lesson = mark.lesson;

  const openPlan = (e: React.MouseEvent) => {
    e.stopPropagation();
    useAppStore.getState().setProgressModalOpen(true, mark.planId);
  };

  const toggleBump = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const uid = auth.currentUser?.uid;
    if (!uid || busy) return;
    setBusy(true);
    try {
      await setProgressBump(uid, mark.planId, dateStr, period, !mark.bumped);
      showToast(
        mark.bumped
          ? `↩ ${period}교시 밀기를 되돌렸습니다. 뒤 차시가 한 칸씩 당겨집니다.`
          : `⏭ ${period}교시를 밀었습니다. 뒤 ${mark.key} 차시가 한 칸씩 밀립니다.`
      );
    } catch (err) {
      showErrorToast(mark.bumped ? '밀기를 되돌리지 못했습니다.' : '이 교시를 밀지 못했습니다.', err);
    } finally {
      setBusy(false);
    }
  };

  const title = mark.bumped
    ? `${mark.key} 진도 - 이 교시는 밀어서 차시가 없습니다 (누르면 진도 관리)`
    : `${mark.key} 진도 ${mark.index! + 1}/${mark.total}차시` +
      (lesson?.unit ? ` · ${lesson.unit}` : '') +
      (lesson?.content ? ` · ${lesson.content}` : '') +
      (lesson?.supplies ? ` · 준비물 ${lesson.supplies}` : '') +
      ' (누르면 진도 관리)';

  return (
    <div data-progress-mark className="flex items-center gap-2 text-xs min-w-0">
      <button type="button" onClick={openPlan} title={title} className="min-w-0 truncate text-left hover:underline">
        {mark.bumped ? (
          <span className="text-amber-700 font-bold">⏭ 밀림 · 이 교시는 차시 없음</span>
        ) : (
          <span className="text-indigo-700">
            📘 <b className="tabular-nums">
              {mark.index! + 1}/{mark.total}차시
            </b>
            {lesson?.content && ` · ${lesson.content}`}
          </span>
        )}
      </button>
      {!mark.bumped && lesson?.supplies && (
        <span className="shrink min-w-0 max-w-[40%] truncate text-amber-600 font-medium" title={`준비물: ${lesson.supplies}`}>
          🎒 {lesson.supplies}
        </span>
      )}
      <button
        type="button"
        onClick={toggleBump}
        disabled={busy}
        className={`ml-auto shrink-0 px-1.5 py-0.5 rounded border font-bold transition-opacity disabled:opacity-50 ${
          mark.bumped
            ? 'text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100'
            : `text-slate-500 border-slate-200 bg-white hover:bg-slate-50 ${alwaysShowAction ? '' : 'sm:opacity-0 sm:group-hover:opacity-100'}`
        }`}
        title={
          mark.bumped
            ? '밀기를 되돌립니다 - 뒤 차시가 한 칸씩 당겨집니다'
            : '이 교시에 수업을 못 했으면 밉니다 - 이 교시는 차시 없이 두고 뒤 차시가 한 칸씩 밀립니다'
        }
      >
        {mark.bumped ? '되돌리기' : '이 교시 밀기'}
      </button>
    </div>
  );
}
