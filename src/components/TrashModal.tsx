import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, orderBy, doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { completeRestoreFromTrash, deleteFromTrash, type TrashItem } from '../utils/trashHelper';
import { formatV3EventText } from '../hooks/useDayData';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';

interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  event: '일정',
  journal: '기록',
  memo: '메모',
  schedule: '수업',
  dday: 'D-Day',
  eval: '조사표',
  roster: '명단',
  label: '라벨',
  template: '시간표',
};

export default function TrashModal({ isOpen, onClose }: TrashModalProps) {
  useBodyScrollLock(isOpen);

  const vv = useVisualViewport(isOpen);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchTrash();
    }
  }, [isOpen]);

  const fetchTrash = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setLoading(true);
    setSelectedIds(new Set());
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

  // 실제 복원 로직만 수행 (UI 상태는 호출부에서 처리) - 단건/일괄 복원 공용
  const restoreItem = async (item: TrashItem) => {
    const user = auth.currentUser;
    if (!user) return;

    const { type, originalDateStr, fId, data } = item;
    const isGroup = fId && fId !== 'personal';

    if (type === 'memo') {
      const targetRef = isGroup
        ? doc(db, 'groups', fId, 'tasks', data.firestoreId || item.id)
        : doc(db, 'users', user.uid, 'tasks', data.firestoreId || item.id);
      const { firestoreId, ...memoData } = data;
      await setDoc(targetRef, memoData, { merge: true });
    } else if (type === 'event' || type === 'journal') {
      if (!originalDateStr) throw new Error('원래 날짜 정보가 없어 복원할 수 없습니다.');
      const col = type === 'event' ? 'events' : 'journals';
      const targetRef = isGroup
        ? doc(db, 'groups', fId, col, originalDateStr)
        : doc(db, 'users', user.uid, col, originalDateStr);

      const snap = await getDoc(targetRef);
      const currentData = snap.exists() ? snap.data() : {};

      if (type === 'event') {
        const list = currentData.eventList || [];
        list.push(data);
        const serializedText = formatV3EventText(list);
        await setDoc(targetRef, { eventList: list, eventText: serializedText, updatedAt: Date.now() }, { merge: true });
      } else {
        const entries = currentData.entries || [];
        entries.push(data);
        await setDoc(targetRef, { entries, updatedAt: Date.now() }, { merge: true });
      }
    } else if (type === 'eval') {
      if (!originalDateStr) throw new Error('원래 날짜 정보가 없어 복원할 수 없습니다.');
      const targetRef = isGroup
        ? doc(db, 'groups', fId, 'evaluations', originalDateStr)
        : doc(db, 'users', user.uid, 'evaluations', originalDateStr);
      const snap = await getDoc(targetRef);
      const list = snap.exists() ? (snap.data().list || []) : [];
      if (!list.some((e: any) => e.id === data.id)) list.push(data);
      await setDoc(targetRef, { list, updatedAt: Date.now() }, { merge: true });
    } else if (type === 'dday') {
      const prefRef = doc(db, 'users', user.uid, 'settings', 'preferences');
      const snap = await getDoc(prefRef);
      const dDayList = snap.exists() ? (snap.data().dDayList || []) : [];
      if (!dDayList.some((d: any) => d.id === data.id)) dDayList.push(data);
      await setDoc(prefRef, { dDayList }, { merge: true });
    } else if (type === 'roster') {
      const rosterRef = doc(db, 'users', user.uid, 'settings', 'rosters');
      const snap = await getDoc(rosterRef);
      const list: any[] = snap.exists() ? (snap.data().classList || snap.data().rosters || []) : [];
      const keyOf = (c: any) => `${c.year}_${c.grade}_${c.classNum}`;

      if (data.kind === 'class') {
        const key = keyOf(data.class);
        if (!list.some((c) => keyOf(c) === key)) list.push(data.class);
      } else {
        const key = keyOf(data.classKey);
        const target = list.find((c) => keyOf(c) === key);
        if (target) {
          target.students = target.students || [];
          if (!target.students.some((s: any) => s.num === data.student.num)) {
            target.students.push(data.student);
          }
        } else {
          // 학급 자체도 함께 삭제되어 없는 경우, 학생만 담을 새 학급을 만들어 복원한다.
          list.push({ ...data.classKey, students: [data.student] });
        }
      }
      await setDoc(rosterRef, { classList: list, rosters: list, updatedAt: Date.now() }, { merge: true });
    } else if (type === 'label') {
      const labelRef = doc(db, 'users', user.uid, 'settings', 'labels');
      const snap = await getDoc(labelRef);
      const cur = snap.exists() ? snap.data() : {};
      const field = data.kind === 'event' ? 'eventLabels' : data.kind === 'journal' ? 'journalLabels' : 'memoLabels';
      const list: any[] = cur[field] || [];
      if (!list.some((l: any) => l.id === data.label.id)) list.push(data.label);
      const payload: any = { [field]: list, updatedAt: Date.now() };
      if (field === 'eventLabels') payload.labels = list; // V3 호환성
      await setDoc(labelRef, payload, { merge: true });
    } else if (type === 'template') {
      const tplRef = doc(db, 'users', user.uid, 'settings', 'timetable_v5');
      const snap = await getDoc(tplRef);
      const templates = snap.exists() ? (snap.data().templates || {}) : {};
      const name = templates[data.name] ? `${data.name} (복원됨)` : data.name;
      templates[name] = data.template;
      await setDoc(tplRef, { templates, updatedAt: Date.now() }, { merge: true });
    } else {
      throw new Error('이 항목 유형은 아직 복원을 지원하지 않습니다.');
    }

    await completeRestoreFromTrash(item.id);
  };

  const handleRestore = async (item: TrashItem) => {
    setActionLoadingId(item.id);
    try {
      await restoreItem(item);
      setTrashItems(prev => prev.filter(t => t.id !== item.id));
      setSelectedIds(prev => {
        if (!prev.has(item.id)) return prev;
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
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
      setSelectedIds(prev => {
        if (!prev.has(item.id)) return prev;
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    } catch (err) {
      alert('삭제 실패');
    } finally {
      setActionLoadingId(null);
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isAllSelected = trashItems.length > 0 && selectedIds.size === trashItems.length;
  const toggleSelectAll = () => {
    setSelectedIds(isAllSelected ? new Set() : new Set(trashItems.map(t => t.id)));
  };

  // 일괄 복원/삭제: 같은 날짜 문서를 여러 항목이 동시에 건드릴 수 있어 순차 처리한다(동시 처리 시 서로 덮어쓰는 경쟁 조건 방지)
  const handleBulkRestore = async () => {
    if (selectedIds.size === 0 || bulkProcessing) return;
    if (!window.confirm(`선택한 ${selectedIds.size}개 항목을 복원하시겠습니까?`)) return;

    setBulkProcessing(true);
    const targets = trashItems.filter(t => selectedIds.has(t.id));
    const restoredIds: string[] = [];
    const failedContents: string[] = [];

    for (const item of targets) {
      try {
        await restoreItem(item);
        restoredIds.push(item.id);
      } catch (err) {
        console.error('일괄 복원 실패:', item.id, err);
        failedContents.push(item.content || item.id);
      }
    }

    setTrashItems(prev => prev.filter(t => !restoredIds.includes(t.id)));
    setSelectedIds(new Set());
    setBulkProcessing(false);

    if (failedContents.length > 0) {
      alert(`${restoredIds.length}개 복원 완료, ${failedContents.length}개 실패:\n${failedContents.join(', ')}`);
    } else {
      alert(`${restoredIds.length}개 항목을 복원했습니다.`);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0 || bulkProcessing) return;
    if (!window.confirm(`선택한 ${selectedIds.size}개 항목을 영구 삭제하시겠습니까? 복구할 수 없습니다.`)) return;

    setBulkProcessing(true);
    const targets = trashItems.filter(t => selectedIds.has(t.id));
    const deletedIds: string[] = [];

    for (const item of targets) {
      try {
        await deleteFromTrash(item.id);
        deletedIds.push(item.id);
      } catch (err) {
        console.error('일괄 삭제 실패:', item.id, err);
      }
    }

    setTrashItems(prev => prev.filter(t => !deletedIds.includes(t.id)));
    setSelectedIds(new Set());
    setBulkProcessing(false);
    alert(`${deletedIds.length}개 항목을 영구 삭제했습니다.`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-full overflow-hidden animate-scale-in">
        <div className="p-4 border-b flex justify-between items-center bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <span>🗑️</span> 휴지통
          </h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200">
            ✕
          </button>
        </div>

        {trashItems.length > 0 && (
          <div className="px-4 py-2.5 border-b bg-white flex items-center justify-between gap-2 flex-wrap">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded shrink-0"
              />
              전체 선택
              {selectedIds.size > 0 && (
                <span className="text-primary">({selectedIds.size}개 선택됨)</span>
              )}
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkRestore}
                disabled={selectedIds.size === 0 || bulkProcessing}
                className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold text-xs rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {bulkProcessing ? '처리 중...' : '일괄 복원'}
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0 || bulkProcessing}
                className="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 font-bold text-xs rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {bulkProcessing ? '처리 중...' : '일괄 삭제'}
              </button>
            </div>
          </div>
        )}

        <div className="p-4 overflow-y-auto overscroll-contain flex-1 min-h-0 bg-slate-50/50" data-scroll-lock>
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
                <div key={item.id} className="bg-white border rounded-xl p-3 flex items-center gap-3 shadow-sm hover:border-slate-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelectOne(item.id)}
                    className="w-4 h-4 rounded shrink-0"
                  />
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-2 mb-1 text-xs text-slate-500">
                      <span className="font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {TYPE_LABELS[item.type] || item.type}
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
                      disabled={actionLoadingId === item.id || bulkProcessing}
                      className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold text-xs rounded-lg transition-colors disabled:opacity-50"
                    >
                      복원
                    </button>
                    <button
                      onClick={() => handlePermanentDelete(item)}
                      disabled={actionLoadingId === item.id || bulkProcessing}
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
