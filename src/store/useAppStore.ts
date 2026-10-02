import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { doc, runTransaction } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { eventDocPayload, readEventList } from '../lib/eventText';
import { getDocTrustingServer } from '../lib/firestoreSubscribe';
import { moveToTrash } from '../utils/trashHelper';
import { formatDateStr } from '../lib/dateUtils';
import { moveEventToDate, snapshotEventFields, type EventFieldSnapshot, type MoveTrail } from '../lib/eventDocOps';
import { showErrorToast } from '../utils/toast';
import { FORWARD_LOOKBACK_DAYS, clampLookbackDays } from '../lib/forwarding';
import type { ShortcutOverrides } from '../lib/shortcuts';
import { applyFontScale, DEFAULT_FONT_SCALE, type FontScale } from '../lib/fontScale';
import type { PopupStyle } from '../lib/preferenceSync';
import type { FocusTarget } from '../lib/searchFocus';
import type { NeisScheduleItem } from '../lib/neis';
import { DEFAULT_TEACHING_MODE, type TeachingMode } from '../lib/teachingMode';

type Scope = 'day' | 'week' | 'month' | 'year' | 'memo' | 'class';

/** 앱을 열었을 때 어느 화면부터 보여줄지. 'last'는 마지막에 보던 화면. */
export type StartupScope = 'last' | Scope;

/** 오른쪽 칸이 무엇을 쓰고 있는가 */
export interface EntryPanelTarget {
  kind: 'memo' | 'journal' | 'event' | 'notice' | 'attendance';
  /** 어느 공간의 것인가 (null = 개인). 열 때의 공간을 붙들어, 공간을 바꿔도 제자리에 저장한다. */
  groupId: string | null;
  /** 기록·일정의 날짜 (메모에는 없다) */
  dateStr?: string;
  /** 고치는 항목의 id. 없으면 새로 쓴다. */
  entryId?: string;
  /** 고칠 때 넘기는 그 순간의 항목 (구독이 도착하기 전 빈 칸이 보이지 않게) */
  initial?: any;
  /** 새로 쓸 때 미리 적어 둘 글 (학사일정 '일정으로 담기', 다른 앱에서 공유받은 글) */
  draftText?: string;
  /** 새 메모에 붙일 파일 (다른 앱에서 공유받은 것). 칸에서 '드라이브에 올려 첨부'를 눌러야 올라간다 */
  draftFiles?: File[];
  /** 새로 쓸 때 미리 골라 둘 라벨 */
  defaultLabel?: string;
  /** 알림장('write'|'list')·출석부('check'|'summary')를 열 때 처음 보일 탭 */
  tab?: 'write' | 'list' | 'check' | 'summary';
  /** 출석부를 열 때 고를 학급 (자리표 학생 칸의 '출석부'). 없으면 마지막에 연 학급 */
  classKey?: string;
  /** 이 칸의 고유 번호 (열 때 붙는다). 여러 칸이 쌓이므로 닫기·id 알리기에 쓴다. */
  openedAt?: number;
  /** 맨 위로 올린 때. 이미 열린 항목을 다시 열면 새로 만들지 않고 이것만 바꿔 맨 위로 올린다. */
  raisedAt?: number;
  /**
   * 새 항목을 처음 저장했을 때 알려 받을 곳. 링크 창의 '+ 새 00 만들어 연결'이 쓴다 -
   * 하루 화면과 같은 칸으로 만들고, 만들어지면 연결 목록에 담는다.
   */
  onCreated?: (item: CreatedEntry) => void;
}

/** 쓰는 칸에서 새로 만든 항목 (링크 창이 연결 목록에 담는 모양) */
export interface CreatedEntry {
  id: string;
  type: 'event' | 'journal' | 'memo';
  title: string;
  /** 일정·기록의 날짜 (메모는 '') */
  date: string;
  /** 'personal' 또는 그룹 id */
  fId: string;
}

/** 같은 항목을 고치는 칸인가 (새로 쓰는 칸은 늘 다르다) */
const samePanelTarget = (a: EntryPanelTarget, b: EntryPanelTarget) =>
  !!a.entryId &&
  a.kind === b.kind &&
  String(a.entryId) === String(b.entryId) &&
  (a.groupId || null) === (b.groupId || null) &&
  (a.dateStr || '') === (b.dateStr || '');

/** 열린 링크 배너 하나 - 어느 항목의 링크를 보는지 */
export interface LinkViewerTarget {
  key: string;
  sourceType: 'schedule' | 'journal' | 'event' | 'memo';
  dateStr: string;
  id: string;
  period?: number | string;
  fId?: string;
  /** 다시 열면 바뀐다 - 배너가 맨 위로 올라간다 (useSideSlot의 raise) */
  raisedAt: number;
}

/** 같은 항목의 링크 배너를 알아보는 열쇠 */
export function linkViewerKey(
  sourceType: string,
  dateStr: string,
  id: string,
  period?: number | string,
  fId?: string
): string {
  return [fId || 'personal', sourceType, dateStr || '', id || '', period ?? ''].join('|');
}

