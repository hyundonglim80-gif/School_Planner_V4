//src/components/SearchModal.tsx

import React, { useState } from 'react';
import { collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { parseDateStr, formatDateStr } from '../lib/dateUtils';
import { parseV3EventText } from '../hooks/useDayData';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface SearchResultItem {
  id: string;
  type: 'memo' | 'event' | 'journal' | 'schedule' | 'schedule_memo' | 'schedule_supplies' | 'eval';
  dateStr?: string;
  title: string;
  snippet: string;
}

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FILTER_OPTIONS = [
  { id: 'all', label: '전체' },
  { id: 'task', label: '메모' },
  { id: 'event', label: '일정' },
  { id: 'journal', label: '기록' },
  { id: 'subject', label: '수업' },
  { id: 'memo', label: '메모(수업)' },
  { id: 'supplies', label: '비고' },
  { id: 'eval', label: '조사표명' },
];

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
  useBodyScrollLock(isOpen);
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // V3 스타일 필터 및 범위 상태
  const [selectedFilters, setSelectedFilters] = useState<string[]>(['all']);
  const [searchScope, setSearchScope] = useState<string>('year');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { currentDate, setCurrentDate, setScope, selectedGroupId } = useAppStore();

  if (!isOpen) return null;

  const toggleFilter = (id: string) => {
    if (id === 'all') {
      setSelectedFilters(['all']);
      return;
    }
    let next = selectedFilters.filter((f) => f !== 'all');
    if (next.includes(id)) {
      next = next.filter((f) => f !== id);
    } else {
      next.push(id);
    }
    
    // 모두 해제되거나 전체를 선택한 경우
    if (next.length === 0 || next.length === FILTER_OPTIONS.length - 1) {
      setSelectedFilters(['all']);
    } else {
      setSelectedFilters(next);
    }
  };

  const getTargetDateRange = () => {
    if (searchScope === 'year') return null; // ALL 데이터
    
    const d = new Date(currentDate);
    const curY = d.getFullYear();
    const curM = d.getMonth() + 1;
    let start = '', end = '';

    if (searchScope === 'day') {
      start = end = formatDateStr(d);
    } else if (searchScope === 'week') {
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const mon = new Date(new Date(d).setDate(diff));
      const fri = new Date(new Date(d).setDate(diff + 4));
      start = formatDateStr(mon);
      end = formatDateStr(fri);
    } else if (searchScope === 'month') {
      const lastDay = new Date(curY, curM, 0).getDate();
      start = `${curY}-${String(curM).padStart(2, '0')}-01`;
      end = `${curY}-${String(curM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    } else if (searchScope === 'sem1') {
      start = `${curY}-03-01`;
      end = `${curY}-08-15`;
    } else if (searchScope === 'sem2') {
      start = `${curY}-08-16`;
      end = `${curY + 1}-02-28`;
    } else if (searchScope === 'custom') {
      start = customStart;
      end = customEnd;
    }
    return { start, end };
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    const rawTerm = keyword.trim().toLowerCase();
    // 검색어가 없거나 '*'인 경우 전체 검색 허용 (V3 기능)
    const queryTerm = (rawTerm === '' || rawTerm === '*') ? '*' : rawTerm;
    
    const user = auth.currentUser;
    if (!user) return;

    try {
      setSearching(true);
      setHasSearched(true);
      const searchResults: SearchResultItem[] = [];

      const range = getTargetDateRange();
      if (searchScope === 'custom' && (!range?.start || !range?.end)) {
        alert('검색할 시작 날짜와 종료 날짜를 모두 지정해주세요.');
        setSearching(false);
        return;
      }

      // 날짜 필터링 쿼리 생성
      const dateQuery = range && range.start && range.end 
        ? [where(documentId(), '>=', range.start), where(documentId(), '<=', range.end)] 
        : [];

      const hasType = (t: string) => selectedFilters.includes('all') || selectedFilters.includes(t);
      
      const checkMatch = (text: string) => {
        if (!text) return false;
        if (queryTerm === '*') return true;
        return text.toLowerCase().includes(queryTerm);
      };

      const promises: Promise<any>[] = [];

      // 1. 메모 (tasks)
      if (hasType('task')) {
        const col = selectedGroupId ? collection(db, 'groups', selectedGroupId, 'tasks') : collection(db, 'users', user.uid, 'tasks');
        promises.push(getDocs(col).then((snap) => ({ type: 'tasks', snap })));
      }
      
      // 2. 일정 (events)
      if (hasType('event')) {
        const col = selectedGroupId ? collection(db, 'groups', selectedGroupId, 'events') : collection(db, 'users', user.uid, 'events');
        promises.push(getDocs(query(col, ...dateQuery)).then((snap) => ({ type: 'events', snap })));
      }

      // 3. 기록 (journals)
      if (hasType('journal')) {
        const col = selectedGroupId ? collection(db, 'groups', selectedGroupId, 'journals') : collection(db, 'users', user.uid, 'journals');
        promises.push(getDocs(query(col, ...dateQuery)).then((snap) => ({ type: 'journals', snap })));
      }

      // 4. 수업, 메모(수업), 비고 (schedules)
      if (hasType('subject') || hasType('memo') || hasType('supplies')) {
        const col = selectedGroupId ? collection(db, 'groups', selectedGroupId, 'schedules') : collection(db, 'users', user.uid, 'schedules');
        promises.push(getDocs(query(col, ...dateQuery)).then((snap) => ({ type: 'schedules', snap })));
      }

      // 5. 조사표 (evaluations)
      if (hasType('eval')) {
        const col = selectedGroupId ? collection(db, 'groups', selectedGroupId, 'evaluations') : collection(db, 'users', user.uid, 'evaluations');
        promises.push(getDocs(query(col, ...dateQuery)).then((snap) => ({ type: 'evaluations', snap })));
      }

      const res = await Promise.all(promises);

      res.forEach(({ type, snap }) => {
        if (type === 'tasks') {
          snap.forEach((d: any) => {
            const data = d.data();
            const text = data.content || data.text || '';
            if (checkMatch(text)) {
              searchResults.push({ id: d.id, type: 'memo', title: '전체 메모', snippet: text });
            }
          });
        } else if (type === 'events') {
          snap.forEach((d: any) => {
            const dateStr = d.id;
            const data = d.data();
            let items = data.eventList;
            if (!items || items.length === 0) {
              items = parseV3EventText(data.eventText || '');
            }
            items.forEach((item: any, idx: number) => {
              if (checkMatch(item.content)) {
                searchResults.push({ id: `ev_${dateStr}_${idx}`, type: 'event', dateStr, title: `일정 (${dateStr})`, snippet: item.content });
              }
            });
          });
        } else if (type === 'journals') {
          snap.forEach((d: any) => {
            const dateStr = d.id;
            const entries = d.data().entries || [];
            entries.forEach((entry: any, idx: number) => {
              if (checkMatch(entry.content)) {
                searchResults.push({ id: `jr_${dateStr}_${idx}`, type: 'journal', dateStr, title: `기록 (${dateStr} - ${entry.label || '일반'})`, snippet: entry.content });
              }
            });
          });
        } else if (type === 'schedules') {
          snap.forEach((d: any) => {
            const dateStr = d.id;
            const periods = d.data().periods || {};
            Object.entries(periods).forEach(([p, pData]: [string, any]) => {
              if (hasType('subject') && checkMatch(pData.subject)) {
                searchResults.push({ id: `sc_sub_${dateStr}_${p}`, type: 'schedule', dateStr, title: `수업 (${dateStr} ${p}교시)`, snippet: pData.subject });
              }
              if (hasType('memo') && checkMatch(pData.memo)) {
                searchResults.push({ id: `sc_mem_${dateStr}_${p}`, type: 'schedule_memo', dateStr, title: `수업 메모 (${dateStr} ${p}교시)`, snippet: pData.memo });
              }
              if (hasType('supplies') && checkMatch(pData.supplies)) {
                searchResults.push({ id: `sc_sup_${dateStr}_${p}`, type: 'schedule_supplies', dateStr, title: `비고 (${dateStr} ${p}교시)`, snippet: pData.supplies });
              }
            });
          });
        } else if (type === 'evaluations') {
          snap.forEach((d: any) => {
            const dateStr = d.id;
            const list = d.data().list || [];
            list.forEach((item: any, idx: number) => {
              if (checkMatch(item.title)) {
                 searchResults.push({ id: `evl_${dateStr}_${idx}`, type: 'eval', dateStr, title: `조사표 (${dateStr})`, snippet: item.title });
              }
            });
          });
        }
      });

      // 날짜 기준 내림차순 정렬
      searchResults.sort((a, b) => {
        if (a.dateStr && b.dateStr) return b.dateStr.localeCompare(a.dateStr);
        if (a.dateStr) return -1;
        if (b.dateStr) return 1;
        return 0;
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

      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl z-10 overflow-hidden flex flex-col max-h-[90vh]">
        {/* 상단 검색바 */}
        <div className="p-4 border-b border-slate-100 flex items-center gap-3">
          <span className="text-xl">🔍</span>
          <form onSubmit={handleSearch} className="flex-1">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="검색어 입력 후 엔터 (빈 칸으로 검색 시 설정된 기간의 모든 데이터 조회)"
              className="w-full text-sm font-bold focus:outline-none placeholder-slate-400"
              autoFocus
            />
          </form>
          <button
            onClick={() => handleSearch()}
            disabled={searching}
            className="px-4 py-1.5 bg-primary text-white text-xs font-bold rounded-xl hover:bg-blue-600 disabled:opacity-40 transition-colors shadow-2xs shrink-0"
          >
            {searching ? '탐색 중...' : '데이터 찾기'}
          </button>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full text-xs shrink-0"
          >
            ✕
          </button>
        </div>

        {/* 필터 및 기간 설정 영역 (V3 복원) */}
        <div className="p-4 bg-slate-50 border-b border-slate-100 flex flex-col gap-3">
          {/* 항목 선택 칩스 */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-slate-700">검색 항목 (다중 선택 가능)</span>
            <div className="flex flex-wrap gap-1.5">
              {FILTER_OPTIONS.map((opt) => {
                const isActive = selectedFilters.includes('all') || selectedFilters.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    onClick={() => toggleFilter(opt.id)}
                    className={`px-3 py-1.5 text-[16.5px] font-bold rounded-lg transition-all border ${
                      isActive 
                        ? 'bg-primary text-white border-primary shadow-xs' 
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          
          {/* 검색 기간 선택 */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-xs font-bold text-slate-700 whitespace-nowrap">검색 기간:</span>
            <select
              value={searchScope}
              onChange={(e) => setSearchScope(e.target.value)}
              className="text-xs p-1.5 border border-slate-200 rounded-lg outline-none bg-white font-semibold cursor-pointer focus:ring-1 focus:ring-primary"
            >
              <option value="year">해당 학년도 전체 (모든 데이터)</option>
              <option value="sem1">1학기 (3월 ~ 8월 15일)</option>
              <option value="sem2">2학기 (8월 16일 ~ 2월 말)</option>
              <option value="month">해당 월</option>
              <option value="week">해당 주</option>
              <option value="day">해당 일</option>
              <option value="custom">직접 지정(Custom)...</option>
            </select>
            
            {searchScope === 'custom' && (
              <div className="flex items-center gap-1">
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="text-xs p-1.5 border border-slate-200 rounded-lg outline-none bg-white" />
                <span className="text-xs font-bold text-slate-500">~</span>
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="text-xs p-1.5 border border-slate-200 rounded-lg outline-none bg-white" />
              </div>
            )}
          </div>
        </div>

        {/* 검색 결과 영역 */}
        <div className="p-4 overflow-y-auto flex-1 min-h-0 space-y-2 bg-slate-50/50" data-scroll-lock>
          {searching ? (
            <div className="py-12 text-center text-slate-500 text-xs font-bold">
              <div className="w-8 h-8 border-2 border-slate-200 border-t-primary rounded-full animate-spin mx-auto mb-3" />
              ⏳ 클라우드에서 데이터를 분석 중입니다...
            </div>
          ) : results.length > 0 ? (
            <>
              <div className="text-xs font-bold text-slate-700 mb-2 pl-1">
                총 {results.length}건의 데이터를 찾았습니다.
              </div>
              {results.map((res) => {
                let badgeClass = 'bg-slate-50 text-slate-700 border-slate-200';
                let badgeText = '';

                switch(res.type) {
                  case 'memo': badgeClass = 'bg-amber-50 text-amber-700 border-amber-200'; badgeText = '전체 메모'; break;
                  case 'event': badgeClass = 'bg-blue-50 text-blue-700 border-blue-200'; badgeText = '일정'; break;
                  case 'journal': badgeClass = 'bg-purple-50 text-purple-700 border-purple-200'; badgeText = '기록'; break;
                  case 'schedule': badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200'; badgeText = '수업'; break;
                  case 'schedule_memo': badgeClass = 'bg-lime-50 text-lime-700 border-lime-200'; badgeText = '수업 메모'; break;
                  case 'schedule_supplies': badgeClass = 'bg-orange-50 text-orange-700 border-orange-200'; badgeText = '비고'; break;
                  case 'eval': badgeClass = 'bg-cyan-50 text-cyan-700 border-cyan-200'; badgeText = '조사표'; break;
                }

                return (
                  <div
                    key={res.id}
                    onClick={() => handleItemClick(res)}
                    className="p-3.5 bg-white hover:bg-blue-50/40 border border-slate-200 hover:border-primary/50 rounded-xl cursor-pointer transition-all flex items-start justify-between gap-3 shadow-sm group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`px-2 py-0.5 rounded text-[15px] font-bold border ${badgeClass}`}>
                          {badgeText}
                        </span>
                        <span className="text-[16.5px] font-bold text-slate-700">{res.title}</span>
                      </div>
                      <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                        {res.snippet}
                      </p>
                    </div>

                    <span className="text-xs text-primary font-bold opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      이동 ➔
                    </span>
                  </div>
                );
              })}
            </>
          ) : hasSearched ? (
            <div className="py-12 text-center text-red-500 font-bold text-xs">
              지정한 조건에 일치하는 결과가 없습니다.
            </div>
          ) : (
            <div className="py-12 text-center text-slate-400 text-xs font-semibold">
              항목과 기간을 설정한 뒤 '데이터 찾기'를 눌러주세요.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
