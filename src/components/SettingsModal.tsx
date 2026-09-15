// src/components/SettingsModal.tsx
//
// ⋮ 메뉴의 '환경설정'.
//
// 규칙(다른 팝업과 같다)
//   - '저장'과 '닫기'가 나뉜다. '저장'을 눌러도 창이 닫히지 않는다.
//   - 창 안에서 고친 것은 '저장'을 눌러야 적용된다. '닫기'로 나가면 버린다.
//     (상단 줄의 표시 버튼은 그 자리에서 바로 켜고 끄는 것이고, 여기 있는 같은
//      항목은 '다음에 열었을 때의 기본값'을 정하는 자리다. 값은 같은 것을 본다.)
//   - 개발자 설정은 등록된 계정으로 로그인했을 때만 보인다.
import React, { useState, useEffect } from 'react';
import { showToast, showErrorToast } from '../utils/toast';
import { auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import type { StartupScope } from '../store/useAppStore';
import { isDeveloper } from '../lib/developers';
import { MIN_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS, clampLookbackDays } from '../lib/forwarding';
import { SHORTCUT_ACTIONS, resolveBindings } from '../lib/shortcuts';
import ShortcutModal from './ShortcutModal';
import { loadAdminConfig, saveAdminGovApiKey } from '../lib/adminConfig';
import { loadSharedHolidays, saveSharedHolidays } from '../lib/holidays';
import { fetchHolidaysFromGovApi } from '../lib/govApi';
import { clearHolidayCache } from '../hooks/useGovHolidays';
import ModalShell, { ModalCloseButton } from './ModalShell';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STARTUP_OPTIONS: { value: StartupScope; label: string }[] = [
  { value: 'last', label: '마지막에 보던 화면' },
  { value: 'day', label: '하루' },
  { value: 'week', label: '주간' },
  { value: 'month', label: '월간' },
  { value: 'year', label: '년간' },
  { value: 'memo', label: '메모' },
];

/** 공휴일을 채워둘 연도. 올해와 내년이면 학사일정을 짜는 데 모자라지 않다. */
const holidayYears = () => {
  const y = new Date().getFullYear();
  return [y, y + 1];
};

interface YearStatus {
  year: number;
  count: number;
  updatedAt: number;
  updatedBy?: string;
}

/** 한 줄짜리 켜기/끄기 */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-2 cursor-pointer">
      <span className="min-w-0">
        <span className="block text-sm font-bold text-slate-700">{label}</span>
        {hint && <span className="block text-xs text-slate-400 mt-0.5">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 shrink-0 rounded text-primary focus:ring-primary border-slate-300 accent-primary cursor-pointer"
      />
    </label>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100 last:border-b-0">
      <h3 className="text-sm font-black text-slate-800">{title}</h3>
      {desc && <p className="text-xs text-slate-400 mt-0.5 mb-2 leading-relaxed">{desc}</p>}
      <div className={desc ? '' : 'mt-2'}>{children}</div>
    </div>
  );
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const developer = isDeveloper(auth.currentUser?.email);

  // 창 안에서만 쓰는 임시 값. '저장'을 눌러야 store/Firestore로 넘어간다.
  const [showWeekend, setShowWeekend] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showClass, setShowClass] = useState(true);
  const [enableScrollNav, setEnableScrollNav] = useState(false);
  const [startupScope, setStartupScope] = useState<StartupScope>('last');
  const [lookbackDays, setLookbackDays] = useState('14');
  const [govApiKey, setGovApiKey] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [shortcutOpen, setShortcutOpen] = useState(false);
  // 저장하면 바로 이 목록에 반영되도록 store를 구독한다
  const shortcutOverrides = useAppStore((s) => s.shortcutOverrides);
  const bindings = resolveBindings(shortcutOverrides);
  const assignedCount = SHORTCUT_ACTIONS.filter((a) => bindings[a.id].key).length;

  // 개발자 설정
  const [yearStatus, setYearStatus] = useState<YearStatus[]>([]);
  const [syncingYear, setSyncingYear] = useState<number | null>(null);

  // 창을 열 때마다 지금 값으로 초기화한다. 닫았다 열면 버린 수정이 남아 있지 않게.
  useEffect(() => {
    if (!isOpen) return;
    const s = useAppStore.getState();
    setShowWeekend(s.showWeekend);
    setShowEvents(s.showEvents);
    setShowClass(s.showClass);
    setEnableScrollNav(s.enableScrollNav);
    setStartupScope(s.startupScope);
    setLookbackDays(String(s.forwardLookbackDays));
    setGovApiKey(s.govApiKey);
    setSaveSuccess(false);
    if (developer) {
      loadDeveloperSettings();
      refreshYearStatus();
    }
  }, [isOpen]);

  // 키는 소스가 아니라 admin/config에 있다. 기기를 바꿔도 다시 입력하지 않아도 된다.
  const loadDeveloperSettings = async () => {
    const config = await loadAdminConfig();
    if (config.govApiKey) {
      setGovApiKey(config.govApiKey);
      useAppStore.getState().setGovApiKey(config.govApiKey);
    }
  };

  const refreshYearStatus = async () => {
    const results = await Promise.all(
      holidayYears().map(async (year) => {
        const docData = await loadSharedHolidays(year);
        return {
          year,
          count: docData ? Object.keys(docData.days).length : 0,
          updatedAt: docData?.updatedAt || 0,
          updatedBy: docData?.updatedBy,
        };
      })
    );
    setYearStatus(results);
  };

  /** 개발자만 누른다. 여기서만 data.go.kr을 부르고, 결과를 모두가 읽는 자리에 적는다. */
  const handleSyncHolidays = async (year: number) => {
    const key = govApiKey.trim();
    if (!key) return showToast('먼저 공공데이터 API 키를 입력하고 저장해 주세요.');

    setSyncingYear(year);
    try {
      const days = await fetchHolidaysFromGovApi(year, key);
      if (Object.keys(days).length === 0) {
        return showErrorToast(`${year}년 공휴일을 한 건도 받지 못했습니다. 키와 사용 승인 상태를 확인해 주세요.`);
      }
      await saveSharedHolidays(year, days);
      clearHolidayCache(year);
      await refreshYearStatus();
      showToast(`${year}년 공휴일 ${Object.keys(days).length}건을 저장했습니다. 이제 모든 사용자가 읽습니다.`);
    } catch (e: any) {
      console.error(e);
      const denied = e?.code === 'permission-denied';
      showErrorToast(
        denied
          ? 'Firestore 규칙에서 막혔습니다. firestore.rules의 holidays 규칙을 배포해 주세요.'
          : `${year}년 공휴일 저장에 실패했습니다: ${e?.message || e}`
      );
    } finally {
      setSyncingYear(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 1) 이 기기에 남는 설정
      const s = useAppStore.getState();
      s.setShowWeekend(showWeekend);
      s.setShowEvents(showEvents);
      s.setShowClass(showClass);
      s.setEnableScrollNav(enableScrollNav);
      s.setStartupScope(startupScope);
      s.setForwardLookbackDays(clampLookbackDays(lookbackDays));

      // 범위를 넘겨 적었으면 입력칸에도 잘린 값을 되돌려 보여준다
      setLookbackDays(String(clampLookbackDays(lookbackDays)));

      // 2) 개발자 키는 admin/config로. 소스에도 이 기기에도 남기지 않는다.
      if (developer) {
        s.setGovApiKey(govApiKey.trim());
        await saveAdminGovApiKey(govApiKey.trim());
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e: any) {
      console.error(e);
      showErrorToast(
        e?.code === 'permission-denied'
          ? 'Firestore 규칙에서 막혔습니다. firestore.rules의 admin 규칙을 배포해 주세요.'
          : '설정 저장에 실패했습니다.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="lg"
      title="⚙️ 환경설정"
      bare
      footer={
        <>
          {saveSuccess && <span className="text-emerald-500 text-xs font-bold mr-auto">✅ 저장되었습니다</span>}
          <ModalCloseButton onClose={onClose} />
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-60"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </>
      }
    >
      <div>
        <Section
          title="화면 표시"
          desc="상단의 주말 / 일정 / 수업 버튼과 같은 값입니다. 여기서 정한 상태로 다음에도 열립니다."
        >
          <ToggleRow
            label="주말"
            hint="토·일 칸을 달력에 보여줍니다 (Shift + ↑/↓)"
            checked={showWeekend}
            onChange={setShowWeekend}
          />
          <ToggleRow
            label="일정"
            hint="하루·주간·월간·년간에 일정 항목을 보여줍니다"
            checked={showEvents}
            onChange={setShowEvents}
          />
          <ToggleRow
            label="수업"
            hint="시간표와 교시 항목을 보여줍니다 (Alt + ↑/↓)"
            checked={showClass}
            onChange={setShowClass}
          />
          <ToggleRow
            label="스크롤로 페이지 이동"
            hint="마우스 휠을 굴려 이전/다음 날짜로 넘어갑니다"
            checked={enableScrollNav}
            onChange={setEnableScrollNav}
          />
        </Section>

        <Section title="시작 화면" desc="앱을 열었을 때 처음 보여줄 화면입니다.">
          <div className="flex flex-wrap gap-1.5">
            {STARTUP_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStartupScope(opt.value)}
                aria-pressed={startupScope === opt.value}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                  startupScope === opt.value
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-primary hover:text-primary'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="단축키" desc="화면 이동·날짜 이동·표시 토글과 메뉴 열기에 단축키를 지정할 수 있습니다.">
          <p className="text-xs text-slate-500">
            지금 <strong className="text-slate-700">{assignedCount}개</strong> 기능에 단축키가 지정되어 있습니다
            {assignedCount < SHORTCUT_ACTIONS.length && (
              <span className="text-slate-400"> (지정하지 않은 기능 {SHORTCUT_ACTIONS.length - assignedCount}개)</span>
            )}
            .
          </p>
          <button
            onClick={() => setShortcutOpen(true)}
            className="mt-3 px-4 py-2 bg-white border border-slate-200 hover:border-primary hover:text-primary text-slate-600 rounded-xl text-xs font-bold transition-colors"
          >
            ⌨️ 단축키 설정
          </button>
        </Section>

        <Section
          title="이월"
          desc="'전달' 라벨이 붙은 미완료 일정을 오늘로 끌어올 때 며칠 전까지 거슬러 볼지 정합니다. 자동 이월과 '미완료 일정 가져오기'가 같은 값을 씁니다."
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={MIN_LOOKBACK_DAYS}
              max={MAX_LOOKBACK_DAYS}
              value={lookbackDays}
              onChange={(e) => setLookbackDays(e.target.value)}
              className="w-24 px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-800 focus:outline-none focus:border-primary"
            />
            <span className="text-xs font-bold text-slate-500">일 전까지</span>
            <span className="text-xs text-slate-400 ml-auto">
              {MIN_LOOKBACK_DAYS}~{MAX_LOOKBACK_DAYS}일
            </span>
          </div>
        </Section>

        {/* 교시 이름은 시간표 쪽이 주인이다.
            예전에는 여기서도 고칠 수 있었지만 그 값(settings/preferences.periodNames)을
            읽는 화면이 V4에 하나도 없었다. 저장은 되는데 아무 일도 일어나지 않았다.
            (V3도 timetable_v5가 없을 때만 보는 옛 폴백으로만 쓴다.)
            그래서 고치는 자리는 한 곳으로 두고, 여기서는 어디로 가면 되는지만 알린다. */}
        <Section title="수업 시간 명칭" desc="교시 이름과 개수는 시간표 설정에서 정합니다.">
          <p className="text-xs text-slate-500 leading-relaxed">
            ⋮ 메뉴 → <strong className="text-slate-700">시간표 적용 (주간 템플릿)</strong> 에서 교시 이름을 바꾸면
            하루·주간 화면의 칸이 그에 맞춰 나뉩니다.
          </p>
        </Section>

        {/* 등록된 개발자 계정으로 로그인했을 때만 보인다.
            사용자는 키를 발급받을 일도, 입력할 일도 없다. 여기서 한 해에 한 번
            받아 holidays/{연도}에 적어두면 모두가 그것을 읽는다. */}
        {developer && (
          <Section
            title="🔧 개발자 설정 - 공휴일"
            desc="여기서만 공공데이터포털을 호출합니다. 받아둔 값은 모든 사용자가 읽습니다. 사용자 쪽에서는 이 호출이 일어나지 않으므로 키가 필요 없습니다."
          >
            <label className="block text-xs font-bold text-slate-700 mb-1">공공데이터포털 API Key (인코딩된 값)</label>
            <input
              type="text"
              value={govApiKey}
              onChange={(e) => setGovApiKey(e.target.value)}
              placeholder="특일정보 서비스 키"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:border-primary"
            />
            <p className="text-xs text-slate-400 mt-1">
              '저장'을 누르면 Firestore의 admin/config에 들어갑니다. 소스나 빌드 결과물에는 남지 않습니다.
            </p>

            <div className="mt-4 space-y-2">
              {yearStatus.map((st) => (
                <div
                  key={st.year}
                  className="flex items-center gap-2 bg-slate-50 rounded-xl p-2.5 border border-slate-100"
                >
                  <span className="text-sm font-black text-slate-700 w-14 shrink-0">{st.year}년</span>
                  <span className="text-xs text-slate-500 min-w-0 flex-1">
                    {st.count > 0 ? (
                      <>
                        {st.count}건 등록됨
                        {st.updatedAt > 0 && (
                          <span className="text-slate-400"> · {new Date(st.updatedAt).toLocaleDateString('ko-KR')}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-amber-600 font-bold">아직 없음</span>
                    )}
                  </span>
                  <button
                    onClick={() => handleSyncHolidays(st.year)}
                    disabled={syncingYear !== null}
                    className="px-3 py-1.5 shrink-0 bg-primary hover:bg-primary/90 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-60"
                  >
                    {syncingYear === st.year ? '받는 중...' : '내려받아 저장'}
                  </button>
                </div>
              ))}
            </div>

            <p className="text-xs text-amber-600 mt-3 leading-relaxed">
              holidays/{'{'}연도{'}'}와 admin/config는 firestore.rules에 규칙이 있어야 저장됩니다. 규칙을 아직 배포하지
              않았다면 '내려받아 저장'이 권한 오류로 실패합니다.
            </p>
          </Section>
        )}
      </div>

      {shortcutOpen && <ShortcutModal isOpen onClose={() => setShortcutOpen(false)} />}
    </ModalShell>
  );
}