interface AppState {
  scope: Scope;
  semesterFilter: 'all' | 1 | 2;
  /**
   * 메모 화면에서 마지막에 고른 거르개. 없으면 즐겨찾기로 연다.
   * '전체'·'⭐ 즐겨찾기'는 글자로, 라벨(여러 개)은 { labels, withChildren }로 둔다.
   * 예전에는 라벨 하나를 글자로 두었다 - 읽는 쪽(MemoScreen)이 둘 다 읽는다.
   */
  memoFilter: string | { labels: string[]; withChildren: string[] } | null;
  setMemoFilter: (filter: string | { labels: string[]; withChildren: string[] } | null) => void;
  showWeekend: boolean;
  showClass: boolean;
  showEvents: boolean;
  /** 주간 화면에 작년 같은 주를 흐리게 겹쳐 보나 (ROADMAP 7). 이 기기에만 남는다(계정에 올리지 않는다). */
  showLastYear: boolean;
  currentDate: string; 
  selectedGroupId: string | null; 
  govApiKey: string; 
  // 💡 스크롤 네비게이션 활성화 여부 추가
  enableScrollNav: boolean;
  // 환경설정에서 조절하는 값들
  startupScope: StartupScope;
  /** 화면 글자 크기. 계정에도 저장된다(hooks/usePreferenceSync). */
  fontScale: FontScale;
  forwardLookbackDays: number;
  /**
   * 팝업을 어디에 띄우나. 'side'는 메모·기록 쓰는 칸처럼 화면 오른쪽을 나눠 쓰고,
   * 'center'는 예전처럼 화면 가운데에 어둡게 덮어 띄운다. 계정에도 저장된다.
   */
  popupStyle: PopupStyle;
  /** 오른쪽·왼쪽 줄의 폭(px). 경계선을 끌어 바꾼 값이다. null이면 기본 폭. 이 기기에만 남는다. */
  rightPanelWidth: number | null;
  leftPanelWidth: number | null;
  /** 왼쪽 클립보드 칸을 열어 두었나 */
  clipboardOpen: boolean;
  // 기본값에서 바꾼 단축키만 담는다. 나머지는 lib/shortcuts.ts의 기본값을 쓴다.
  shortcutOverrides: ShortcutOverrides;

  setScope: (scope: Scope) => void;
  setSemesterFilter: (filter: 'all' | 1 | 2) => void;
  setShowWeekend: (show: boolean) => void;
  setShowClass: (show: boolean) => void;
  setShowEvents: (show: boolean) => void;
  setShowLastYear: (show: boolean) => void;
  setCurrentDate: (date: Date) => void;
  setSelectedGroupId: (groupId: string | null) => void;
  setGovApiKey: (key: string) => void;
  setEnableScrollNav: (enable: boolean) => void;
  setStartupScope: (scope: StartupScope) => void;
  setFontScale: (scale: FontScale) => void;
  setPopupStyle: (style: PopupStyle) => void;
  setRightPanelWidth: (px: number | null) => void;
  setLeftPanelWidth: (px: number | null) => void;
  setClipboardOpen: (open: boolean) => void;
  setForwardLookbackDays: (days: number) => void;
  setShortcutOverrides: (overrides: ShortcutOverrides) => void;
  navigatePrevDate: () => void;
  navigateNextDate: () => void;

  // Multi Event Selection State
  isMultiSelectMode: boolean;
  selectedEventIds: string[];
  selectedEventDateMap: Record<string, string>;
  setMultiSelectMode: (isMulti: boolean) => void;
  toggleEventSelection: (eventId: string, dateStr?: string) => void;
  clearEventSelection: () => void;
  selectAllEvents: (eventIds: string[], dateMap?: Record<string, string>) => void;
  /** 고치기 전 칸 값을 돌려준다(안내의 '되돌리기'). 실패하면 안내하고 null */
  bulkUpdateSelectedEvents: (updates: { completed?: boolean; label?: string; labelIds?: string[] }) => Promise<EventFieldSnapshot[] | null>;
  /** 휴지통 문서 id들을 돌려준다(안내의 '되돌리기'). 실패하면 안내하고 null */
  bulkDeleteSelectedEvents: () => Promise<string[] | null>;
  /**
   * 고른 일정을 모두 한 날짜로 옮긴다 (기간·반복 묶음이어도 고른 것만 - 범위는 묻지 않는다).
   * 옮긴 것·이미 그 날인 것·못 옮긴 것을 세어 주고, 옮긴 일정의 모습(안내용)도 준다. 다 끝나면 다중 선택을 끝낸다.
   */
  bulkMoveSelectedEvents: (toDate: string) => Promise<{ moved: number; same: number; failed: number; items: any[]; trail: MoveTrail[] }>;

  // Google API Token (For Tasks etc)
  googleAccessToken: string | null;
  setGoogleAccessToken: (token: string | null) => void;

  // Linker Modal State
  isLinkerModalOpen: boolean;
  linkerSourceType: 'schedule' | 'schedule_header' | 'journal' | 'event' | 'memo' | 'manual';
  linkerSourceDateStr: string;
  linkerSourceId?: string;
  linkerSourcePeriod?: number | string;
  linkerSourceFId?: string;
  linkerCallback?: (links: any[]) => void;
  openLinkerModal: (
    sourceType: 'schedule' | 'schedule_header' | 'journal' | 'event' | 'memo' | 'manual', 
    dateStr: string, 
    id?: string, 
    period?: number | string,
    callback?: (links: any[]) => void,
    fId?: string
  ) => void;
  closeLinkerModal: () => void;

