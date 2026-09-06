import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Scope = 'day' | 'week' | 'month' | 'year' | 'memo';
type Mode = 'viewer' | 'editor';

interface AppState {
  scope: Scope;
  mode: Mode;
  semesterFilter: 'all' | 1 | 2;
  showWeekend: boolean;
  showClass: boolean;
  currentDate: string; // ISO String format
  selectedGroupId: string | null; // null: 개인, string: 특정 공유 그룹 ID
  setScope: (scope: Scope) => void;
  setMode: (mode: Mode) => void;
  setSemesterFilter: (filter: 'all' | 1 | 2) => void;
  setShowWeekend: (show: boolean) => void;
  setShowClass: (show: boolean) => void;
  setCurrentDate: (date: Date) => void;
  setSelectedGroupId: (groupId: string | null) => void;
  
  // Linker Modal State
  isLinkerModalOpen: boolean;
  linkerSourceType: 'schedule' | 'journal' | 'manual';
  linkerSourceDateStr: string;
  linkerSourceId?: string;
  linkerSourcePeriod?: number;
  openLinkerModal: (sourceType: 'schedule' | 'journal' | 'manual', dateStr: string, id?: string, period?: number) => void;
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
      mode: 'viewer',
      semesterFilter: 'all',
      showWeekend: true,
      showClass: false,
      currentDate: new Date().toISOString(),
      selectedGroupId: null,
      setScope: (scope) => {
        const showClass = scope !== 'year' && scope !== 'month';
        set({ scope, showClass });
      },
      setMode: (mode) => set({ mode }),
      setSemesterFilter: (filter) => set({ semesterFilter: filter }),
      setShowWeekend: (showWeekend) => set({ showWeekend }),
      setShowClass: (showClass) => set({ showClass }),
      setCurrentDate: (date) => set({ currentDate: date.toISOString() }),
      setSelectedGroupId: (selectedGroupId) => set({ selectedGroupId }),

      isLinkerModalOpen: false,
      linkerSourceType: 'manual',
      linkerSourceDateStr: '',
      openLinkerModal: (sourceType, dateStr, id, period) => set({ 
        isLinkerModalOpen: true, 
        linkerSourceType: sourceType, 
        linkerSourceDateStr: dateStr, 
        linkerSourceId: id, 
        linkerSourcePeriod: period 
      }),
      closeLinkerModal: () => set({ isLinkerModalOpen: false }),

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
        mode: state.mode, 
        semesterFilter: state.semesterFilter,
        showWeekend: state.showWeekend, 
        showClass: state.showClass,
        selectedGroupId: state.selectedGroupId,
      }),
    }
  )
);
