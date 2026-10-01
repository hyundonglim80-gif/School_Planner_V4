// src/features/day/DayMeals.tsx
//
// 하루 화면 수업 칸 아래의 그날 학사일정과 급식 (나이스, docs/ROADMAP.md 4-3·4-4).
// 환경설정 '우리 학교'를 골랐을 때만 보인다. 둘 다 없는 날(주말·방학)은 아무것도 그리지 않는다.
// 학사일정은 표시만 한다 (일정이 아니다). 알레르기 번호는 음식 이름 뒤에 작게 (1 난류 … 19 잣 - 마우스를 올리면 이름).
import { useDayMeals, useSchoolSchedule } from '../../hooks/useNeis';
import { schoolEventTitle } from '../../lib/schoolSetting';

const ALLERGY_NAMES = [
  '',
  '난류',
  '우유',
  '메밀',
  '땅콩',
  '대두',
  '밀',
  '고등어',
  '게',
  '새우',
  '돼지고기',
  '복숭아',
  '토마토',
  '아황산류',
  '호두',
  '닭고기',
  '쇠고기',
  '오징어',
  '조개류',
  '잣',
];

export default function DayMeals({ dateStr }: { dateStr?: string }) {
  const { school, meals, failed } = useDayMeals(dateStr);
  const { byDate } = useSchoolSchedule(dateStr ? [dateStr.slice(0, 7)] : []);
  const events = (dateStr && byDate[dateStr]) || [];
  if (!school) return null;
  if (meals.length === 0 && events.length === 0) {
    return failed ? <p className="mt-3 text-xs text-slate-400">🍚 급식을 불러오지 못했습니다. 잠시 뒤 다시 열어 보세요.</p> : null;
  }
  return (
    <div className="mt-3 rounded-xl border border-orange-100 bg-orange-50/60 px-3 py-2 space-y-1">
      {events.length > 0 && (
        <div data-day-school-events className="flex gap-2 text-xs leading-relaxed" title={schoolEventTitle(events)}>
          <span className="shrink-0 font-bold text-teal-700">📚 학사</span>
          <p className="min-w-0 font-bold text-teal-700">{events.map((it) => it.name).join(' · ')}</p>
        </div>
      )}
      <div data-day-meals={meals.length > 0 ? '' : undefined} className="space-y-1">
      {meals.map((m) => (
        <div key={m.kind} className="flex gap-2 text-xs leading-relaxed" title={m.calories ? `${m.kind} ${m.calories}` : m.kind}>
          <span className="shrink-0 font-bold text-orange-700">🍚 {m.kind}</span>
          <p className="min-w-0 text-slate-700">
            {m.dishes.map((d, i) => (
              <span key={i}>
                {i > 0 && <span className="text-slate-300"> · </span>}
                {d.name}
                {d.allergies.length > 0 && (
                  <sup className="ml-0.5 text-2xs text-slate-400" title={d.allergies.map((n) => ALLERGY_NAMES[n] || n).join(', ')}>
                    {d.allergies.join('.')}
                  </sup>
                )}
              </span>
            ))}
          </p>
        </div>
      ))}
      </div>
    </div>
  );
}
