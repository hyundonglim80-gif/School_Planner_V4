import React, { useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { showToast, showErrorToast } from '../utils/toast';
import { useAppStore } from '../store/useAppStore';
import { useLabels } from '../hooks/useLabels';
import { addReverseLink } from '../utils/linkUtils';
import { eventDocPayload, readEventList } from '../lib/eventText';
import ModalShell, { ModalCloseButton } from './ModalShell';

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  dateStr: string;
}

export default function QuickAddModal({ isOpen, onClose, dateStr }: QuickAddModalProps) {
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
    if (!text.trim()) return showToast('일정 내용을 입력하세요.');
    
    setSaving(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      const colPath = selectedGroupId && selectedGroupId !== 'personal'
        ? `groups/${selectedGroupId}/events`
        : `users/${uid}/events`;
      
      const ref = doc(db, colPath, dateStr);
      const snap = await getDoc(ref);
      const eventList = snap.exists() ? readEventList(snap.data()) : [];

      // 고유 ID 생성
      const newId = 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);

      eventList.push({
        id: newId,
        content: text.trim(), // V4 호환성을 위한 content
        text: text.trim(),    // 기존 코드 호환
        label: selectedLabels.length > 0 ? selectedLabels.join(',') : '',
        // labelIds에는 이름이 아니라 실제 라벨 ID를 넣어야 V3가 라벨을 찾을 수 있다
        labelIds: selectedLabels
          .map((n) => eventLabels.find((l) => l.name === n)?.id)
          .filter((id): id is string => !!id),
        linkedItems,
        completed: false,
        createdAt: Date.now()
      });

      await setDoc(ref, eventDocPayload(eventList), { merge: true });
      
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
      showToast('✅ 일정이 추가되었습니다.');
    } catch (e: any) {
      console.error(e);
      showErrorToast('저장 중 오류: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="sm"
      title="새 일정 추가"
      headerExtra={<span className="text-xs text-slate-400">{dateStr}</span>}
      footer={
        <>
          <ModalCloseButton onClose={onClose} />
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-primary hover:bg-blue-600 text-white rounded-xl text-xs font-bold shadow-xs transition-all">
            {saving ? '저장 중...' : '저장'}
          </button>
        </>
      }
    >
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
                className="px-2 py-1 bg-yellow-50 text-yellow-800 border border-yellow-300 rounded text-xs font-bold hover:bg-yellow-100 transition-colors"
              >
                + 링크 추가
              </button>
            </div>
            {linkedItems.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {linkedItems.map((link, idx) => (
                  <div key={idx} className="flex items-center gap-1 bg-white border border-slate-200 pl-2 pr-1 py-1 rounded-md shadow-2xs">
                    <span className="text-xs font-bold text-slate-600 truncate max-w-[150px]">
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
    </ModalShell>
  );
}