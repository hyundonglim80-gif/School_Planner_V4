import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Scope = 'day' | 'week' | 'month' | 'year' | 'memo';

interface AppState {
  scope: Scope;
  semesterFilter: 'all' | 1 | 2;
  showWeekend: boolean;
  showClass: boolean;
  showEvents: boolean;
  currentDate: string; // ISO String format
  selectedGroupId: string | null; // null: 개인, string: 특정 공유 그룹 ID
  setScope: (scope: Scope) => void;
  setSemesterFilter: (filter: 'all' | 1 | 2) => void;
  setShowWeekend: (show: boolean) => void;
  setShowClass: (show: boolean) => void;
  setShowEvents: (show: boolean) => void;
  setCurrentDate: (date: Date) => void;
  setSelectedGroupId: (groupId: string | null) => void;
  
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

  // Evaluation Modal State
  isEvaluationModalOpen: boolean;
  evalDateStr: string;
  evalSource: 'schedule' | 'journal' | 'event';
  evalPeriod?: number;
  evalSubject?: string;
  openEvaluationModal: (dateStr: string, source: 'schedule' | 'journal' | 'event', period?: number, subject?: string) => void;
  closeEvaluationModal: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      scope: 'day',
      semesterFilter: 'all',
      showWeekend: true,
      showClass: true,
      showEvents: true,
      currentDate: new Date().toISOString(),
      selectedGroupId: null,
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
        linkerCallback: undefined,
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
      }),
    }
  )
);
