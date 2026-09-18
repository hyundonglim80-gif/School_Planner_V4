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
import { auth, db } from '../lib/firebase';
import { collection, doc, getDoc, getDocFromServer, getDocs, setDoc } from 'firebase/firestore';
import { useAppStore } from '../store/useAppStore';
import type { StartupScope } from '../store/useAppStore';
import { FONT_SCALES } from '../lib/fontScale';
import { isDeveloper } from '../lib/developers';
import { labelDiagnostics, useLabels, toSharedEventLabel } from '../hooks/useLabels';
import { MIN_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS, clampLookbackDays } from '../lib/forwarding';
import { SHORTCUT_ACTIONS, resolveBindings } from '../lib/shortcuts';
import ShortcutModal from './ShortcutModal';
import { loadAdminConfig, saveAdminGovApiKey } from '../lib/adminConfig';
import { loadSharedHolidays, saveSharedHolidays } from '../lib/holidays';
import { fetchHolidaysFromGovApi } from '../lib/govApi';
import { clearHolidayCache } from '../hooks/useGovHolidays';
import ModalShell, { ModalCloseButton } from './ModalShell';
import { runDriveMigration, CORS_HELP, type MigrationProgress } from '../lib/driveMigration';

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
  // 글자 크기는 고르는 즉시 적용되므로 store를 그대로 구독한다. 다른 설정들처럼
  // 지역 상태에 담아 두었다가 '저장'에서 옮기면 눌러도 화면이 그대로다.
  const fontScale = useAppStore((s) => s.fontScale);
  const setFontScale = useAppStore((s) => s.setFontScale);
  const shortcutOverrides = useAppStore((s) => s.shortcutOverrides);
  const selectedGroupId = useAppStore((s) => s.selectedGroupId);
  const { eventLabels, journalLabels, memoLabels, labelsLoaded } = useLabels();
  const bindings = resolveBindings(shortcutOverrides);
  const assignedCount = SHORTCUT_ACTIONS.filter((a) => bindings[a.id].key).length;

  // 첨부를 구글 드라이브로 모으는 작업
  const [migrating, setMigrating] = useState(false);
  const [migrateProgress, setMigrateProgress] = useState<MigrationProgress | null>(null);
  const [migrateErrors, setMigrateErrors] = useState<string[]>([]);

  const handleDriveMigration = async () => {
    // 원본을 지우는 일이라 한 번 묻는다. 되돌릴 수 없다.
    const ok = window.confirm(
      [
        '첨부와 캡처 이미지를 구글 드라이브로 옮깁니다.',
        '드라이브에 올라간 것을 확인한 뒤 원본(Firebase Storage)을 지웁니다.',
        '지운 원본은 되돌릴 수 없습니다. 진행할까요?',
      ].join(String.fromCharCode(10))
    );
    if (!ok) return;
    setMigrating(true);
    setMigrateErrors([]);
    try {
      const result = await runDriveMigration(selectedGroupId, (p) => setMigrateProgress(p));
      setMigrateProgress(result);
      if (result.corsBlocked) {
        // 원인이 하나뿐이라 무엇을 하면 되는지만 보여준다. 원본은 하나도 지우지 않았다.
        setMigrateErrors([CORS_HELP]);
        showToast('아직 옮길 수 없습니다. 아래 안내를 확인해 주세요.');
        return;
      }
      setMigrateErrors(result.errors);
      if (result.failed === 0 && result.moved > 0) {
        showToast(`✅ ${result.moved}건을 구글 드라이브로 옮겼습니다.`);
      } else if (result.moved === 0 && result.failed === 0) {
        showToast('옮길 파일이 없습니다. 이미 모두 드라이브에 있습니다.');
      } else {
        showToast(`옮김 ${result.moved}건, 실패 ${result.failed}건. 아래 내용을 확인해 주세요.`);
      }
    } catch (e) {
      showErrorToast('옮기는 중 문제가 생겼습니다.', e);
    } finally {
      setMigrating(false);
    }
  };

  // 개발자 설정 - 공유 그룹 점검
  // 보안 규칙을 조이려면 '초대 코드 -> 그룹' 매핑이 모든 그룹에 있어야 한다.
  // 매핑이 없는 그룹은 '그룹 목록을 훑는' 폴백에 기대는데, 규칙을 조이면 그게 막힌다.
  const [groupAudit, setGroupAudit] = useState<
    { total: number; missing: { id: string; name: string; owner: string; mine: boolean }[] } | null
  >(null);
  // 규칙을 조인 뒤에는 '그룹 목록 전체 훑기' 자체가 막힌다. 그게 정상이고,
  // 그 사실이 곧 '규칙이 배포되었다'는 증거가 된다.
  const [rulesTightened, setRulesTightened] = useState(false);
  // 라벨 칩이 사라졌다는 신고를 가릴 때 쓴다. 클라우드를 못 읽은 것인지,
  // 클라우드에 아예 없는 것인지에 따라 손쓸 곳이 완전히 다르다.
  const [labelReport, setLabelReport] = useState<string[] | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [fixing, setFixing] = useState(false);

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
  /**
   * 그룹마다 '초대 코드 -> 그룹' 매핑 문서가 있는지 살핀다.
   *
   * 지금 규칙은 로그인한 사람이면 그룹 목록을 훑을 수 있어서 이 점검이 된다.
   * 규칙을 조이고 나면 이 점검 자체도 내 그룹만 보이게 되므로, 조이기 전에 한다.
   */
  const handleAuditGroups = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setAuditing(true);
    try {
      const snap = await getDocs(collection(db, 'groups'));
      const missing: { id: string; name: string; owner: string; mine: boolean }[] = [];
      for (const g of snap.docs) {
        const data = g.data() as any;
        if (!data.inviteCode) continue;
        const mapped = await getDoc(doc(db, 'inviteCodes', data.inviteCode));
        if (!mapped.exists()) {
          missing.push({
            id: g.id,
            name: data.name || '(이름 없음)',
            owner: data.ownerName || '알 수 없음',
            mine: data.ownerId === uid,
          });
        }
      }
      setGroupAudit({ total: snap.size, missing });
      setRulesTightened(false);
    } catch (e: any) {
      if (e?.code === 'permission-denied') {
        // 조인 규칙에서는 구성원만 그룹을 읽을 수 있어, 목록 전체 조회가 막힌다.
        setRulesTightened(true);
        setGroupAudit(null);
      } else {
        showErrorToast('그룹을 살펴보지 못했습니다.', e);
      }
    } finally {
      setAuditing(false);
    }
  };

  /** 규칙상 매핑 문서는 그룹장만 만들 수 있다. 내가 그룹장인 것만 채운다. */
  const handleFixMyGroups = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !groupAudit) return;
    setFixing(true);
    let made = 0;
    try {
      const snap = await getDocs(collection(db, 'groups'));
      for (const g of snap.docs) {
        const data = g.data() as any;
        if (data.ownerId !== uid || !data.inviteCode) continue;
        const ref = doc(db, 'inviteCodes', data.inviteCode);
        if ((await getDoc(ref)).exists()) continue;
        await setDoc(ref, { groupId: g.id, ownerId: uid, createdAt: Date.now() });
        made++;
      }
      showToast(`✅ 매핑 ${made}개를 만들었습니다.`);
      await handleAuditGroups();
    } catch (e) {
      showErrorToast('매핑을 만들지 못했습니다.', e);
    } finally {
      setFixing(false);
    }
  };

  /** 라벨이 지금 어디서 오고 있는지, 클라우드에 실제로 무엇이 있는지 그대로 보여 준다. */
  const handleLabelReport = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const lines: string[] = [];
    const d = labelDiagnostics;
    lines.push(`화면이 쓰는 출처: ${
      d.source === 'cloud' ? '클라우드' : d.source === 'legacy' ? 'V3 localStorage' :
      d.source === 'default' ? '기본값 (선생님 라벨을 못 찾음)' : '아직 못 읽음'
    }`);
    if (d.error) lines.push(`읽기 오류: ${d.error}`);
    if (d.migrateError) lines.push(`클라우드로 옮기기 실패: ${d.migrateError}`);
    if (d.migratedAt) lines.push(`클라우드로 옮긴 시각: ${new Date(d.migratedAt).toLocaleString('ko-KR')}`);

    try {
      // ⚠️ getDoc은 캐시 때문에 '없다'고 거짓으로 답할 수 있다.
      //    진단은 서버에 직접 물어야 의미가 있다.
      const snap = await getDocFromServer(doc(db, 'users', uid, 'settings', 'labels'));
      if (!snap.exists()) {
        lines.push('클라우드(settings/labels): 문서 없음 (서버에 직접 확인함)');
      } else {
        const data = snap.data() as any;
        const ev = Array.isArray(data.eventLabels) ? data.eventLabels : null;
        lines.push(`클라우드 일정 라벨: ${ev ? `${ev.length}개 — ${ev.map((l: any) => l.name).join(', ')}` : '없음'}`);
        const jr = Array.isArray(data.journalLabels) ? data.journalLabels : null;
        lines.push(`클라우드 기록 라벨: ${jr ? `${jr.length}개` : '없음'}`);
        const mm = Array.isArray(data.memoLabels) ? data.memoLabels : null;
        lines.push(`클라우드 메모 라벨: ${mm ? `${mm.length}개` : '없음'}`);
        if (data.updatedAt) lines.push(`마지막 저장: ${new Date(data.updatedAt).toLocaleString('ko-KR')}`);
      }
    } catch (e: any) {
      lines.push(`클라우드를 읽지 못함: ${e?.code || e?.message}`);
    }

    try {
      const raw = localStorage.getItem('workCalendar_eventLabels_v4');
      const arr = raw ? JSON.parse(raw) : null;
      lines.push(`이 기기 localStorage(V3 값): ${Array.isArray(arr) ? `${arr.length}개 — ${arr.map((l: any) => l.name).join(', ')}` : '없음'}`);
    } catch {
      lines.push('이 기기 localStorage(V3 값): 읽지 못함');
    }

    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('workCalendar'));
      lines.push(`이 기기의 V3 저장값 ${keys.length}개: ${keys.join(', ') || '없음'}`);
    } catch { /* 무시 */ }

    // ⚠️ 계정 주소가 같아도 uid가 다르면 서로 다른 문서를 보게 된다.
    //    V3와 V4는 Firebase 앱 이름이 달라 로그인 세션도 따로 갖는다.
    //    V3에서도 같은 값이 나와야 한 곳을 보고 있는 것이다.
    lines.push(`로그인 계정: ${auth.currentUser?.email || '알 수 없음'}`);
    lines.push(`내 uid: ${uid}`);
    lines.push(`보고 있는 공간: ${selectedGroupId ? `공유 그룹 (${selectedGroupId})` : '개인 공간'}`);

    // 일정이 라벨을 '이름'으로 들고 있는지 'ID'로만 들고 있는지.
    // 이름이면 정의가 없어도 칩을 보여 줄 수 있고, ID뿐이면 정의 없이는 복구가 안 된다.
    try {
      const col = selectedGroupId
        ? collection(db, 'groups', selectedGroupId, 'events')
        : collection(db, 'users', uid, 'events');
      const snap = await getDocs(col);
      const keys = new Set<string>();
      let withLabel = 0;
      let total = 0;
      snap.forEach((d) => {
        const list = (d.data() as any).eventList;
        if (!Array.isArray(list)) return;
        for (const e of list) {
          total++;
          let had = false;
          if (e.label) { String(e.label).split(',').forEach((k: string) => { const t = k.trim(); if (t) { keys.add(t); had = true; } }); }
          if (Array.isArray(e.labelIds)) { e.labelIds.forEach((k: any) => { const t = String(k ?? '').trim(); if (t) { keys.add(t); had = true; } }); }
          const m = String(e.content || '').match(/^\[(.*?)\]/);
          if (m) { keys.add(m[1].trim()); had = true; }
          if (had) withLabel++;
        }
      });
      const all = [...keys];
      const idLike = all.filter((k) => /^(ev|j|lbl)[_-]/i.test(k));
      lines.push(`일정 ${total}건 중 라벨이 붙은 것 ${withLabel}건`);
      lines.push(`일정이 들고 있는 라벨 값 ${all.length}가지: ${all.slice(0, 12).join(', ')}${all.length > 12 ? ' …' : ''}`);
      lines.push(`그중 이름이 아니라 ID처럼 보이는 것: ${idLike.length}가지`);
    } catch (e: any) {
      lines.push(`일정을 훑지 못함: ${e?.code || e?.message}`);
    }

    // ── 쓰기가 서버까지 닿는지 직접 재 본다 ────────────────────────
    // 여기까지 오게 된 사정: 라벨을 저장해도 다음에 보면 서버에 없었다.
    // 지우는 코드는 어디에도 없다. 그러면 애초에 서버에 닿지 않았다는 뜻인데,
    // Firestore는 오프라인 저장소에 먼저 쓰고 나중에 보내기 때문에 화면에서는
    // 저장된 것처럼 보인다. 작은 문서를 하나 써 보고 서버에서 도로 읽어 확인한다.
    try {
      const probeRef = doc(db, 'users', uid, 'settings', '_writeprobe');
      const stamp = Date.now();
      const t0 = performance.now();
      await setDoc(probeRef, { t: stamp }, { merge: true });
      const took = Math.round(performance.now() - t0);
      const back = await getDocFromServer(probeRef);
      if (back.exists() && back.data()?.t === stamp) {
        lines.push(`쓰기 시험: 서버까지 닿음 (${took}ms)`);
      } else {
        lines.push(`쓰기 시험: ❌ 저장은 됐다는데 서버에 없음 (${took}ms) — 오프라인 저장소가 깨진 상태`);
      }
    } catch (e: any) {
      lines.push(`쓰기 시험: ❌ 실패 — ${e?.code || e?.message}`);
    }

    setLabelReport(lines);
  };

  /**
   * 지금 화면이 쓰고 있는 라벨 정의를 공용 저장소(settings/labels)에 올린다.
   *
   * V3와 V4는 이 문서 하나를 같이 본다. 사본을 따로 두면 시간이 지나며 갈라지므로,
   * 사본을 만드는 것이 아니라 이 기기에만 있던 값을 공용 자리에 올리는 것이다.
   * V3가 라벨을 localStorage에 두고 클라우드에는 바뀔 때만 써 온 탓에 그 자리가
   * 비어 있을 수 있다. 비면 사용기록을 지우는 순간 라벨 정의가 사라지고,
   * 일정은 라벨을 id(lbl_ev_...)로 들고 있어서 대응표 없이는 이름을 알 길이 없다.
   */
  const handlePinLabels = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (!labelsLoaded) {
      showErrorToast('지금은 선생님 라벨을 못 찾은 상태라 저장할 것이 없습니다. V3를 먼저 열어 라벨이 보이게 한 뒤 눌러 주세요.');
      return;
    }
    try {
      const ref = doc(db, 'users', uid, 'settings', 'labels');
      await setDoc(
        ref,
        { eventLabels: eventLabels.map(toSharedEventLabel), journalLabels, memoLabels, updatedAt: Date.now() },
        { merge: true }
      );

      // ⚠️ '저장했다'를 그대로 믿으면 안 된다. Firestore는 오프라인 저장소에
      //    먼저 쓰고 나중에 서버로 보낸다. 그 층이 깨져 있으면 화면에는 저장된
      //    것처럼 보이는데 서버에는 영영 안 간다. 실제로 그렇게 라벨이 사라졌다.
      //    서버에 직접 읽어 확인한다.
      const check = await getDocFromServer(ref);
      const saved = (check.data()?.eventLabels || []).length;
      if (saved > 0) {
        showToast(`✅ 라벨 ${saved}개를 공용 저장소에 올렸습니다. 서버에서 확인했습니다.`);
      } else {
        showErrorToast(
          '저장은 했는데 서버에서 확인되지 않습니다. 이 기기의 오프라인 저장소가 깨졌을 수 있습니다. 새로고침한 뒤 다시 시도해 주세요.'
        );
      }
      await handleLabelReport();
    } catch (e) {
      showErrorToast('라벨을 저장하지 못했습니다.', e);
    }
  };

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

        {/* 글자 크기만 '저장'을 기다리지 않고 고르는 즉시 바꾼다. 크기는 눈으로
            보고 정하는 것이라, 저장한 뒤에야 보인다면 몇 번을 오가게 된다. */}
        <Section title="글자 크기" desc="고르는 즉시 화면에 적용됩니다. 이 기기에만 저장됩니다.">
          <div className="flex flex-wrap gap-1.5">
            {FONT_SCALES.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setFontScale(opt.id)}
                aria-pressed={fontScale === opt.id}
                className={`px-3 py-1.5 rounded-lg font-bold border transition-all ${
                  fontScale === opt.id
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-primary hover:text-primary'
                }`}
                // 단계마다 그 크기로 적어 둔다. 이름만으로는 얼마나 달라지는지
                // 알 수 없어, 고르기 전에 한 번씩 눌러 보게 된다.
                style={{ fontSize: `calc(0.75rem * ${opt.percent} / 100)` }}
              >
                {opt.label}
              </button>
            ))}
          </div>
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

        {/* 첨부 파일을 구글 드라이브 한 곳으로 모은다.
            예전에는 V3가 파일 첨부는 드라이브, 이미지는 Firebase Storage에 두었고
            V4는 둘 다 Storage였다. 그래서 같은 사람의 첨부가 흩어져 있었다. */}
        <Section
          title="첨부 파일을 구글 드라이브로 모으기"
          desc="지금까지 Firebase Storage에 올라가 있던 첨부와 캡처 이미지를 구글 드라이브(School_Planner 폴더)로 옮깁니다. 옮긴 것이 드라이브에 있는지 확인한 뒤에만 원본을 지웁니다."
        >
          <button
            onClick={handleDriveMigration}
            disabled={migrating}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all"
          >
            {migrating ? '옮기는 중...' : '드라이브로 옮기기'}
          </button>
          {migrateProgress && (
            <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 leading-relaxed">
              <p>
                {migrateProgress.scanned} / {migrateProgress.total} 건 처리 · 옮김{' '}
                {migrateProgress.moved} · 원본 삭제 {migrateProgress.deleted}
                {migrateProgress.failed > 0 && ` · 실패 ${migrateProgress.failed}`}
              </p>
              {migrateProgress.current && (
                <p className="text-slate-400 break-all mt-1">{migrateProgress.current}</p>
              )}
            </div>
          )}
          {migrateErrors.length > 0 && (
            <pre className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-2xs text-amber-900 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
              {migrateErrors.join(String.fromCharCode(10))}
            </pre>
          )}
        </Section>

        {developer && (
          <Section
            title="🔧 개발자 설정 - 라벨 상태"
            desc="V3와 V4는 라벨을 한 문서(settings/labels)에서 같이 씁니다. 그 자리가 비어 있으면 라벨 칩이 사라집니다. 상태를 보고, 비어 있으면 올릴 수 있습니다."
          >
            <button
              onClick={handleLabelReport}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all"
            >
              라벨 상태 보기
            </button>
            <button
              onClick={handlePinLabels}
              className="ml-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all"
            >
              라벨을 공용 저장소에 올리기
            </button>
            {labelReport && (
              <pre className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                {labelReport.join(String.fromCharCode(10))}
              </pre>
            )}
          </Section>
        )}

        {developer && (
          <Section
            title="🔧 개발자 설정 - 공유 그룹 점검"
            desc="조이기 전에는 매핑이 빠진 그룹을 찾아 줍니다. 조인 뒤에는 목록 조회 자체가 막히므로, 이 단추가 권한 거부를 내는 것이 곧 규칙이 배포되었다는 뜻입니다."
          >
            <button
              onClick={handleAuditGroups}
              disabled={auditing}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-60"
            >
              {auditing ? '살펴보는 중...' : '지금 점검하기'}
            </button>

            {rulesTightened && (
              <p className="mt-3 text-xs text-emerald-800 font-bold bg-emerald-50 border border-emerald-200 rounded-xl p-3 leading-relaxed">
                ✅ 규칙이 이미 조여져 있습니다.
                <br />
                <span className="font-semibold text-emerald-700">
                  그룹 목록 전체 조회가 권한 거부로 막혔습니다. 조이기 전에는 로그인한 사람이면
                  누구나 이 목록을 볼 수 있었습니다. 지금은 내가 속한 그룹만 보입니다.
                </span>
              </p>
            )}

            {groupAudit && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-bold text-slate-700">
                  그룹 {groupAudit.total}개 중 매핑이 없는 그룹 {groupAudit.missing.length}개
                </p>
                {groupAudit.missing.length === 0 ? (
                  <p className="text-xs text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                    모든 그룹에 매핑이 있습니다. 규칙을 조여도 초대 코드 참여가 막히지 않습니다.
                  </p>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      {groupAudit.missing.map((g) => (
                        <div
                          key={g.id}
                          className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-xs"
                        >
                          <span className="font-bold text-amber-900 truncate flex-1">{g.name}</span>
                          <span className="text-amber-700 shrink-0">
                            {g.mine ? '내 그룹' : `${g.owner} 님의 그룹`}
                          </span>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={handleFixMyGroups}
                      disabled={fixing || groupAudit.missing.every((g) => !g.mine)}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-40"
                    >
                      {fixing ? '만드는 중...' : '내 그룹의 매핑 만들기'}
                    </button>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      남의 그룹 매핑은 규칙상 그룹장만 만들 수 있습니다. 그 그룹장이 앱을 한 번 열면
                      자동으로 채워집니다. 여기 목록이 비워진 뒤에 규칙을 조이세요.
                    </p>
                  </>
                )}
              </div>
            )}
          </Section>
        )}

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
