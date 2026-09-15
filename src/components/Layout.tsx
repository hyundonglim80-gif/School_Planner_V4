//src/components/Layout.tsx

import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { useAuth } from '../features/auth/useAuth';
import { useAppStore } from '../store/useAppStore';
import { useGroups } from '../hooks/useGroups';
import { useDDay } from '../hooks/useDDay';
// 모달은 처음 열 때 받아오면 충분하다. 전부 첫 화면 번들에 넣으면
// 초기 로딩만 느려지므로, 열릴 때만 그려서 그때 청크를 내려받는다.
const GroupModal = lazy(() => import('./GroupModal'));
const DDayModal = lazy(() => import('./DDayModal'));
const SearchModal = lazy(() => import('./SearchModal'));
const RosterModal = lazy(() => import('./RosterModal'));
const LabelModal = lazy(() => import('./LabelModal'));
const BackupModal = lazy(() => import('./BackupModal'));
const HelpModal = lazy(() => import('./HelpModal'));
const TimetableTemplateModal = lazy(() => import('./TimetableTemplateModal'));
const SettingsModal = lazy(() => import('./SettingsModal'));
const EvaluationModal = lazy(() => import('./EvaluationModal'));
const RecurringModal = lazy(() => import('./RecurringModal'));
const ForwardingModal = lazy(() => import('./ForwardingModal'));
const LinkerModal = lazy(() => import('./LinkerModal'));
const LinkViewerModal = lazy(() => import('./LinkViewerModal'));
const TrashModal = lazy(() => import('./TrashModal'));

