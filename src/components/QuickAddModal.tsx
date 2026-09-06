import React, { useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  dateStr: string;
}

export default function QuickAddModal({ isOpen, onClose, dateStr }: QuickAddModalProps) {
  const { selectedGroupId } = useAppStore();
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!text.trim()) return alert('일정 내용을 입력하세요.');
    
    setSaving(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      const colPath = selectedGroupId && selectedGroupId !== 'personal'
        ? `groups/${selectedGroupId}/events`
        : `users/${uid}/events`;
      
      const ref = doc(db, colPath, dateStr);
      const snap = await getDoc(ref);
      const existing = snap.exists() ? snap.data() : {};
      const eventList = existing.eventList || [];

      eventList.push({
        id: 'ev_' + Date.now().toString(36),
        text: text.trim(),
        labelIds: label ? [label] : [],
        completed: false,
        createdAt: Date.now()
      });

      await setDoc(ref, { ...existing, eventList, updatedAt: Date.now() }, { merge: true });
      setText('');
      setLabel('');
      onClose();
    } catch (e: any) {
      console.error(e);
      alert('저장 중 오류: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col border border-slate-200 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-black text-slate-800">새 일정 추가</h3>
          <span className="text-xs text-slate-400">{dateStr}</span>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">일정 내용</label>
            <input 
              type="text" 
              autoFocus
              value={text} 
              onChange={e => setText(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="일정을 입력하세요" 
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-primary" 
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">라벨 (선택)</label>
            <input 
              type="text" 
              value={label} 
              onChange={e => setLabel(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="예: 중요, 회의" 
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-primary" 
            />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all">취소</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 py-2 bg-primary text-white rounded-xl text-xs font-bold shadow-xs transition-all">
            {saving ? '저장 중...' : '저장하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
