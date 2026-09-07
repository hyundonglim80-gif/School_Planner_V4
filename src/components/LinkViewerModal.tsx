import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';

interface LinkViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceType: string;
  sourceDateStr: string;
  sourceId: string;
}

export default function LinkViewerModal({ isOpen, onClose, sourceType, sourceDateStr, sourceId }: LinkViewerModalProps) {
  const { selectedGroupId } = useAppStore();
  const [links, setLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editModeId, setEditModeId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchLinks();
    } else {
      setLinks([]);
      setEditModeId(null);
    }
  }, [isOpen, sourceType, sourceDateStr, sourceId]);

  const fetchLinks = async () => {
    setLoading(true);
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    try {
      const colPath = selectedGroupId && selectedGroupId !== 'personal'
        ? `groups/${selectedGroupId}/${sourceType === 'journal' ? 'journals' : sourceType === 'schedule' ? 'schedules' : 'events'}`
        : `users/${uid}/${sourceType === 'journal' ? 'journals' : sourceType === 'schedule' ? 'schedules' : 'events'}`;

      const snap = await getDoc(doc(db, colPath, sourceDateStr));
      let foundLinks: any[] = [];
      
      if (snap.exists()) {
        const data = snap.data();
        
        // Check V3 style array structure (e.linkedItems)
        if (sourceType === 'event' && data.eventList) {
          const ev = data.eventList.find((e: any) => e.id === sourceId);
          if (ev && ev.linkedItems) foundLinks = [...ev.linkedItems];
        } else if (sourceType === 'journal' && data.entries) {
          const j = data.entries.find((e: any) => e.id === sourceId);
          if (j && j.linkedItems) foundLinks = [...j.linkedItems];
        } else if (sourceType === 'schedule' && data.periods) {
          const p = data.periods[sourceId];
          if (p && p.linkedItems) foundLinks = [...p.linkedItems];
        }
        
        // Also check V4 style data.links map
        if (data.links && data.links[`${sourceType}_${sourceId}`]) {
          foundLinks = [...foundLinks, ...data.links[`${sourceType}_${sourceId}`]];
        }
      }
      
      // Remove duplicates by id
      const uniqueLinks = Array.from(new Map(foundLinks.map(item => [item.id, item])).values());
      setLinks(uniqueLinks);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlink = async (linkId: string) => {
    if (!window.confirm('이 연결을 해제하시겠습니까?')) return;
    
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    try {
      const colPath = selectedGroupId && selectedGroupId !== 'personal'
        ? `groups/${selectedGroupId}/${sourceType === 'journal' ? 'journals' : sourceType === 'schedule' ? 'schedules' : 'events'}`
        : `users/${uid}/${sourceType === 'journal' ? 'journals' : sourceType === 'schedule' ? 'schedules' : 'events'}`;

      const snap = await getDoc(doc(db, colPath, sourceDateStr));
      if (!snap.exists()) return;
      
      const data = snap.data();
      let updated = false;

      // Update V3 style array
      if (sourceType === 'event' && data.eventList) {
        data.eventList = data.eventList.map((e: any) => {
          if (e.id === sourceId && e.linkedItems) {
            updated = true;
            return { ...e, linkedItems: e.linkedItems.filter((l: any) => l.id !== linkId) };
          }
          return e;
        });
      } else if (sourceType === 'journal' && data.entries) {
        data.entries = data.entries.map((e: any) => {
          if (e.id === sourceId && e.linkedItems) {
            updated = true;
            return { ...e, linkedItems: e.linkedItems.filter((l: any) => l.id !== linkId) };
          }
          return e;
        });
      } else if (sourceType === 'schedule' && data.periods && data.periods[sourceId]) {
        if (data.periods[sourceId].linkedItems) {
          data.periods[sourceId].linkedItems = data.periods[sourceId].linkedItems.filter((l: any) => l.id !== linkId);
          updated = true;
        }
      }

      // Update V4 style links map
      if (data.links && data.links[`${sourceType}_${sourceId}`]) {
        data.links[`${sourceType}_${sourceId}`] = data.links[`${sourceType}_${sourceId}`].filter((l: any) => l.id !== linkId);
        updated = true;
      }

      if (updated) {
        await setDoc(doc(db, colPath, sourceDateStr), data, { merge: true });
        setLinks(prev => prev.filter(l => l.id !== linkId));
      }
    } catch (e) {
      console.error(e);
      alert('연결 해제 실패');
    }
  };

  const handleSaveEdit = async (link: any) => {
    if (!editText.trim()) return;
    
    // Attempt to update the target document where the link originally resides
    const uid = auth.currentUser?.uid;
    if (!uid || !link.dateStr || !link.type) return;

    try {
      const colPath = selectedGroupId && selectedGroupId !== 'personal'
        ? `groups/${selectedGroupId}/${link.type === 'journal' ? 'journals' : link.type === 'schedule' ? 'schedules' : 'events'}`
        : `users/${uid}/${link.type === 'journal' ? 'journals' : link.type === 'schedule' ? 'schedules' : 'events'}`;

      const snap = await getDoc(doc(db, colPath, link.dateStr));
      if (!snap.exists()) return;

      const data = snap.data();
      let updated = false;

      if (link.type === 'event' && data.eventList) {
        data.eventList = data.eventList.map((e: any) => {
          if (e.id === link.id) {
            updated = true;
            return { ...e, content: editText.trim() };
          }
          return e;
        });
      } else if (link.type === 'journal' && data.entries) {
        data.entries = data.entries.map((e: any) => {
          if (e.id === link.id) {
            updated = true;
            return { ...e, content: editText.trim() };
          }
          return e;
        });
      }
      
      if (updated) {
        await setDoc(doc(db, colPath, link.dateStr), data, { merge: true });
        // Also update local view
        setLinks(prev => prev.map(l => l.id === link.id ? { ...l, text: editText.trim() } : l));
        setEditModeId(null);
        alert('수정되었습니다.');
      } else {
        alert('원본 항목을 찾을 수 없습니다.');
      }

    } catch (e) {
      console.error(e);
      alert('수정 실패');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col border border-slate-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50 rounded-t-2xl">
          <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
            <span>📑</span> 연결된 링크 모음
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 bg-slate-50/50">
          {loading ? (
            <div className="text-center py-10 text-slate-400 text-xs font-bold">불러오는 중...</div>
          ) : links.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-xs">연결된 링크가 없습니다.</div>
          ) : (
            <div className="space-y-3">
              {links.map((link, idx) => (
                <div key={idx} className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm hover:border-slate-300 transition-colors">
                  
                  {editModeId === link.id ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        className="w-full text-sm p-2 border border-blue-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[60px]"
                        autoFocus
                      />
                      <div className="flex justify-end gap-1.5 mt-1">
                        <button onClick={() => setEditModeId(null)} className="px-2.5 py-1 text-xs bg-slate-100 text-slate-600 rounded font-bold hover:bg-slate-200">취소</button>
                        <button onClick={() => handleSaveEdit(link)} className="px-2.5 py-1 text-xs bg-blue-50 text-blue-600 rounded font-bold hover:bg-blue-100">저장</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-start gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-bold">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100">
                            {link.type === 'event' ? '📌 일정' : link.type === 'journal' ? '📝 기록' : link.type === 'memo' ? '💡 메모' : '🏫 수업'}
                          </span>
                          <span>{link.dateStr}</span>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => { setEditModeId(link.id); setEditText(link.text); }} className="text-[10px] text-slate-400 hover:text-blue-600 p-1 bg-slate-50 hover:bg-slate-100 rounded">✏️ 수정</button>
                          <button onClick={() => handleUnlink(link.id)} className="text-[10px] text-slate-400 hover:text-red-500 p-1 bg-slate-50 hover:bg-slate-100 rounded">🔗 해제</button>
                        </div>
                      </div>
                      <p className="text-sm font-medium text-slate-800 leading-snug whitespace-pre-wrap">{link.text}</p>
                    </>
                  )}
                  
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
