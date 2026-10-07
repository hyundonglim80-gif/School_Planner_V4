// src/components/roster/RosterMemorizeTab.tsx
//
// 암기 탭. 사진을 보고 이름을 떠올린 뒤 O / X 를 누르면 이름이 드러난다.
//
// 틀린 학생은 다음 판에서 더 자주·더 앞에 나온다(lib/photoQuiz.ts).
// 성적은 계정에 담기므로 내일 다시 열어도 어제 틀린 얼굴부터 이어서 한다.
// 2026-10-07 사용자 요청: 문제·정답의 사진 자리·크기를 같게(정답은 아래에 이름만), 함께 외울 학급 여러 개,
// 자동 넘김(초, 0 = 끔), 출제 수(0 = 계속). 설정은 이 기기에만(lib/photoQuiz readQuizSettings).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import StudentPhoto from './StudentPhoto';
import { usePhotoQuiz, type QuizStudent } from '../../hooks/usePhotoQuiz';
import { useStudentPhotos } from '../../hooks/useStudentPhotos';
import type { ClassRoster } from '../../hooks/useRoster';
import { readQuizSettings, sanitizeQuizSettings, saveQuizSettings, type QuizSettings } from '../../lib/photoQuiz';
import { describeClass } from '../../lib/classPicker';
import type { ClassKey } from '../../lib/studentPhotoNames';

interface RosterMemorizeTabProps {
  cls: (ClassKey & { students?: unknown }) | null;
  /** 사진이 있는 학생만 넘긴다 (얼굴 없이 이름을 맞힐 수는 없다) */
  candidates: QuizStudent[];
  /** 사진이 아직 없는 학생 수. 왜 스물다섯이 아닌지 알려 주려고. */
  withoutPhoto: number;
  /** 함께 외울 학급을 고르는 데 쓰는 학급 목록 (같은 학년도만 보인다) - 2026-10-07 */
  classes?: ClassRoster[];
  /** 사진 보기가 켜져 있는가 (꺼져 있으면 다른 학급 사진도 부르지 않는다) */
  photosOn?: boolean;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <b className="bg-slate-100 border border-slate-200 rounded-xs px-1.5 py-0.5 text-slate-600 font-bold">
      {children}
    </b>
  );
}

const keyOfCls = (c: ClassKey) => `${c.year}_${c.grade}_${c.classNum}`;

/**
 * 함께 외울 다른 학급의 사진을 부른다 (화면에는 아무것도 그리지 않는다).
 * 훅(useStudentPhotos)은 학급 하나씩이라 학급마다 이 칸을 하나씩 둔다.
 */
function ClassQuizPhotos({
  cls,
  onReady,
}: {
  cls: ClassRoster;
  onReady: (key: string, list: QuizStudent[], done: boolean) => void;
}) {
  const students = useMemo(() => cls.students || [], [cls.students]);
  const st = useStudentPhotos(cls, students, true);
  const list = useMemo(
    () =>
      students
        .filter((s) => s.isActive !== false && s.name && s.name !== '000')
        .map((s) => ({
          num: s.num,
          name: s.name,
          gender: s.gender,
          note: s.note,
          url: st.photos.get(s.num)?.url || '',
          cls: { year: cls.year, grade: String(cls.grade), classNum: String(cls.classNum) },
        }))
        .filter((s) => s.url),
    [students, st.photos, cls.year, cls.grade, cls.classNum]
  );
  const done = st.status !== 'checking' && st.status !== 'loading' && !st.resolving;
  const key = keyOfCls(cls);
  useEffect(() => onReady(key, list, done), [key, list, done, onReady]);
  return null;
}

