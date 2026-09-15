import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { formatV3EventText } from '../hooks/useDayData';
import { moveToTrash } from '../utils/trashHelper';
import { showErrorToast } from '../utils/toast';
import { FORWARD_LOOKBACK_DAYS, clampLookbackDays } from '../lib/forwarding';
import type { ShortcutOverrides } from '../lib/shortcuts';

type Scope = 'day' | 'week' | 'month' | 'year' | 'memo';

/** 앱을 열었을 때 어느 화면부터 보여줄지. 'last'는 마지막에 보던 화면. */
export type StartupScope = 'last' | Scope;

interface AppState {
  scope: Scope;
  semesterFilter: 'all' | 1 | 2;
  showWeekend: boolean;
  showClass: boolean;
  showEvents: boolean;
  currentDate: string; 
  selectedGroupId: string | null; 
  govApiKey: string; 
  // 💡 스크롤 네비게이션 활성화 여부 추가
  enableScrollNav: boolean;
  // 환경설정에서 조절하는 값들
  startupScope: StartupScope;
  forwardLookbackDays: number;
  // 기본값에서 바꾼 단축키만 담는다. 나머지는 lib/shortcuts.ts의 기본값을 쓴다.
  shortcutOverrides: ShortcutOverrides;

  setScope: (scope: Scope) => void;
  setSemesterFilter: (filter: 'all' | 1 | 2) => void;
  setShowWeekend: (show: boolean) => void;
  setShowClass: (show: boolean) => void;
  setShowEvents: (show: boolean) => void;
  setCurrentDate: (date: Date) => void;
  setSelectedGroupId: (groupId: string | null) => void;
  setGovApiKey: (key: string) => void;
  setEnableScrollNav: (enable: boolean) => void;
  setStartupScope: (scope: StartupScope) => void;
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
  bulkUpdateSelectedEvents: (updates: { completed?: boolean; label?: string }) => Promise<void>;
  bulkDeleteSelectedEvents: () => Promise<void>;

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

  // Link Viewer Modal State
  isLinkViewerModalOpen: boolean;
  linkViewerSourceType: 'schedule' | 'journal' | 'event' | 'memo';
  linkViewerSourceDateStr: string;
  linkViewerSourceId: string;
  linkViewerSourcePeriod?: number | string;
  linkViewerSourceFId?: string;
  openLinkViewerModal: (
    sourceType: 'schedule' | 'journal' | 'event' | 'memo', 
    dateStr: string, 
    id?: string, 
    period?: number | string,
    fId?: string
  ) => void;
  closeLinkViewerModal: () => void;

  // Evaluation Modal State
  isEvaluationModalOpen: boolean;
  evalDateStr: string;
  evalSource: 'schedule' | 'journal' | 'event';
  evalPeriod?: number;
  evalSubject?: string;
  openEvaluationModal: (dateStr: string, source: 'schedule' | 'journal' | 'event', period?: number, subject?: string) => void;
  closeEvaluationModal: () => void;

  // Trash Modal State
  isTrashModalOpen: boolean;
  setTrashModalOpen: (isOpen: boolean) => void;

  // Label Modal State
  isLabelModalOpen: boolean;
  labelModalTab: 'event' | 'journal' | 'memo';
  openLabelModal: (tab?: 'event' | 'journal' | 'memo') => void;
  closeLabelModal: () => void;

  clearAuthData: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      scope: 'day',
      semesterFilter: 'all',
      showWeekend: true,
      showClass: true,
      showEvents: true,
      currentDate: new Date().toISOString(),
      selectedGroupId: null,
      govApiKey: '',
      enableScrollNav: false,
      startupScope: 'last',
      forwardLookbackDays: FORWARD_LOOKBACK_DAYS,
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
      setShowWeekend: (showWeekend) => set({ showWeekend }),
      setShowClass: (showClass) => set({ showClass }),
      setShowEvents: (showEvents) => set({ showEvents }),
      setCurrentDate: (date) => set({ currentDate: date.toISOString() }),
      setSelectedGroupId: (selectedGroupId) => set({ selectedGroupId }),
      setGovApiKey: (govApiKey) => set({ govApiKey }),
      setEnableScrollNav: (enable) => set({ enableScrollNav: enable }),
      setStartupScope: (startupScope) => set({ startupScope }),
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
        if (selectedEventIds.length === 0) return;
        const user = auth.currentUser;
        if (!user) return;

        const defaultDate = new Date(currentDate).toISOString().split('T')[0];
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

          const snap = await getDoc(eventDocRef);
          if (!snap.exists()) return;
          const data = snap.data();
          const currentList: any[] = data.eventList || [];

