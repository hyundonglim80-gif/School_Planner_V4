// src/components/PeriodModal.tsx
//
// 연속 기간 일정 등록. V3의 '📅 연속 기간 등록' 팝업(js/modules/multiEvent.js의
// openPeriodModal/executeGroupSave)을 옮긴 것이다.
//
// V4에는 '기간' 체크상자만 있고 기간을 정할 자리가 없었다. 그래서 체크해도 그날 하루에
// period: true가 붙을 뿐 여러 날에 걸친 일정이 만들어지지 않아, 선생님 눈에는 '체크했는데
// 아무 일도 안 일어나는' 칸이었다.
import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { showToast, showErrorToast } from '../utils/toast';
import { useAppStore } from '../store/useAppStore';
import { useLabels } from '../hooks/useLabels';
import { loadHolidayYears } from '../hooks/useGovHolidays';
import { eventDocPayload, readEventList } from '../lib/eventText';
import { formatDateStr, parseDateStr } from '../lib/dateUtils';
import ModalShell, { ModalCloseButton } from './ModalShell';

// Firestore 일괄 쓰기는 한 번에 500건까지다. 그보다 길게 잡으면 커밋이 통째로 실패한다.
const MAX_DAYS = 500;

export interface PeriodModalProps {
  isOpen: boolean;
  /** 등록하지 않고 닫을 때 */
  onClose: () => void;
  /** 시작일 (YYYY-MM-DD). 일정을 적던 날짜를 그대로 받는다. */
  startDate: string;
  defaultContent?: string;
  /** 등록 화면에서 골라 둔 라벨 이름들 */
  labels?: string[];
  /** 등록 화면에서 켜 둔 나머지 속성. 만들어지는 모든 날짜에 같이 붙는다. */
  attrs?: { calendar?: boolean; forward?: boolean; skip?: boolean };
  /** 등록에 성공했을 때. 만든 날짜 수를 넘긴다. */
  onRegistered?: (count: number) => void;
}

