import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { formatV3EventText } from '../hooks/useDayData';
import { moveToTrash } from '../utils/trashHelper';

type Scope = 'day' | 'week' | 'month' | 'year' | 'memo';

interface AppState {
  scope: Scope;
  semesterFilter: 'all' | 1 | 2;
  showWeekend: boolean;
  showClass: boolean;
  showEvents: boolean;
  currentDate: string; // ISO String format
  selectedGroupId: string | null; // null: 개인, string: 특정 공유 그룹 ID
  govApiKey: string; // 공공데이터 API 키
  setScope: (scope: Scope) => void;
  setSemesterFilter: (filter: 'all' | 1 | 2) => void;
  setShowWeekend: (show: boolean) => void;
  setShowClass: (show: boolean) => void;
  setShowEvents: (show: boolean) => void;
  setCurrentDate: (date: Date) => void;
  setSelectedGroupId: (groupId: string | null) => void;
  setGovApiKey: (key: string) => void;
  
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
  linkerSourceType: 'schedule' | 'journal' | 'event' | 'manual';
  linkerSourceDateStr: string;
  linkerSourceId?: string;
  linkerSourcePeriod?: number;
  linkerCallback?: (links: any[]) => void;
  openLinkerModal: (
    sourceType: 'schedule' | 'journal' | 'event' | 'manual', 
    dateStr: string, 
    id?: string, 
    period?: number,
    callback?: (links: any[]) => void
  ) => void;
  closeLinkerModal: () => void;

  // Link Viewer Modal State
  isLinkViewerModalOpen: boolean;
  linkViewerSourceType: 'schedule' | 'journal' | 'event';
  linkViewerSourceDateStr: string;
  linkViewerSourceId: string;
  openLinkViewerModal: (sourceType: 'schedule' | 'journal' | 'event', dateStr: string, id: string) => void;
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
      setScope: (scope) => {
        const showClass = scope !== 'year' && scope !== 'month';
        set({ scope, showClass });
      },
      setSemesterFilter: (filter) => set({ semesterFilter: filter }),
      setShowWeekend: (showWeekend) => set({ showWeekend }),
      setShowClass: (showClass) => set({ showClass }),
      setShowEvents: (showEvents) => set({ showEvents }),
      setCurrentDate: (date) => set({ currentDate: date.toISOString() }),
      setSelectedGroupId: (selectedGroupId) => set({ selectedGroupId }),
      setGovApiKey: (govApiKey) => set({ govApiKey }),

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

        await Promise.all(promises);
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

          // Move deleted items to trash
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

        await Promise.all(promises);
        get().clearEventSelection();
      },

      isLinkerModalOpen: false,
      linkerSourceType: 'manual',
      linkerSourceDateStr: '',
      linkerSourceId: undefined,
      linkerSourcePeriod: undefined,
      linkerCallback: undefined,
      openLinkerModal: (sourceType, dateStr, id, period, callback) => set({ 
        isLinkerModalOpen: true, 
        linkerSourceType: sourceType, 
        linkerSourceDateStr: dateStr, 
        linkerSourceId: id,
        linkerSourcePeriod: period,
        linkerCallback: callback,
      }),
      closeLinkerModal: () => set({ 
        isLinkerModalOpen: false, 
        linkerSourceId: undefined,
        linkerSourcePeriod: undefined,
        linkerCallback: undefined
      }),

      isLinkViewerModalOpen: false,
      linkViewerSourceType: 'event',
      linkViewerSourceDateStr: '',
      linkViewerSourceId: '',
      openLinkViewerModal: (sourceType, dateStr, id) => set({
        isLinkViewerModalOpen: true,
        linkViewerSourceType: sourceType,
        linkViewerSourceDateStr: dateStr,
        linkViewerSourceId: id
      }),
      closeLinkViewerModal: () => set({
        isLinkViewerModalOpen: false,
        linkViewerSourceDateStr: '',
        linkViewerSourceId: ''
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
        selectedGroupId: state.selectedGroupId,
        govApiKey: state.govApiKey,
      }),
    }
  )
);