export default function RosterMemorizeTab({
  cls,
  candidates,
  withoutPhoto,
  classes = [],
  photosOn = true,
}: RosterMemorizeTabProps) {
  // ── 설정 (이 기기에만): 자동 넘김 · 출제 수 · 함께 외울 학급 ──
  const [settings, setSettingsState] = useState<QuizSettings>(readQuizSettings);
  const setSettings = (patch: Partial<QuizSettings>) =>
    setSettingsState((prev) => {
      const nextSettings = sanitizeQuizSettings({ ...prev, ...patch });
      saveQuizSettings(nextSettings);
      return nextSettings;
    });

  const curKey = cls ? keyOfCls(cls) : '';
  /** 고를 수 있는 학급: 지금 학급과 같은 학년도 */
  const sameYear = useMemo(
    () =>
      classes
        .filter((c) => cls && String(c.year) === String(cls.year) && (c.students || []).length > 0)
        .sort((a, b) => String(a.grade).localeCompare(String(b.grade), 'ko', { numeric: true }) || Number(a.classNum) - Number(b.classNum)),
    [classes, cls]
  );
  const extraClasses = useMemo(
    () => (photosOn ? sameYear.filter((c) => keyOfCls(c) !== curKey && settings.classes.includes(keyOfCls(c))) : []),
    [photosOn, sameYear, curKey, settings.classes]
  );
  const [extra, setExtra] = useState<Record<string, { list: QuizStudent[]; done: boolean }>>({});
  const onExtraReady = useCallback((key: string, list: QuizStudent[], done: boolean) => {
    setExtra((prev) => (prev[key]?.list === list && prev[key]?.done === done ? prev : { ...prev, [key]: { list, done } }));
  }, []);
  const extraLoading = extraClasses.some((c) => !extra[keyOfCls(c)]?.done);
  // 다른 학급 사진을 다 받은 뒤에 판을 짠다 (받는 중에 판이 다시 짜여 처음으로 돌아가지 않게)
  const allCandidates = useMemo(
    () => (extraLoading ? [] : [...candidates, ...extraClasses.flatMap((c) => extra[keyOfCls(c)]?.list || [])]),
    [extraLoading, candidates, extraClasses, extra]
  );
  const multi = extraClasses.length > 0;

  const quiz = usePhotoQuiz(cls, allCandidates, { count: settings.count });
  const { current, revealed, answer, undo, next, reveal, shuffle, finished, canUndo } = quiz;

  /**
   * 자동 넘김: 문제를 정한 초만큼 보인 뒤 이름, 다시 그만큼 뒤 다음 (0이면 끔).
   * 그 사이에 알아요/모르겠어요를 누르면 성적에 들어가고, 이름을 보인 채 다시 기다렸다 넘어간다.
   */
  useEffect(() => {
    if (!settings.auto || !current || finished) return;
    const t = window.setTimeout(() => (revealed ? next() : reveal()), settings.auto * 1000);
    return () => window.clearTimeout(t);
  }, [settings.auto, current, revealed, finished, next, reveal, quiz.index]);

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

  const loaders = extraClasses.map((c) => <ClassQuizPhotos key={keyOfCls(c)} cls={c} onReady={onExtraReady} />);
  const numInput = 'w-14 px-1.5 py-1 border border-slate-300 rounded-md bg-white text-xs font-bold text-slate-700 text-center';

  // ── 설정 줄 ──
  const settingsBar = (
    <div data-quiz-settings className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
      <label className="flex items-center gap-1.5">
        자동 넘김
        <input
          type="number"
          min={0}
          max={60}
          aria-label="자동 넘김 (초)"
          data-quiz-auto
          value={settings.auto}
          onChange={(e) => setSettings({ auto: Number(e.target.value) })}
          className={numInput}
        />
        초 <span className="text-2xs font-semibold text-slate-400">(0 = 끔)</span>
      </label>
      <label className="flex items-center gap-1.5">
        출제 수
        <input
          type="number"
          min={0}
          max={999}
          aria-label="출제 수"
          data-quiz-count
          value={settings.count}
          onChange={(e) => setSettings({ count: Number(e.target.value) })}
          className={numInput}
        />
        번 <span className="text-2xs font-semibold text-slate-400">(0 = 계속)</span>
      </label>
      {sameYear.length > 1 && (
        <div className="flex flex-wrap items-center gap-1" data-quiz-classes>
          <span className="mr-0.5">함께 외울 학급</span>
          {sameYear.map((c) => {
            const k = keyOfCls(c);
            const isCur = k === curKey;
            const on = isCur || settings.classes.includes(k);
            return (
              <button
                key={k}
                type="button"
                data-quiz-class={`${c.grade}-${c.classNum}`}
                aria-pressed={on}
                disabled={isCur}
                title={isCur ? '지금 고른 학급 (늘 들어갑니다)' : on ? '빼기' : '함께 외우기'}
                onClick={() =>
                  setSettings({ classes: on ? settings.classes.filter((x) => x !== k) : [...settings.classes, k] })
                }
                className={`px-2 py-0.5 rounded-md border text-2xs font-extrabold transition-colors ${
                  on ? 'bg-primary text-white border-primary' : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-100 cursor-pointer'
                } ${isCur ? 'opacity-80' : ''}`}
              >
                {c.grade}-{c.classNum}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  if (allCandidates.length === 0) {
    return (
      <div className="flex flex-col gap-2.5">
        {loaders}
        {settingsBar}
        {extraLoading ? (
          <div className="text-center py-12 text-xs text-slate-400 font-semibold">함께 외울 학급의 사진을 불러오는 중...</div>
        ) : (
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
        )}
      </div>
    );
  }

  const shown = Math.min(quiz.index + (revealed ? 1 : 0), quiz.total);
  const progress = quiz.total > 0 ? Math.round((shown / quiz.total) * 100) : 0;
  const btn = 'w-45 h-12 flex items-center justify-center gap-2 rounded-xl border text-sm font-extrabold transition-colors cursor-pointer';

  return (
    <div className="flex flex-col gap-2.5" data-quiz>
      {loaders}
      {settingsBar}
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
        <span className="text-2xs font-semibold text-slate-400" data-quiz-class-label>
          {multi ? `${extraClasses.length + 1}개 학급` : describeClass(cls as any)}
        </span>
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

      {/* 진행 막대 ('계속'이면 몇 장째인지만) */}
      <div className="flex items-center gap-2" data-quiz-progress>
        {quiz.count > 0 ? (
          <>
            <span className="text-2xs font-bold text-slate-500 whitespace-nowrap">
              {shown} / {quiz.total}
            </span>
            <span className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
              <span className="block h-full bg-primary rounded-full transition-all duration-200" style={{ width: `${progress}%` }} />
            </span>
            <span className="text-2xs font-bold text-slate-500 whitespace-nowrap">{quiz.round}회차</span>
          </>
        ) : (
          <span className="text-2xs font-bold text-slate-500 whitespace-nowrap">
            {quiz.index + (revealed ? 1 : 0)}장째 · 계속 ({quiz.round}바퀴째)
          </span>
        )}
        {settings.auto > 0 && <span className="text-2xs font-bold text-primary whitespace-nowrap">⏱ {settings.auto}초마다 넘김</span>}
      </div>

      {finished || !current ? (
        <div className="flex flex-col items-center gap-2.5 py-10 text-center">
          <div className="text-lg font-black text-slate-800">{quiz.round}회차를 마쳤습니다</div>
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
      ) : (
        // 문제와 정답이 같은 자리·같은 크기의 사진을 쓴다 (2026-10-07 사용자 요청 - 사진이 옮겨 다녀 어지러웠다).
        // 정답에서는 사진 아래 같은 칸에 이름만 더 보인다.
        <div className="flex flex-col items-center gap-3 pt-1" data-quiz-stage={revealed ? 'answer' : 'question'}>
          <div className="w-60 relative shrink-0" data-quiz-photo>
            <StudentPhoto url={current.url} name={current.name} shape="card" />
            {quiz.currentRecord && quiz.currentRecord.x > 0 && (
              <span className="absolute top-2.5 right-2.5 bg-red-50 border border-red-200 text-red-700 text-2xs font-extrabold rounded-md px-1.5 py-0.5">
                {quiz.currentRecord.x}번 틀림
              </span>
            )}
          </div>

          <div className="h-14 flex items-center justify-center text-center" data-quiz-answer>
            {revealed ? (
              <div className="text-4xl font-black text-slate-800 tracking-tight leading-none" data-quiz-name>
                {current.name}
              </div>
            ) : (
              <div className="text-sm font-extrabold text-slate-500">이 학생의 이름은?</div>
            )}
          </div>

          <div className="flex gap-2.5">
            {!revealed ? (
              <>
                <button type="button" onClick={() => answer(false)} className={`${btn} border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                  모르겠어요
                </button>
                <button type="button" onClick={() => answer(true)} className={`${btn} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                    <circle cx="12" cy="12" r="8" />
                  </svg>
                  알아요
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={undo}
                  disabled={!canUndo}
                  className={`${btn} border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40`}
                >
                  되돌리기
                </button>
                <button type="button" onClick={next} className={`${btn} border-primary bg-primary text-white hover:bg-primary/90`}>
                  다음
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h13M13 6l6 6-6 6" />
                  </svg>
                </button>
              </>
            )}
          </div>

          <div className="h-5 flex justify-center gap-2.5 text-2xs text-slate-400 font-semibold">
            {!revealed ? (
              <>
                <span><Kbd>←</Kbd> 모르겠어요</span>
                <span><Kbd>→</Kbd> 알아요</span>
              </>
            ) : (
              <>
                <span><Kbd>→</Kbd> · <Kbd>Enter</Kbd> 다음</span>
                <span><Kbd>Backspace</Kbd> 되돌리기</span>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-center items-center gap-1.5 text-2xs text-slate-400 font-semibold pt-1">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9.2" />
          <path d="M9 12.5l2.8 2.8L21 6" />
        </svg>
        기록은 계정에 저장됩니다 · 다음에 열면 틀린 학생부터 이어서
        {withoutPhoto > 0 && ` · 이 학급의 사진 없는 ${withoutPhoto}명은 빠져 있습니다`}
      </div>
    </div>
  );
}