  // 연결된 링크 배너. 다른 칸처럼 오른쪽 줄에 쌓인다 (나중에 연 것이 위, 2026-09-30).
  // 예전에는 한 개뿐이라 다른 링크를 열면 앞의 배너가 바뀌어 버렸다.
  /** 열린 링크 배너들 (연 차례). 하나라도 있으면 isLinkViewerModalOpen */
  linkViewers: LinkViewerTarget[];
  isLinkViewerModalOpen: boolean;
  /** 같은 항목의 배너가 이미 열려 있으면 새로 만들지 않고 맨 위로 올린다 */
  openLinkViewerModal: (
    sourceType: 'schedule' | 'journal' | 'event' | 'memo', 
    dateStr: string, 
    id?: string, 
    period?: number | string,
    fId?: string
  ) => void;
  /** key를 주면 그 배너만, 안 주면 모두 닫는다 (ESC) */
  closeLinkViewerModal: (key?: string) => void;

  // 연결된 링크 팝업에서 여는 '제대로 된 편집기'.
  // 예전에는 거기서 글자만 고칠 수 있는 칸이 열려, 첨부·라벨·링크를 손댈 수 없었다.
  // 일정/수업은 일정 수정 팝업, 기록/메모는 옆 배너를 그대로 연다.
  isDetailEditOpen: boolean;
  detailEditTarget: {
    type: 'schedule' | 'event';
    dateStr: string;
    itemId: string | number;
    initialData: any;
    fId?: string;
  } | null;
  openDetailEdit: (t: {
    type: 'schedule' | 'event';
    dateStr: string;
    itemId: string | number;
    initialData: any;
    fId?: string;
  }) => void;
  closeDetailEdit: () => void;

  // 검색에서 '이동'을 누른 항목. 그 화면에서 찾아 스크롤하고 강조한 뒤 비운다.
  // (lib/searchFocus.ts) 기기에 남기지 않는다.
  focusTarget: FocusTarget | null;
  requestFocus: (target: FocusTarget) => void;
  clearFocusTarget: () => void;

  /** 달력에서 기록 아이콘을 눌러 그날 기록을 들여다보는 창 */
  journalPeek: { dateStr: string; fId?: string | null } | null;
  openJournalPeek: (dateStr: string, fId?: string | null) => void;
  closeJournalPeek: () => void;

  /** 날짜 칸의 학사일정 이름을 눌러 여는 창 (나이스, 'D-Day로'·'일정으로 담기') */
  schoolEventPeek: { dateStr: string; items: NeisScheduleItem[] } | null;
  /**
   * 교사 유형 (lib/teachingMode, 계정 문서 v4_teaching). App이 로그인 뒤 한 번 구독해 넣는다.
   * 기기에 남기지 않는다(persist 아님). 읽기는 hooks/useTeachingMode로만.
   */
  teachingMode: TeachingMode;
  teachingModeLoaded: boolean;
  /** 문서가 있었나 - 없으면 하루 화면에 처음 안내 띠 */
  teachingModeExists: boolean;
  setTeachingMode: (mode: TeachingMode, exists: boolean) => void;
  openSchoolEventPeek: (dateStr: string, items: NeisScheduleItem[]) => void;
  closeSchoolEventPeek: () => void;

  /**
   * 다른 곳(달력의 '기록 N건 보기', 링크 보기)에서 기록·메모를 고칠 때. 하루·메모 화면과
   * 같은 쓰는 칸(entryPanels)을 연다. 예전에는 따로 만든 편집기(LinkedEntryEditor)가 열려
   * 날짜 표시·삭제·옮기기가 없고, PC에서도 화면을 덮었다.
   */
  openEntryEditor: (t: { kind: 'journal' | 'memo'; dateStr: string; id: string; fId?: string; initial?: any }) => void;

  // Evaluation Modal State
  isEvaluationModalOpen: boolean;
  evalDateStr: string;
  evalSource: 'schedule' | 'journal' | 'event';
  evalPeriod?: number;
  evalSubject?: string;
  /** 열자마자 보일 조사표 (학생 카드의 평가에서 열 때 - 그 자리에 조사표가 여럿이어도 그것으로) */
  evalId?: string;
  openEvaluationModal: (dateStr: string, source: 'schedule' | 'journal' | 'event', period?: number, subject?: string, evalId?: string) => void;
  closeEvaluationModal: () => void;

  // Trash Modal State
  isTrashModalOpen: boolean;
  setTrashModalOpen: (isOpen: boolean) => void;
  /** 진도 관리 창 (⋮ 메뉴와 시간표 설정 창, 수업 칸의 진도 줄에서 연다, docs/ROADMAP.md 5-2·5-3) */
  isProgressModalOpen: boolean;
  /** 진도 관리 창에서 먼저 보일 진도 (수업 칸의 진도 줄을 누르면 그 진도) */
  progressModalPlanId: string | null;
  setProgressModalOpen: (isOpen: boolean, planId?: string) => void;
  /** 주간학습안내 창 (ROADMAP 12-2). 열면 그 주의 아무 날(''이면 다음 주), 닫혀 있으면 null */
  weeklyGuideDate: string | null;
  openWeeklyGuide: (dateStr?: string) => void;
  closeWeeklyGuide: () => void;

