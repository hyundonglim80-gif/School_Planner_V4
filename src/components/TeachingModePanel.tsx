// src/components/TeachingModePanel.tsx
//
// 환경설정 '교사 유형' 칸 (docs/ROADMAP-SUBJECT.md S1). 셋 중 하나를 고르면 곧바로 계정에 저장한다.
// 교과 전담·교과+담임이면 가르치는 과목, 초등 담임·교과+담임이면 담임반을 고른다.
// 교과 모드면 반마다 색을 고른다 (S3 - 하루·주간 수업 칸의 반 색. 고르지 않으면 반 차례 색).
import { useState } from 'react';
import { auth } from '../lib/firebase';
import {
  TEACHER_PRESETS,
  addTeachingSubject,
  homeroomClassOptions,
  presetPatch,
  removeTeachingSubject,
  saveTeachingMode,
  type TeacherPreset,
} from '../lib/teachingMode';
import { schoolYearOf } from '../lib/schoolSetting';
import { formatDateStr } from '../lib/dateUtils';
import { useTeachingMode } from '../hooks/useTeachingMode';
import { useRoster } from '../hooks/useRoster';
import { CLASS_COLORS, classColor, classesForYear } from '../lib/teachingSlot';
import { showToast, showErrorToast } from '../utils/toast';

const chip = (on: boolean) =>
  `px-3 py-1.5 rounded-lg text-xs font-bold border transition-all disabled:opacity-50 ${
    on ? 'bg-primary text-white border-primary shadow-xs' : 'bg-white text-slate-500 border-slate-200 hover:border-primary hover:text-primary'
  }`;

const fail = (e: unknown) => showErrorToast('저장하지 못했습니다. 잠시 뒤 다시 골라 주세요.', e);

