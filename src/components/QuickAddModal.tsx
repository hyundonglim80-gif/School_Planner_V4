import React, { useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { useLabels } from '../hooks/useLabels';
import { addReverseLink } from '../utils/linkUtils';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  dateStr: string;
}

export default function QuickAddModal({ isOpen, onClose, dateStr }: QuickAddModalProps) {
  useBodyScrollLock(isOpen);

  const vv = useVisualViewport(isOpen);
  const { selectedGroupId, openLinkerModal } = useAppStore();
  const { eventLabels, getLabelColor } = useLabels();

  const [text, setText] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [linkedItems, setLinkedItems] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  // 라벨 다중 선택 토글
  const handleLabelToggle = (labelName: string) => {
    setSelectedLabels(prev => 
      prev.includes(labelName) ? prev.filter(l => l !== labelName) : [...prev, labelName]
    );
  };

  // 링크 삭제
  const handleRemoveLink = (idx: number) => {
    setLinkedItems(prev => prev.filter((_, i) => i !== idx));
  };

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

      // 고유 ID 생성
      const newId = 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);

      eventList.push({
        id: newId,
        content: text.trim(), // V4 호환성을 위한 content
        text: text.trim(),    // 기존 코드 호환
        label: selectedLabels.length > 0 ? selectedLabels.join(',') : '',
        labelIds: selectedLabels,
        linkedItems,
        completed: false,
        createdAt: Date.now()
      });

      await setDoc(ref, { ...existing, eventList, updatedAt: Date.now() }, { merge: true });
      
      // 리버스 링크(양방향 연결) 처리
      if (linkedItems.length > 0) {
        const sourceMeta = {
          targetType: 'event',
          targetId: newId,
          targetDate: dateStr,
          title: `[${dateStr}] 일정`,
          targetFId: selectedGroupId || 'personal',
        };
        for (const link of linkedItems) {
          await addReverseLink(link, sourceMeta as any, selectedGroupId || 'personal');
        }
      }

      setText('');
      setSelectedLabels([]);
      setLinkedItems([]);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 backdrop-blur-sm animate-fade-in" style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height }} onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-full overflow-y-auto overscroll-contain flex flex-col border border-slate-200 p-5" onClick={e => e.stopPropagation()} data-scroll-lock>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-black text-slate-800">새 일정 추가</h3>
          <span className="text-xs text-slate-400">{dateStr}</span>
        </div>

        <div className="space-y-4">
          {/* 일정 내용 */}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-2">일정 내용</label>
            <input 
              type="text" 
              autoFocus
              value={text} 
              onChange={e => setText(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="일정을 입력하세요" 
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary" 
            />
          </div>

          {/* 라벨 (다중 선택 버튼) */}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-2">라벨 (다중 선택 가능)</label>
            <div className="flex flex-wrap gap-1.5">
              {eventLabels.map(l => {
                const isSelected = selectedLabels.includes(l.name);
                const color = getLabelColor(l.name);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => handleLabelToggle(l.name)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all border ${
                      isSelected 
                        ? 'ring-2 ring-primary ring-offset-1 shadow-xs' 
                        : 'opacity-70 hover:opacity-100 bg-white text-slate-600 border-slate-200'
                    }`}
                    style={isSelected ? { backgroundColor: color.bg, color: color.text, borderColor: color.border } : {}}
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 링크 연결 영역 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-600">링크 연결</label>
              <button
                type="button"
                onClick={() => {
                  // V4 글로벌 모달 호출
                  openLinkerModal('manual', dateStr, undefined, undefined, (links) => {
                    setLinkedItems(prev => [...prev, ...links]);
                  });
                }}
                className="px-2 py-1 bg-yellow-50 text-yellow-800 border border-yellow-300 rounded text-[15px] font-bold hover:bg-yellow-100 transition-colors"
              >
                + 링크 추가
              </button>
            </div>
            {linkedItems.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {linkedItems.map((link, idx) => (
                  <div key={idx} className="flex items-center gap-1 bg-white border border-slate-200 pl-2 pr-1 py-1 rounded-md shadow-2xs">
                    <span className="text-[15px] font-bold text-slate-600 truncate max-w-[150px]">
                      {link.title || link.text}
                    </span>
                    <button type="button" onClick={() => handleRemoveLink(idx)} className="text-slate-400 hover:text-red-500 p-0.5">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all">
            취소
          </button>
          <button onClick={handleSave} disabled={saving} className="flex-1 py-2 bg-primary hover:bg-blue-600 text-white rounded-xl text-xs font-bold shadow-xs transition-all">
            {saving ? '저장 중...' : '저장하기'}
          </button>
        </div>
      </div>
    </div>
  );
}