  // Label Modal State
  isLabelModalOpen: boolean;
  labelModalTab: 'event' | 'journal' | 'memo';
  openLabelModal: (tab?: 'event' | 'journal' | 'memo') => void;
  closeLabelModal: () => void;

  /**
   * 메모·기록·일정을 쓰는 오른쪽 칸. 화면(페이지)이 아니라 Layout이 그린다.
   * 그래서 다른 날짜·다른 화면으로 옮겨 다녀도 쓰던 것이 그대로 남는다.
   */
  /**
   * 열려 있는 쓰는 칸들 (메모·기록·일정·알림장·출석부). 뒤에 있을수록 나중에 연 것(맨 위).
   * 예전에는 한 칸뿐이라, 새 일정 칸을 연 채 새 기록을 열면 일정 칸이 기록 칸으로 바뀌었다.
   * 이제 다른 팝업 칸처럼 위에 쌓이고, 먼저 연 칸은 적던 것을 그대로 가진 채 아래로 내려간다.
   */
  entryPanels: EntryPanelTarget[];
  /** 맨 위 칸 (없으면 null). entryPanels의 마지막과 같다. */
  entryPanel: EntryPanelTarget | null;
  openEntryPanel: (target: EntryPanelTarget) => void;
  /** 새로 만든 항목의 id를 알려 준다 (이어서 저장하면 그 항목을 고친다). key는 그 칸의 openedAt. */
  setEntryPanelId: (id: string, initial?: any, key?: number) => void;
  /**
   * 칸의 날짜를 바꾼다. 새 일정 칸에서 날짜를 고르거나, 일정을 다른 날짜로 옮긴 뒤 그 날짜의 수정 칸으로 이어질 때.
   * 옮기며 id가 바뀌었으면(새 날짜에 같은 id가 있었을 때) id도 함께. 칸은 다시 그리지 않아 적던 것이 남는다.
   */
  setEntryPanelDate: (dateStr: string, key: number | undefined, id?: string, initial?: any) => void;
  /**
   * 칸 밖(끌어 놓기·다중 선택)에서 일정을 옮겼을 때, 그 일정을 고치던 칸이 열려 있으면 새 날짜로 따라가게 한다.
   * 안 그러면 칸이 옛 날짜에서 그 일정을 찾지 못해 '불러오는 중'에 머문다.
   */
  retargetEventPanels: (groupId: string | null, fromDate: string, id: string, toDate: string, newId: string) => void;
  /** key(openedAt)의 칸을 닫는다. 주지 않으면 맨 위 칸. */
  closeEntryPanel: (key?: number) => void;
  /** 이 항목을 고치고 있던 칸을 모두 닫는다 (항목을 지웠을 때) */
  closeEntryPanelsFor: (kind: EntryPanelTarget['kind'], entryId: string) => void;

  clearAuthData: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      scope: 'day',
      semesterFilter: 'all',
      memoFilter: null,
      showWeekend: true,
      showClass: true,
      showEvents: true,
      showLastYear: false,
      currentDate: new Date().toISOString(),
      selectedGroupId: null,
      govApiKey: '',
      enableScrollNav: false,
      startupScope: 'last',
      fontScale: DEFAULT_FONT_SCALE,
      forwardLookbackDays: FORWARD_LOOKBACK_DAYS,
      popupStyle: 'side',
      rightPanelWidth: null,
      leftPanelWidth: null,
      clipboardOpen: false,
      shortcutOverrides: {},

      clearAuthData: () => set({
        selectedGroupId: null,
        govApiKey: '',
        googleAccessToken: null,
        selectedEventIds: [],
        selectedEventDateMap: {},
        isMultiSelectMode: false,
      }),

      setScope: (scope) => set({ scope }),
      setSemesterFilter: (filter) => set({ semesterFilter: filter }),
      setMemoFilter: (memoFilter) => set({ memoFilter }),
      setShowWeekend: (showWeekend) => set({ showWeekend }),
      setShowClass: (showClass) => set({ showClass }),
      setShowEvents: (showEvents) => set({ showEvents }),
      setShowLastYear: (showLastYear) => set({ showLastYear }),
      setCurrentDate: (date) => set({ currentDate: date.toISOString() }),
      setSelectedGroupId: (selectedGroupId) => set({ selectedGroupId }),
      setGovApiKey: (govApiKey) => set({ govApiKey }),
      setEnableScrollNav: (enable) => set({ enableScrollNav: enable }),
      setStartupScope: (startupScope) => set({ startupScope }),
      // 고르는 그 순간 화면이 바뀌어야 한다. 크기는 눈으로 보고 정하는 것이라
      // 저장한 뒤에야 보인다면 몇 번을 오가게 된다.
      setFontScale: (fontScale) => {
        applyFontScale(fontScale);
        set({ fontScale });
      },
      setPopupStyle: (popupStyle) => set({ popupStyle }),
      setRightPanelWidth: (rightPanelWidth) => set({ rightPanelWidth }),
      setLeftPanelWidth: (leftPanelWidth) => set({ leftPanelWidth }),
      setClipboardOpen: (clipboardOpen) => set({ clipboardOpen }),
      setForwardLookbackDays: (days) => set({ forwardLookbackDays: clampLookbackDays(days) }),
      setShortcutOverrides: (shortcutOverrides) => set({ shortcutOverrides }),