export default function PeriodModal({
  isOpen,
  onClose,
  startDate,
  defaultContent = '',
  labels = [],
  attrs,
  onRegistered,
}: PeriodModalProps) {
  const { selectedGroupId } = useAppStore();
  const { getLabelColor } = useLabels();

  const [content, setContent] = useState(defaultContent);
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(startDate);
  // V3와 같게 쉬는 날 제외를 기본으로 켜 둔다. 학교 일정은 대부분 수업일에만 돈다.
  const [excludeWeekend, setExcludeWeekend] = useState(true);
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // 기간이 걸친 해의 공휴일을 받아 둔다. 겨울방학처럼 해를 넘기면 두 해가 필요하다.
  const years = useMemo(() => {
    const s = start ? parseDateStr(start).getFullYear() : NaN;
    const e = end ? parseDateStr(end).getFullYear() : NaN;
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return [];
    return Array.from({ length: e - s + 1 }, (_, i) => s + i);
  }, [start, end]);
  const yearsKey = years.join(',');

  useEffect(() => {
    if (years.length === 0) return;
    let alive = true;
    loadHolidayYears(years)
      .then((days) => { if (alive) setHolidays((prev) => ({ ...prev, ...days })); })
      // 공휴일을 못 읽어도 등록은 되어야 한다. 주말만 빠진다.
      .catch((err) => console.warn('공휴일을 읽지 못했습니다.', err));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearsKey]);

  /** 쉬는 날 제외를 켰을 때 빠지는 날인가 (토·일 또는 공휴일) */
  const isOffDay = (dateStr: string, weekday: number) =>
    weekday === 0 || weekday === 6 || !!holidays[dateStr];

  const dates = useMemo(() => {
    if (!start || !end) return [];
    const s = parseDateStr(start);
    const e = parseDateStr(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return [];
    const out: string[] = [];
    const cur = new Date(s);
    while (cur <= e) {
      const dateStr = formatDateStr(cur);
      if (!(excludeWeekend && isOffDay(dateStr, cur.getDay()))) out.push(dateStr);
      cur.setDate(cur.getDate() + 1);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, excludeWeekend, holidays]);

  /** 제외된 공휴일 이름. 무엇 때문에 며칠이 빠졌는지 보여 준다. */
  const skippedHolidays = useMemo(() => {
    if (!excludeWeekend || !start || !end) return [];
    const s = parseDateStr(start);
    const e = parseDateStr(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return [];
    const names: string[] = [];
    const cur = new Date(s);
    while (cur <= e) {
      const dateStr = formatDateStr(cur);
      const name = holidays[dateStr];
      // 주말에 겹친 공휴일은 어차피 빠지므로 따로 알리지 않는다
      if (name && cur.getDay() !== 0 && cur.getDay() !== 6) names.push(name);
      cur.setDate(cur.getDate() + 1);
    }
    return names;
  }, [start, end, excludeWeekend, holidays]);

  const handleRegister = async () => {
    const text = content.trim();
    if (!text) return showErrorToast('일정 내용을 입력해 주세요.');
    if (!start || !end) return showErrorToast('시작일과 종료일을 모두 정해 주세요.');
    if (parseDateStr(start) > parseDateStr(end)) {
      return showErrorToast('종료일이 시작일보다 빠를 수 없습니다.');
    }
    if (dates.length === 0) {
      return showErrorToast('등록할 날짜가 없습니다. 쉬는 날 제외를 끄거나 기간을 늘려 주세요.');
    }
    if (dates.length > MAX_DAYS) {
      return showErrorToast(`한 번에 ${MAX_DAYS}일까지 등록할 수 있습니다. 기간을 나눠서 등록해 주세요.`);
    }
    const uid = auth.currentUser?.uid;
    if (!uid) return showErrorToast('로그인 상태를 확인해 주세요.');
    if (!confirm(`${dates.length}개 날짜에 일정을 등록합니다. 계속할까요?`)) return;

    setSaving(true);
    try {
      const colPath =
        selectedGroupId && selectedGroupId !== 'personal'
          ? `groups/${selectedGroupId}/events`
          : `users/${uid}/events`;

      // 같은 기간에서 나온 일정끼리 묶어 둔다. V3가 '반복/기간으로 연결된 일정'을
      // 알아보는 표시이고, 나중에 한꺼번에 다룰 때 쓰인다.
      const groupId = `group_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const labelStr = labels.join(',');

      const refs = dates.map((dateStr) => doc(db, colPath, dateStr));
      const snaps = await Promise.all(refs.map((ref) => getDoc(ref)));

      const batch = writeBatch(db);
      dates.forEach((dateStr, i) => {
        const snap = snaps[i];
        const list = snap.exists() ? readEventList(snap.data()) : [];
        // 며칠째인지 본문에 남긴다 (V3와 같다). '여름방학 (3/10)'처럼 보인다.
        const numbered = `${text} (${i + 1}/${dates.length})`;
        list.push({
          id: 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
          content: numbered,
          text: numbered, // V3 및 백업 내보내기 호환
          label: labelStr,
          labelIds: labels,
          completed: false,
          authorId: uid,
          date: dateStr,
          groupId,
          period: true,
          ...(attrs?.calendar !== undefined ? { calendar: attrs.calendar } : {}),
          // 💡 forward: false는 적지 않는다. 이월 라벨이 붙은 일정에 이 값이 굳으면
          // 그 일정은 영영 이월되지 않는다 (DayEvents의 forwardFieldsFor 주석 참고).
          ...(attrs?.forward ? { forward: true } : {}),
          ...(attrs?.skip !== undefined ? { skip: attrs.skip } : {}),
          createdAt: Date.now(),
        });
        batch.set(refs[i], eventDocPayload(list), { merge: true });
      });

      await batch.commit();
      showToast(`✅ ${dates.length}개 날짜에 기간 일정을 등록했습니다.`);
      onRegistered?.(dates.length);
    } catch (e: any) {
      console.error(e);
      showErrorToast('기간 일정 등록 중 문제가 생겼습니다: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="md"
      title="📅 연속 기간 등록"
      footer={
        <>
          <ModalCloseButton onClose={onClose} />
          <button
            type="button"
            onClick={handleRegister}
            disabled={saving || dates.length === 0}
            className="px-5 py-2 bg-primary text-white rounded-xl text-xs font-bold shadow-xs hover:bg-primary/90 disabled:opacity-40 transition-all cursor-pointer"
          >
            {saving ? '등록 중...' : `등록 (${dates.length}일)`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="period-content" className="block text-xs font-bold text-slate-600 mb-1">
            일정 내용
          </label>
          <input
            id="period-content"
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="예: 여름방학, 중간고사"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="period-start" className="block text-xs font-bold text-slate-600 mb-1">
              시작일
            </label>
            <input
              id="period-start"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label htmlFor="period-end" className="block text-xs font-bold text-rose-600 mb-1">
              종료일
            </label>
            <input
              id="period-end"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-full px-3 py-2 border border-rose-300 rounded-lg text-xs focus:outline-none focus:border-rose-500"
            />
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={excludeWeekend}
              onChange={(e) => setExcludeWeekend(e.target.checked)}
              className="rounded text-primary focus:ring-0 w-3.5 h-3.5 cursor-pointer"
            />
            주말(토/일)과 공휴일 제외하고 계산하기
          </label>
          <p className="mt-1 ml-6 text-xs text-slate-500">켜 두면 수업이 있는 평일에만 등록됩니다.</p>
          {skippedHolidays.length > 0 && (
            <p className="mt-1 ml-6 text-xs text-rose-600">
              빠지는 공휴일: {skippedHolidays.join(', ')}
            </p>
          )}
        </div>

        {/* 라벨과 나머지 속성은 일정을 적던 칸에서 고른 것을 그대로 따른다.
            같은 것을 두 군데서 고르게 하면 어느 쪽이 적용됐는지 알 수 없게 된다. */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <span className="block text-xs font-bold text-slate-600 mb-1.5">
            라벨 <span className="font-normal text-slate-400">(일정 칸에서 고른 것을 따릅니다)</span>
          </span>
          {labels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {labels.map((name) => {
                const c = getLabelColor(name);
                return (
                  <span
                    key={name}
                    className="px-2.5 py-1 text-xs font-bold rounded-lg border"
                    style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}
                  >
                    {name}
                  </span>
                );
              })}
            </div>
          ) : (
            <span className="text-xs text-slate-400">고른 라벨 없음</span>
          )}
        </div>

        <p className="text-xs text-slate-500">
          {dates.length > 0
            ? `${dates[0]} ~ ${dates[dates.length - 1]} 중 ${dates.length}일에 등록됩니다. 내용 뒤에 (1/${dates.length}) 처럼 며칠째인지 붙습니다.`
            : '등록할 날짜가 없습니다. 기간과 쉬는 날 제외를 확인해 주세요.'}
        </p>
      </div>
    </ModalShell>
  );
}
