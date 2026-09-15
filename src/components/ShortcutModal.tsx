// src/components/ShortcutModal.tsx
//
// 환경설정 > 단축키. 조합을 직접 정한다.
//
// 규칙은 다른 팝업과 같다. '저장'과 '닫기'가 나뉘고, '저장'을 눌러도 닫히지 않는다.
// 창 안에서 고친 것은 '저장'을 눌러야 적용되고, '닫기'로 나가면 버린다.
import React, { useState, useEffect, useMemo } from 'react';
import { showToast, showErrorToast } from '../utils/toast';
import { useAppStore } from '../store/useAppStore';
import {
  SHORTCUT_ACTIONS,
  FIXED_SHORTCUTS,
  resolveBindings,
  findConflicts,
  bindingFromEvent,
  isModifierOnly,
  labelOf,
  type Binding,
  type ShortcutId,
} from '../lib/shortcuts';
import ModalShell, { ModalCloseButton } from './ModalShell';

interface ShortcutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** 입력칸에 보여줄 글자. 화살표처럼 이름이 긴 키는 기호로 보여준다. */
const KEY_DISPLAY: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Enter: 'Enter',
};

function ModifierBox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1 cursor-pointer select-none shrink-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 rounded text-primary focus:ring-primary border-slate-300 accent-primary cursor-pointer"
      />
      <span className={`text-xs font-bold ${checked ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span>
    </label>
  );
}

function ShortcutRow({
  label,
  binding,
  conflicted,
  onChange,
}: {
  label: string;
  binding: Binding;
  conflicted: boolean;
  onChange: (b: Binding) => void;
}) {
  // 키 입력칸: 칸을 누르고 키를 누르면 그 키가 들어간다.
  // 화살표·Space처럼 글자가 없는 키도 있어서, 글자를 받는 대신 눌린 키를 잡는다.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') return; // 다음 칸으로 넘어가는 것은 막지 않는다
    e.preventDefault();
    if (isModifierOnly(e as unknown as KeyboardEvent)) return;

    if (e.key === 'Backspace' || e.key === 'Delete') {
      onChange({ ...binding, key: '' });
      return;
    }
    // 누른 대로 수식키까지 같이 채워준다. 체크박스로 따로 손봐도 된다.
    onChange(bindingFromEvent(e as unknown as KeyboardEvent));
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border p-2.5 ${
        conflicted ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-100'
      }`}
    >
      <span className="text-sm font-bold text-slate-700 min-w-0 flex-1">{label}</span>

      <div className="flex items-center gap-2.5 shrink-0">
        <ModifierBox label="Ctrl" checked={binding.ctrl} onChange={(v) => onChange({ ...binding, ctrl: v })} />
        <ModifierBox label="Alt" checked={binding.alt} onChange={(v) => onChange({ ...binding, alt: v })} />
        <ModifierBox label="Shift" checked={binding.shift} onChange={(v) => onChange({ ...binding, shift: v })} />
      </div>

      <input
        type="text"
        readOnly
        value={KEY_DISPLAY[binding.key] || binding.key}
        onKeyDown={handleKeyDown}
        placeholder="없음"
        aria-label={`${label} 키`}
        title="이 칸을 누른 뒤 원하는 키를 누르세요. 비우려면 Backspace (비우면 그 기능은 단축키 없이 씁니다)."
        className={`w-20 shrink-0 px-2 py-1.5 text-center bg-white border rounded-lg text-sm font-bold text-slate-800 cursor-pointer focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${
          conflicted ? 'border-red-300' : 'border-slate-200'
        }`}
      />
    </div>
  );
}

