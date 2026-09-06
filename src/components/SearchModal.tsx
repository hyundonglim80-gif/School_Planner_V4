import React, { useState } from 'react';
import { collection, getDocs, doc, query, limit } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { parseDateStr } from '../lib/dateUtils';
import { parseV3EventText } from '../hooks/useDayData';

interface SearchResultItem {
  id: string;
  type: 'memo' | 'event' | 'journal';
  dateStr?: string;
  title: string;
  snippet: string;
}

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const { setCurrentDate, setScope, selectedGroupId } = useAppStore();

  if (!isOpen) return null;

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const queryTerm = keyword.trim().toLowerCase();
    if (!queryTerm) return;

    const user = auth.currentUser;
    if (!user) return;

    try {
      setSearching(true);
      setHasSearched(true);
      const searchResults: SearchResultItem[] = [];

      // 1. 메모 검색 (tasks 컬렉션)
      const tasksCol = selectedGroupId
        ? collection(db, 'groups', selectedGroupId, 'tasks')
        : collection(db, 'users', user.uid, 'tasks');
      const taskSnap = await getDocs(tasksCol);

      taskSnap.forEach((d) => {
        const data = d.data();
        const text = (data.content || data.text || '').toLowerCase();
        if (text.includes(queryTerm)) {
          searchResults.push({
            id: d.id,
            type: 'memo',
            title: '메모',
            snippet: data.content || data.text || '',
          });
        }
      });

      // 2. 일정 검색 (events 컬렉션)
      const eventsCol = selectedGroupId
        ? collection(db, 'groups', selectedGroupId, 'events')
        : collection(db, 'users', user.uid, 'events');
      const eventSnap = await getDocs(eventsCol);

      eventSnap.forEach((d) => {
        const dateStr = d.id;
        const data = d.data();
        const rawText = data.eventText || '';
        let items = data.eventList;
        if (!items || items.length === 0) {
          items = parseV3EventText(rawText);
        }

        items.forEach((item: any, idx: number) => {
          const content = (item.content || '').toLowerCase();
          if (content.includes(queryTerm)) {
            searchResults.push({
              id: `ev_${dateStr}_${idx}`,
              type: 'event',
              dateStr,
              title: `일정 (${dateStr})`,
              snippet: item.content,
            });
          }
        });
      });

      // 3. 일지 검색 (journals 컬렉션)
      const journalsCol = selectedGroupId
        ? collection(db, 'groups', selectedGroupId, 'journals')
        : collection(db, 'users', user.uid, 'journals');
      const journalSnap = await getDocs(journalsCol);

      journalSnap.forEach((d) => {
        const dateStr = d.id;
        const data = d.data();
        const entries = data.entries || [];
        entries.forEach((entry: any, idx: number) => {
          const content = (entry.content || '').toLowerCase();
          if (content.includes(queryTerm)) {
            searchResults.push({
              id: `jr_${dateStr}_${idx}`,
              type: 'journal',
              dateStr,
              title: `일지 (${dateStr} - ${entry.label || '일반'})`,
              snippet: entry.content,
            });
          }
        });
      });

      setResults(searchResults);
    } catch (error) {
      console.error('검색 실패:', error);
    } finally {
      setSearching(false);
    }
  };

  const handleItemClick = (item: SearchResultItem) => {
    if (item.type === 'memo') {
      setScope('memo');
    } else if (item.dateStr) {
      setCurrentDate(parseDateStr(item.dateStr));
      setScope('day');
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={onClose} />

      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl z-10 overflow-hidden flex flex-col max-h-[85vh]">
        {/* 상단 검색바 */}
        <div className="p-4 border-b border-slate-100 flex items-center gap-3">
          <span className="text-xl">🔍</span>
          <form onSubmit={handleSearch} className="flex-1">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="검색어를 입력하세요 (예: 학생 이름, 수행평가, 회의)..."
              className="w-full text-sm font-semibold focus:outline-none placeholder-slate-400"
              autoFocus
            />
          </form>
          <button
            onClick={() => handleSearch()}
            disabled={searching || !keyword.trim()}
            className="px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-xl hover:bg-blue-600 disabled:opacity-40 transition-colors shadow-2xs"
          >
            {searching ? '검색 중...' : '검색'}
          </button>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full text-xs"
          >
            ✕
          </button>
        </div>

        {/* 검색 결과 영역 */}
        <div className="p-4 overflow-y-auto flex-1 space-y-2">
          {searching ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              <div className="w-8 h-8 border-2 border-slate-200 border-t-primary rounded-full animate-spin mx-auto mb-2" />
              전체 데이터를 탐색 중입니다...
            </div>
          ) : results.length > 0 ? (
            results.map((res) => {
              const badgeClass =
                res.type === 'memo'
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : res.type === 'event'
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-purple-50 text-purple-700 border-purple-200';

              return (
                <div
                  key={res.id}
                  onClick={() => handleItemClick(res)}
                  className="p-3 bg-slate-50/60 hover:bg-blue-50/40 border border-slate-200/70 hover:border-primary/50 rounded-xl cursor-pointer transition-all flex items-start justify-between gap-3 group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badgeClass}`}>
                        {res.type === 'memo' ? '메모' : res.type === 'event' ? '일정' : '일지'}
                      </span>
                      <span className="text-xs font-bold text-slate-700">{res.title}</span>
                    </div>
                    <p className="text-xs text-slate-600 whitespace-pre-wrap line-clamp-2 leading-relaxed">
                      {res.snippet}
                    </p>
                  </div>

                  <span className="text-xs text-primary font-bold opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    이동 ➔
                  </span>
                </div>
              );
            })
          ) : hasSearched ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              일치하는 검색 결과가 없습니다.
            </div>
          ) : (
            <div className="py-12 text-center text-slate-400 text-xs">
              검색어를 입력하고 Enter를 누르면 메모, 일정, 일지에서 모두 찾아드립니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
