// src/components/TeachingModePanel.tsx
//
// 환경설정 '교사 유형' 칸 (docs/ROADMAP-SUBJECT.md S1). 셋 중 하나를 고르면 곧바로 계정에 저장한다
// (lib/teachingMode - 저장은 unit·hasHomeroom 두 값). 교과 전담·교과+담임은 가르치는 과목,
// 초등 담임·교과+담임은 담임반(그 학년도 명렬표의 '학년-반')을 고른다.
// 카드 글(TEACHER_PRESETS)은 처음 안내 띠(features/day/TeachingModeBanner)와 같다.
import { useMemo, useState } from 'react';
import { TEACHER_PRESETS, presetPatch, type TeacherPreset } from '../lib/teachingMode';
import { schoolYearOf } from '../lib/schoolSetting';
import { formatDateStr } from '../lib/dateUtils';
import { saveTeachingPatch, useTeachingMode } from '../hooks/useTeachingMode';
import { useRoster } from '../hooks/useRoster';

const chip = (on: boolean) =>
  `px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
    on ? 'bg-primary text-white border-primary shadow-xs' : 'bg-white text-slate-500 border-slate-200 hover:border-primary hover:text-primary'
  }`;

export default function TeachingModePanel() {
  const { mode, preset } = useTeachingMode();
  const { rosterList } = useRoster();
  const [subjectInput, setSubjectInput] = useState('');

  const classOptions = useMemo(() => {
    const year = schoolYearOf(formatDateStr());
    const names = rosterList
      .filter((r) => Number(r.year) === year && r.grade && r.classNum)
      .map((r) => `${r.grade}-${r.classNum}`);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
  }, [rosterList]);

  const choosePreset = (p: TeacherPreset) => {
    if (p === preset) return;
    const label = TEACHER_PRESETS.find((x) => x.value === p)?.label;
    void saveTeachingPatch(presetPatch(p), `교사 유형: ${label}`);
  };

  const addSubjects = (raw: string) => {
    const add = raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    setSubjectInput('');
    const next = [...new Set([...mode.subjects, ...add])];
    if (next.length === mode.subjects.length) return;
    void saveTeachingPatch({ subjects: next }, `가르치는 과목: ${next.join(', ')}`);
  };

  const removeSubject = (s: string) => {
    const next = mode.subjects.filter((x) => x !== s);
    void saveTeachingPatch({ subjects: next }, next.length ? `가르치는 과목: ${next.join(', ')}` : '가르치는 과목을 비웠습니다.');
  };

  const showSubjects = preset !== 'homeroom';
  const showHomeroom = preset !== 'subject';

  return (
    <div className="space-y-3" data-teaching-mode>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="교사 유형">
        {TEACHER_PRESETS.map((p) => {
          const on = preset === p.value;
          return (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-teacher-preset={p.value}
              onClick={() => choosePreset(p.value)}
              className={`text-left px-3 py-2 rounded-xl border transition-all ${
                on ? 'border-primary bg-primary/10 shadow-xs' : 'border-slate-200 bg-white hover:border-primary'
              }`}
            >
              <span className={`block text-sm font-black ${on ? 'text-primary' : 'text-slate-700'}`}>
                {on ? '● ' : '○ '}
                {p.label}
              </span>
              <span className="block text-2xs text-slate-400 mt-0.5 leading-snug">{p.desc}</span>
            </button>
          );
        })}
      </div>

      {showSubjects && (
        <div data-teaching-subjects>
          <p className="text-xs font-bold text-slate-600 mb-1">가르치는 과목</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {mode.subjects.map((s) => (
              <span
                key={s}
                data-teaching-subject={s}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/30"
              >
                {s}
                <button type="button" aria-label={`${s} 빼기`} onClick={() => removeSubject(s)} className="hover:text-red-500">
                  ✕
                </button>
              </span>
            ))}
            <input
              value={subjectInput}
              onChange={(e) => {
                const v = e.target.value;
                if (/[,，]/.test(v)) addSubjects(v);
                else setSubjectInput(v);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addSubjects(subjectInput);
                }
              }}
              onBlur={() => subjectInput.trim() && addSubjects(subjectInput)}
              placeholder="과목 (쉼표·Enter로 더하기)"
              data-teaching-subject-input
              className="min-w-[10rem] flex-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      )}

      {showHomeroom && (
        <div data-teaching-homeroom>
          <p className="text-xs font-bold text-slate-600 mb-1">담임반</p>
          {classOptions.length === 0 ? (
            <p className="text-xs text-slate-400">명렬표에서 학급을 먼저 만드세요.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                data-homeroom-class=""
                aria-pressed={!mode.homeroomClass}
                onClick={() => mode.homeroomClass && void saveTeachingPatch({ homeroomClass: '' }, '담임반을 비웠습니다.')}
                className={chip(!mode.homeroomClass)}
              >
                고르지 않음
              </button>
              {classOptions.map((c) => (
                <button
                  key={c}
                  type="button"
                  data-homeroom-class={c}
                  aria-pressed={mode.homeroomClass === c}
                  onClick={() => mode.homeroomClass !== c && void saveTeachingPatch({ homeroomClass: c }, `담임반: ${c}`)}
                  className={chip(mode.homeroomClass === c)}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