export default function ShortcutModal({ isOpen, onClose }: ShortcutModalProps) {
  const setShortcutOverrides = useAppStore((s) => s.setShortcutOverrides);
  const [draft, setDraft] = useState<Record<ShortcutId, Binding>>(() => resolveBindings());
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(resolveBindings(useAppStore.getState().shortcutOverrides));
    setSaveSuccess(false);
  }, [isOpen]);

  const conflicts = useMemo(() => findConflicts(draft), [draft]);
  const conflicted = useMemo(() => new Set(conflicts.flat()), [conflicts]);

  const groups = useMemo(() => {
    const out: Record<string, typeof SHORTCUT_ACTIONS> = {};
    for (const action of SHORTCUT_ACTIONS) {
      (out[action.group] ||= []).push(action);
    }
    return Object.entries(out);
  }, []);

  const handleSave = () => {
    // 키가 비어 있는 것은 '쓰지 않음'이다. 막지 않는다.
    if (conflicts.length > 0) {
      const [a, b] = conflicts[0];
      return showErrorToast(`같은 조합을 두 기능이 쓰고 있습니다: ${labelOf(a)} / ${labelOf(b)}`);
    }

    // 기본값과 같은 것은 저장하지 않는다. 나중에 기본값을 고치면 그대로 따라온다.
    const overrides: Partial<Record<ShortcutId, Binding>> = {};
    for (const action of SHORTCUT_ACTIONS) {
      const cur = draft[action.id];
      const def = action.def;
      const same = cur.ctrl === def.ctrl && cur.alt === def.alt && cur.shift === def.shift && cur.key === def.key;
      if (!same) overrides[action.id] = cur;
    }

    setShortcutOverrides(overrides);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleReset = () => {
    setDraft(resolveBindings());
    showToast("기본값으로 되돌렸습니다. '저장'을 눌러야 적용됩니다.");
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="2xl"
      title="⌨️ 단축키"
      bare
      footer={
        <>
          {saveSuccess && <span className="text-emerald-500 text-xs font-bold mr-auto">✅ 저장되었습니다</span>}
          {!saveSuccess && conflicts.length > 0 && (
            <span className="text-red-500 text-xs font-bold mr-auto">
              겹치는 단축키가 있습니다 ({labelOf(conflicts[0][0])} / {labelOf(conflicts[0][1])})
            </span>
          )}
          <button
            onClick={handleReset}
            className="px-4 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 rounded-xl text-xs font-bold transition-colors mr-auto sm:mr-0"
          >
            기본값으로
          </button>
          <ModalCloseButton onClose={onClose} />
          <button
            onClick={handleSave}
            className="px-5 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
          >
            저장
          </button>
        </>
      }
    >
      <div>
        <div className="px-5 py-3 border-b border-slate-100">
          <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-3 text-xs text-slate-600 leading-relaxed">
            키 칸을 누른 뒤 <strong className="text-slate-800">원하는 키를 그대로 누르면</strong> 들어갑니다. 글자·숫자·기호는
            물론 화살표나 Space도 됩니다. Ctrl / Alt / Shift는 체크로 켜고 끕니다.
            <br />
            켜고 끄는 기능(주말·일정·수업)에 화살표를 쓰면 <strong className="text-slate-800">↑와 ↓가 같이</strong> 동작합니다.
            <br />
            '메뉴 열기'는 기본값이 <strong className="text-slate-800">없음</strong>입니다. 자주 쓰는 것만 골라 정해 두세요.
            비워 두면 그 기능은 메뉴에서만 씁니다.
          </div>
        </div>

        {groups.map(([groupName, actions]) => (
          <div key={groupName} className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-black text-slate-800 mb-2">{groupName}</h3>
            <div className="space-y-2">
              {actions.map((action) => (
                <ShortcutRow
                  key={action.id}
                  label={action.label}
                  binding={draft[action.id]}
                  conflicted={conflicted.has(action.id)}
                  onChange={(b) => setDraft((prev) => ({ ...prev, [action.id]: b }))}
                />
              ))}
            </div>
          </div>
        ))}

        {/* 바꾸지 않는 것들. 목록에서 빠지면 "없는 기능"으로 보이므로 이유와 함께 보여준다. */}
        <div className="px-5 py-4">
          <h3 className="text-sm font-black text-slate-800 mb-0.5">고정 단축키</h3>
          <p className="text-xs text-slate-400 mb-2">아래는 바꿀 수 없습니다.</p>
          <div className="space-y-2">
            {FIXED_SHORTCUTS.map((fixed) => (
              <div key={fixed.label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-slate-500 min-w-0">{fixed.label}</span>
                  <kbd className="px-2 py-1 shrink-0 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-500">
                    {fixed.keys}
                  </kbd>
                </div>
                <p className="text-xs text-slate-400 mt-1">{fixed.why}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