export default function TeachingModePanel() {
  const { mode, loaded, preset } = useTeachingMode();
  const { rosterList, loading: rosterLoading } = useRoster();
  const [subjectInput, setSubjectInput] = useState('');
  const uid = auth.currentUser?.uid;

  const schoolYear = schoolYearOf(formatDateStr(new Date()));
  const classOptions = homeroomClassOptions(rosterList, schoolYear);
  const classLabels = classesForYear(rosterList, schoolYear).map((c) => c.label);

  const choosePreset = async (p: TeacherPreset) => {
    if (!uid) return;
    try {
      await saveTeachingMode(uid, presetPatch(p));
      showToast(`👩‍🏫 교사 유형을 '${TEACHER_PRESETS.find((x) => x.value === p)?.label}'(으)로 저장했습니다.`);
    } catch (e) {
      fail(e);
    }
  };

  const addSubjects = async () => {
    if (!uid) return;
    const names = subjectInput
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !mode.subjects.includes(s));
    setSubjectInput('');
    if (!names.length) return;
    try {
      for (const name of [...new Set(names)]) await addTeachingSubject(uid, name);
      showToast(`📚 가르치는 과목을 저장했습니다: ${names.join(', ')}`);
    } catch (e) {
      fail(e);
    }
  };

  const removeSubject = async (name: string) => {
    if (!uid) return;
    try {
      await removeTeachingSubject(uid, name);
      showToast(`📚 '${name}'을(를) 가르치는 과목에서 뺐습니다.`);
    } catch (e) {
      fail(e);
    }
  };

  const chooseHomeroom = async (cls: string) => {
    if (!uid) return;
    try {
      await saveTeachingMode(uid, { homeroomClass: cls });
      showToast(cls ? `🏠 담임반을 ${cls}(으)로 저장했습니다.` : '🏠 담임반을 비웠습니다.');
    } catch (e) {
      fail(e);
    }
  };

  /** 반 하나의 색만 덧쓴다 (setDoc merge가 classColors 안의 다른 반을 남긴다) */
  const chooseColor = async (cls: string, name: string) => {
    if (!uid) return;
    try {
      await saveTeachingMode(uid, { classColors: { [cls]: name } });
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="space-y-3" data-teaching-mode-setting>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="교사 유형">
        {TEACHER_PRESETS.map((p) => {
          const on = loaded && preset === p.value;
          return (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-teacher-preset={p.value}
              disabled={!loaded}
              onClick={() => void choosePreset(p.value)}
              className={`text-left px-3 py-2 rounded-xl border transition-all disabled:opacity-50 ${
                on ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-slate-200 bg-white hover:border-primary'
              }`}
            >
              <span className={`block text-sm font-bold ${on ? 'text-primary' : 'text-slate-700'}`}>
                {on ? '● ' : '○ '}
                {p.label}
              </span>
              <span className="block text-xs text-slate-500 mt-0.5">{p.desc}</span>
            </button>
          );
        })}
      </div>

      {loaded && preset !== 'homeroom' && (
        <div className="space-y-1.5" data-teaching-subjects>
          <span className="text-xs font-bold text-slate-600">가르치는 과목</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {mode.subjects.map((s) => (
              <span
                key={s}
                data-teaching-subject={s}
                className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-lg bg-primary/10 text-primary text-xs font-bold"
              >
                {s}
                <button
                  type="button"
                  onClick={() => void removeSubject(s)}
                  aria-label={`${s} 빼기`}
                  className="w-5 h-5 rounded hover:bg-primary/20 leading-none"
                >
                  ✕
                </button>
              </span>
            ))}
            <input
              type="text"
              value={subjectInput}
              onChange={(e) => setSubjectInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ',') && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void addSubjects();
                }
              }}
              onBlur={() => subjectInput.trim() && void addSubjects()}
              placeholder={mode.subjects.length ? '더하기' : '예: 과학, 영어'}
              aria-label="가르치는 과목 더하기"
              className="w-28 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:border-primary"
            />
          </div>
          <p className="text-xs text-slate-400">쉼표나 Enter로 더합니다. 시간표 칸을 채울 때 먼저 보여 줍니다.</p>
        </div>
      )}

      {loaded && preset !== 'homeroom' && classLabels.length > 0 && (
        <div className="space-y-1.5" data-teaching-colors>
          <span className="text-xs font-bold text-slate-600">반 색 (하루·주간 수업 칸)</span>
          <div className="flex flex-col gap-1">
            {classLabels.map((cls) => {
              const current = classColor(cls, mode.classColors, classLabels).name;
              return (
                <div key={cls} className="flex items-center gap-2" data-class-color-row={cls}>
                  <span className="w-10 text-xs font-black text-slate-700 tabular-nums">{cls}</span>
                  <div className="flex items-center gap-1">
                    {CLASS_COLORS.map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        data-class-color={c.name}
                        aria-pressed={current === c.name}
                        aria-label={`${cls} ${c.name}`}
                        onClick={() => void chooseColor(cls, c.name)}
                        className={`w-4 h-4 rounded-full ${c.dot} ${current === c.name ? 'ring-2 ring-offset-1 ring-slate-500' : 'opacity-60 hover:opacity-100'}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-400">고르지 않은 반은 반 차례대로 색이 정해집니다.</p>
        </div>
      )}

      {loaded && preset !== 'subject' && (
        <div className="space-y-1.5" data-teaching-homeroom>
          <span className="text-xs font-bold text-slate-600">담임반 ({schoolYear}학년도)</span>
          {classOptions.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {classOptions.map((cls) => (
                <button
                  key={cls}
                  type="button"
                  data-homeroom-class={cls}
                  aria-pressed={mode.homeroomClass === cls}
                  onClick={() => void chooseHomeroom(cls)}
                  className={chip(mode.homeroomClass === cls)}
                >
                  {cls}
                </button>
              ))}
              <button
                type="button"
                data-homeroom-class=""
                aria-pressed={!mode.homeroomClass}
                onClick={() => void chooseHomeroom('')}
                className={chip(!mode.homeroomClass)}
              >
                고르지 않음
              </button>
            </div>
          ) : (
            !rosterLoading && <p className="text-xs text-slate-400">명렬표에서 학급을 먼저 만드세요.</p>
          )}
        </div>
      )}
    </div>
  );
}
