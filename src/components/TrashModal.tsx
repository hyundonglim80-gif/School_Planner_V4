import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, orderBy, doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { completeRestoreFromTrash, deleteFromTrash, type TrashItem } from '../utils/trashHelper';
import { formatV3EventText } from '../hooks/useDayData';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TrashModal({ isOpen, onClose }: TrashModalProps) {
  useBodyScrollLock(isOpen);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchTrash();
    }
  }, [isOpen]);

  const fetchTrash = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setLoading(true);
    try {
      const q = query(collection(db, 'users', user.uid, 'trash'), orderBy('deletedAt', 'desc'));
      const snap = await getDocs(q);
      const items: TrashItem[] = [];
      snap.forEach(doc => {
        items.push(doc.data() as TrashItem);
      });
      setTrashItems(items);
    } catch (err) {
      console.error('Failed to fetch trash', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (item: TrashItem) => {
    const user = auth.currentUser;
    if (!user) return;
    setActionLoadingId(item.id);
    
    try {
      const { type, originalDateStr, fId, data } = item;
      if (type !== 'memo' && !originalDateStr) throw new Error('원래 날짜 정보가 없어 복원할 수 없습니다.');
      
      const isGroup = fId && fId !== 'personal';

      if (type === 'memo') {
        const targetRef = isGroup
          ? doc(db, 'groups', fId, 'tasks', data.firestoreId || item.id)
          : doc(db, 'users', user.uid, 'tasks', data.firestoreId || item.id);
        const { firestoreId, ...memoData } = data;
        await setDoc(targetRef, memoData, { merge: true });
      } else {
        const col = type === 'event' ? 'events' : type === 'journal' ? 'journals' : 'schedules';
        const targetRef = isGroup 
          ? doc(db, 'groups', fId, col, originalDateStr!)
          : doc(db, 'users', user.uid, col, originalDateStr!);
          
        const snap = await getDoc(targetRef);
        const currentData = snap.exists() ? snap.data() : {};
        
        if (type === 'event') {
          const list = currentData.eventList || [];
          list.push(data);
          const serializedText = formatV3EventText(list);
          await setDoc(targetRef, { eventList: list, eventText: serializedText, updatedAt: Date.now() }, { merge: true });
        } else if (type === 'journal') {
          const entries = currentData.entries || [];
          entries.push(data);
          await setDoc(targetRef, { entries, updatedAt: Date.now() }, { merge: true });
        }
      }
      
      await completeRestoreFromTrash(item.id);
      
      setTrashItems(prev => prev.filter(t => t.id !== item.id));
      alert('복원되었습니다.');
    } catch (err: any) {
      alert('복원 실패: ' + err.message);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handlePermanentDelete = async (item: TrashItem) => {
    if (!window.confirm('이 항목을 영구 삭제하시겠습니까? 복구할 수 없습니다.')) return;
    
    setActionLoadingId(item.id);
    try {
      await deleteFromTrash(item.id);
      setTrashItems(prev => prev.filter(t => t.id !== item.id));
    } catch (err) {
      alert('삭제 실패');
    } finally {
      setActionLoadingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden animate-scale-in">
        <div className="p-4 border-b flex justify-between items-center bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <span>🗑️</span> 휴지통
          </h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200">
            ✕
          </button>
        </div>
        
        <div className="p-4 overflow-y-auto flex-1 bg-slate-50/50">
          {loading ? (
            <div className="text-center py-8 text-slate-500">불러오는 중...</div>
          ) : trashItems.length === 0 ? (
            <div className="text-center py-12 text-slate-400 flex flex-col items-center gap-2">
              <span className="text-4xl opacity-50">🍃</span>
              <p>휴지통이 비어 있습니다.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {trashItems.map((item) => (
                <div key={item.id} className="bg-white border rounded-xl p-3 flex justify-between items-center shadow-sm hover:border-slate-300 transition-colors">
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-2 mb-1 text-xs text-slate-500">
                      <span className="font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {item.type === 'event' ? '일정' : item.type === 'journal' ? '기록' : item.type}
                      </span>
                      <span>{item.originalDateStr || '날짜 없음'}</span>
                      <span>•</span>
                      <span>{new Date(item.deletedAt).toLocaleString()} 삭제됨</span>
                    </div>
                    <p className="text-sm text-slate-700 truncate font-medium">
                      {item.content || '(내용 없음)'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleRestore(item)}
                      disabled={actionLoadingId === item.id}
                      className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold text-xs rounded-lg transition-colors disabled:opacity-50"
                    >
                      복원
                    </button>
                    <button
                      onClick={() => handlePermanentDelete(item)}
                      disabled={actionLoadingId === item.id}
                      className="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 font-bold text-xs rounded-lg transition-colors disabled:opacity-50"
                    >
                      영구 삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
