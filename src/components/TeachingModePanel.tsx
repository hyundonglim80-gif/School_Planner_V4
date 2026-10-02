// src/components/TeachingModePanel.tsx
//
// 환경설정 '교사 유형' 칸 (docs/ROADMAP-SUBJECT.md S1). 고르는 즉시 계정에 저장한다 (lib/teachingMode).
// 셋 중 하나 + 가르치는 과목(교과 전담·교과+담임) + 담임반(초등 담임·교과+담임).
import { useMemo, useState } from 'react';
import { auth } from '../lib/firebase';
import {
  addTeachingSubjects,
  presetPatch,
  removeTeachingSubject,
  saveTeachingMode,
  TEACHER_PRESETS,
} from '../lib/teachingMode';
import { schoolYearOf } from '../lib/schoolSetting';
import { formatDateStr } from '../lib/dateUtils';
import { useTeachingMode } from '../hooks/useTeachingMode';
import { useRoster } from '../hooks/useRoster';
import { showToast, showErrorToast } from '../utils/toast';

const chip = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border border-primary/30 bg-primary/5 text-primary';

export default function TeachingModePanel() {
  const { mode, loaded, preset } = useTeachingMode();
  const { rosterList } = useRoster();
  const [subjectText, setSubjectText] = useState('');
  const uid = auth.currentUser?.uid;

  // 그 학년도(3월~이듬해 2월) 명렬표의 '학년-반' 목록
  const classOptions = useMemo(() => {
    const year = schoolYearOf(formatDateStr(new Date()));
    const list = rosterList
      .filter((r) => Number(r.year) === year && r.grade && r.classNum)
      .map((r) => `${r.grade}-${r.classNum}`);
    return [...new Set(list)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [rosterList]);

  const save = async (patch: Parameters<typeof saveTeachingMode>[1], msg: string) => {
    if (!uid) return;
    try {
      await saveTeachingMode(uid, patch);
      showToast(msg);
    } catch (e) {
      showErrorToast('저장하지 못했습니다. 잠시 뒤 다시 골라 주세요.', e);
    }
  };

  const addSubjects = async () => {
    const names = subjectText.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (!uid || !names.length) return;
    try {
      await addTeachingSubjects(uid, names);
      setSubjectText('');
      showToast('저장했습니다.');
    } catch (e) {
      showErrorToast('저장하지 못했습니다. 잠시 뒤 다시 해 주세요.', e);
    }
  };

  const removeSubject = async (name: string) => {
    if (!uid) return;
    try {
      await removeTeachingSubject(uid, name);
      showToast('저장했습니다.');
    } catch (e) {
      showErrorToast('저장하지 못했습니다. 잠시 뒤 다시 해 주세요.', e);
    }
  };

  const showSubjects = preset !== 'homeroom';
  const showHomeroom = preset !== 'subject';

  return (
    <div className="space-y-3" data-teaching-mode>
      <div role="radiogroup" aria-label="교사 유형" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
              onClick={() => {
                if (preset !== p.value) void save(presetPatch(p.value), `저장했습니다 - ${p.label}`);
              }}
              className={`text-left px-3 py-2 rounded-xl border transition-all disabled:opacity-50 ${
                on ? 'border-primary bg-primary/5 shadow-xs' : 'border-slate-200 bg-white hover:border-primary'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${on ? 'border-primary bg-primary' : 'border-slate-300'}`}
                  aria-hidden
                />
                <span className={`text-xs font-black ${on ? 'text-primary' : 'text-slate-700'}`}>{p.label}</span>
              </span>
              <span className="block text-2xs text-slate-400 mt-0.5 leading-snug">{p.desc}</span>
            </button>
          );
        })}
      </div>

      {loaded && showSubjects && (
        <div className="space-y-1.5" data-teaching-subjects>
          <p className="text-xs font-bold text-slate-600">가르치는 과목</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {mode.subjects.map((s) => (
              <span key={s} className={chip} data-teaching-subject={s}>
                {s}
                <button
                  type="button"
                  aria-label={`${s} 빼기`}
                  onClick={() => void removeSubject(s)}
                  className="text-primary/60 hover:text-red-500"
                >
                  ✕
                </button>
              </span>
            ))}
            <input
              value={subjectText}
              onChange={(e) => setSubjectText(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  void addSubjects();
                }
              }}
              onBlur={() => void addSubjects()}
              placeholder="과목 이름 (쉼표·Enter로 더하기)"
              aria-label="가르치는 과목 더하기"
              data-teaching-subject-input
              className="flex-1 min-w-[10rem] px-2.5 py-1 rounded-lg text-xs border border-slate-200 bg-white focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      )}

      {loaded && showHomeroom && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-slate-600">담임반</p>
          {classOptions.length ? (
            <select
              value={mode.homeroomClass}
              onChange={(e) => {
                const v = e.target.value;
                void save({ homeroomClass: v }, v ? `저장했습니다 - 담임반 ${v}` : '저장했습니다 - 담임반 없음');
              }}
              aria-label="담임반"
              data-homeroom-class
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white focus:outline-none focus:border-primary"
            >
              <option value="">고르지 않음</option>
              {mode.homeroomClass && !classOptions.includes(mode.homeroomClass) && (
                <option value={mode.homeroomClass}>{mode.homeroomClass} (명렬표에 없음)</option>
              )}
              {classOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-slate-400" data-homeroom-empty>
              명렬표에서 학급을 먼저 만드세요 (학급 화면 → 명렬표).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
