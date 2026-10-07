//src/components/Layout.tsx

import { lazyWithReload } from '../lib/lazyWithReload';
import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { useAuth } from '../features/auth/useAuth';
import { useAppStore } from '../store/useAppStore';
import { useGroups } from '../hooks/useGroups';
import { useDDay, calculateDDay } from '../hooks/useDDay';
import { useLabels } from '../hooks/useLabels';
import { useGcalAuto } from '../lib/gcalAuto';
import { useClassBellRunner } from '../hooks/useClassBell';
import { formatDateStr, isToday } from '../lib/dateUtils';
import { scrollToToday } from '../lib/todayScroll';
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
const ProgressModal = lazyWithReload(() => import('./ProgressModal'));
const SettingsModal = lazyWithReload(() => import('./SettingsModal'));
const EvaluationModal = lazyWithReload(() => import('./EvaluationModal'));
const RecurringModal = lazyWithReload(() => import('./RecurringModal'));
const ForwardingModal = lazyWithReload(() => import('./ForwardingModal'));
// 연결된 링크 팝업에서 여는 편집기 (일정/수업은 팝업, 기록/메모는 하루·메모 화면과 같은 쓰는 칸)
const DetailEditModal = lazyWithReload(() => import('./DetailEditModal'));
const JournalPeekHost = lazy(() =>
  import('./JournalPeekModal').then((m) => ({ default: m.JournalPeekHost }))
);
// 날짜 칸의 학사일정 이름을 눌렀을 때 (나이스 - D-Day로·일정으로 담기)
const SchoolEventPeekHost = lazyWithReload(() =>
  import('./SchoolEventModal').then((m) => ({ default: m.SchoolEventPeekHost }))
);
const LinkerModal = lazyWithReload(() => import('./LinkerModal'));
const LinkViewerModal = lazyWithReload(() => import('./LinkViewerModal'));
const TrashModal = lazyWithReload(() => import('./TrashModal'));
const CalendarSyncModal = lazyWithReload(() => import('./CalendarSyncModal'));
const StudentRecordModal = lazyWithReload(() => import('./StudentRecordModal'));
const SeatingModal = lazyWithReload(() => import('./SeatingModal'));
const EvalOverviewModal = lazyWithReload(() => import('./EvalOverviewModal'));
const SubjectAttendanceSummaryModal = lazyWithReload(() => import('./SubjectAttendanceSummaryModal'));
const WeeklyGuideModal = lazyWithReload(() => import('./WeeklyGuideModal'));

import MultiEventActionBar from './MultiEventActionBar';
import MiniCalendarPicker from './MiniCalendarPicker';
import MobileTabBar from './MobileTabBar';
import EntryPanelHost, { DOCK_MIN_WIDTH, openEntryPanel, closeAllEntryPanels } from './EntryPanelHost';
import { useShareReceiver } from '../hooks/useShareReceiver';
import { useSidePopups, RIGHT_COLUMN_CSS_WIDTH } from './PopupFrame';
import { closeAllModals } from '../hooks/useModalLayer';
import ClipboardPanel, { useClipboardCapture, LEFT_COLUMN_CSS_WIDTH } from './ClipboardPanel';
import GoogleLoginPrompt from './GoogleLoginPrompt';
import ColumnResizer from './ColumnResizer';
import { purgeExpiredTrashDaily } from '../lib/trashRetention';
import { useAutoBackupRunner } from '../hooks/useAutoBackup';
import AutoBackupBanner from './AutoBackupBanner';
import { MainWidthContext } from '../hooks/useMainWidth';
import { useMinWidth } from '../hooks/useMinWidth';
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
import { useSearchFocusRunner } from '../lib/searchFocus';
import { APP_ACTION_EVENT, type AppActionDetail } from '../lib/appActions';
import { toggleThemeMode } from '../lib/theme';
import { useTeachingMode } from '../hooks/useTeachingMode';
import { NEW_COURSE_PLAN_ID } from '../lib/progress';

