import React from 'react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function HelpModal({ isOpen, onClose }: HelpModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl z-10 overflow-hidden flex flex-col max-h-[85vh]">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="text-xl">💡</span>
            <div>
              <h3 className="text-lg font-bold text-slate-800">School Planner V4 사용 설명서</h3>
              <p className="text-xs text-slate-400 mt-0.5">단축키 및 주요 활용 팁</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 본문 */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs text-slate-700 leading-relaxed">
          {/* 주요 키보드 단축키 */}
          <div className="space-y-2">
            <h4 className="font-extrabold text-sm text-slate-800 flex items-center gap-1.5">
              <span>⌨️</span> 키보드 단축키
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between">
                <span className="text-slate-600">통합 검색 열기</span>
                <kbd className="px-2 py-0.5 bg-white border border-slate-300 rounded font-mono font-bold shadow-2xs">/</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between">
                <span className="text-slate-600">보기 모드 전환</span>
                <kbd className="px-2 py-0.5 bg-white border border-slate-300 rounded font-mono font-bold shadow-2xs">Ctrl + ↑</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between">
                <span className="text-slate-600">작성 / 저장 모드</span>
                <kbd className="px-2 py-0.5 bg-white border border-slate-300 rounded font-mono font-bold shadow-2xs">Ctrl + ↓</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between">
                <span className="text-slate-600">주말 보기 / 숨기기</span>
                <kbd className="px-2 py-0.5 bg-white border border-slate-300 rounded font-mono font-bold shadow-2xs">Shift + ↑/↓</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between">
                <span className="text-slate-600">이전 / 다음 날짜</span>
                <kbd className="px-2 py-0.5 bg-white border border-slate-300 rounded font-mono font-bold shadow-2xs">Ctrl + ← / →</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between">
                <span className="text-slate-600">오늘 날짜로 이동</span>
                <kbd className="px-2 py-0.5 bg-white border border-slate-300 rounded font-mono font-bold shadow-2xs">Ctrl + Space</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between">
                <span className="text-slate-600">메모 즉시 저장</span>
                <kbd className="px-2 py-0.5 bg-white border border-slate-300 rounded font-mono font-bold shadow-2xs">Ctrl + Enter</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between">
                <span className="text-slate-600">할 일 빠른 등록</span>
                <kbd className="px-2 py-0.5 bg-white border border-slate-300 rounded font-mono font-bold shadow-2xs">Enter</kbd>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between sm:col-span-2">
                <span className="text-slate-600">패널 / 모달 닫기</span>
                <kbd className="px-2 py-0.5 bg-white border border-slate-300 rounded font-mono font-bold shadow-2xs">ESC</kbd>
              </div>
            </div>
          </div>

          {/* 주요 기능 팁 */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <h4 className="font-extrabold text-sm text-slate-800 flex items-center gap-1.5">
              <span>✨</span> 알아두면 유용한 팁
            </h4>

            <div className="p-3 bg-blue-50/60 border border-blue-100 rounded-xl space-y-1">
              <div className="font-bold text-primary">📋 주간 기본 시간표 불러오기</div>
              <p className="text-slate-600">
                하루 뷰의 시간표 상단에서 <strong>'기본 시간표 불러오기'</strong>를 누르면 오늘 요일에 배정된 기본 과목들이 한 번에 채워집니다.
              </p>
            </div>

            <div className="p-3 bg-amber-50/60 border border-amber-100 rounded-xl space-y-1">
              <div className="font-bold text-amber-800">📥 지난 미완료 할 일 가져오기</div>
              <p className="text-slate-600">
                하루 뷰의 오늘 할 일 상단에서 <strong>'미완료 할 일 가져오기'</strong>를 누르면 최근 14일간 깜빡하고 완료하지 못한 업무들을 오늘로 이월합니다.
              </p>
            </div>

            <div className="p-3 bg-purple-50/60 border border-purple-100 rounded-xl space-y-1">
              <div className="font-bold text-purple-800">👥 교과/학년 협의회 공유 그룹</div>
              <p className="text-slate-600">
                상단 헤더의 <strong>'그룹 관리'</strong>에서 초대 코드를 만들어 동료 선생님과 같은 일정과 시간표를 실시간으로 공유할 수 있습니다.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
