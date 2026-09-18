// src/components/roster/RosterMemorizeTab.tsx
//
// 암기 탭. 사진을 보고 이름을 떠올린 뒤 O / X 를 누르면 이름이 드러난다.
//
// 틀린 학생은 다음 판에서 더 자주·더 앞에 나온다(lib/photoQuiz.ts).
// 성적은 계정에 담기므로 내일 다시 열어도 어제 틀린 얼굴부터 이어서 한다.
import React, { useEffect } from 'react';
import StudentPhoto from './StudentPhoto';
import { usePhotoQuiz, type QuizStudent } from '../../hooks/usePhotoQuiz';
import { describeClass } from '../../lib/classPicker';
import type { ClassKey } from '../../lib/studentPhotoNames';

interface RosterMemorizeTabProps {
  cls: (ClassKey & { students?: unknown }) | null;
  /** 사진이 있는 학생만 넘긴다 (얼굴 없이 이름을 맞힐 수는 없다) */
  candidates: QuizStudent[];
  /** 사진이 아직 없는 학생 수. 왜 스물다섯이 아닌지 알려 주려고. */
  withoutPhoto: number;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <b className="bg-slate-100 border border-slate-200 rounded-xs px-1.5 py-0.5 text-slate-600 font-bold">
      {children}
    </b>
  );
}

