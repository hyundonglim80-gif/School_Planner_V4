import React, { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc, getDocs, collection } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { useLabels } from '../hooks/useLabels';

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
  labelIds?: string[];
  period?: string | number;
}

function formatDate(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export default function LinkerModal({ isOpen, onClose, sourceType, sourceDateStr, sourceId, sourcePeriod }: LinkerModalProps) {
  const { selectedGroupId, linkerCallback } = useAppStore();
  const { eventLabels, getLabelColor } = useLabels();
  
  const [activeTab, setActiveTab] = useState<'event' | 'schedule' | 'journal' | 'memo'>('event');
  const [items, setItems] = useState<LinkableItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  
  // Date Range State
  const [searchRange, setSearchRange] = useState('today'); // default: today (sourceDateStr)
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // Label Filter State (Multi-select)
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  
  const [loading, setLoading] = useState(false);

  // Initialize dates when modal opens or range changes
  useEffect(() => {
    if (!isOpen) return;
    
    const center = new Date(sourceDateStr);
    let s = new Date(center);
    let e = new Date(center);
    
    if (searchRange === 'today') {
      // today is just sourceDateStr
    } else if (searchRange === '1week') {
      s.setDate(s.getDate() - 7);
      e.setDate(e.getDate() + 7);
    } else if (searchRange === '1month') {
      s.setMonth(s.getMonth() - 1);
      e.setMonth(e.getMonth() + 1);
    } else if (searchRange === 'sem1') {
      s = new Date(center.getFullYear(), 2, 1); // March 1
      e = new Date(center.getFullYear(), 7, 31); // Aug 31
    } else if (searchRange === 'sem2') {
      s = new Date(center.getFullYear(), 8, 1); // Sept 1
      e = new Date(center.getFullYear() + 1, 1, 28); // Feb 28
    } else if (searchRange === 'year') {
      s = new Date(center.getFullYear(), 2, 1);
      e = new Date(center.getFullYear() + 1, 1, 28);
    }
    
    if (searchRange !== 'custom') {
      setStartDate(formatDate(s));
      setEndDate(formatDate(e));
    }
  }, [isOpen, searchRange, sourceDateStr]);

  // Fetch items when tab, dates or labels change
  useEffect(() => {
    if (isOpen && startDate && endDate) {
      fetchItems();
    }
  }, [isOpen, activeTab, startDate, endDate, selectedLabels]);

  const fetchItems = async () => {
    setLoading(true);
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }

    const results: LinkableItem[] = [];
    
    // Memo tab uses a collection query, no date loop needed in V4 currently
    if (activeTab === 'memo') {
      try {
        const colPath = selectedGroupId && selectedGroupId !== 'personal'
          ? `groups/${selectedGroupId}/tasks`
          : `users/${uid}/tasks`;
        const snap = await getDocs(collection(db, colPath));
        snap.forEach(d => {
          const data = d.data();
          // Text/Label matching for memos if we implement labels for memos later
          results.push({ id: d.id, type: 'memo', dateStr: '', text: data.content || data.text || '' });
        });
      } catch (e) {
        console.error(e);
      }
    } else {
      const cur = new Date(startDate);
      const end = new Date(endDate);
      const maxDays = 400; // prevent infinite loops
      let days = 0;

      while (cur <= end && days < maxDays) {
        const dateStr = formatDate(cur);
        try {
          const colPath = selectedGroupId && selectedGroupId !== 'personal'
            ? `groups/${selectedGroupId}/${activeTab === 'journal' ? 'journals' : activeTab === 'schedule' ? 'schedules' : 'events'}`
            : `users/${uid}/${activeTab === 'journal' ? 'journals' : activeTab === 'schedule' ? 'schedules' : 'events'}`;
            
          const snap = await getDoc(doc(db, colPath, dateStr));

          if (snap.exists()) {
            const data = snap.data();
            
            if (activeTab === 'event' && data.eventList) {
              data.eventList.forEach((ev: any) => {
                results.push({ id: ev.id || dateStr + '_ev_' + Math.random(), type: 'event', dateStr, text: ev.content || ev.text || '', label: ev.label, labelIds: ev.labelIds || [] });
              });
            }
            if (activeTab === 'schedule' && data.periods) { // In V4, it's periods
              Object.entries(data.periods).forEach(([period, schedule]: [string, any]) => {
                if (schedule && (schedule.subject || schedule.content)) {
                  results.push({ id: dateStr + '_sch_' + period, type: 'schedule', dateStr, text: `${period}교시: ${schedule.subject || ''} ${schedule.content || ''}`, period });
                }
              });
            }
            if (activeTab === 'journal' && data.entries) { // In V4, it's entries
              data.entries.forEach((j: any) => {
                results.push({ id: j.id || dateStr + '_j_' + Math.random(), type: 'journal', dateStr, text: j.content || '', label: j.label, labelIds: j.labelIds || [] });
              });
            }
          }
        } catch (e) {
          // skip
        }
        cur.setDate(cur.getDate() + 1);
        days++;
      }
    }

    // Apply Label Filtering (Only for event and journal where labels exist)
    const filteredResults = results.filter(item => {
      if (selectedLabels.length === 0) return true; // 'All' selected
      if (item.type !== 'event' && item.type !== 'journal') return true;
      
      const itemLabelNames: string[] = [];
      if (item.label) itemLabelNames.push(...item.label.split(',').map(l => l.trim()));
      if (item.labelIds && item.labelIds.length > 0) {
        const found = eventLabels.filter(l => item.labelIds!.includes(l.id));
        itemLabelNames.push(...found.map(f => f.name));
      }
      
      // If no label and we need specific labels, omit
      if (itemLabelNames.length === 0) return false;
      
      // If at least one selected label matches
      return selectedLabels.some(sl => itemLabelNames.includes(sl));
    });

    setItems(filteredResults);
    setLoading(false);
  };

  const toggleItem = (id: string) => {
    setSelectedItems(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSaveLinks = async () => {
    if (selectedItems.length === 0) return alert('연결할 항목을 선택해주세요.');
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const newLinks = selectedItems.map(id => {
      const item = items.find(i => i.id === id);
      return item ? { id: item.id, type: item.type, dateStr: item.dateStr, text: item.text.slice(0, 50) } : null;
    }).filter(Boolean);

    if (linkerCallback) {
      linkerCallback(newLinks);
      onClose();
      return;
    }

    if (sourceType === 'manual') {
      onClose();
      return;
    }

    try {
      const colPath = selectedGroupId && selectedGroupId !== 'personal'
        ? `groups/${selectedGroupId}/${sourceType === 'journal' ? 'journals' : sourceType === 'schedule' ? 'schedules' : 'events'}`
        : `users/${uid}/${sourceType === 'journal' ? 'journals' : sourceType === 'schedule' ? 'schedules' : 'events'}`;

      const snap = await getDoc(doc(db, colPath, sourceDateStr));
      const data = snap.exists() ? snap.data() : {};

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

  const toggleLabel = (labelName: string) => {
    setSelectedLabels(prev => 
      prev.includes(labelName) ? prev.filter(l => l !== labelName) : [...prev, labelName]
    );
  };

  if (!isOpen) return null;

  const tabs = [
    { key: 'event' as const, label: '📌 일정' },
    { key: 'journal' as const, label: '📝 기록' },
    { key: 'memo' as const, label: '💡 메모' },
    { key: 'schedule' as const, label: '🏫 수업' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col border border-slate-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50 rounded-t-2xl">
          <h3 className="text-lg font-black text-slate-800">🔗 새 데이터 연결하기</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors">✕</button>
        </div>

        {/* 탭 */}
        <div className="flex gap-2 px-6 pt-4 pb-2 border-b border-slate-100">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => { setActiveTab(tab.key); setSelectedItems([]); setSelectedLabels([]); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex-1 ${activeTab === tab.key ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* 범위 선택 및 필터 헤더 */}
        <div className="px-6 py-4 bg-white border-b border-slate-100 space-y-3">
          {activeTab !== 'memo' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600 w-16">조회 범위:</span>
                <select value={searchRange} onChange={e => setSearchRange(e.target.value)} className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-bold focus:outline-none focus:ring-1 focus:ring-primary/50 text-slate-700">
                  <option value="today">현재 페이지 날짜</option>
                  <option value="1week">±1주일</option>
                  <option value="1month">±1개월</option>
                  <option value="sem1">1학기 전체</option>
                  <option value="sem2">2학기 전체</option>
                  <option value="year">학년도 전체</option>
                  <option value="custom">기간 직접 선택</option>
                </select>
              </div>
              
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600 w-16">날짜 선택:</span>
                <input type="date" value={startDate} onChange={e => {setStartDate(e.target.value); setSearchRange('custom');}} className="flex-1 px-2 py-1.5 text-xs border rounded-lg" />
                <span className="text-xs text-slate-400">~</span>
                <input type="date" value={endDate} onChange={e => {setEndDate(e.target.value); setSearchRange('custom');}} className="flex-1 px-2 py-1.5 text-xs border rounded-lg" />
              </div>
            </div>
          )}

          {/* 라벨 칩 (일정, 기록 탭에서만 활성화) */}
          {(activeTab === 'event' || activeTab === 'journal') && eventLabels.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-2">
              <span className="text-xs font-bold text-slate-600">라벨 필터 (다중 선택):</span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setSelectedLabels([])}
                  className={`px-2 py-1 text-[11px] font-bold rounded-lg transition-all border ${selectedLabels.length === 0 ? 'bg-primary text-white border-primary shadow-xs' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                >
                  전체
                </button>
                {eventLabels.map(l => {
                  const isSelected = selectedLabels.includes(l.name);
                  const color = getLabelColor(l.name);
                  return (
                    <button
                      key={l.id}
                      onClick={() => toggleLabel(l.name)}
                      className={`px-2 py-1 text-[11px] font-bold rounded-lg transition-all border ${isSelected ? 'shadow-xs ring-1 ring-offset-1' : 'opacity-70 hover:opacity-100'}`}
                      style={isSelected ? {
                        backgroundColor: color.bg,
                        color: color.text,
                        borderColor: color.border,
                        ringColor: color.border
                      } : {
                        backgroundColor: '#f8fafc',
                        color: '#64748b',
                        borderColor: '#e2e8f0'
                      }}
                    >
                      {l.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto px-6 py-3 bg-slate-50/50">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-400">
               <div className="animate-spin w-6 h-6 border-2 border-slate-300 border-t-primary rounded-full" />
               <p className="text-xs font-bold">데이터 조회 중...</p>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-slate-400 flex flex-col items-center gap-2">
              <span className="text-3xl opacity-50">📂</span>
              <p className="text-xs font-bold">조건에 맞는 데이터가 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map(item => (
                <button key={item.id} onClick={() => toggleItem(item.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3 shadow-sm ${selectedItems.includes(item.id) ? 'bg-blue-50 border-primary ring-1 ring-primary/20' : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow'}`}>
                  <input type="checkbox" checked={selectedItems.includes(item.id)} readOnly className="mt-1 w-4 h-4 rounded text-primary focus:ring-primary border-slate-300 cursor-pointer" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 line-clamp-2 leading-snug mb-1">{item.text || '(내용 없음)'}</p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 font-medium">
                      <span>{item.dateStr}</span>
                      {item.label && (
                        <>
                          <span>•</span>
                          <span className="text-primary">{item.label}</span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 장바구니 하단바 */}
        <div className="flex flex-col px-6 py-4 border-t border-slate-100 bg-white rounded-b-2xl">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <span>🛒</span> 링크 장바구니 <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px]">{selectedItems.length}</span>
            </h4>
            <button onClick={handleSaveLinks} disabled={selectedItems.length === 0} className="px-5 py-2 bg-primary hover:bg-blue-600 text-white rounded-xl text-xs font-bold shadow-xs transition-colors disabled:opacity-50 flex items-center gap-1.5">
              <span>🔗</span> 최종 연결하기
            </button>
          </div>
          <div className="flex gap-1.5 flex-wrap min-h-[30px] p-2 bg-slate-50 rounded-lg border border-dashed border-slate-300 items-center">
            {selectedItems.length === 0 ? (
              <span className="text-[10px] text-slate-400 font-medium px-1">선택된 항목이 없습니다. 목록에서 클릭하여 추가하세요.</span>
            ) : (
              items.filter(i => selectedItems.includes(i.id)).map(item => (
                <span key={item.id} className="text-[10px] bg-white border border-slate-200 text-slate-600 px-2 py-1 rounded truncate max-w-[120px] shadow-2xs font-medium">
                  {item.text}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