/** 환경설정 '앱으로 설치' → Layout이 설치 창을 띄운다 */
export const INSTALL_PWA_EVENT = 'sp-install-pwa';
/** 휴대폰 손짓 안내를 보였나 (이 기기에만) */
const GESTURE_HINT_KEY = 'sp4-gesture-hint-shown';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { logout, user } = useAuth();
  const { showHomeroomTools, isClassUnit } = useTeachingMode();
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
    evalId,
    weeklyGuideDate,
    closeEvaluationModal,
    isMultiSelectMode,
    setMultiSelectMode,
    isTrashModalOpen,
    setTrashModalOpen,
    isProgressModalOpen,
    setProgressModalOpen,
    linkViewers,
    closeLinkViewerModal,
    isDetailEditOpen,
    detailEditTarget,
    closeDetailEdit,
    isLabelModalOpen,
    labelModalTab,
    openLabelModal,
    closeLabelModal,
    schoolEventPeek,
    // 💡 스크롤 네비게이션 상태 가져오기
  } = useAppStore();
  const { groups, loading: groupsLoading } = useGroups();
  const { primaryDDay } = useDDay();
  // 휴대폰에서 처음 열 때 한 번: 손짓 안내 (UX-AUDIT H9)
  useEffect(() => {
    if (typeof window === 'undefined' || window.innerWidth >= 640) return;
    try {
      if (localStorage.getItem(GESTURE_HINT_KEY)) return;
      localStorage.setItem(GESTURE_HINT_KEY, '1');
    } catch {
      return;
    }
    const t = setTimeout(() => showToast('👆 옆으로 밀면 하루·주간·월간… 화면이 바뀝니다. 자세한 것은 ⋮ → 사용 설명서 > 휴대폰에서 쓰기.'), 2500);
    return () => clearTimeout(t);
  }, []);
  // 일정 라벨 '구글 캘린더' 자동 보내기 (19번 U11, lib/gcalAuto) - 못 보낸 날이 있으면 머리줄 단추
  const { eventLabels: gcalEventLabels } = useLabels();
  const gcal = useGcalAuto(gcalEventLabels);
  // 수업 종 (2026-10-07) - 교시 시각에 맞춰 울린다 (hooks/useClassBell)
  useClassBellRunner();

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

  // 다른 앱에서 공유받은 것 (안드로이드 설치본) → 새 메모 칸
  useShareReceiver();

  // 휴지통 자동 비우기 (환경설정에서 기간을 정했을 때만, 하루 한 번)
  useEffect(() => {
    if (user?.uid) void purgeExpiredTrashDaily(user.uid);
  }, [user?.uid]);

  // 드라이브 자동 백업 (PC, 구글 권한이 이미 있을 때 조용히). 오래 밀리면 위에 띠
  const autoBackup = useAutoBackupRunner();

  useGlobalGestures();
  // 검색에서 '이동'한 항목을 찾아 스크롤하고 강조한다
  useSearchFocusRunner();

  // 모달 상태 관리
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isDDayModalOpen, setIsDDayModalOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isRosterModalOpen, setIsRosterModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  /** 환경설정을 열 때 먼저 보일 구역 (단축키 '교사 유형 바꾸기') */
  const [settingsFocus, setSettingsFocus] = useState<'teaching' | undefined>(undefined);
  const [isRecurringModalOpen, setIsRecurringModalOpen] = useState(false);
  const [isForwardingModalOpen, setIsForwardingModalOpen] = useState(false);
  const [isTimetableModalOpen, setIsTimetableModalOpen] = useState(false);
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);
  /**
   * 알림장·출석부는 팝업이 아니라 메모·기록·일정과 같은 오른쪽 칸에서 연다.
   * 알림장은 지금 보는 공간에, 출석부는 개인 공간에만 있다(학생 개인정보).
   */
  const openClassroomPanel = (kind: 'notice' | 'attendance', tab?: 'write' | 'list' | 'check' | 'summary') => {
    const s = useAppStore.getState();
    void openEntryPanel({
      kind,
      groupId: kind === 'notice' ? s.selectedGroupId : null,
      dateStr: formatDateStr(new Date(s.currentDate)),
      tab,
    });
  };
  const [isStudentRecordOpen, setIsStudentRecordOpen] = useState(false);
  /** 자리표 학생 칸의 '누가기록'으로 열 때 처음 보일 학생 */
  const [studentRecordStart, setStudentRecordStart] = useState<{ classKey: string; num: number } | null>(null);
  const [isSeatingOpen, setIsSeatingOpen] = useState(false);
  const [isEvalOverviewOpen, setIsEvalOverviewOpen] = useState(false);
  // 교과 출결 누계 (ROADMAP-SUBJECT S7). 열려 있으면 처음 고를 반('' = 첫 반), 닫혀 있으면 null
  const [subjectAttSummaryClass, setSubjectAttSummaryClass] = useState<string | null>(null);
  /** 늘 때마다 자리표 창이 발표자 뽑기 칸을 편다 */
  const [seatingDrawRequest, setSeatingDrawRequest] = useState(0);
  const openStudentDraw = () => {
    setSeatingDrawRequest((n) => n + 1);
    setIsSeatingOpen(true);
  };

  // 더보기 드롭다운 상태
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // 머리줄 높이를 --app-header-h로 알려 둔다. 머리줄에 붙어 따라 내려가는
  // 칸(메모 화면의 라벨 거르개 등)이 그만큼 아래에 멈춘다. 머리줄은 줄바꿈과
  // D-Day 표시에 따라 높이가 달라지므로 재서 쓴다.
  // 메모·기록 칸이 화면 옆에 붙어 있으면 그 폭만큼 화면을 왼쪽으로 줄인다
  const entryPanelOpen = useAppStore((s) => !!s.entryPanel);
  const canDock = useMinWidth(DOCK_MIN_WIDTH);
  const panelDocked = entryPanelOpen && canDock;
  // 오른쪽 줄(팝업·쓰는 칸)이 하나라도 서 있으면 그 폭만큼 화면을 줄인다. 폭은 모든 칸이 같다.
  const rightOpen = useSidePopups((s) => s.order.length > 0) || panelDocked;
  // 왼쪽 클립보드 칸 (넓은 화면에서 열려 있으면 그만큼 화면을 오른쪽으로 민다)
  useClipboardCapture();
  const clipboardOpen = useAppStore((s) => s.clipboardOpen);
  const leftOpen = clipboardOpen && canDock;
  // 경계선을 끌어 바꾼 폭. 칸들은 body 아래에 그려지므로(createPortal) 문서 맨 위에 건다.
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth);
  const leftPanelWidth = useAppStore((s) => s.leftPanelWidth);
  useEffect(() => {
    const root = document.documentElement.style;
    if (rightPanelWidth) root.setProperty('--right-column-w', `${rightPanelWidth}px`);
    else root.removeProperty('--right-column-w');
    if (leftPanelWidth) root.setProperty('--left-column-w', `${leftPanelWidth}px`);
    else root.removeProperty('--left-column-w');
  }, [rightPanelWidth, leftPanelWidth]);

  // 본문의 실제 폭. 칸이 열려 좁아지면 화면들이 그에 맞춰 칸 수를 줄인다 (hooks/useMainWidth)
  const mainRef = useRef<HTMLElement>(null);
  const [mainWidth, setMainWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  useEffect(() => {
    const el = mainRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // 안쪽 여백을 뺀 폭 (CSS의 @container 가 재는 폭과 같게)
    const measure = () => {
      const cs = getComputedStyle(el);
      setMainWidth(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

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

  // 환경설정의 '앱으로 설치' 단추 (UX-AUDIT M4 - ⋮ 메뉴에서 옮겼다). 설치 안내는 여기(beforeinstallprompt를 받는 곳)가 띄운다
  const installRef = useRef(handleInstallPWA);
  installRef.current = handleInstallPWA;
  useEffect(() => {
    const on = () => void installRef.current();
    window.addEventListener(INSTALL_PWA_EVENT, on);
    return () => window.removeEventListener(INSTALL_PWA_EVENT, on);
  }, []);

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
  // 보인다. V3처럼 오늘 칸을 화면 안으로 끌어와 보여준다 (lib/todayScroll - 모든 화면, 휴대폰 년간 포함).
  // 날짜를 바꾸면 새 화면이 그려진 뒤에 찾아야 해서 한 프레임 뒤에 시작하고, 찾을 때까지 잠시 기다린다.
  const stopTodayScrollRef = useRef<() => void>(() => {});
  const handleTodayClick = () => {
    useAppStore.getState().setCurrentDate(new Date());
    stopTodayScrollRef.current();
    requestAnimationFrame(() => {
      stopTodayScrollRef.current = scrollToToday(useAppStore.getState().scope);
    });
  };

  // 화면에 무엇을 보여줄지 정하는 토글. 상단 줄과 ⋮ 메뉴가 같은 정의를 쓴다.
  // showEvents는 값과 화면 연결은 되어 있었는데 누르는 자리가 없어서 늘 켜짐이었다.
  // 툴팁의 단축키는 실제 설정값에서 가져온다. 적어두면 환경설정에서 바꿨을 때 거짓말이 된다.
  // 키를 정하지 않은 기능은 빈 글자를 돌려준다. '(단축키: 없음)'까지 붙이면 군더더기다.
  const bindings = resolveBindings(shortcutOverrides);
  const shortcutHint = (id: ShortcutId) => {
    const action = SHORTCUT_ACTIONS.find((a) => a.id === id)!;
    return bindings[id].key ? formatActionBinding(action, bindings[id]) : '';
  };
  /** 툴팁 글. 단축키가 정해져 있을 때만 뒤에 붙인다. */
  const withShortcut = (text: string, id: ShortcutId) => {
    const hint = shortcutHint(id);
    return hint ? `${text} (단축키: ${hint})` : text;
  };
  /** ⋮ 메뉴 항목 오른쪽에 붙이는 단축키 표시. 정한 것이 없으면 아무것도 없다. */
  const menuKey = (id: ShortcutId) => {
    const hint = shortcutHint(id);
    return hint ? (
      <kbd className="ml-auto pl-2 shrink-0 text-2xs font-mono font-bold text-slate-400 whitespace-nowrap">{hint}</kbd>
    ) : null;
  };
  // ⋮ 메뉴 구역. 기능이 15개를 넘어 한 줄로 늘어서 있으니 찾기 어려워 구역 제목을 붙였다(로드맵 6-3).
  // 항목을 더할 때는 알맞은 구역에 넣는다. 단축키 목록(lib/shortcuts)과 설명서의 ⋮ 메뉴 목록에도 같은 기능이 있어야 한다.
  // (명령 창 Ctrl+K는 19번 U4에서 지웠다 - 날짜 고르기·검색·⋮ 메뉴가 같은 일을 한다.)
  // homeroom: 담임 도구 - 교과 전담(담임반 없음)에서는 메뉴에서 숨긴다. 단축키로는 그대로 연다(자료가 남아 있으니, S3).
  // classUnit: 교과 모드 도구 - 초등 담임에서는 메뉴에서 숨긴다 (S7 교과 출결 누계).
  type MoreMenuItem = { icon: string; label: string; shortcut?: ShortcutId; tone?: 'install'; homeroom?: true; classUnit?: true; onClick: () => void };
  // 구역 안의 차례는 자주 쓰는 것이 위 (UX-AUDIT M3, 2026-10-07). 앱 설치·화면 밝기는 환경설정으로, 설명서는 머리줄 ❓에도 (M4).
  const moreMenuSections: Array<{ title: string; items: MoreMenuItem[] }> = [
    {
      title: '일정 · 라벨',
      items: [
        { icon: '🏷️', label: '라벨 관리', shortcut: 'labels', onClick: () => openLabelModal('event') },
        // '스크롤 페이지 이동'은 환경설정으로 옮겼다. 켜고 끄는 자리가 두 군데면 어느 쪽이 지금 값인지 헷갈린다.
        { icon: '☑️', label: isMultiSelectMode ? '여러 개 고르기 끝' : '여러 개 고르기', shortcut: 'multiSelect', onClick: () => setMultiSelectMode(!isMultiSelectMode) },
        // 반복 일정 등록 / 지난 일정 가져오기는 만들어져 있었는데 여는 자리가 없어 화면에서 닿을 수 없었다.
        { icon: '🔁', label: '반복 일정 등록', shortcut: 'recurring', onClick: () => setIsRecurringModalOpen(true) },
        { icon: '📥', label: '지난 일정 오늘로 가져오기', shortcut: 'forwarding', onClick: () => setIsForwardingModalOpen(true) },
      ],
    },
    {
      title: '수업',
      items: [
        { icon: '📘', label: '진도 관리', shortcut: 'progress', onClick: () => setProgressModalOpen(true) },
        { icon: '⏰', label: '시간표', shortcut: 'timetable', onClick: () => setIsTimetableModalOpen(true) },
        { icon: '📰', label: '주간학습안내', shortcut: 'weeklyGuide', homeroom: true, onClick: () => useAppStore.getState().openWeeklyGuide() },
      ],
    },
    {
      // 출석부·알림장은 하루 화면 수업 칸 옆 단추로도 연다.
      title: '학급 운영',
      items: [
        { icon: '📋', label: '출석부', shortcut: 'attendance', homeroom: true, onClick: () => openClassroomPanel('attendance') },
        { icon: '📢', label: '알림장 모아 보기', shortcut: 'notices', homeroom: true, onClick: () => openClassroomPanel('notice', 'list') },
        { icon: '🎯', label: '발표자 뽑기', shortcut: 'drawStudent', onClick: openStudentDraw },
        { icon: '🧑‍🎓', label: '학생 기록(누가기록)', shortcut: 'studentRecord', onClick: () => setIsStudentRecordOpen(true) },
        { icon: '📊', label: '조사표 모아 보기', shortcut: 'evalOverview', onClick: () => setIsEvalOverviewOpen(true) },
        { icon: '🪑', label: '자리표', shortcut: 'seating', onClick: () => setIsSeatingOpen(true) },
        { icon: '🙋', label: '교과 출결 누계', shortcut: 'subjectAttendance', classUnit: true, onClick: () => setSubjectAttSummaryClass('') },
        { icon: '🧑‍🤝‍🧑', label: '학급 정보(명렬표) 관리', shortcut: 'roster', onClick: () => setIsRosterModalOpen(true) },
      ],
    },
    {
      title: '공유 · 연동 · 백업',
      items: [
        // 병합/교체·'지금 화면 기간으로'는 이 창에만 있다 (백업 창의 캘린더 보내기에는 없다)
        { icon: '📅', label: '구글 캘린더로 보내기', shortcut: 'calendar', onClick: () => setIsCalendarModalOpen(true) },
        { icon: '👥', label: '공유 그룹 관리', shortcut: 'group', onClick: () => setIsGroupModalOpen(true) },
        { icon: '💾', label: '백업 (내보내기 / 가져오기)', shortcut: 'backup', onClick: () => setIsBackupModalOpen(true) },
      ],
    },
    {
      title: '설정 · 도움말',
      items: [
        { icon: '⚙️', label: '환경설정', shortcut: 'settings', onClick: () => setIsSettingsModalOpen(true) },
        { icon: '💡', label: '사용 설명서', shortcut: 'help', onClick: () => setIsHelpModalOpen(true) },
      ],
    },
  ];
  const viewToggles = [
    { key: 'weekend', label: '주말', on: showWeekend, set: setShowWeekend, hint: shortcutHint('toggleWeekend') },
    { key: 'events', label: '일정', on: showEvents, set: setShowEvents, hint: shortcutHint('toggleEvents') },
    { key: 'class', label: '수업', on: showClass, set: setShowClass, hint: shortcutHint('toggleClass') },
  ];

  // 단축키 하나가 실제로 하는 일.
  // 조합(어떤 키냐)은 lib/shortcuts.ts가, 동작(무엇을 하냐)은 여기가 맡는다.
  const runShortcut = (id: ShortcutId) => {
    const scopeOrder: Array<'day' | 'week' | 'month' | 'year' | 'memo' | 'class'> = ['day', 'week', 'month', 'year', 'memo', 'class'];
    const store = useAppStore.getState();

    switch (id) {
      case 'search': setIsSearchModalOpen(true); return;
      // 쓰는 칸의 체크리스트 - 커서가 든 쓰는 칸이 받는다 (EntryDrawer)
      case 'checklist': window.dispatchEvent(new Event('sp-checklist')); return;
      case 'scopeDay': setScope('day'); return;
      case 'scopeWeek': setScope('week'); return;
      case 'scopeMonth': setScope('month'); return;
      case 'scopeYear': setScope('year'); return;
      case 'scopeMemo': setScope('memo'); return;
      case 'scopeClass': setScope('class'); return;
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
      // 작년 이맘때는 주간 화면에만 있다. 다른 화면에서 누르면 주간으로 가서 켠다.
      case 'lastYear':
        if (store.scope !== 'week') {
          setScope('week');
          store.setShowLastYear(true);
        } else {
          store.setShowLastYear(!store.showLastYear);
        }
        return;

      // 메뉴 열기. 기본값이 비어 있어서, 사용자가 키를 정해야 동작한다.
      case 'multiSelect': setMultiSelectMode(!store.isMultiSelectMode); return;
      case 'calendar': setIsCalendarModalOpen(true); return;
      case 'dday': setIsDDayModalOpen(true); return;
      case 'trash': setTrashModalOpen(true); return;
      case 'labels': openLabelModal('event'); return;
      case 'recurring': setIsRecurringModalOpen(true); return;
      case 'forwarding': setIsForwardingModalOpen(true); return;
      case 'roster': setIsRosterModalOpen(true); return;
      case 'notices': openClassroomPanel('notice', 'list'); return;
      case 'attendance': openClassroomPanel('attendance'); return;
      case 'subjectAttendance': setSubjectAttSummaryClass(''); return;
      case 'studentRecord': setIsStudentRecordOpen(true); return;
      case 'seating': setIsSeatingOpen(true); return;
      case 'drawStudent': openStudentDraw(); return;
      case 'evalOverview': setIsEvalOverviewOpen(true); return;
      case 'group': setIsGroupModalOpen(true); return;
      case 'timetable': setIsTimetableModalOpen(true); return;
      case 'progress': setProgressModalOpen(true); return;
      case 'weeklyGuide': useAppStore.getState().openWeeklyGuide(); return;
      case 'backup': setIsBackupModalOpen(true); return;
      case 'help': setIsHelpModalOpen(true); return;
      case 'settings': setSettingsFocus(undefined); setIsSettingsModalOpen(true); return;
      case 'teachingMode': setSettingsFocus('teaching'); setIsSettingsModalOpen(true); return;
      case 'newCourse': setProgressModalOpen(true, NEW_COURSE_PLAN_ID); return;
      case 'toggleTheme': toggleThemeMode(); return;
      case 'clipboard': {
        const s = useAppStore.getState();
        s.setClipboardOpen(!s.clipboardOpen);
        return;
      }
    }
  };

  // 화면(학급 화면 등)이 부탁한 창 열기 (lib/appActions). 단축키와 같은 이름으로 받는다.
  // 학급을 함께 받으면 출석부·누가기록은 그 학급(학생)으로 연다.
  const runShortcutRef = useRef(runShortcut);
  runShortcutRef.current = runShortcut;
  useEffect(() => {
    const onAction = (e: Event) => {
      const d = (e as CustomEvent<AppActionDetail>).detail;
      if (!d?.id) return;
      setIsMoreMenuOpen(false);
      if (d.id === 'studentRecord' && d.classKey && d.num != null) {
        setStudentRecordStart({ classKey: d.classKey, num: d.num });
        setIsStudentRecordOpen(true);
        return;
      }
      if (d.id === 'subjectAttendance') {
        setSubjectAttSummaryClass(d.classKey || '');
        return;
      }
      if (d.id === 'attendance' && d.classKey) {
        void openEntryPanel({ kind: 'attendance', groupId: null, dateStr: formatDateStr(new Date()), tab: 'check', classKey: d.classKey });
        return;
      }
      runShortcutRef.current(d.id);
    };
    window.addEventListener(APP_ACTION_EVENT, onAction);
    return () => window.removeEventListener(APP_ACTION_EVENT, onAction);
  }, []);

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

      // 검색(기본 Ctrl+F)은 아래 단축키 목록이 맡는다. 거기서 preventDefault를
      // 하므로 브라우저 찾기창도 뜨지 않는다. 다른 키로 바꾸면 Ctrl+F는 브라우저 몫이 된다.

      // ESC: 열려있는 모든 모달 및 메뉴 닫기
      if (e.key === 'Escape') {
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
        setProgressModalOpen(false);
        setIsCalendarModalOpen(false);
        setIsStudentRecordOpen(false);
        setIsSeatingOpen(false);
        setSeatingDrawRequest(0);
        setIsEvalOverviewOpen(false);
        setSubjectAttSummaryClass(null);
        useAppStore.getState().closeWeeklyGuide();
        setIsMoreMenuOpen(false);
        if (isForwardingModalOpen) {
          setIsForwardingModalOpen(false);
        }
        closeLinkerModal();
        closeLinkViewerModal();
        closeEvaluationModal();
        setTrashModalOpen(false);
        // 오른쪽 줄의 쓰는 칸(메모·기록·일정·알림장·출석부)도 모두 닫는다. 예전에는 칸 안에서 누르면
        // 그 칸 하나만, 밖에서 누르면 팝업만 닫혀 '오른쪽 줄 전체가 안 닫힌다'고 느꼈다.
        // 저장 안 한 것이 있으면 먼저 묻는다.
        closeAllEntryPanels();
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
    { id: 'day', label: '하루', key: 'scopeDay' },
    { id: 'week', label: '주간', key: 'scopeWeek' },
    { id: 'month', label: '월간', key: 'scopeMonth' },
    { id: 'year', label: '년간', key: 'scopeYear' },
    { id: 'memo', label: '메모', key: 'scopeMemo' },
    { id: 'class', label: '학급', key: 'scopeClass' },
  ] as const;

  return (
    <div
      className="min-h-screen bg-bg-body text-slate-900 transition-[padding] duration-200"
      style={{
        paddingRight: rightOpen ? RIGHT_COLUMN_CSS_WIDTH : undefined,
        paddingLeft: leftOpen ? LEFT_COLUMN_CSS_WIDTH : undefined,
      }}
    >
      <header ref={headerRef} className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm px-4 py-3 border-b border-border shadow-xs flex flex-col gap-2.5">
        <div className="flex items-center gap-2 max-w-7xl mx-auto w-full">
          {/* 상단 메뉴 영역 (스크롤 없이 버튼 크기 축소로 한 줄 유지) */}
          {/* 자리가 모자라면 겹치는 대신 검색·화면 탭 묶음이 아랫줄로 내려간다.
              예전에는 오른쪽 칸이 열렸을 때만 줄바꿈을 허락해서, 칸이 닫힌 태블릿 폭(800px 안팎)에
              공유 그룹 선택까지 생기면 휴지통·검색·⋮ 메뉴가 서로 포개져 눌리지 않았다. */}
          <div className="flex flex-wrap items-center justify-between flex-1 gap-x-0.5 sm:gap-x-4 gap-y-1.5 pr-1 sm:pr-2 min-w-0">
            
            {/* 좌측: 로고 및 기능 버튼들 */}
            <div className="flex items-center gap-0.5 sm:gap-2 shrink">
              <h1 className="text-base sm:text-xl font-extrabold text-primary tracking-tighter pr-0 sm:pr-1 shrink-0">SP4</h1>

              {/* D-Day 뱃지 버튼 */}
              <button
                onClick={() => setIsDDayModalOpen(true)}
                className="p-1 sm:px-2.5 sm:py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-md sm:rounded-xl text-xs sm:text-xs font-bold transition-all flex items-center gap-0 sm:gap-1 shadow-2xs shrink-0"
                title={withShortcut('학사 D-Day 관리', 'dday')}
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

              {/* 휴지통은 휴대폰에서도 맨 위에 둔다 (좁으면 🔍 검색처럼 그림만).
                  예전에는 좁은 화면에서 숨기고 ⋮ 메뉴에만 두어 찾기 어려웠다.
                  구글 캘린더로 보내기는 자주 쓰지 않아 맨 위 단추를 걷고 ⋮ 메뉴에 둔다. */}
              <button
                onClick={() => setTrashModalOpen(true)}
                className="flex p-1 sm:px-2.5 sm:py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md sm:rounded-xl text-xs font-bold transition-all items-center gap-0 sm:gap-1 shadow-2xs shrink-0"
                title={withShortcut('휴지통', 'trash')}
                aria-label="휴지통"
              >
                <span>🗑️</span>
                <span className="hidden sm:inline">휴지통</span>
              </button>
              {gcal.pending > 0 && (
                <button
                  type="button"
                  data-gcal-pending={gcal.pending}
                  onClick={() => void gcal.sendNow()}
                  className="flex p-1 sm:px-2.5 sm:py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-md sm:rounded-xl text-xs font-bold transition-all items-center gap-0.5 sm:gap-1 shadow-2xs shrink-0"
                  title="구글 캘린더에 아직 못 보낸 날짜가 있습니다 (구글 로그인이 만료됨). 누르면 로그인하고 보냅니다."
                >
                  <span>📅</span>
                  <span className="hidden sm:inline">못 보낸 날</span>
                  <strong>{gcal.pending}</strong>
                </button>
              )}
            </div>

            {/* 우측: 검색, 스코프 탭, 그룹 선택. 이 묶음도 좁으면 줄을 바꾼다
                (오른쪽 칸이 열린 태블릿 폭에서 한 줄로 두면 ⋮ 메뉴·프로필 밑으로 파고든다). */}
            <div className="flex flex-wrap items-center gap-0.5 sm:gap-2 gap-y-1.5 shrink min-w-0">
              {/* 검색 버튼 */}
            <button
              onClick={() => setIsSearchModalOpen(true)}
              className="p-1 sm:px-2.5 sm:py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md sm:rounded-xl text-xs sm:text-xs font-bold transition-all flex items-center gap-0 sm:gap-1 shrink-0"
              title={withShortcut('검색', 'search')}
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
                  title={withShortcut(`${s.label} 화면`, s.key)}
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
            {/* 사용 설명서 (UX-AUDIT M4) - ⋮를 열지 않고 */}
            <button
              type="button"
              data-header-help
              onClick={() => setIsHelpModalOpen(true)}
              className="w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 font-black rounded-md sm:rounded-xl text-xs sm:text-sm transition-colors"
              title={withShortcut('사용 설명서', 'help')}
              aria-label="사용 설명서"
            >
              ?
            </button>
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
                <div className="absolute right-0 top-10 w-72 max-h-[80vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-50 animate-fade-in text-xs">

                  {/* 좁은 화면에서 상단에 둘 자리가 없어 내려온 항목들 */}
                  <div className="sm:hidden border-b border-slate-200 pb-1 mb-1">
                    <button
                      onClick={() => { setIsMoreMenuOpen(false); setTrashModalOpen(true); }}
                      className="w-full px-4 py-2.5 text-left font-bold text-slate-700 hover:bg-slate-50 hover:text-primary flex items-center gap-2"
                    >
                      <span>🗑️</span> 휴지통
                      {menuKey('trash')}
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

                  {moreMenuSections.map((section) => (
                    <div
                      key={section.title}
                      role="group"
                      aria-label={section.title}
                      data-menu-section={section.title}
                      className="border-t border-slate-100 mt-1 pt-1"
                    >
                      <div className="px-4 pt-1.5 pb-0.5 text-2xs font-black text-slate-500 tracking-wide select-none">
                        {section.title}
                      </div>
                      {section.items.filter((item) => (showHomeroomTools || !item.homeroom) && (isClassUnit || !item.classUnit)).map((item) => (
                        <button
                          key={item.icon}
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            item.onClick();
                          }}
                          className={`w-full px-4 py-2 text-left font-bold flex items-center gap-2 ${
                            item.tone === 'install'
                              ? 'text-emerald-600 hover:bg-emerald-50'
                              : 'text-slate-700 hover:bg-slate-50 hover:text-primary'
                          }`}
                        >
                          <span>{item.icon}</span> {item.label}
                          {item.shortcut && menuKey(item.shortcut)}
                        </button>
                      ))}
                    </div>
                  ))}
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
        {scope !== 'memo' && scope !== 'class' && (
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
                title={withShortcut('이전 날짜', 'datePrev')}
              >
                ◀
              </button>
              <div className="flex items-center">
                <span
                  onClick={handleTodayClick}
                  className="text-sm sm:text-base font-extrabold text-slate-800 hover:text-primary transition-colors cursor-pointer select-none text-center whitespace-nowrap px-1"
                  title={withShortcut('오늘 날짜로 돌아가기', 'dateToday')}
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
                title={withShortcut('다음 날짜', 'dateNext')}
              >
                ▶
              </button>
            </div>
          </div>
        )}
      </header>

      {/* 하단 탭바에 내용이 가리지 않도록 아래 여백을 둔다 */}
      <main ref={mainRef} className="@container px-3 py-3 sm:p-5 max-w-7xl mx-auto pb-24 sm:pb-5">
        {autoBackup.nag && (
          <AutoBackupBanner overdue={autoBackup.overdue} keep={autoBackup.settings.keep} onSnooze={autoBackup.snooze} />
        )}
        <MainWidthContext.Provider value={mainWidth}>{children}</MainWidthContext.Provider>
      </main>

      <MobileTabBar />

      {/* 메모·기록 쓰는 칸. 화면과 따로 살아서, 다른 화면으로 옮겨도 남는다. */}
      <EntryPanelHost />
      <ClipboardPanel />
      {/* 구글 토큰이 만료됐는데 로그인 창이 막힐 때 묻는 창 (lib/googleLoginPrompt) */}
      <GoogleLoginPrompt />
      {rightOpen && <ColumnResizer side="right" width={RIGHT_COLUMN_CSS_WIDTH} />}
      {/* 오른쪽 줄을 닫는 작은 단추 - 왼쪽 클립보드의 📋 단추와 짝 (2026-09-30).
          열린 팝업과 쓰는 칸을 모두 닫는다(ESC와 같다. 저장 안 한 글이 있으면 먼저 묻는다).
          ESC와 달리 라벨 거르개 같은 화면의 고른 것은 그대로 둔다. */}
      {rightOpen && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            closeAllModals();
            closeAllEntryPanels();
          }}
          title="오른쪽 칸 닫기 (ESC와 같음)"
          aria-label="오른쪽 칸 닫기"
          className="fixed top-1/2 -translate-y-1/2 z-[46] w-6 h-14 flex items-center justify-center rounded-l-xl bg-white/90 border border-r-0 border-slate-200 shadow-md text-xs text-slate-500 hover:bg-primary/10 hover:w-7 transition-all cursor-pointer"
          style={{ right: RIGHT_COLUMN_CSS_WIDTH }}
        >
          ▶
        </button>
      )}
      {leftOpen && <ColumnResizer side="left" width={LEFT_COLUMN_CSS_WIDTH} />}

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
          <SettingsModal isOpen focusSection={settingsFocus} onClose={() => setIsSettingsModalOpen(false)} />
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
            initialEvalId={evalId}
          />
        )}

        {isRecurringModalOpen && (
          // 만들고 나면 닫는다. 예전에는 창이 그대로 남아 한 번 더 누르면 같은 반복 일정이 두 벌 생겼다.
          <RecurringModal isOpen onClose={() => setIsRecurringModalOpen(false)} onRegistered={() => setIsRecurringModalOpen(false)} />
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

        {/* 연결된 링크 배너 - 여러 개가 오른쪽 줄에 쌓인다 (나중에 연 것이 위) */}
        {linkViewers.map((v) => (
          <LinkViewerModal
            key={v.key}
            isOpen
            onClose={() => closeLinkViewerModal(v.key)}
            raise={v.raisedAt}
            sourceType={v.sourceType}
            sourceDateStr={v.dateStr || currentDate}
            sourceId={v.id}
            sourcePeriod={v.period}
            sourceFId={v.fId}
          />
        ))}

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

        <JournalPeekHost />

        {schoolEventPeek && <SchoolEventPeekHost />}

        {isStudentRecordOpen && (
          <StudentRecordModal
            key={studentRecordStart ? `${studentRecordStart.classKey}:${studentRecordStart.num}` : 'last'}
            isOpen
            initialClassKey={studentRecordStart?.classKey}
            initialNum={studentRecordStart?.num}
            onClose={() => {
              setIsStudentRecordOpen(false);
              setStudentRecordStart(null);
            }}
          />
        )}

        {isSeatingOpen && (
          <SeatingModal
            isOpen
            onClose={() => {
              setIsSeatingOpen(false);
              setSeatingDrawRequest(0);
            }}
            drawRequest={seatingDrawRequest}
            onOpenStudentRecord={(classKey, num) => {
              setStudentRecordStart({ classKey, num });
              setIsStudentRecordOpen(true);
            }}
            onOpenAttendance={(classKey, dateStr) =>
              void openEntryPanel({ kind: 'attendance', groupId: null, dateStr, tab: 'check', classKey })
            }
          />
        )}

        {isEvalOverviewOpen && <EvalOverviewModal isOpen onClose={() => setIsEvalOverviewOpen(false)} />}
        {subjectAttSummaryClass !== null && (
          <SubjectAttendanceSummaryModal
            key={subjectAttSummaryClass}
            isOpen
            initialClassKey={subjectAttSummaryClass || undefined}
            onClose={() => setSubjectAttSummaryClass(null)}
          />
        )}
        {weeklyGuideDate !== null && (
          <WeeklyGuideModal isOpen startDate={weeklyGuideDate || null} onClose={() => useAppStore.getState().closeWeeklyGuide()} />
        )}

        {isTrashModalOpen && (
          <TrashModal isOpen onClose={() => setTrashModalOpen(false)} />
        )}

        {isTimetableModalOpen && (
          <TimetableTemplateModal isOpen onClose={() => setIsTimetableModalOpen(false)} />
        )}

        {isProgressModalOpen && <ProgressModal isOpen onClose={() => setProgressModalOpen(false)} />}
      </Suspense>

      {/* 다중 선택 액션 바 */}
      <MultiEventActionBar />
    </div>
  );
}