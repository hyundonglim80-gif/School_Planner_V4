import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [periodNames, setPeriodNames] = useState<string[]>(['1', '2', '3', '4', '5', '6']);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const { govApiKey, setGovApiKey } = useAppStore();

  useEffect(() => {
    if (!isOpen) return;
    loadSettings();
  }, [isOpen]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const snap = await getDoc(doc(db, 'users', uid, 'settings', 'preferences'));
      if (snap.exists() && snap.data().periodNames) {
        setPeriodNames([...snap.data().periodNames]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateName = (idx: number, value: string) => {
    const updated = [...periodNames];
    updated[idx] = value;
    setPeriodNames(updated);
  };

  const handleAddPeriod = () => {
    setPeriodNames([...periodNames, `새 시간 ${periodNames.length + 1}`]);
  };

  const handleRemovePeriod = (idx: number) => {
    if (periodNames.length <= 1) return alert('최소 1개의 시간은 존재해야 합니다.');
    const updated = periodNames.filter((_, i) => i !== idx);
    setPeriodNames(updated);
  };

  const handleSave = async () => {
    const finalNames = periodNames.map(n => n.trim()).filter(n => n !== '');
    if (finalNames.length === 0) return alert('최소 1개의 유효한 명칭을 입력해야 합니다.');
    setSaving(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      await setDoc(doc(db, 'users', uid, 'settings', 'preferences'), {
        periodNames: finalNames,
        updatedAt: Date.now()
      }, { merge: true });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      console.error(e);
      alert('설정 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col border border-slate-200" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-black text-slate-800">⚙️ 환경 설정 (수업 명칭/시수)</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
        </div>

        {/* 안내 */}
        <div className="px-6 py-3">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800">
            <strong>[시수 설정]</strong> 학교마다 다른 수업 시간을 자유롭게 변경하세요.<br />
            이곳에 등록된 개수와 순서에 맞춰 화면 칸이 자연스럽게 분할됩니다.
          </div>
        </div>

        {/* 교시 목록 */}
        <div className="flex-1 overflow-y-auto px-6 py-2">
          {loading ? (
            <div className="text-center py-8 text-slate-400 text-xs">불러오는 중...</div>
          ) : (
            <div className="space-y-2">
              {periodNames.map((name, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-slate-50 rounded-xl p-2.5 border border-slate-100">
                  <span className="text-xs font-black text-slate-500 w-5 text-center">{idx + 1}</span>
                  <input
                    type="text"
                    value={name}
                    onChange={e => handleUpdateName(idx, e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-800 focus:outline-none focus:border-primary"
                  />
                  <button
                    onClick={() => handleRemovePeriod(idx)}
                    className="text-slate-300 hover:text-red-500 font-black text-sm transition-colors p-1"
                    title="삭제"
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleAddPeriod}
            className="w-full mt-3 py-2.5 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:text-primary hover:border-primary text-xs font-bold transition-colors"
          >
            + 새로운 시간/활동 추가
          </button>
        </div>

        {/* 공공데이터 API 키 설정 영역 */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50">
          <label className="block text-xs font-bold text-slate-700 mb-1">
            공공데이터포털 API Key (특일정보)
          </label>
          <input
            type="text"
            value={govApiKey}
            onChange={(e) => setGovApiKey(e.target.value)}
            placeholder="인코딩된 API Key를 입력하세요"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:border-primary"
          />
          <p className="text-[15px] text-slate-400 mt-1">공휴일을 달력에 표시하기 위해 필요합니다. (자동 저장)</p>
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-slate-100 bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all">닫기</button>
          {saveSuccess && <span className="text-emerald-500 text-xs font-bold mr-2">✅ 저장되었습니다 (새로고침 시 적용)</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
          >
            {saving ? '저장 중...' : '저장 및 적용'}
          </button>
        </div>
      </div>
    </div>
  );
}
