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
        const showWeekend = scope === 'year' || scope === 'month';
        const showClass = scope !== 'year' && scope !== 'month';
        set({ scope, showWeekend, showClass });
      },
      setMode: (mode) => set({ mode }),
      setSemesterFilter: (filter) => set({ semesterFilter: filter }),
      setShowWeekend: (showWeekend) => set({ showWeekend }),
      setShowClass: (showClass) => set({ showClass }),
      setCurrentDate: (date) => set({ currentDate: date.toISOString() }),
      setSelectedGroupId: (selectedGroupId) => set({ selectedGroupId }),
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
