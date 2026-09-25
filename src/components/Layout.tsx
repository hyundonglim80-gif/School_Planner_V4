//src/components/Layout.tsx

import { lazyWithReload } from '../lib/lazyWithReload';
import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { useAuth } from '../features/auth/useAuth';
import { useAppStore } from '../store/useAppStore';
import { useGroups } from '../hooks/useGroups';
import { useDDay, calculateDDay } from '../hooks/useDDay';
import { formatDateStr, isToday } from '../lib/dateUtils';
// 모달은 처음 열 때 받아오면 충분하다. 전부 첫 화면 번들에 넣으면
// 초기 로딩만 느려지므로, 열릴 때만 그려서 그때 청크를 내려받는다.
const GroupModal = lazyWithReload(() => import('./GroupModal'));
const DDayModal = lazyWithReload(() => import('./DDayModal'));
const SearchModal = lazyWithReload(() => import('./SearchModal'));
const RosterModal = lazyWithReload(() => import('./RosterModal'));
const LabelModal = lazyWithReload(() => import('./LabelModal'));
const BackupModal = lazyWithReload(() => import('./BackupModal'));
const HelpModal = lazyWithReload(() => import('./HelpModal'));
const TimetableTemplateModal = lazyWithReload(() => import('./TimetableTemplateModal'));
const SettingsModal = lazyWithReload(() => import('./SettingsModal'));
const EvaluationModal = lazyWithReload(() => import('./EvaluationModal'));
const RecurringModal = lazyWithReload(() => import('./RecurringModal'));
const ForwardingModal = lazyWithReload(() => import('./ForwardingModal'));
// 연결된 링크 팝업에서 여는 편집기 (일정/수업은 팝업, 기록/메모는 옆 배너)
const DetailEditModal = lazyWithReload(() => import('./DetailEditModal'));
const LinkedEntryEditorHost = lazy(() =>
  import('./LinkedEntryEditor').then((m) => ({ default: m.LinkedEntryEditorHost }))
);
const JournalPeekHost = lazy(() =>
  import('./JournalPeekModal').then((m) => ({ default: m.JournalPeekHost }))
);
const LinkerModal = lazyWithReload(() => import('./LinkerModal'));
const LinkViewerModal = lazyWithReload(() => import('./LinkViewerModal'));
const TrashModal = lazyWithReload(() => import('./TrashModal'));
const CalendarSyncModal = lazyWithReload(() => import('./CalendarSyncModal'));

