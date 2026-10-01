// src/components/SeatDrawPanel.tsx
//
// 자리표 창의 발표자 뽑기 칸 (ROADMAP 8-3). 뽑기·저장은 hooks/useStudentDraw, 셈은 lib/draw.
// 뽑힌 학생은 자리표에서도 짚는다(SeatingModal이 그린다). 자리표가 없어도 학급 명렬표로 뽑는다.
import React from 'react';
import type { DrawState, DrawStatus } from '../lib/draw';

interface SeatDrawPanelProps {
  shown: number | null;
  rolling: boolean;
  status: DrawStatus;
  draw: DrawState;
  /** 번호 → 이름 (없으면 '15번') */
  nameFor: (num: number) => string;
  onPick: () => void;
  onUndo: () => void;
  onNewRound: () => void;
  onBig: () => void;
}

/** '2번째 판 · 5/25명 뽑음 · 남은 19명 · 오늘 결석 1명 빼고' */
export function drawStatusLine(draw: DrawState, status: DrawStatus): string {
  const parts = [`${draw.round}번째 판`, `${status.done}/${status.total}명 뽑음`];
  if (status.pool.length > 0 && status.remaining.length === 0) parts.push('다 뽑음 - 다음은 새 판');
  else parts.push(`남은 ${status.remaining.length}명`);
  if (status.absent.length > 0) parts.push(`오늘 결석 ${status.absent.length}명 빼고`);
  return parts.join(' · ');
}

export default function SeatDrawPanel({ shown, rolling, status, draw, nameFor, onPick, onUndo, onNewRound, onBig }: SeatDrawPanelProps) {
  const canUndo = !rolling && shown !== null && draw.picked.includes(shown);
  // 굴리는 동안은 방금 뽑힌 학생(판의 맨 끝)을 아직 보이지 않는다 - 멈추기 전에 답이 보이지 않게
  const visiblePicked = rolling ? draw.picked.slice(0, -1) : draw.picked;
  const btn = 'px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 font-bold';
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 flex flex-col gap-2 text-xs" data-seating-panel="draw">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex-1 min-w-[10rem] h-14 rounded-xl bg-white border border-amber-200 flex items-center justify-center gap-2 px-3"
          aria-live="polite"
          data-draw-result={rolling ? '' : shown ?? ''}
        >
          {shown === null ? (
            <span className="text-slate-400 font-bold">누가 발표할까요?</span>
          ) : (
            <>
              <span className={`text-lg font-black ${rolling ? 'text-slate-300' : 'text-amber-600'}`}>{shown}</span>
              <span className={`text-xl font-black truncate ${rolling ? 'text-slate-400' : 'text-slate-900'}`}>{nameFor(shown)}</span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onPick}
          // 굴리는 동안 커서를 잃지 않게 disabled 대신 (누름은 onPick이 무시한다)
          aria-disabled={rolling}
          className={`px-4 h-14 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-900 text-sm font-black ${rolling ? 'opacity-60' : ''}`}
        >
          🎯 뽑기
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-bold text-slate-600 mr-auto" data-draw-status>
          {drawStatusLine(draw, status)}
        </span>
        <button type="button" onClick={onBig} className={btn}>
          🔍 크게 보기
        </button>
        <button type="button" onClick={onUndo} disabled={!canUndo} className={`${btn} disabled:opacity-40`} title="방금 뽑은 학생을 안 뽑힌 학생으로 되돌립니다">
          ↩️ 되돌리기
        </button>
        <button type="button" onClick={onNewRound} disabled={rolling || draw.picked.length === 0} className={`${btn} disabled:opacity-40`}>
          🔄 새 판
        </button>
      </div>
      {visiblePicked.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" data-draw-picked>
          <span className="text-2xs font-black text-slate-400 mr-1">뽑힌 차례</span>
          {visiblePicked.map((n, i) => (
            <span
              key={n}
              data-draw-picked-num={n}
              className={`px-1.5 py-0.5 rounded-md border text-2xs font-bold ${
                !rolling && n === shown ? 'border-amber-400 bg-amber-100 text-amber-800' : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              {i + 1}. {n} {nameFor(n)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
