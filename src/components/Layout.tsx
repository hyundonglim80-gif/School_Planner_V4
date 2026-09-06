import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../features/auth/useAuth';
import { useAppStore } from '../store/useAppStore';
import { useGroups } from '../hooks/useGroups';
import { useDDay } from '../hooks/useDDay';
import GroupModal from './GroupModal';
import DDayModal from './DDayModal';
import SearchModal from './SearchModal';
import RosterModal from './RosterModal';
import LabelModal from './LabelModal';
import BackupModal from './BackupModal';
import HelpModal from './HelpModal';
import TimetableTemplateModal from './TimetableTemplateModal';

import SettingsModal from './SettingsModal';
import EvaluationModal from './EvaluationModal';
import RecurringModal from './RecurringModal';
import ForwardingModal from './ForwardingModal';
import LinkerModal from './LinkerModal';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { logout, user } = useAuth();
  const {
    scope,
    setScope,
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
    closeLinkerModal,
    isEvaluationModalOpen,
    evalDateStr,
    evalSource,
    evalPeriod,
    evalSubject,
    closeEvaluationModal,
  } = useAppStore();
  const { groups } = useGroups();
  const { primaryDDay } = useDDay();

  // 모달 상태 관리
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isDDayModalOpen, setIsDDayModalOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isRosterModalOpen, setIsRosterModalOpen] = useState(false);
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);
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
      alert("이미 기기에 설치되어 있거나 현재 브라우저 환경에서 직접 설치를 지원하지 않습니다.\n\n[아이폰/아이패드(Safari)의 경우]\n하단의 '공유(내보내기)' 아이콘을 누르고 '홈 화면에 추가'를 선택하여 수동으로 설치할 수 있습니다.");
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
  const handlePrevDate = () => {
    const { currentDate, scope, showWeekend, setCurrentDate } = useAppStore.getState();
    const d = new Date(currentDate);
    if (scope === 'day') {
      d.setDate(d.getDate() - 1);
      if (!showWeekend) {
        if (d.getDay() === 0) d.setDate(d.getDate() - 2);
        else if (d.getDay() === 6) d.setDate(d.getDate() - 1);
      }
    } else if (scope === 'week') {
      d.setDate(d.getDate() - 7);
    } else if (scope === 'month') {
      d.setMonth(d.getMonth() - 1);
    } else if (scope === 'year') {
      d.setFullYear(d.getFullYear() - 1);
    }
    setCurrentDate(d);
  };

  const handleNextDate = () => {
    const { currentDate, scope, showWeekend, setCurrentDate } = useAppStore.getState();
    const d = new Date(currentDate);
    if (scope === 'day') {
      d.setDate(d.getDate() + 1);
      if (!showWeekend) {
        if (d.getDay() === 6) d.setDate(d.getDate() + 2);
        else if (d.getDay() === 0) d.setDate(d.getDate() + 1);
      }
    } else if (scope === 'week') {
      d.setDate(d.getDate() + 7);
    } else if (scope === 'month') {
      d.setMonth(d.getMonth() + 1);
    } else if (scope === 'year') {
      d.setFullYear(d.getFullYear() + 1);
    }
    setCurrentDate(d);
  };

  const handleTodayClick = () => {
    useAppStore.getState().setCurrentDate(new Date());
  };

  // 키보드 단축키 핸들러 (ESC, /, Ctrl+화살표, Ctrl+Space, Shift+화살표 등)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

      // ESC: 열려있는 모든 모달 및 메뉴 닫기
      if (e.key === 'Escape') {
        setIsHelpModalOpen(false);
        setIsSearchModalOpen(false);
        setIsGroupModalOpen(false);
        setIsBackupModalOpen(false);
        setIsLabelModalOpen(false);
        setIsMoreMenuOpen(false);
        if (isForwardingModalOpen) {
          setIsForwardingModalOpen(false);
        }
        if (isLinkerModalOpen) {
          closeLinkerModal();
        }
        return;
      }

      // 통합 검색: / 또는 ` (입력창 포커스 아닐 때)
      if ((e.key === '/' || e.key === '`') && !isInput) {
        e.preventDefault();
        setIsSearchModalOpen(true);
        return;
      }

      // 주말 보기/숨기기 토글: Shift + ↑ 또는 Shift + ↓
      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const currentShow = useAppStore.getState().showWeekend;
        setShowWeekend(!currentShow);
        return;
      }

      // 이전 날짜: Ctrl + ←
      if (e.ctrlKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevDate();
        return;
      }

      // 다음 날짜: Ctrl + →
      if (e.ctrlKey && e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextDate();
        return;
      }

      // 오늘 날짜로 이동: Ctrl + Space
      if (e.ctrlKey && (e.key === ' ' || e.code === 'Space')) {
        e.preventDefault();
        handleTodayClick();
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setShowWeekend, isForwardingModalOpen, isLinkerModalOpen, closeLinkerModal]);

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
        <div className="flex items-center justify-between flex-wrap gap-3 max-w-7xl mx-auto w-full">
          {/* 좌측: 로고 및 D-Day 설정 (V3 방식) */}
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-extrabold text-primary tracking-tight">SP4</h1>

            {/* D-Day 뱃지 버튼 */}
            <button
              onClick={() => setIsDDayModalOpen(true)}
              className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs"
              title="학사 D-Day 관리"
            >
              <span>⏳</span>
              {primaryDDay ? (
                <span>
                  {primaryDDay.title} <strong className="text-rose-600 font-extrabold">{primaryDDay.text}</strong>
                </span>
              ) : (
                <span>D-Day</span>
              )}
            </button>
          </div>

          {/* 우측: 검색, 스코프 탭, 그룹 선택, 더보기, 프로필 (V3 방식) */}
          <div className="flex items-center gap-2.5 flex-wrap justify-end">
            {/* 통합 검색 버튼 */}
            <button
              onClick={() => setIsSearchModalOpen(true)}
              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
              title="통합 검색 (단축키: /)"
            >
              <span>🔍</span>
              <span className="hidden sm:inline">검색</span>
              <kbd className="hidden md:inline px-1 py-0.2 bg-white rounded text-[10px] text-slate-400 font-mono shadow-2xs">
                /
              </kbd>
            </button>

            {/* 스코프 탭 버튼 그룹 */}
            <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
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
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1">
              <span className="text-xs">📂</span>
              <select
                value={selectedGroupId || ''}
                onChange={(e) => setSelectedGroupId(e.target.value ? e.target.value : null)}
                className="bg-transparent text-xs font-bold text-slate-700 focus:outline-none cursor-pointer pr-1"
              >
                <option value="">🔒 개인 공간</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    👥 {g.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 🔥 V3와 동일한 더보기 (⋮) 드롭다운 메뉴 */}
            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 font-black rounded-xl text-base transition-colors"
                title="더보기 메뉴"
              >
                ⋮
              </button>

              {isMoreMenuOpen && (
                <div className="absolute right-0 top-10 w-56 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-50 animate-fade-in text-xs">
                  <button
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      setIsLabelModalOpen(true);
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
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <span className="text-xs font-medium text-slate-500 hidden md:inline">
                {user?.displayName || '선생님'}
              </span>
              <button
                onClick={logout}
                className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 rounded-xl font-bold text-xs transition-colors"
              >
                로그아웃
              </button>
            </div>
          </div>
        </div>
        {/* 🔥 상단 2행: 좌측(옵션 버튼), 중앙(가운데 정렬: ◀ 날짜(클릭 시 오늘) ▶), 우측(보기/작성) */}
        <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-2.5 mt-0.5 max-w-7xl mx-auto w-full gap-2 flex-nowrap overflow-x-auto">
          {/* 좌측 옵션 버튼 (주말 숨기기, 수업 숨기기) */}
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
            <button
              onClick={() => setShowWeekend(!showWeekend)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border shadow-2xs ${
                showWeekend
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-slate-100 text-slate-500 border-slate-200'
              }`}
              title="단축키: Shift + ↑/↓"
            >
              {showWeekend ? '주말 숨기기' : '주말 보기'}
            </button>
            {scope !== 'memo' && (
              <>
                {/* 수업 숨기기/보이기, 일정 숨기기/보이기 버튼 삭제됨 */}
              </>
            )}
            
          </div>

          {/* 중앙 날짜 네비게이션 (가운데 정렬, 왼쪽 이전, 오른쪽 다음, 날짜 클릭 시 오늘) */}
          <div className="flex items-center justify-center gap-2 sm:gap-4 flex-1 min-w-[200px]">
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
              <label className="cursor-pointer ml-1 text-slate-400 hover:text-primary relative overflow-hidden flex items-center justify-center w-6 h-6 text-sm" title="날짜 이동">
                📅
                <input 
                  type="date" 
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={(e) => {
                    if(e.target.value) setCurrentDate(new Date(e.target.value));
                  }}
                />
              </label>
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
      </header>

      <main className="p-3 sm:p-5 max-w-7xl mx-auto">
        {children}
      </main>

      {/* 모달 모음 */}
      <GroupModal
        isOpen={isGroupModalOpen}
        onClose={() => setIsGroupModalOpen(false)}
      />

      <DDayModal
        isOpen={isDDayModalOpen}
        onClose={() => setIsDDayModalOpen(false)}
      />

      <SearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
      />

      <RosterModal
        isOpen={isRosterModalOpen}
        onClose={() => setIsRosterModalOpen(false)}
      />

      <LabelModal
        isOpen={isLabelModalOpen}
        onClose={() => setIsLabelModalOpen(false)}
      />

      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
      />

      <HelpModal
        isOpen={isHelpModalOpen}
        onClose={() => setIsHelpModalOpen(false)}
      />
      <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />
      
      {/* Evaluation/Survey Modal */}
      <EvaluationModal 
        isOpen={isEvaluationModalOpen} 
        onClose={closeEvaluationModal} 
        dateStr={evalDateStr || currentDate} 
        defaultSource={evalSource}
        defaultPeriod={evalPeriod}
        defaultSubject={evalSubject}
      />
      
      <RecurringModal isOpen={isRecurringModalOpen} onClose={() => setIsRecurringModalOpen(false)} />
      <ForwardingModal isOpen={isForwardingModalOpen} onClose={() => setIsForwardingModalOpen(false)} />
      
      {/* Linker Modal */}
      <LinkerModal 
        isOpen={isLinkerModalOpen} 
        onClose={closeLinkerModal} 
        sourceType={linkerSourceType || 'manual'} 
        sourceDateStr={linkerSourceDateStr || currentDate} 
        sourceId={linkerSourceId || 'manual'}
        sourcePeriod={linkerSourcePeriod}
      />

      <TimetableTemplateModal
        isOpen={isTimetableModalOpen}
        onClose={() => setIsTimetableModalOpen(false)}
      />
    </div>
  );
}