      navigatePrevDate: () => {
        const state = get();
        const d = new Date(state.currentDate);
        if (state.scope === 'day') {
          d.setDate(d.getDate() - 1);
          if (!state.showWeekend) {
            if (d.getDay() === 0) d.setDate(d.getDate() - 2);
            else if (d.getDay() === 6) d.setDate(d.getDate() - 1);
          }
        } else if (state.scope === 'week') {
          d.setDate(d.getDate() - 7);
        } else if (state.scope === 'month') {
          d.setMonth(d.getMonth() - 1);
        } else if (state.scope === 'year') {
          d.setFullYear(d.getFullYear() - 1);
        }
        set({ currentDate: d.toISOString() });
      },
      navigateNextDate: () => {
        const state = get();
        const d = new Date(state.currentDate);
        if (state.scope === 'day') {
          d.setDate(d.getDate() + 1);
          if (!state.showWeekend) {
            if (d.getDay() === 6) d.setDate(d.getDate() + 2);
            else if (d.getDay() === 0) d.setDate(d.getDate() + 1);
          }
        } else if (state.scope === 'week') {
          d.setDate(d.getDate() + 7);
        } else if (state.scope === 'month') {
          d.setMonth(d.getMonth() + 1);
        } else if (state.scope === 'year') {
          d.setFullYear(d.getFullYear() + 1);
        }
        set({ currentDate: d.toISOString() });
      },

      isMultiSelectMode: false,
      selectedEventIds: [],
      selectedEventDateMap: {},

      googleAccessToken: null,
      setGoogleAccessToken: (token) => set({ googleAccessToken: token }),

      setMultiSelectMode: (isMulti) => set({ 
        isMultiSelectMode: isMulti, 
        selectedEventIds: isMulti ? get().selectedEventIds : [],
        selectedEventDateMap: isMulti ? get().selectedEventDateMap : {}
      }),
      toggleEventSelection: (eventId, dateStr) => set((state) => {
        const isSelected = state.selectedEventIds.includes(eventId);
        const newSelected = isSelected
          ? state.selectedEventIds.filter(id => id !== eventId)
          : [...state.selectedEventIds, eventId];
        const newDateMap = { ...state.selectedEventDateMap };
        if (isSelected) {
          delete newDateMap[eventId];
        } else if (dateStr) {
          newDateMap[eventId] = dateStr;
        }
        return { selectedEventIds: newSelected, selectedEventDateMap: newDateMap };
      }),
      clearEventSelection: () => set({ selectedEventIds: [], selectedEventDateMap: {}, isMultiSelectMode: false }),
      selectAllEvents: (eventIds, dateMap = {}) => set({ 
        selectedEventIds: eventIds, 
        selectedEventDateMap: dateMap 
      }),
      
