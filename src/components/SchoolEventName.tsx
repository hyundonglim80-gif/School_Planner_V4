// src/components/SchoolEventName.tsx
//
// 날짜 칸의 학사일정 이름 (나이스, docs/ROADMAP.md 4-4). 공휴일 이름(HolidayName)처럼 표시만 한다 -
// 일정이 아니라 누르거나 고칠 수 없다. 공휴일(빨강)과 섞이지 않게 청록색.
// 한 날에 여럿이면 ' · '로 잇고, 마우스를 올리면 모두(내용·학년까지) 보인다.
import type { NeisScheduleItem } from '../lib/neis';
import { schoolEventTitle } from '../lib/schoolSetting';
import { META_TEXT, type DensityTier } from '../lib/typeScale';

export default function SchoolEventName({
  items,
  tier,
  className = '',
}: {
  items?: NeisScheduleItem[];
  tier: DensityTier;
  className?: string;
}) {
  if (!items?.length) return null;
  return (
    <span
      data-school-event
      title={schoolEventTitle(items)}
      className={`${META_TEXT[tier]} font-bold text-teal-700 truncate min-w-0 ${className}`}
    >
      {items.map((it) => it.name).join(' · ')}
    </span>
  );
}