          const updatedList = currentList.map((item) => {
            if (ids.includes(item.id)) {
              return {
                ...item,
                ...(updates.completed !== undefined ? { completed: updates.completed } : {}),
                ...(updates.label !== undefined ? { label: updates.label } : {}),
              };
            }
            return item;
          });

          const serializedText = formatV3EventText(updatedList);
          await setDoc(eventDocRef, {
            eventList: updatedList,
            eventText: serializedText,
            updatedAt: Date.now(),
          }, { merge: true });
        });

        try {
          await Promise.all(promises);
        } catch (err) {
          showErrorToast('선택한 일정을 수정하지 못했습니다.', err);
          return;
        }
        get().clearEventSelection();
      },
      bulkDeleteSelectedEvents: async () => {
        const { selectedEventIds, selectedEventDateMap, selectedGroupId, currentDate } = get();
        if (selectedEventIds.length === 0) return;
        const user = auth.currentUser;
        if (!user) return;

        const defaultDate = new Date(currentDate).toISOString().split('T')[0];
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

          const snap = await getDoc(eventDocRef);
          if (!snap.exists()) return;
          const data = snap.data();
          const currentList: any[] = data.eventList || [];

          const toDelete = currentList.filter((item) => ids.map(String).includes(String(item.id)));
          for (const item of toDelete) {
            try {
              await moveToTrash({
                id: String(item.id),
                type: 'event',
                originalDateStr: dStr,
                fId: selectedGroupId || 'personal',
                content: item.content,
                data: item,
              });
            } catch (e) {
              console.error('Failed to move bulk event to trash:', e);
            }
          }

          const updatedList = currentList.filter((item) => !ids.map(String).includes(String(item.id)));
          const serializedText = formatV3EventText(updatedList);
          await setDoc(eventDocRef, {
            eventList: updatedList,
            eventText: serializedText,
            updatedAt: Date.now(),
          }, { merge: true });
        });

        try {
          await Promise.all(promises);
        } catch (err) {
          showErrorToast('선택한 일정을 삭제하지 못했습니다.', err);
          return;
        }
        get().clearEventSelection();
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

      isLinkViewerModalOpen: false,
      linkViewerSourceType: 'event',
      linkViewerSourceDateStr: '',
      linkViewerSourceId: '',
      linkViewerSourcePeriod: undefined,
      linkViewerSourceFId: undefined,
      openLinkViewerModal: (sourceType, dateStr, id = '', period, fId) => set({
        isLinkViewerModalOpen: true,
        linkViewerSourceType: sourceType,
        linkViewerSourceDateStr: dateStr,
        linkViewerSourceId: id,
        linkViewerSourcePeriod: period,
        linkViewerSourceFId: fId,
      }),
      closeLinkViewerModal: () => set({
        isLinkViewerModalOpen: false,
        linkViewerSourceDateStr: '',
        linkViewerSourceId: '',
        linkViewerSourcePeriod: undefined,
        linkViewerSourceFId: undefined,
      }),

      isEvaluationModalOpen: false,
      evalDateStr: '',
      evalSource: 'event',
      openEvaluationModal: (dateStr, source, period, subject) => set({
        isEvaluationModalOpen: true,
        evalDateStr: dateStr,
        evalSource: source,
        evalPeriod: period,
        evalSubject: subject
      }),
      closeEvaluationModal: () => set({ isEvaluationModalOpen: false }),

      isTrashModalOpen: false,
      setTrashModalOpen: (isOpen: boolean) => set({ isTrashModalOpen: isOpen }),

      isLabelModalOpen: false,
      labelModalTab: 'event',
      openLabelModal: (tab = 'event') => set({ isLabelModalOpen: true, labelModalTab: tab }),
      closeLabelModal: () => set({ isLabelModalOpen: false }),

    }),
    {
      name: 'sp4-app-storage',
      partialize: (state) => ({
        scope: state.scope,
        semesterFilter: state.semesterFilter,
        showWeekend: state.showWeekend,
        showClass: state.showClass,
        showEvents: state.showEvents,
        enableScrollNav: state.enableScrollNav, // 추가됨
        startupScope: state.startupScope,
        forwardLookbackDays: state.forwardLookbackDays,
        shortcutOverrides: state.shortcutOverrides,
        // govApiKey는 일부러 넣지 않는다. 키는 Firestore의 admin/config에 있고
        // 개발자가 환경설정을 열 때 거기서 읽어온다. 이 기기에도 남길 이유가 없다.
      }),
    }
  )
);