import MultiEventActionBar from './MultiEventActionBar';
import MiniCalendarPicker from './MiniCalendarPicker';
import MobileTabBar from './MobileTabBar';
import { useGlobalGestures } from '../hooks/useGlobalGestures';
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
    isLabelModalOpen,
    labelModalTab,
    openLabelModal,
    closeLabelModal,
    // 💡 스크롤 네비게이션 상태 가져오기
  } = useAppStore();
  const { groups, loading: groupsLoading } = useGroups();
  const { primaryDDay } = useDDay();

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

  // 더보기 드롭다운 상태
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

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
  const viewToggles = [
    { key: 'weekend', label: '주말', on: showWeekend, set: setShowWeekend, hint: 'Shift + ↑/↓' },
    { key: 'events', label: '일정', on: showEvents, set: setShowEvents, hint: '' },
    { key: 'class', label: '수업', on: showClass, set: setShowClass, hint: 'Alt + ↑/↓' },
  ];

  // 키보드 단축키 핸들러 (ESC, /, Ctrl+화살표, Ctrl+Space, Shift+화살표, Shift+1~5 등)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

      // 1. 브라우저 기본 '다른 이름으로 저장' (Ctrl+S / Cmd+S) 잠금
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        // V4의 항목 저장은 각 입력창의 onKeyDown 이벤트에서 자체 처리되므로, 
        // 전역(Layout)에서는 브라우저 저장 팝업이 뜨는 것만 완벽히 차단합니다.
        return;
      }

      // 2. 브라우저 기본 '찾기' (Ctrl+F / Cmd+F) 잠금 및 V4 검색창 실행
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSearchModalOpen(true);
        return;
      }

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

      // 통합 검색: / 또는 ` 또는 ~ (입력창 포커스 아닐 때) 또는 Ctrl+F / Cmd+F (항상 작동)
      if (((e.key === '/' || e.key === '`' || e.key === '~') && !isInput) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        setIsSearchModalOpen(true);
        return;
      }

      // 화면(탭) 전환: Shift + 1 ~ 5 (하루, 주간, 월간, 년간, 메모)
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !isInput) {
        if (e.code === 'Digit1' || e.key === '1' || e.key === '!') {
          e.preventDefault();
          setScope('day');
          return;
        }
        if (e.code === 'Digit2' || e.key === '2' || e.key === '@') {
          e.preventDefault();
          setScope('week');
          return;
        }
        if (e.code === 'Digit3' || e.key === '3' || e.key === '#') {
          e.preventDefault();
          setScope('month');
          return;
        }
        if (e.code === 'Digit4' || e.key === '4' || e.key === '$') {
          e.preventDefault();
          setScope('year');
          return;
        }
        if (e.code === 'Digit5' || e.key === '5' || e.key === '%') {
          e.preventDefault();
          setScope('memo');
          return;
        }
      }

      // 탭 순환 이동: Shift + ← / → (입력창 포커스 아닐 때)
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !isInput && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const scopeOrder: Array<'day' | 'week' | 'month' | 'year' | 'memo'> = ['day', 'week', 'month', 'year', 'memo'];
        const currentScope = useAppStore.getState().scope;
        const currentIndex = scopeOrder.indexOf(currentScope);
        if (currentIndex !== -1) {
          const nextIndex = e.key === 'ArrowRight'
            ? (currentIndex + 1) % scopeOrder.length
            : (currentIndex - 1 + scopeOrder.length) % scopeOrder.length;
          setScope(scopeOrder[nextIndex]);
        }
        return;
      }

      // 주말 보기/숨기기 토글: Shift + ↑ 또는 Shift + ↓
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const currentShow = useAppStore.getState().showWeekend;
        setShowWeekend(!currentShow);
        return;
      }

      // 수업 보이기/숨기기 토글: Alt + ↑ 또는 Alt + ↓
      if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const currentShow = useAppStore.getState().showClass;
        setShowClass(!currentShow);
        return;
      }

      // 이전 날짜: Ctrl + ← (또는 Cmd + ←)
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevDate();
        return;
      }

      // 다음 날짜: Ctrl + → (또는 Cmd + →)
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextDate();
        return;
      }

      // 오늘 날짜로 이동: Ctrl + Space (또는 Cmd + Space)
      if ((e.ctrlKey || e.metaKey) && (e.key === ' ' || e.code === 'Space')) {
        e.preventDefault();
        handleTodayClick();
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    setShowWeekend,
    setShowClass,
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
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm px-4 py-3 border-b border-border shadow-xs flex flex-col gap-2.5">
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
                onClick={() => { showToast('구글 캘린더 연동 기능이 준비 중입니다.'); }}
                className="hidden sm:flex px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200/80 rounded-xl text-xs font-bold transition-all items-center gap-1 shadow-2xs shrink-0"
                title="구글 캘린더 연동"
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
              title="통합 검색 (단축키: Ctrl+F 또는 /)"
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
                  title={user?.displayName || '사용자'}
                />
              ) : (
                <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center text-xs font-bold text-slate-500 shadow-sm">
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
        {scope !== 'memo' && (
          <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-2.5 mt-0.5 max-w-7xl mx-auto w-full gap-2 flex-nowrap overflow-x-auto">
            {/* 좌측 옵션 버튼 (주말 숨기기, 학기 필터) */}
            <div className="flex items-center gap-1.5 flex-none">
              {scope === 'year' && (
                <div className="flex bg-slate-100 p-0.5 rounded-xl gap-0.5">
                  <button
                    onClick={() => setSemesterFilter('all')}
                    className={`px-2 py-1 rounded-lg text-xs font-bold transition-all ${semesterFilter === 'all' ? 'bg-white text-primary shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    전체
                  </button>
                  <button
                    onClick={() => setSemesterFilter(1)}
                    className={`px-2 py-1 rounded-lg text-xs font-bold transition-all ${semesterFilter === 1 ? 'bg-white text-primary shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    1학기
                  </button>
                  <button
                    onClick={() => setSemesterFilter(2)}
                    className={`px-2 py-1 rounded-lg text-xs font-bold transition-all ${semesterFilter === 2 ? 'bg-white text-primary shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    2학기
                  </button>
                </div>
              )}
              {/* 표시 토글 - 켜짐/꺼짐이 한눈에 구분되게 채움 vs 흐림으로 나눈다.
                  좁은 화면에서는 날짜 이동만 남기고 ⋮ 메뉴로 내린다. */}
              <div className="hidden sm:flex items-center gap-1.5">
                {viewToggles.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => t.set(!t.on)}
                    aria-pressed={t.on}
                    title={`${t.label} ${t.on ? '숨기기' : '보이기'}${t.hint ? ` (단축키: ${t.hint})` : ''}`}
                    className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${
                      t.on
                        ? 'bg-primary text-white border-primary shadow-xs'
                        : 'bg-white text-slate-400 border-slate-200 line-through decoration-slate-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 중앙 날짜 네비게이션 (가운데 정렬, 왼쪽 이전, 오른쪽 다음, 날짜 클릭 시 오늘) */}
            <div className="flex items-center justify-center gap-3 sm:gap-4 flex-1 min-w-0">
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