import MultiEventActionBar from './MultiEventActionBar';
import MiniCalendarPicker from './MiniCalendarPicker';
import MobileTabBar from './MobileTabBar';
import { useGlobalGestures } from '../hooks/useGlobalGestures';
import {
  SHORTCUT_ACTIONS,
  resolveBindings,
  matchesEvent,
  isModifierOnly,
  formatActionBinding,
  type ShortcutId,
} from '../lib/shortcuts';
import { showToast, showErrorToast } from '../utils/toast';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { logout, user } = useAuth();
  const {
    scope,
    setScope,
    navigatePrevDate,
    navigateNextDate,
    selectedGroupId,
    setSelectedGroupId,
    currentDate,
    setCurrentDate,
    showWeekend,
    setShowWeekend,
    showClass,
    setShowClass,
    showEvents,
    setShowEvents,
    shortcutOverrides,
    semesterFilter,
    setSemesterFilter,
    isLinkerModalOpen,
    linkerSourceType,
    linkerSourceDateStr,
    linkerSourceId,
    linkerSourcePeriod,
    linkerSourceFId,
    closeLinkerModal,
    isEvaluationModalOpen,
    evalDateStr,
    evalSource,
    evalPeriod,
    evalSubject,
    closeEvaluationModal,
    isMultiSelectMode,
    setMultiSelectMode,
    isTrashModalOpen,
    setTrashModalOpen,
    isLinkViewerModalOpen,
    linkViewerSourceType,
    linkViewerSourceDateStr,
    linkViewerSourceId,
    linkViewerSourcePeriod,
    linkViewerSourceFId,
    closeLinkViewerModal,
    isDetailEditOpen,
    detailEditTarget,
    closeDetailEdit,
    isLabelModalOpen,
    labelModalTab,
    openLabelModal,
    closeLabelModal,
    // 💡 스크롤 네비게이션 상태 가져오기
  } = useAppStore();
  const { groups, loading: groupsLoading } = useGroups();
  const { primaryDDay } = useDDay();

  // 왼쪽 ⏳ 배지는 늘 오늘을 센다. 'D-100'은 오늘부터 100일이라는 뜻이고, 그
  // 배지는 모든 화면에 떠 있어 기준이 화면마다 달라지면 알아볼 수가 없다.
  //
  // 대신 하루 화면에서 다른 날을 펼쳐 놓았을 때는 그 날 기준도 궁금하다.
  // 날짜 바로 옆에 두어 '이 날짜에 딸린 것'으로 읽히게 하고, 기준을 글로
  // 적어 둔다. 오늘을 보고 있을 때는 ⏳ 배지와 값이 같으므로 내보내지 않는다.
  // 주간·월간·년간은 '보고 있는 날'이 하나가 아니라 여기서 뺀다.
  const viewedDateStr = formatDateStr(new Date(currentDate));
  const dDayHere =
    scope === 'day' && primaryDDay && !isToday(viewedDateStr)
      ? calculateDDay(primaryDDay.date, viewedDateStr)
      : null;

  // 어느 계정으로 들어와 있는지 언제든 확인할 수 있게 한다. 계정이 여럿인 경우
  // V3와 다른 계정으로 들어와도 화면만 봐서는 알 수가 없었다.
  const accountTitle = user?.email
    ? `${user.displayName || '사용자'} (${user.email})`
    : user?.displayName || '사용자';

  // 💡 그룹을 탈퇴/삭제해도 selectedGroupId가 그 그룹을 계속 가리켰다. 이후 모든
  // 읽기/쓰기가 권한 거부로 조용히 실패해서 화면에는 텅 빈 달력만 보였다.
  useEffect(() => {
    if (groupsLoading || !selectedGroupId) return;
    if (!groups.some((g) => g.id === selectedGroupId)) {
      setSelectedGroupId(null);
    }
  }, [groupsLoading, groups, selectedGroupId, setSelectedGroupId]);

  useGlobalGestures();

  // 모달 상태 관리
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isDDayModalOpen, setIsDDayModalOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isRosterModalOpen, setIsRosterModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isRecurringModalOpen, setIsRecurringModalOpen] = useState(false);
  const [isForwardingModalOpen, setIsForwardingModalOpen] = useState(false);
  const [isTimetableModalOpen, setIsTimetableModalOpen] = useState(false);
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);

  // 더보기 드롭다운 상태
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // 머리줄 높이를 --app-header-h로 알려 둔다. 머리줄에 붙어 따라 내려가는
  // 칸(메모 화면의 라벨 거르개 등)이 그만큼 아래에 멈춘다. 머리줄은 줄바꿈과
  // D-Day 표시에 따라 높이가 달라지므로 재서 쓴다.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => {
      root.style.setProperty('--app-header-h', `${el.offsetHeight}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--app-header-h');
    };
  }, []);

  // 환경설정 > 시작 화면. 'last'면 마지막에 보던 화면(scope는 이미 저장돼 있다)을
  // 그대로 두고, 아니면 정해둔 화면으로 한 번만 옮긴다.
  useEffect(() => {
    const startupScope = useAppStore.getState().startupScope;
    if (startupScope !== 'last') setScope(startupScope);
    // 처음 한 번만. 뒤에 사용자가 탭을 바꾸면 그대로 둬야 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleInstallPWA = async () => {
    setIsMoreMenuOpen(false);
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      showErrorToast("이미 기기에 설치되어 있거나 현재 브라우저 환경에서 직접 설치를 지원하지 않습니다.\n\n[아이폰/아이패드(Safari)의 경우]\n하단의 '공유(내보내기)' 아이콘을 누르고 '홈 화면에 추가'를 선택하여 수동으로 설치할 수 있습니다.");
    }
  };

  // 외부 클릭 시 더보기 메뉴 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 상단 2행 날짜 네비게이션 함수들
  const handlePrevDate = () => navigatePrevDate();
  const handleNextDate = () => navigateNextDate();

  // 💡 날짜만 오늘로 바꾸면, 이미 이번 달/주를 보고 있을 때는 아무 일도 안 일어난 것처럼
  // 보인다. V3처럼 오늘 칸을 화면 안으로 끌어와 보여준다.
  // 다른 달로 넘어가는 경우에는 새로 그려진 뒤에 찾아야 해서 몇 번 더 시도한다.
  const scrollToToday = (tries = 6) => {
    const el = document.querySelector('[data-today="true"]') as HTMLElement | null;
    // 접혀 있는 달 안에 있으면(offsetParent가 없다) 스크롤해도 소용이 없다
    if (el && el.offsetParent !== null) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (tries > 0) {
      requestAnimationFrame(() => scrollToToday(tries - 1));
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleTodayClick = () => {
    useAppStore.getState().setCurrentDate(new Date());
    requestAnimationFrame(() => scrollToToday());
  };

  // 화면에 무엇을 보여줄지 정하는 토글. 상단 줄과 ⋮ 메뉴가 같은 정의를 쓴다.
  // showEvents는 값과 화면 연결은 되어 있었는데 누르는 자리가 없어서 늘 켜짐이었다.
  // 툴팁의 단축키는 실제 설정값에서 가져온다. 적어두면 환경설정에서 바꿨을 때 거짓말이 된다.
  const shortcutHint = (id: ShortcutId) => {
    const action = SHORTCUT_ACTIONS.find((a) => a.id === id)!;
    return formatActionBinding(action, resolveBindings(shortcutOverrides)[id]);
  };
  const viewToggles = [
    { key: 'weekend', label: '주말', on: showWeekend, set: setShowWeekend, hint: shortcutHint('toggleWeekend') },
    { key: 'events', label: '일정', on: showEvents, set: setShowEvents, hint: shortcutHint('toggleEvents') },
    { key: 'class', label: '수업', on: showClass, set: setShowClass, hint: shortcutHint('toggleClass') },
  ];

  // 단축키 하나가 실제로 하는 일.
  // 조합(어떤 키냐)은 lib/shortcuts.ts가, 동작(무엇을 하냐)은 여기가 맡는다.
  const runShortcut = (id: ShortcutId) => {
    const scopeOrder: Array<'day' | 'week' | 'month' | 'year' | 'memo'> = ['day', 'week', 'month', 'year', 'memo'];
    const store = useAppStore.getState();

    switch (id) {
      case 'search': setIsSearchModalOpen(true); return;
      case 'scopeDay': setScope('day'); return;
      case 'scopeWeek': setScope('week'); return;
      case 'scopeMonth': setScope('month'); return;
      case 'scopeYear': setScope('year'); return;
      case 'scopeMemo': setScope('memo'); return;
      case 'scopePrev':
      case 'scopeNext': {
        const currentIndex = scopeOrder.indexOf(store.scope);
        if (currentIndex === -1) return;
        const step = id === 'scopeNext' ? 1 : -1;
        setScope(scopeOrder[(currentIndex + step + scopeOrder.length) % scopeOrder.length]);
        return;
      }
      case 'datePrev': handlePrevDate(); return;
      case 'dateNext': handleNextDate(); return;
      case 'dateToday': handleTodayClick(); return;
      case 'toggleWeekend': setShowWeekend(!store.showWeekend); return;
      case 'toggleEvents': setShowEvents(!store.showEvents); return;
      case 'toggleClass': setShowClass(!store.showClass); return;

      // 메뉴 열기. 기본값이 비어 있어서, 사용자가 키를 정해야 동작한다.
      case 'multiSelect': setMultiSelectMode(!store.isMultiSelectMode); return;
      case 'calendar': setIsCalendarModalOpen(true); return;
      case 'dday': setIsDDayModalOpen(true); return;
      case 'trash': setTrashModalOpen(true); return;
      case 'labels': openLabelModal('event'); return;
      case 'recurring': setIsRecurringModalOpen(true); return;
      case 'forwarding': setIsForwardingModalOpen(true); return;
      case 'roster': setIsRosterModalOpen(true); return;
      case 'group': setIsGroupModalOpen(true); return;
      case 'timetable': setIsTimetableModalOpen(true); return;
      case 'backup': setIsBackupModalOpen(true); return;
      case 'help': setIsHelpModalOpen(true); return;
      case 'settings': setIsSettingsModalOpen(true); return;
    }
  };

  // 키보드 단축키 핸들러. 고정 키(ESC, Ctrl+S 차단, / 검색)와
  // 환경설정에서 바꿀 수 있는 단축키를 함께 처리한다.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

      // 1. 브라우저 기본 '다른 이름으로 저장' (Ctrl+S / Cmd+S) 잠금
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
        e.preventDefault();
        // V4의 항목 저장은 각 입력창의 onKeyDown 이벤트에서 자체 처리되므로, 
        // 전역(Layout)에서는 브라우저 저장 팝업이 뜨는 것만 완벽히 차단합니다.
        return;
      }

      // 통합 검색(기본 Ctrl+F)은 아래 단축키 목록이 맡는다. 거기서 preventDefault를
      // 하므로 브라우저 찾기창도 뜨지 않는다. 다른 키로 바꾸면 Ctrl+F는 브라우저 몫이 된다.

      // ESC: 열려있는 모든 모달 및 메뉴 닫기
      if (e.key === 'Escape') {
        setIsHelpModalOpen(false);
        setIsHelpModalOpen(false);
        setIsSearchModalOpen(false);
        setIsGroupModalOpen(false);
        setIsBackupModalOpen(false);
        closeLabelModal();
        setIsDDayModalOpen(false);
        setIsRosterModalOpen(false);
        setIsSettingsModalOpen(false);
        setIsRecurringModalOpen(false);
        setIsTimetableModalOpen(false);
        setIsCalendarModalOpen(false);
        setIsMoreMenuOpen(false);
        if (isForwardingModalOpen) {
          setIsForwardingModalOpen(false);
        }
        closeLinkerModal();
        closeLinkViewerModal();
        closeEvaluationModal();
        setTrashModalOpen(false);
        return;
      }

      // 환경설정 > 단축키에서 정한 조합들. 정의는 lib/shortcuts.ts 한 곳에 있다.
      if (isModifierOnly(e)) return;
      const bindings = resolveBindings(useAppStore.getState().shortcutOverrides);

      for (const action of SHORTCUT_ACTIONS) {
        const binding = bindings[action.id];
        if (!matchesEvent(binding, e, action)) continue;
        // 입력칸에 글자를 쓰는 중이면 수식키 없는 단축키는 무시한다(글자가 먹히지 않으면 곤란하다)
        if (isInput && !binding.ctrl && !binding.alt) continue;

        e.preventDefault();
        setIsMoreMenuOpen(false);
        runShortcut(action.id);
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    setShowWeekend,
    setShowClass,
    setShowEvents,
    setScope,
    isForwardingModalOpen,
    closeLinkerModal,
    closeLinkViewerModal,
    closeEvaluationModal,
    setTrashModalOpen
  ]);

  const getFormattedDateRange = () => {
    const d = new Date(currentDate);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const dt = d.getDate();
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = dayNames[d.getDay()];

    if (scope === 'day') {
      return `${y}년 ${m}월 ${dt}일 (${dayName})`;
    }
    if (scope === 'week') {
      const target = new Date(d);
      target.setDate(target.getDate() - target.getDay() + 4); 
      const y_week = target.getFullYear();
      const m_week = target.getMonth() + 1;
      const firstDayOfMonth = new Date(target.getFullYear(), target.getMonth(), 1);
      const firstDayOfWeek = firstDayOfMonth.getDay(); 
      const weekNumber = Math.ceil((target.getDate() + firstDayOfWeek) / 7);
      return `${y_week}년 ${m_week}월 ${weekNumber}주`;
    }
    if (scope === 'month') {
      return `${y}년 ${m}월`;
    }
    if (scope === 'year') {
      const academicYear = m < 3 ? y - 1 : y;
      return `${academicYear}학년도`;
    }
    return '전체 메모';
  };

  const scopes = [
    { id: 'day', label: '하루' },
    { id: 'week', label: '주간' },
    { id: 'month', label: '월간' },
    { id: 'year', label: '년간' },
    { id: 'memo', label: '메모' },
  ] as const;

  return (
    <div className="min-h-screen bg-bg-body text-slate-900">
      <header ref={headerRef} className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm px-4 py-3 border-b border-border shadow-xs flex flex-col gap-2.5">
        <div className="flex items-center gap-2 max-w-7xl mx-auto w-full">
          {/* 상단 메뉴 영역 (스크롤 없이 버튼 크기 축소로 한 줄 유지) */}
          <div className="flex items-center justify-between flex-1 gap-0.5 sm:gap-4 pr-1 sm:pr-2 min-w-0">
            
            {/* 좌측: 로고 및 기능 버튼들 */}
            <div className="flex items-center gap-0.5 sm:gap-2 shrink">
              <h1 className="text-base sm:text-xl font-extrabold text-primary tracking-tighter pr-0 sm:pr-1 shrink-0">SP4</h1>

              {/* D-Day 뱃지 버튼 */}
              <button
                onClick={() => setIsDDayModalOpen(true)}
                className="p-1 sm:px-2.5 sm:py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-md sm:rounded-xl text-xs sm:text-xs font-bold transition-all flex items-center gap-0 sm:gap-1 shadow-2xs shrink-0"
                title="학사 D-Day 관리"
              >
                <span>⏳</span>
                {primaryDDay ? (
                  <>
                    {/* 좁은 화면에서도 남은 날짜는 보여준다. 예전에는 통째로 숨겨서
                        휴대폰에서는 D-Day가 아예 없는 것처럼 보였다. */}
                    <span className="hidden sm:inline">{primaryDDay.title}</span>
                    <strong className="text-rose-600 font-extrabold text-xs sm:text-xs">
                      {primaryDDay.text}
                    </strong>
                  </>
                ) : (
                  <span className="hidden sm:inline">D-Day</span>
                )}
              </button>

              {/* 캘린더·휴지통은 좁은 화면에서 ⋮ 메뉴로 내린다 */}
              <button
                onClick={() => setIsCalendarModalOpen(true)}
                className="hidden sm:flex px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200/80 rounded-xl text-xs font-bold transition-all items-center gap-1 shadow-2xs shrink-0"
                title={`구글 캘린더로 보내기 (단축키: ${shortcutHint('calendar')})`}
              >
                <span>📅</span>
                <span>캘린더</span>
              </button>

              <button
                onClick={() => setTrashModalOpen(true)}
                className="hidden sm:flex px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all items-center gap-1 shadow-2xs shrink-0"
                title="휴지통"
              >
                <span>🗑️</span>
                <span>휴지통</span>
              </button>
            </div>

            {/* 우측: 검색, 스코프 탭, 그룹 선택 */}
            <div className="flex items-center gap-0.5 sm:gap-2 shrink min-w-0">
              {/* 통합 검색 버튼 */}
            <button
              onClick={() => setIsSearchModalOpen(true)}
              className="p-1 sm:px-2.5 sm:py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md sm:rounded-xl text-xs sm:text-xs font-bold transition-all flex items-center gap-0 sm:gap-1 shrink-0"
              title={`통합 검색 (단축키: ${shortcutHint('search')})`}
            >
              <span>🔍</span>
              <span className="hidden sm:inline">검색</span>
            </button>

            {/* 스코프 탭 버튼 그룹 - 좁은 화면에서는 하단 탭바(MobileTabBar)가 대신한다 */}
            <div className="hidden sm:flex bg-slate-100 p-1 rounded-xl gap-1 shrink-0 overflow-hidden">
              {scopes.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setScope(s.id)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    scope === s.id
                      ? 'bg-white text-primary shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* 그룹 선택 셀렉트 */}
            {groups.length > 0 && (
              <div className="flex items-center gap-0.5 sm:gap-1.5 bg-slate-50 border border-slate-200 rounded-md sm:rounded-xl px-1 sm:px-2.5 py-1 shrink-0 min-w-0">
                <span className="text-xs sm:text-xs shrink-0">📂</span>
                <select
                  value={selectedGroupId || ''}
                  onChange={(e) => setSelectedGroupId(e.target.value ? e.target.value : null)}
                  className="bg-transparent text-xs sm:text-xs font-bold text-slate-700 focus:outline-none cursor-pointer pr-1 w-12 sm:w-auto truncate tracking-tighter"
                >
                  <option value="">🔒 개인 공간</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      👥 {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            </div>
          </div>

          {/* 우측 고정 영역 (더보기, 프로필) - 스크롤 밖으로 분리하여 드롭다운이 잘리지 않게 함 */}
          <div className="flex items-center gap-0.5 sm:gap-2 shrink-0 pl-1 border-l border-slate-200">
            {/* 🔥 V3와 동일한 더보기 (⋮) 드롭다운 메뉴 */}
            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                className="w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 font-black rounded-md sm:rounded-xl text-sm sm:text-base transition-colors"
                title="더보기 메뉴"
              >
                ⋮
              </button>

              {isMoreMenuOpen && (
                <div className="absolute right-0 top-10 w-56 max-h-[70vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-50 animate-fade-in text-xs">

                  {/* 좁은 화면에서 상단에 둘 자리가 없어 내려온 항목들 */}
                  <div className="sm:hidden border-b border-slate-200 pb-1 mb-1">
                    <button
                      onClick={() => { setIsMoreMenuOpen(false); setIsCalendarModalOpen(true); }}
                      className="w-full px-4 py-2.5 text-left font-bold text-slate-700 hover:bg-slate-50 hover:text-primary flex items-center gap-2"
                    >
                      <span>📅</span> 구글 캘린더로 보내기
                    </button>
                    <button
                      onClick={() => { setIsMoreMenuOpen(false); setTrashModalOpen(true); }}
                      className="w-full px-4 py-2.5 text-left font-bold text-slate-700 hover:bg-slate-50 hover:text-primary flex items-center gap-2"
                    >
                      <span>🗑️</span> 휴지통
                    </button>
                    {/* 표시 토글 - 상단 줄과 같은 정의를 쓰고, 켜짐/꺼짐을 같은 모양으로 보여준다 */}
                    <div className="px-4 py-2.5 flex items-center gap-2">
                      <span className="font-bold text-slate-700 shrink-0">표시</span>
                      <div className="flex items-center gap-1.5 ml-auto">
                        {viewToggles.map((t) => (
                          <button
                            key={t.key}
                            onClick={() => t.set(!t.on)}
                            aria-pressed={t.on}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
                              t.on
                                ? 'bg-primary text-white border-primary'
                                : 'bg-white text-slate-400 border-slate-200 line-through decoration-slate-300'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => { setIsMoreMenuOpen(false); logout(); }}
                      className="w-full px-4 py-2.5 text-left font-bold text-red-600 hover:bg-red-50 flex items-center gap-2"
                    >
                      <span>🚪</span> 로그아웃
                    </button>
                  </div>

                  {/* '스크롤 페이지 이동'은 환경설정으로 옮겼다. 켜고 끄는 자리가
                      두 군데면 어느 쪽이 지금 값인지 헷갈린다. */}
                  <button
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      setMultiSelectMode(!isMultiSelectMode);
                    }}
                    className="w-full px-4 py-2.5 text-left font-bold text-slate-700 hover:bg-slate-50 hover:text-primary flex items-center gap-2 border-b border-dashed border-slate-100"
                  >
                    <span>☑️</span> 다중 선택 모드 {isMultiSelectMode ? '종료' : '켜기'}
                  </button>

                  <button
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      openLabelModal('event');
                    }}
                    className="w-full px-4 py-2.5 text-left font-bold text-slate-700 hover:bg-slate-50 hover:text-primary flex items-center gap-2"
                  >
                    <span>🏷️</span> 통합 라벨 관리
                  </button>

                  {/* 반복 일정 등록 / 미완료 일정 가져오기.
                      둘 다 만들어져 있었는데 여는 자리가 없어 화면에서 닿을 수 없었다. */}
                  <button
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      setIsRecurringModalOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-left font-bold text-slate-700 hover:bg-slate-50 hover:text-primary flex items-center gap-2 border-t border-dashed border-slate-100"
                  >
                    <span>🔁</span> 반복 일정 등록
                  </button>

                  <button
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      setIsForwardingModalOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-left font-bold text-slate-700 hover:bg-slate-50 hover:text-primary flex items-center gap-2"
                  >
                    <span>📥</span> 미완료 일정 가져오기
                  </button>

                  <button
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      setIsRosterModalOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-left font-bold text-slate-700 hover:bg-slate-50 hover:text-primary flex items-center gap-2 border-t border-dashed border-slate-100"
                  >
                    <span>🧑‍🤝‍🧑</span> 학급 정보(명렬표) 관리
                  </button>

                  <button
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      setIsGroupModalOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-left font-bold text-slate-700 hover:bg-slate-50 hover:text-primary flex items-center gap-2 border-t border-dashed border-slate-100"
                  >
                    <span>👥</span> 공유 그룹 관리
                  </button>

                  <button
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      setIsTimetableModalOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-left font-bold text-slate-700 hover:bg-slate-50 hover:text-primary flex items-center gap-2 border-t border-dashed border-slate-100"
                  >
                    <span>⏰</span> 시간표 적용 (주간 템플릿)
                  </button>

                  <button
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      setIsBackupModalOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-left font-bold text-slate-700 hover:bg-slate-50 hover:text-primary flex items-center gap-2 border-t border-dashed border-slate-100"
                  >
                    <span>💾</span> 내보내기 / 가져오기 (백업)
                  </button>

                  <button
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      setIsSettingsModalOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-left font-bold text-slate-700 hover:bg-slate-50 hover:text-primary flex items-center gap-2 border-t border-dashed border-slate-100"
                  >
                    <span>⚙️</span> 환경설정
                  </button>

                  <button
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      setIsHelpModalOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-left font-bold text-slate-700 hover:bg-slate-50 hover:text-primary flex items-center gap-2 border-t border-dashed border-slate-100"
                  >
                    <span>💡</span> 사용 설명서 및 단축키
                  </button>

                  <button
                    onClick={handleInstallPWA}
                    className="w-full px-4 py-2.5 text-left font-bold text-emerald-600 hover:bg-emerald-50 flex items-center gap-2 border-t border-dashed border-slate-100"
                  >
                    <span>📱</span> 앱 설치하기 (PWA)
                  </button>
                </div>
              )}
            </div>

            {/* 사용자 프로필 및 로그아웃 */}
            <div className="flex items-center gap-2 pl-1">
              {/* ✨ 구글 프로필 사진 출력 */}
              {user?.photoURL ? (
                <img 
                  src={user.photoURL} 
                  alt="Profile" 
                  className="w-6 h-6 sm:w-8 sm:h-8 rounded-full border-2 border-white shadow-sm object-cover"
                  title={accountTitle}
                />
              ) : (
                <div
                  className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center text-xs font-bold text-slate-500 shadow-sm"
                  title={accountTitle}
                >
                  {(user?.displayName || '선').charAt(0)}
                </div>
              )}
              {/* 로그아웃은 좁은 화면에서 ⋮ 메뉴로 내린다 */}
              <button
                onClick={logout}
                className="hidden sm:block px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 rounded-xl font-bold text-xs transition-colors shrink-0 ml-1"
              >
                로그아웃
              </button>
            </div>
          </div>
        </div>
        {/* 🔥 상단 2행: 좌측(옵션 버튼), 중앙(가운데 정렬: ◀ 날짜(클릭 시 오늘) ▶) - 메모 뷰에서는 표시하지 않음 */}
        {/* 💡 좁은 화면에서는 줄을 바꾼다.
            예전에는 한 줄에 억지로 밀어 넣느라, 년간 화면에서 '2학기' 칩 위에
            날짜 이동 '◀'가 그대로 올라앉았다(18px 겹침). 2학기를 누르면 이전
            학년도로 넘어갔다. 가운데 날짜 칸이 flex-1이라 내용보다 작게 줄면서
            왼쪽으로 삐져나온 것이 원인이었다.
            날짜 이동은 모든 화면에 공통이므로 좁은 화면에서도 늘 첫 줄에 둔다. */}
        {scope !== 'memo' && (
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-between border-t border-dashed border-slate-200 pt-2.5 mt-0.5 max-w-7xl mx-auto w-full gap-2 sm:overflow-x-auto">
            {/* 년간의 학기 칩.
                ⚠️ 좁은 화면에서는 아랫줄로 내린다. 토글 셋과 날짜 이동만으로도
                   360px가 꽉 차서, 학기 칩까지 같은 줄에 두면 '▶'가 4px 밀려
                   나갔다(실제로 그랬다). PC에서는 예전처럼 토글 왼쪽에 선다. */}
            {scope === 'year' && (
              <div className="order-3 w-full sm:order-1 sm:w-auto flex-none">
                <div className="inline-flex bg-slate-100 p-0.5 rounded-xl gap-0.5">
                  <button
                    onClick={() => setSemesterFilter('all')}
                    className={`px-1.5 py-0.5 text-2xs sm:px-2 sm:py-1 sm:text-xs rounded-lg font-bold whitespace-nowrap transition-all ${semesterFilter === 'all' ? 'bg-white text-primary shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    전체
                  </button>
                  <button
                    onClick={() => setSemesterFilter(1)}
                    className={`px-1.5 py-0.5 text-2xs sm:px-2 sm:py-1 sm:text-xs rounded-lg font-bold whitespace-nowrap transition-all ${semesterFilter === 1 ? 'bg-white text-primary shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    1학기
                  </button>
                  <button
                    onClick={() => setSemesterFilter(2)}
                    className={`px-1.5 py-0.5 text-2xs sm:px-2 sm:py-1 sm:text-xs rounded-lg font-bold whitespace-nowrap transition-all ${semesterFilter === 2 ? 'bg-white text-primary shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    2학기
                  </button>
                </div>
              </div>
            )}

            {/* 주말/일정/수업 토글.
                ⚠️ 좁은 화면에서 이것을 숨기고 ⋮ 메뉴로 내려 두었더니, 늘 쓰는
                   토글을 쓰려면 메뉴를 먼저 열어야 했다. PC와 같게 왼쪽에 둔다.
                   좁은 화면에서는 단추를 작게 줄여 날짜와 한 줄에 세운다. */}
            <div className="flex order-1 sm:order-2 items-center gap-1 sm:gap-1.5 flex-none">
                {viewToggles.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => t.set(!t.on)}
                    aria-pressed={t.on}
                    title={`${t.label} ${t.on ? '숨기기' : '보이기'}${t.hint ? ` (단축키: ${t.hint})` : ''}`}
                    /* 좁은 화면에서는 작게 줄여 날짜와 한 줄에 선다.
                       390px 기준 한 단추 34px * 3 + 사이 8px = 110px 로,
                       날짜 칸(약 230px)과 함께 들어간다. */
                    className={`px-1.5 py-0.5 text-2xs sm:px-3 sm:py-1 sm:text-xs rounded-lg font-bold border transition-all whitespace-nowrap ${
                      t.on
                        ? 'bg-primary text-white border-primary shadow-xs'
                        : 'bg-white text-slate-400 border-slate-200 line-through decoration-slate-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
            </div>

            {/* 중앙 날짜 네비게이션 (가운데 정렬, 왼쪽 이전, 오른쪽 다음, 날짜 클릭 시 오늘) */}
            {/* 토글을 작게 만들어 같은 줄에 넣었으므로, 날짜 칸이 한 줄을
                통째로 차지하지 않게 한다(basis-full 을 뗀다). */}
            <div className="flex items-center justify-center gap-1.5 sm:gap-4 flex-1 min-w-0 order-2 sm:order-3">
              <button
                onClick={handlePrevDate}
                className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs sm:text-sm transition-all shadow-2xs cursor-pointer"
                title="이전 날짜 (단축키: Ctrl + ←)"
              >
                ◀
              </button>
              <div className="flex items-center">
                <span
                  onClick={handleTodayClick}
                  className="text-sm sm:text-base font-extrabold text-slate-800 hover:text-primary transition-colors cursor-pointer select-none text-center whitespace-nowrap px-1"
                  title="오늘 날짜로 돌아가기 (단축키: Ctrl + Space)"
                >
                  {getFormattedDateRange()}
                </span>
                <MiniCalendarPicker
                  currentDate={currentDate}
                  onSelectDate={(newDate) => setCurrentDate(newDate)}
                />
              </div>

              {dDayHere && (
                <span
                  onClick={() => setIsDDayModalOpen(true)}
                  title={`${primaryDDay!.title} (${primaryDDay!.date}) 까지, 지금 보고 있는 날 기준`}
                  className="px-2 py-0.5 rounded-full text-2xs sm:text-xs font-bold bg-rose-50 text-rose-600 border border-rose-100 whitespace-nowrap shrink-0 cursor-pointer hover:bg-rose-100 transition-colors"
                >
                  {/* 날짜 바로 옆이라 무엇을 기준으로 센 것인지는 자리가 말해
                      준다. 무슨 D-Day인지와 목표 날짜는 올려 두면 나온다. */}
                  {dDayHere.text}
                </span>
              )}
              <button
                onClick={handleNextDate}
                className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs sm:text-sm transition-all shadow-2xs cursor-pointer"
                title="다음 날짜 (단축키: Ctrl + →)"
              >
                ▶
              </button>
            </div>
          </div>
        )}
      </header>

      {/* 하단 탭바에 내용이 가리지 않도록 아래 여백을 둔다 */}
      <main className="px-3 py-3 sm:p-5 max-w-7xl mx-auto pb-24 sm:pb-5">
        {children}
      </main>

      <MobileTabBar />

      {/* 모달 모음 - 열려 있을 때만 그려서 필요한 시점에 내려받는다 */}
      <Suspense fallback={null}>
        {isGroupModalOpen && (
          <GroupModal isOpen onClose={() => setIsGroupModalOpen(false)} />
        )}

        {isDDayModalOpen && (
          <DDayModal isOpen onClose={() => setIsDDayModalOpen(false)} />
        )}

        {isSearchModalOpen && (
          <SearchModal isOpen onClose={() => setIsSearchModalOpen(false)} />
        )}

        {isRosterModalOpen && (
          <RosterModal isOpen onClose={() => setIsRosterModalOpen(false)} />
        )}

        {isLabelModalOpen && (
          <LabelModal isOpen onClose={closeLabelModal} initialTab={labelModalTab} />
        )}

        {isBackupModalOpen && (
          <BackupModal isOpen onClose={() => setIsBackupModalOpen(false)} />
        )}

        {isHelpModalOpen && (
          <HelpModal isOpen onClose={() => setIsHelpModalOpen(false)} />
        )}

        {isSettingsModalOpen && (
          <SettingsModal isOpen onClose={() => setIsSettingsModalOpen(false)} />
        )}

        {isCalendarModalOpen && (
          <CalendarSyncModal isOpen onClose={() => setIsCalendarModalOpen(false)} />
        )}

        {isEvaluationModalOpen && (
          <EvaluationModal
            isOpen
            onClose={closeEvaluationModal}
            dateStr={evalDateStr || currentDate}
            defaultSource={evalSource}
            defaultPeriod={evalPeriod}
            defaultSubject={evalSubject}
          />
        )}

        {isRecurringModalOpen && (
          <RecurringModal isOpen onClose={() => setIsRecurringModalOpen(false)} />
        )}

        {isForwardingModalOpen && (
          <ForwardingModal isOpen onClose={() => setIsForwardingModalOpen(false)} />
        )}

        {isLinkerModalOpen && (
          <LinkerModal
            isOpen
            onClose={closeLinkerModal}
            sourceType={linkerSourceType || 'manual'}
            sourceDateStr={linkerSourceDateStr || currentDate}
            sourceId={linkerSourceId}
            sourcePeriod={linkerSourcePeriod}
            sourceFId={linkerSourceFId}
          />
        )}

        {isLinkViewerModalOpen && (
          <LinkViewerModal
            isOpen
            onClose={closeLinkViewerModal}
            sourceType={linkViewerSourceType}
            sourceDateStr={linkViewerSourceDateStr || currentDate}
            sourceId={linkViewerSourceId}
            sourcePeriod={linkViewerSourcePeriod}
            sourceFId={linkViewerSourceFId}
          />
        )}

        {/* 연결된 링크에서 연 편집기. 링크는 다른 날짜·다른 공유 공간을 가리킬 수
            있으므로 대상을 통째로 넘겨받는다. */}
        {isDetailEditOpen && detailEditTarget && (
          <DetailEditModal
            isOpen
            onClose={closeDetailEdit}
            type={detailEditTarget.type}
            dateStr={detailEditTarget.dateStr}
            itemId={detailEditTarget.itemId}
            initialData={detailEditTarget.initialData}
            fId={detailEditTarget.fId}
          />
        )}

        <LinkedEntryEditorHost />
        <JournalPeekHost />

        {isTrashModalOpen && (
          <TrashModal isOpen onClose={() => setTrashModalOpen(false)} />
        )}

        {isTimetableModalOpen && (
          <TimetableTemplateModal isOpen onClose={() => setIsTimetableModalOpen(false)} />
        )}
      </Suspense>

      {/* 다중 선택 액션 바 */}
      <MultiEventActionBar />
    </div>
  );
}