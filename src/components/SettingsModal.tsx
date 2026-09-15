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
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import type { StartupScope } from '../store/useAppStore';
import { isDeveloper } from '../lib/developers';
import { MIN_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS, clampLookbackDays } from '../lib/forwarding';
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
  const [periodNames, setPeriodNames] = useState<string[]>(['1', '2', '3', '4', '5', '6']);
  const [showWeekend, setShowWeekend] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showClass, setShowClass] = useState(true);
  const [enableScrollNav, setEnableScrollNav] = useState(false);
  const [startupScope, setStartupScope] = useState<StartupScope>('last');
  const [lookbackDays, setLookbackDays] = useState('14');
  const [govApiKey, setGovApiKey] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [loading, setLoading] = useState(true);

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
    loadSettings();
  }, [isOpen]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const snap = await getDoc(doc(db, 'users', uid, 'settings', 'preferences'));
      if (snap.exists() && snap.data().periodNames) {
        setPeriodNames([...snap.data().periodNames]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateName = (idx: number, value: string) => {
    const updated = [...periodNames];
    updated[idx] = value;
    setPeriodNames(updated);
  };

  const handleAddPeriod = () => {
    setPeriodNames([...periodNames, `새 시간 ${periodNames.length + 1}`]);
  };

  const handleRemovePeriod = (idx: number) => {
    if (periodNames.length <= 1) return showToast('최소 1개의 시간은 존재해야 합니다.');
    setPeriodNames(periodNames.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    const finalNames = periodNames.map((n) => n.trim()).filter((n) => n !== '');
    if (finalNames.length === 0) return showToast('최소 1개의 유효한 명칭을 입력해야 합니다.');

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
      if (developer) s.setGovApiKey(govApiKey.trim());

      // 범위를 넘겨 적었으면 입력칸에도 잘린 값을 되돌려 보여준다
      setLookbackDays(String(clampLookbackDays(lookbackDays)));

      // 2) 계정에 남는 설정 (다른 기기에서도 같아야 하는 것)
      const uid = auth.currentUser?.uid;
      if (uid) {
        await setDoc(
          doc(db, 'users', uid, 'settings', 'preferences'),
          { periodNames: finalNames, updatedAt: Date.now() },
          { merge: true }
        );
      }

      setPeriodNames(finalNames);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      console.error(e);
      showErrorToast('설정 저장에 실패했습니다.');
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

        <Section
          title="수업 시간 명칭"
          desc="학교마다 다른 수업 시간을 자유롭게 바꿀 수 있습니다. 여기 등록한 개수와 순서에 맞춰 시간표 칸이 나뉩니다."
        >
          {loading ? (
            <div className="text-center py-6 text-slate-400 text-xs">불러오는 중...</div>
          ) : (
            <div className="space-y-2">
              {periodNames.map((name, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-slate-50 rounded-xl p-2.5 border border-slate-100">
                  <span className="text-xs font-black text-slate-500 w-5 text-center">{idx + 1}</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => handleUpdateName(idx, e.target.value)}
                    className="flex-1 min-w-0 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-800 focus:outline-none focus:border-primary"
                  />
                  <button
                    onClick={() => handleRemovePeriod(idx)}
                    className="text-slate-300 hover:text-red-500 font-black text-sm transition-colors p-1"
                    title="삭제"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleAddPeriod}
            className="w-full mt-3 py-2.5 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:text-primary hover:border-primary text-xs font-bold transition-colors"
          >
            + 새로운 시간/활동 추가
          </button>
        </Section>

        {/* 개발자 계정으로 로그인했을 때만 보인다.
            사용자는 키를 발급받거나 입력할 필요가 없다 - 비워두면 앱에 들어 있는
            기본 키로 공휴일을 받아온다. */}
        {developer && (
          <Section
            title="🔧 개발자 설정"
            desc="등록된 개발자 계정에만 보입니다. 공공데이터포털 특일정보 키이며, 비워두면 앱에 들어 있는 기본 키를 씁니다."
          >
            <label className="block text-xs font-bold text-slate-700 mb-1">공공데이터포털 API Key (인코딩된 값)</label>
            <input
              type="text"
              value={govApiKey}
              onChange={(e) => setGovApiKey(e.target.value)}
              placeholder="비워두면 기본 키 사용"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:border-primary"
            />
            <p className="text-xs text-amber-600 mt-2 leading-relaxed">
              이 키는 사용자 브라우저에서 직접 호출하는 데 쓰이므로 빌드 결과물에 남습니다. 키를 완전히 감추려면
              공휴일을 서버(Firestore)에 한 번 받아두고 사용자는 읽기만 하는 구조가 필요합니다.
            </p>
          </Section>
        )}
      </div>
    </ModalShell>
  );
}