      bulkUpdateSelectedEvents: async (updates) => {
        const { selectedEventIds, selectedEventDateMap, selectedGroupId, currentDate } = get();
        if (selectedEventIds.length === 0) return [];
        const user = auth.currentUser;
        if (!user) return null;

        const defaultDate = formatDateStr(new Date(currentDate)); // toISOString은 UTC라 한국 새벽·자정이면 하루 앞날이 된다
        const groupedByDate: Record<string, string[]> = {};
        for (const id of selectedEventIds) {
          const d = selectedEventDateMap[id] || defaultDate;
          if (!groupedByDate[d]) groupedByDate[d] = [];
          groupedByDate[d].push(id);
        }
        // 되돌리기에 쓸 고치기 전 칸 값 (날짜마다 - 트랜잭션이 다시 돌면 그 날짜 것을 새로 담는다)
        const touched = updates.label !== undefined ? ['label', 'labelIds', 'forward', 'forwardOptOut'] : [];
        if (updates.completed !== undefined) touched.push('completed');
        const snapsByDate = new Map<string, EventFieldSnapshot[]>();

        const promises = Object.entries(groupedByDate).map(async ([dStr, ids]) => {
          const eventDocRef = selectedGroupId
            ? doc(db, 'groups', selectedGroupId, 'events', dStr)
            : doc(db, 'users', user.uid, 'events', dStr);

          // 트랜잭션으로 서버의 지금 목록을 읽어 고른 일정만 고친다 (캐시로 읽어 통째로 쓰면 그 사이 바뀐 것이 되돌아간다)
          const wanted = new Set(ids.map(String));
          await runTransaction(db, async (tx) => {
            const snap = await tx.get(eventDocRef);
            snapsByDate.set(dStr, []);
            if (!snap.exists()) return;
            // V3 옛 글(eventText)만 있는 날도 목록으로 읽는다. eventList만 보면 빈 목록을 써서 그날 일정이 사라진다.
            const currentList: any[] = readEventList(snap.data());
            const updatedList = currentList.map((item) => {
              if (wanted.has(String(item.id))) {
                snapsByDate.get(dStr)!.push(snapshotEventFields(dStr, item, touched));
                return {
                  ...item,
                  ...(updates.completed !== undefined ? { completed: updates.completed } : {}),
                  // 라벨을 바꿀 때는 labelIds도 새로 쓴다. label만 바꾸면 옛 라벨이 labelIds로
                  // 남아 칩이 둘 붙고(V3는 id로 찾으니 옛 라벨만 보인다), 이월 여부도 옛 라벨을 따른다.
                  // 이월을 일부러 켜고 끈 표시도 지워, 새 라벨의 기본을 따르게 한다.
                  ...(updates.label !== undefined
                    ? { label: updates.label, labelIds: updates.labelIds ?? [], forward: false, forwardOptOut: false }
                    : {}),
                };
              }
              return item;
            });
            tx.set(eventDocRef, eventDocPayload(updatedList), { merge: true });
          });
        });

        try {
          await Promise.all(promises);
        } catch (err) {
          showErrorToast('선택한 일정을 수정하지 못했습니다.', err);
          return null;
        }
        get().clearEventSelection();
        return [...snapsByDate.values()].flat();
      },
      bulkMoveSelectedEvents: async (toDate) => {
        const { selectedEventIds, selectedEventDateMap, selectedGroupId, currentDate } = get();
        const result = { moved: 0, same: 0, failed: 0, items: [] as any[], trail: [] as MoveTrail[] };
        if (selectedEventIds.length === 0) return result;
        const defaultDate = formatDateStr(new Date(currentDate));
        const failedIds: string[] = [];
        // 하나씩 옮긴다 (한 건 = 두 날짜 문서 한 트랜잭션). 같은 날짜에 여럿을 놓아도 서로 덮지 않는다.
        for (const id of selectedEventIds) {
          const fromDate = selectedEventDateMap[id] || defaultDate;
          if (fromDate === toDate) {
            result.same += 1;
            continue;
          }
          try {
            const r = await moveEventToDate({ fId: selectedGroupId || 'personal', fromDate, toDate, eventId: id });
            if (!r) {
              result.failed += 1;
              failedIds.push(id);
              continue;
            }
            result.moved += 1;
            result.items.push(r.item);
            result.trail.push({ fromDate, toDate, id: r.id });
            get().retargetEventPanels(selectedGroupId, fromDate, id, toDate, r.id);
          } catch (err) {
            console.error('일정을 옮기지 못했습니다:', id, err);
            result.failed += 1;
            failedIds.push(id);
          }
        }
        if (failedIds.length === 0) {
          get().clearEventSelection();
        } else {
          // 못 옮긴 것만 고른 채로 둔다 (다시 누르면 그것만 옮긴다)
          const map = get().selectedEventDateMap;
          set({
            selectedEventIds: failedIds,
            selectedEventDateMap: Object.fromEntries(failedIds.map((id) => [id, map[id]]).filter(([, d]) => !!d)),
          });
        }
        return result;
      },
      bulkDeleteSelectedEvents: async () => {
        const { selectedEventIds, selectedEventDateMap, selectedGroupId, currentDate } = get();
        if (selectedEventIds.length === 0) return [];
        const user = auth.currentUser;
        if (!user) return null;
        const trashIds: string[] = [];

        const defaultDate = formatDateStr(new Date(currentDate)); // toISOString은 UTC라 한국 새벽·자정이면 하루 앞날이 된다
        const groupedByDate: Record<string, string[]> = {};
        for (const id of selectedEventIds) {
          const d = selectedEventDateMap[id] || defaultDate;
          if (!groupedByDate[d]) groupedByDate[d] = [];
          groupedByDate[d].push(id);
        }

        const promises = Object.entries(groupedByDate).map(async ([dStr, ids]) => {
          const eventDocRef = selectedGroupId
            ? doc(db, 'groups', selectedGroupId, 'events', dStr)
            : doc(db, 'users', user.uid, 'events', dStr);

          // 휴지통에 넣을 원본은 서버에서 읽는다
          const { snap } = await getDocTrustingServer(eventDocRef);
          if (!snap.exists()) return;
          // V3 옛 글(eventText)만 있는 날도 목록으로 읽는다. eventList만 보면 빈 목록을 써서 그날 일정이 사라진다.
          const wanted = new Set(ids.map(String));
          const toDelete = readEventList(snap.data()).filter((item: any) => wanted.has(String(item.id)));
          // 휴지통에 넣은 것만 지운다. 못 넣은 것을 지우면 되돌릴 길 없이 사라진다.
          const trashed = new Set<string>();
          for (const item of toDelete) {
            try {
              const trashId = await moveToTrash({
                id: String(item.id),
                type: 'event',
                originalDateStr: dStr,
                fId: selectedGroupId || 'personal',
                content: item.content,
                data: item,
              });
              if (trashId) trashIds.push(trashId);
              trashed.add(String(item.id));
            } catch (e) {
              console.error('Failed to move bulk event to trash:', e);
            }
          }
          if (trashed.size === 0) {
            if (toDelete.length > 0) throw new Error('휴지통에 옮기지 못했습니다');
            return;
          }
          // 서버의 지금 목록에서 휴지통에 넣은 것만 뺀다
          await runTransaction(db, async (tx) => {
            const fresh = await tx.get(eventDocRef);
            if (!fresh.exists()) return;
            const currentList: any[] = readEventList(fresh.data());
            const updatedList = currentList.filter((item) => !trashed.has(String(item.id)));
            if (updatedList.length === currentList.length) return;
            tx.set(eventDocRef, eventDocPayload(updatedList), { merge: true });
          });
          if (trashed.size < toDelete.length) throw new Error('일부를 휴지통에 옮기지 못해 지우지 않았습니다');
        });

        try {
          await Promise.all(promises);
        } catch (err) {
          showErrorToast('선택한 일정을 삭제하지 못했습니다.', err);
          return null;
        }
        get().clearEventSelection();
        return trashIds;
      },

