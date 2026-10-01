// src/components/GroupMoveModal.tsx
//
// 기간·반복으로 여러 날에 걸쳐 만든 일정을 다른 날짜로 옮길 때 '어디까지' 옮길지 고른다.
// 지우기의 GroupDeleteModal과 같은 세 갈래(이 날만 / 이 날과 이후 모두 / 전체)이고, 고른 것은 모두
// **같은 날 수만큼** 옮긴다. 옮겨 갈 날짜 범위와 주말·공휴일에 놓이는 날 수를 미리 보여 준다 -
// 주말·공휴일을 빼고 만든 기간 일정을 날 수로 밀면 주말에 놓이는 날이 생길 수 있다.
import { useEffect, useState } from 'react';
import ModalShell, { ModalCloseButton } from './ModalShell';
import { findGroupEvents, hitsFrom, planGroupMove, type GroupHit, type GroupMovePlanItem } from '../lib/eventGroups';
import { loadHolidayYears } from '../hooks/useGovHolidays';
import { parseDateStr } from '../lib/dateUtils';
import { shortDateLabel } from '../lib/notices';
import { showErrorToast } from '../utils/toast';

export type GroupMoveScope = 'only' | 'after' | 'all';

export interface GroupMoveModalProps {
  onClose: () => void;
  /** 옮기려는 일정이 지금 있는 날짜 */
  dateStr: string;
  /** 옮길 날짜 (이 일정 기준) */
  toDate: string;
  /** 며칠 옮기나 (뒤로 +, 앞으로 -) */
  days: number;
  fId: string;
  groupId: string;
  content?: string;
  /** 고른 범위와 그 범위의 일정들. 옮기기는 부르는 쪽이 한다(실패하면 칸에 그대로 남도록). */
  onPick: (scope: GroupMoveScope, items: GroupMovePlanItem[]) => Promise<void>;
}

const rangeLabel = (plan: GroupMovePlanItem[], key: 'fromDate' | 'toDate') =>
  plan.length === 0
    ? ''
    : plan.length === 1
    ? shortDateLabel(plan[0][key])
    : `${shortDateLabel(plan[0][key])}~${shortDateLabel(plan[plan.length - 1][key])}`;

export default function GroupMoveModal({ onClose, dateStr, toDate, days, fId, groupId, content, onPick }: GroupMoveModalProps) {
  const [hits, setHits] = useState<GroupHit[] | null>(null);
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<GroupMoveScope | null>(null);

  // 묶음이 어느 날짜에 몇 건 있는지 서버에서 센다 (지우기와 같은 길)
  useEffect(() => {
    let alive = true;
    findGroupEvents(fId, groupId)
      .then((found) => {
        if (alive) setHits(found);
      })
      .catch((err) => {
        console.error(err);
        if (alive) setHits([]);
        showErrorToast('연결된 일정을 불러오지 못했습니다.', err);
      });
    return () => {
      alive = false;
    };
  }, [fId, groupId]);

  const allPlan = hits ? planGroupMove(hits, days) : [];
  const afterPlan = hits ? planGroupMove(hitsFrom(hits, dateStr), days) : [];

  // 옮겨 갈 날짜들의 공휴일 (못 읽어도 옮기기는 된다 - 주말만 센다)
  const yearsKey = [...new Set(allPlan.map((p) => p.toDate.slice(0, 4)))].join(',');
  useEffect(() => {
    if (!yearsKey) return;
    let alive = true;
    loadHolidayYears(yearsKey.split(',').map(Number))
      .then((days) => {
        if (alive) setHolidays(days);
      })
      .catch((err) => console.warn('공휴일을 읽지 못했습니다.', err));
    return () => {
      alive = false;
    };
  }, [yearsKey]);

  const offDays = (plan: GroupMovePlanItem[]) =>
    plan.filter((p) => {
      const wd = parseDateStr(p.toDate).getDay();
      return wd === 0 || wd === 6 || !!holidays[p.toDate];
    }).length;

  const run = async (scope: GroupMoveScope) => {
    if (busy) return;
    setBusy(scope);
    try {
      const plan = scope === 'only' ? [] : scope === 'after' ? afterPlan : allPlan;
      await onPick(scope, plan);
    } finally {
      setBusy(null);
    }
  };

  const when = days > 0 ? `${days}일 뒤로` : `${-days}일 앞으로`;
  const countLabel = (n: number) => (hits === null ? '세는 중…' : `${n}건`);
  const option = (scope: 'after' | 'all', plan: GroupMovePlanItem[], title: string, tone: string) => {
    const off = offDays(plan);
    return (
      <button
        type="button"
        onClick={() => void run(scope)}
        disabled={busy !== null || hits === null || plan.length === 0}
        className={`w-full text-left px-3.5 py-3 rounded-xl border disabled:opacity-40 transition-colors cursor-pointer ${tone}`}
      >
        <span className="block text-xs font-bold text-slate-800">
          {title} ({countLabel(plan.length)})
        </span>
        {plan.length > 0 && (
          <span className="block mt-0.5 text-xs text-slate-500">
            {rangeLabel(plan, 'fromDate')} → {rangeLabel(plan, 'toDate')}
            {off > 0 && <b className="text-amber-700"> · ⚠️ 주말·공휴일에 놓이는 날 {off}건</b>}
          </span>
        )}
      </button>
    );
  };

  return (
    <ModalShell isOpen onClose={onClose} width="sm" title="📅 연결된 일정 옮기기" footer={<ModalCloseButton onClose={onClose} />}>
      <div className="space-y-3">
        <p className="text-xs text-slate-600 leading-relaxed">
          {content ? <b className="text-slate-800">{content}</b> : '이 일정'} 은(는) <b>기간 또는 반복</b>으로 여러 날에 걸쳐
          연결되어 있습니다. 어디까지 옮길까요? 고른 일정은 모두 <b>{when}</b> 옮깁니다.
        </p>

        <button
          type="button"
          onClick={() => void run('only')}
          disabled={busy !== null}
          className="w-full text-left px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 transition-colors cursor-pointer"
        >
          <span className="block text-xs font-bold text-slate-800">이 날짜의 일정만 옮기기</span>
          <span className="block mt-0.5 text-xs text-slate-500">
            {shortDateLabel(dateStr)} → {shortDateLabel(toDate)} 1건. 나머지 날짜는 그대로 둡니다(묶음에는 남습니다).
          </span>
        </button>

        {option('after', afterPlan, '이 날짜와 이후 일정 모두 옮기기', 'border-blue-200 bg-blue-50 hover:bg-blue-100')}
        {option('all', allPlan, '연결된 일정 전체 옮기기', 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100')}

        <p className="text-xs text-slate-400">
          옮긴 뒤에도 묶음은 그대로라, 지울 때는 함께 지울 수 있습니다. 칸에서 고친 내용은 이 날짜의 일정에만 들어갑니다.
        </p>
      </div>
    </ModalShell>
  );
}