export default function RosterMemorizeTab({
  cls,
  candidates,
  withoutPhoto,
}: RosterMemorizeTabProps) {
  const quiz = usePhotoQuiz(cls, candidates);
  const { current, revealed, answer, undo, next, shuffle, finished, canUndo } = quiz;

  /**
   * 자판으로도 넘길 수 있게.
   *
   * 한 손으로 스물다섯 장을 넘기는 일이라 마우스를 오가는 것이 번거롭다.
   * 팝업 안에서만 듣고, 글자를 치는 중(입력칸에 focus)에는 듣지 않는다.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (!revealed) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          answer(false);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          answer(true);
        }
        return;
      }
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, answer, next, undo]);

  if (!cls) {
    return (
      <div className="text-center py-12 text-xs text-slate-400 font-semibold">
        학급을 먼저 골라 주세요.
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="text-center py-12 flex flex-col items-center gap-2">
        <div className="text-sm font-extrabold text-slate-700">외울 얼굴이 아직 없습니다</div>
        <div className="text-xs text-slate-500 leading-relaxed max-w-125">
          {withoutPhoto > 0 ? (
            <>
              이 학급 학생 {withoutPhoto}명의 사진이 아직 없습니다. <b>관리</b> 탭의 타일 보기에서 빈
              칸을 눌러 사진을 올리시면 여기에 나옵니다.
            </>
          ) : (
            <>이 학급에 학생이 없습니다. 먼저 관리 탭에서 명단을 넣어 주세요.</>
          )}
        </div>
      </div>
    );
  }

  const progress = quiz.total > 0 ? Math.round(((quiz.index + (revealed ? 1 : 0)) / quiz.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-2.5">
      {/* 상태 줄 */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={quiz.weighted}
            onChange={(e) => quiz.setWeighted(e.target.checked)}
            className="w-3.5 h-3.5 accent-primary cursor-pointer"
          />
          틀린 학생 더 자주
        </label>
        <span className="text-2xs font-semibold text-slate-400">{describeClass(cls as any)}</span>
        <span className="flex-1" />
        <span className="flex items-center gap-1.5 text-xs font-extrabold">
          <span className="text-emerald-700">○ {quiz.tally.o}</span>
          <span className="text-slate-300 font-normal">|</span>
          <span className="text-red-700">✕ {quiz.tally.x}</span>
        </span>
        <button
          type="button"
          onClick={() => shuffle()}
          className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 4v6h-6" />
            <path d="M3 20v-6h6" />
            <path d="M20 10a8 8 0 0 0-13.7-4.2L3 9" />
            <path d="M4 14a8 8 0 0 0 13.7 4.2L21 15" />
          </svg>
          처음부터
        </button>
      </div>

      {/* 진행 막대 */}
      <div className="flex items-center gap-2">
        <span className="text-2xs font-bold text-slate-500 whitespace-nowrap">
          {Math.min(quiz.index + (revealed ? 1 : 0), quiz.total)} / {quiz.total}
        </span>
        <span className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
          <span
            className="block h-full bg-primary rounded-full transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </span>
        <span className="text-2xs font-bold text-slate-500 whitespace-nowrap">{quiz.round}회차</span>
      </div>

      {finished || !current ? (
        <div className="flex flex-col items-center gap-2.5 py-10 text-center">
          <div className="text-lg font-black text-slate-800">
            {quiz.round}회차를 마쳤습니다
          </div>
          <div className="text-xs text-slate-500">
            맞힘 <b className="text-emerald-700">{quiz.tally.o}</b> · 틀림{' '}
            <b className="text-red-700">{quiz.tally.x}</b>
            {quiz.tally.x > 0 && ' — 다음 판에서는 틀린 얼굴이 먼저 나옵니다'}
          </div>
          <button
            type="button"
            onClick={() => shuffle()}
            className="mt-1 px-6 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-extrabold transition-colors cursor-pointer"
          >
            한 판 더
          </button>
        </div>
      ) : !revealed ? (
        // ── 문제 ──
        <div className="flex flex-col items-center gap-3 pt-1">
          <div className="w-66 relative">
            <StudentPhoto url={current.url} name={current.name} shape="card" />
            {quiz.currentRecord && quiz.currentRecord.x > 0 && (
              <span className="absolute top-2.5 right-2.5 bg-red-50 border border-red-200 text-red-700 text-2xs font-extrabold rounded-md px-1.5 py-0.5">
                {quiz.currentRecord.x}번 틀림
              </span>
            )}
          </div>

          <div className="text-center">
            <div className="text-sm font-extrabold text-slate-700">이 학생의 이름은?</div>
            <div className="text-xs font-semibold text-slate-400 mt-1">
              떠올린 뒤 아래에서 골라 주세요
            </div>
          </div>

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => answer(false)}
              className="w-45 h-12 flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-extrabold hover:bg-red-100 transition-colors cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
              모르겠어요
            </button>
            <button
              type="button"
              onClick={() => answer(true)}
              className="w-45 h-12 flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-extrabold hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                <circle cx="12" cy="12" r="8" />
              </svg>
              알아요
            </button>
          </div>

          <div className="flex justify-center gap-2.5 text-2xs text-slate-400 font-semibold">
            <span><Kbd>←</Kbd> 모르겠어요</span>
            <span><Kbd>→</Kbd> 알아요</span>
          </div>
        </div>
      ) : (
        // ── 정답 ──
        <div className="flex items-center justify-center gap-8 pt-1 flex-wrap">
          <div className="w-52 shrink-0">
            <StudentPhoto url={current.url} name={current.name} shape="card" />
          </div>

          <div className="flex flex-col gap-2.5 max-w-85 min-w-0">
            <span
              className={`inline-flex items-center gap-1.5 self-start text-2xs font-extrabold rounded-md px-1.5 py-1 border ${
                quiz.lastKnown
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {quiz.lastKnown ? '○ 알아요로 표시했습니다' : '✕ 모르겠어요로 표시했습니다'}
            </span>

            <div className="text-4xl font-black text-slate-800 tracking-tight leading-none">
              {current.name}
            </div>

            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
              <span className="bg-blue-50 text-primary rounded px-1.5 py-0.5 font-extrabold">
                {current.num}번
              </span>
              {current.gender && <span>{current.gender === 'M' ? '남' : '여'}</span>}
              <span>{describeClass(cls as any)}</span>
            </div>

            {current.note && (
              <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 leading-relaxed">
                {current.note}
              </div>
            )}

            {quiz.lastKnown === false && quiz.currentRecord && quiz.currentRecord.x > 0 && (
              <span className="self-start text-2xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-1">
                {quiz.currentRecord.x}번째 틀림 · 다음 판에서 더 일찍 나옵니다
              </span>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={undo}
                disabled={!canUndo}
                className="bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-40"
              >
                되돌리기
              </button>
              <button
                type="button"
                onClick={next}
                className="bg-primary hover:bg-primary/90 rounded-xl px-8 py-2.5 text-sm font-extrabold text-white transition-colors cursor-pointer flex items-center gap-2"
              >
                다음
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h13M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-center items-center gap-1.5 text-2xs text-slate-400 font-semibold pt-1">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9.2" />
          <path d="M9 12.5l2.8 2.8L21 6" />
        </svg>
        기록은 계정에 저장됩니다 · 다음에 열면 틀린 학생부터 이어서
        {withoutPhoto > 0 && ` · 사진 없는 ${withoutPhoto}명은 빠져 있습니다`}
      </div>
    </div>
  );
}