      isLinkerModalOpen: false,
      linkerSourceType: 'manual',
      linkerSourceDateStr: '',
      linkerSourceId: undefined,
      linkerSourcePeriod: undefined,
      linkerSourceFId: undefined,
      linkerCallback: undefined,
      openLinkerModal: (sourceType, dateStr, id, period, callback, fId) => set({ 
        isLinkerModalOpen: true, 
        linkerSourceType: sourceType, 
        linkerSourceDateStr: dateStr, 
        linkerSourceId: id,
        linkerSourcePeriod: period,
        linkerCallback: callback,
        linkerSourceFId: fId,
      }),
      closeLinkerModal: () => set({ 
        isLinkerModalOpen: false, 
        linkerSourceId: undefined,
        linkerSourcePeriod: undefined,
        linkerSourceFId: undefined,
        linkerCallback: undefined
      }),

      linkViewers: [],
      isLinkViewerModalOpen: false,
      openLinkViewerModal: (sourceType, dateStr, id = '', period, fId) =>
        set((s) => {
          const key = linkViewerKey(sourceType, dateStr, id, period, fId);
          const now = Date.now();
          const exists = s.linkViewers.some((v) => v.key === key);
          const linkViewers = exists
            ? s.linkViewers.map((v) => (v.key === key ? { ...v, raisedAt: now } : v))
            : [...s.linkViewers, { key, sourceType, dateStr, id, period, fId, raisedAt: now }];
          return { linkViewers, isLinkViewerModalOpen: true };
        }),
      closeLinkViewerModal: (key) =>
        set((s) => {
          const linkViewers = key === undefined ? [] : s.linkViewers.filter((v) => v.key !== key);
          return { linkViewers, isLinkViewerModalOpen: linkViewers.length > 0 };
        }),

      isDetailEditOpen: false,
      detailEditTarget: null,
      openDetailEdit: (t) => set({ isDetailEditOpen: true, detailEditTarget: t }),
      closeDetailEdit: () => set({ isDetailEditOpen: false, detailEditTarget: null }),

      focusTarget: null,
      requestFocus: (target) => set({ focusTarget: target }),
      clearFocusTarget: () => set({ focusTarget: null }),

      journalPeek: null,
      openJournalPeek: (dateStr, fId) => set({ journalPeek: { dateStr, fId: fId ?? null } }),
      closeJournalPeek: () => set({ journalPeek: null }),

      schoolEventPeek: null,
      teachingMode: DEFAULT_TEACHING_MODE,
      teachingModeLoaded: false,
      teachingModeExists: false,
      setTeachingMode: (mode, exists) => set({ teachingMode: mode, teachingModeLoaded: true, teachingModeExists: exists }),
      openSchoolEventPeek: (dateStr, items) => set({ schoolEventPeek: { dateStr, items } }),
      closeSchoolEventPeek: () => set({ schoolEventPeek: null }),

      openEntryEditor: (t) =>
        get().openEntryPanel({
          kind: t.kind,
          groupId: t.fId && t.fId !== 'personal' ? t.fId : null,
          dateStr: t.kind === 'journal' ? t.dateStr : undefined,
          entryId: t.id,
          ...(t.initial ? { initial: t.initial } : {}),
        }),

      isEvaluationModalOpen: false,
      evalDateStr: '',
      evalSource: 'event',
      openEvaluationModal: (dateStr, source, period, subject, evalId) => set({
        isEvaluationModalOpen: true,
        evalDateStr: dateStr,
        evalSource: source,
        evalPeriod: period,
        evalSubject: subject,
        evalId,
      }),
      closeEvaluationModal: () => set({ isEvaluationModalOpen: false }),

      isTrashModalOpen: false,
      setTrashModalOpen: (isOpen: boolean) => set({ isTrashModalOpen: isOpen }),

      isProgressModalOpen: false,
      progressModalPlanId: null,
      setProgressModalOpen: (isOpen: boolean, planId?: string) =>
        set({ isProgressModalOpen: isOpen, progressModalPlanId: isOpen ? planId ?? null : null }),

