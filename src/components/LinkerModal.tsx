import React, { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';

interface LinkerModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceType: string;
  sourceDateStr: string;
  sourceId: string;
  sourcePeriod?: string | number;
}

interface LinkableItem {
  id: string;
  type: 'event' | 'schedule' | 'journal' | 'memo';
  dateStr: string;
  text: string;
  label?: string;
  period?: string | number;
}

function formatDate(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export default function LinkerModal({ isOpen, onClose, sourceType, sourceDateStr, sourceId, sourcePeriod }: LinkerModalProps) {
  const { selectedGroupId } = useAppStore();
  const [activeTab, setActiveTab] = useState<'event' | 'schedule' | 'journal' | 'memo'>('event');
  const [items, setItems] = useState<LinkableItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [searchRange, setSearchRange] = useState('1week');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) fetchItems();
  }, [isOpen, activeTab, searchRange]);

  const getDateRange = (): [string, string] => {
    const center = new Date(sourceDateStr);
    let days = 7;
    if (searchRange === '2weeks') days = 14;
    if (searchRange === '1month') days = 30;
    if (searchRange === '3months') days = 90;

    const start = new Date(center);
    start.setDate(start.getDate() - days);
    const end = new Date(center);
    end.setDate(end.getDate() + days);
    return [formatDate(start), formatDate(end)];
  };

  const fetchItems = async () => {
    setLoading(true);
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }

    const [startStr, endStr] = getDateRange();
    const results: LinkableItem[] = [];
    const cur = new Date(startStr);
    const end = new Date(endStr);

    while (cur <= end) {
      const dateStr = formatDate(cur);
      try {
        const colPath = selectedGroupId && selectedGroupId !== 'personal'
          ? `groups/${selectedGroupId}/events`
          : `users/${uid}/events`;
        const snap = await getDoc(doc(db, colPath, dateStr));

        if (snap.exists()) {
          const data = snap.data();
          if (activeTab === 'event' && data.eventList) {
            data.eventList.forEach((ev: any) => {
              results.push({ id: ev.id || dateStr + '_ev_' + Math.random(), type: 'event', dateStr, text: ev.text || '', label: (ev.labelIds || []).join(',') });
            });
          }
          if (activeTab === 'schedule' && data.schedules) {
            Object.entries(data.schedules).forEach(([period, schedule]: [string, any]) => {
              if (schedule && (schedule.subject || schedule.content)) {
                results.push({ id: dateStr + '_sch_' + period, type: 'schedule', dateStr, text: `${period}교시: ${schedule.subject || ''} ${schedule.content || ''}`, period });
              }
            });
          }
          if (activeTab === 'journal' && data.journals) {
            data.journals.forEach((j: any) => {
              results.push({ id: j.id || dateStr + '_j_' + Math.random(), type: 'journal', dateStr, text: j.content || '', label: j.label });
            });
          }
        }
      } catch (e) {
        // skip
      }
      cur.setDate(cur.getDate() + 1);
    }

    // 메모 탭
    if (activeTab === 'memo') {
      try {
        const { getDocs, collection } = await import('firebase/firestore');
        const colPath = selectedGroupId && selectedGroupId !== 'personal'
          ? `groups/${selectedGroupId}/tasks`
          : `users/${uid}/tasks`;
        const snap = await getDocs(collection(db, colPath));
        snap.forEach(d => {
          const data = d.data();
          results.push({ id: d.id, type: 'memo', dateStr: '', text: data.content || data.text || '' });
        });
      } catch (e) {
        console.error(e);
      }
    }

    setItems(results);
    setLoading(false);
  };

  const toggleItem = (id: string) => {
    setSelectedItems(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSaveLinks = async () => {
    if (selectedItems.length === 0) return alert('연결할 항목을 선택해주세요.');
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const { linkerCallback } = useAppStore.getState();
    const newLinks = selectedItems.map(id => {
      const item = items.find(i => i.id === id);
      return item ? { id: item.id, type: item.type, dateStr: item.dateStr, text: item.text.slice(0, 50) } : null;
    }).filter(Boolean);

    if (linkerCallback) {
      linkerCallback(newLinks);
      onClose();
      return;
    }

    try {
      const colPath = selectedGroupId && selectedGroupId !== 'personal'
        ? `groups/${selectedGroupId}/events`
        : `users/${uid}/events`;

      const snap = await getDoc(doc(db, colPath, sourceDateStr));
      const data = snap.exists() ? snap.data() : {};

      // 링크 데이터를 해당 날짜 문서에 저장
      const links = data.links || {};
      const sourceKey = `${sourceType}_${sourceId}`;
      const existingLinks = links[sourceKey] || [];
      
      links[sourceKey] = [...existingLinks, ...newLinks];
      await setDoc(doc(db, colPath, sourceDateStr), { ...data, links, updatedAt: Date.now() }, { merge: true });

      alert(`✅ ${selectedItems.length}개 항목이 연결되었습니다.`);
      onClose();
    } catch (e: any) {
      console.error(e);
      alert('연결 저장 중 오류: ' + e.message);
    }
  };

  if (!isOpen) return null;

  const tabs = [
    { key: 'event' as const, label: '📌 일정' },
    { key: 'schedule' as const, label: '🏫 수업' },
    { key: 'journal' as const, label: '📝 기록' },
    { key: 'memo' as const, label: '💡 메모' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col border border-slate-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-black text-slate-800">🔗 데이터 연결하기</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 px-6 pt-3">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => { setActiveTab(tab.key); setSelectedItems([]); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === tab.key ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* 범위 선택 */}
        <div className="px-6 py-2">
          <select value={searchRange} onChange={e => setSearchRange(e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-bold focus:outline-none">
            <option value="1week">±1주</option>
            <option value="2weeks">±2주</option>
            <option value="1month">±1개월</option>
            <option value="3months">±3개월</option>
          </select>
        </div>

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto px-6 py-2">
          {loading ? (
            <p className="text-center text-slate-400 text-xs py-8">데이터 불러오는 중...</p>
          ) : items.length === 0 ? (
            <p className="text-center text-slate-400 text-xs py-8">해당 범위에 연결 가능한 데이터가 없습니다.</p>
          ) : (
            <div className="space-y-1.5">
              {items.map(item => (
                <button key={item.id} onClick={() => toggleItem(item.id)}
                  className={`w-full text-left p-2.5 rounded-xl border transition-all ${selectedItems.includes(item.id) ? 'bg-blue-50 border-primary/50 ring-1 ring-primary/20' : 'bg-white border-slate-200 hover:bg-slate-50'}`}>
                  <div className="flex items-start gap-2">
                    <input type="checkbox" checked={selectedItems.includes(item.id)} readOnly className="mt-0.5 accent-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{item.text || '(내용 없음)'}</p>
                      <p className="text-[10px] text-slate-400">{item.dateStr} {item.label ? `· ${item.label}` : ''}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-100 bg-slate-50">
          <span className="text-xs text-slate-400">{selectedItems.length}개 선택됨</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl text-xs font-bold">취소</button>
            <button onClick={handleSaveLinks} disabled={selectedItems.length === 0} className="px-5 py-2 bg-primary text-white rounded-xl text-xs font-bold shadow-xs disabled:opacity-50">
              연결 저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
