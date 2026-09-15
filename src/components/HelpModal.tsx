import React from 'react';
import ModalShell, { ModalCloseButton } from './ModalShell';
import { useAppStore } from '../store/useAppStore';
import {
  SHORTCUT_ACTIONS,
  FIXED_SHORTCUTS,
  resolveBindings,
  formatActionBinding,
} from '../lib/shortcuts';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function HelpModal({ isOpen, onClose }: HelpModalProps) {
  // 안내 문구가 실제 동작과 어긋나지 않게 환경설정 값을 그대로 읽는다
  const forwardLookbackDays = useAppStore((s) => s.forwardLookbackDays);
  // 단축키도 마찬가지다. 여기 적어두면 환경설정에서 바꿨을 때 설명서가 거짓말을 한다.
  const shortcutOverrides = useAppStore((s) => s.shortcutOverrides);
  const bindings = resolveBindings(shortcutOverrides);

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="lg"
      title="💡 School Planner V4 사용 설명서"
      footer={<ModalCloseButton onClose={onClose} />}
    >
        <div className="space-y-5 text-xs text-slate-700 leading-relaxed">
          {/* 주요 키보드 단축키 */}
          <div className="space-y-2">
            <h4 className="font-extrabold text-sm text-slate-800 flex items-center gap-1.5">
              <span>⌨️</span> 키보드 단축키
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SHORTCUT_ACTIONS.map((action) => (
                <div
                  key={action.id}
                  className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-2"
                >
                  <span className="text-slate-600 min-w-0">{action.label}</span>
                  <kbd className="px-2 py-0.5 shrink-0 bg-white border border-slate-300 rounded font-mono font-bold shadow-2xs">
                    {formatActionBinding(action, bindings[action.id])}
                  </kbd>
                </div>
              ))}
              {FIXED_SHORTCUTS.map((fixed) => (
                <div
                  key={fixed.label}
                  className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-2"
                >
                  <span className="text-slate-600 min-w-0">{fixed.label}</span>
                  <kbd className="px-2 py-0.5 shrink-0 bg-white border border-slate-300 rounded font-mono font-bold shadow-2xs">
                    {fixed.keys}
                  </kbd>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              ⋮ 메뉴 → 환경설정 → 단축키에서 바꿀 수 있습니다. 고정 단축키는 바꿀 수 없습니다.
            </p>
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
              <div className="font-bold text-amber-800">📥 지난 미완료 일정 가져오기</div>
              <p className="text-slate-600">
                하루 뷰의 오늘 일정 상단에서 <strong>'미완료 일정 가져오기'</strong>를 누르면 최근 {forwardLookbackDays}일간 깜빡하고 완료하지 못한 업무들을 오늘로 이월합니다.
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
    </ModalShell>
  );
}