      weeklyGuideDate: null,
      openWeeklyGuide: (dateStr = '') => set({ weeklyGuideDate: dateStr }),
      closeWeeklyGuide: () => set({ weeklyGuideDate: null }),

      isLabelModalOpen: false,
      labelModalTab: 'event',
      openLabelModal: (tab = 'event') => set({ isLabelModalOpen: true, labelModalTab: tab }),
      closeLabelModal: () => set({ isLabelModalOpen: false }),

      entryPanels: [],
      entryPanel: null,
      // 새 칸은 맨 위에 쌓는다. 이미 같은 항목을 고치는 칸이 열려 있으면 새로 만들지 않고
      // 그 칸을 맨 위로 올린다 (적던 것이 그대로 남는다).
      openEntryPanel: (target) =>
        set((st) => {
          const now = Date.now();
          const existing = st.entryPanels.find((p) => samePanelTarget(p, target));
          let panels: EntryPanelTarget[];
          if (existing) {
            const raised = { ...existing, raisedAt: now };
            panels = [...st.entryPanels.filter((p) => p !== existing), raised];
          } else {
            // 같은 밀리초에 둘을 열어도 번호가 겹치지 않게
            const last = Math.max(0, ...st.entryPanels.map((p) => p.openedAt || 0));
            const openedAt = now > last ? now : last + 1;
            panels = [...st.entryPanels, { ...target, openedAt, raisedAt: openedAt }];
          }
          return { entryPanels: panels, entryPanel: panels[panels.length - 1] };
        }),
      setEntryPanelId: (id, initial, key) =>
        set((st) => {
          const k = key ?? st.entryPanel?.openedAt;
          const panels = st.entryPanels.map((p) =>
            p.openedAt === k ? { ...p, entryId: id, ...(initial ? { initial } : {}) } : p
          );
          return { entryPanels: panels, entryPanel: panels[panels.length - 1] || null };
        }),
      setEntryPanelDate: (dateStr, key, id, initial) =>
        set((st) => {
          const k = key ?? st.entryPanel?.openedAt;
          const panels = st.entryPanels.map((p) =>
            p.openedAt === k
              ? { ...p, dateStr, ...(id !== undefined ? { entryId: id } : {}), ...(initial ? { initial } : {}) }
              : p
          );
          return { entryPanels: panels, entryPanel: panels[panels.length - 1] || null };
        }),
      retargetEventPanels: (groupId, fromDate, id, toDate, newId) =>
        set((st) => {
          let changed = false;
          const panels = st.entryPanels.map((p) => {
            if (
              p.kind !== 'event' ||
              String(p.entryId ?? '') !== String(id) ||
              (p.dateStr || '') !== fromDate ||
              (p.groupId || null) !== (groupId || null)
            ) {
              return p;
            }
            changed = true;
            return { ...p, dateStr: toDate, entryId: newId };
          });
          return changed ? { entryPanels: panels, entryPanel: panels[panels.length - 1] || null } : {};
        }),
      closeEntryPanel: (key) =>
        set((st) => {
          const k = key ?? st.entryPanel?.openedAt;
          const panels = st.entryPanels.filter((p) => p.openedAt !== k);
          return { entryPanels: panels, entryPanel: panels[panels.length - 1] || null };
        }),
      closeEntryPanelsFor: (kind, entryId) =>
        set((st) => {
          const panels = st.entryPanels.filter(
            (p) => !(p.kind === kind && p.entryId !== undefined && String(p.entryId) === String(entryId))
          );
          return { entryPanels: panels, entryPanel: panels[panels.length - 1] || null };
        }),

    }),
    {
      name: 'sp4-app-storage',
      // 저장해 둔 글자 크기는 화면이 그려지기 전에 입혀야 한다. 나중에 입히면
      // 기본 크기로 한 번 그려졌다가 바뀌어, 열 때마다 글자가 튄다.
      onRehydrateStorage: () => (state) => {
        applyFontScale(state?.fontScale || DEFAULT_FONT_SCALE);
      },
      // 아래 값 중 설정에 해당하는 것은 계정(Firestore)에도 저장된다.
      // 무엇을 올리는지는 lib/preferenceSync.ts 의 SYNCED_PREFERENCE_KEYS 에 있다.
      partialize: (state) => ({
        scope: state.scope,
        semesterFilter: state.semesterFilter,
        memoFilter: state.memoFilter,
        showWeekend: state.showWeekend,
        showClass: state.showClass,
        showEvents: state.showEvents,
        showLastYear: state.showLastYear,
        enableScrollNav: state.enableScrollNav, // 추가됨
        startupScope: state.startupScope,
        fontScale: state.fontScale,
        forwardLookbackDays: state.forwardLookbackDays,
        popupStyle: state.popupStyle,
        rightPanelWidth: state.rightPanelWidth,
        leftPanelWidth: state.leftPanelWidth,
        clipboardOpen: state.clipboardOpen,
        shortcutOverrides: state.shortcutOverrides,
        // govApiKey는 일부러 넣지 않는다. 키는 Firestore의 admin/config에 있고
        // 개발자가 환경설정을 열 때 거기서 읽어온다. 이 기기에도 남길 이유가 없다.
      }),
    }
  )
);