//src/components/SearchModal.tsx

import React, { useState } from 'react';
import { showErrorToast } from '../utils/toast';
import { collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { parseDateStr, formatDateStr } from '../lib/dateUtils';
import { parseV3EventText } from '../hooks/useDayData';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer } from '../hooks/useModalLayer';
import { useBackdropClose } from '../hooks/useBackdropClose';
import ModalShell, { ModalCloseButton } from './ModalShell';
import { focusKey, type FocusSection } from '../lib/searchFocus';
import DateRangeFields from './DateRangeFields';

interface SearchResultItem {
  id: string;
  type: 'memo' | 'event' | 'journal' | 'schedule' | 'schedule_memo' | 'schedule_supplies' | 'eval' | 'attachment';
  dateStr?: string;
  title: string;
  snippet: string;
  /** 눌렀을 때 갈 곳. 첨부는 어디에 붙어 있었느냐에 따라 다르다. */
  goTo?: 'memo' | 'day';
  /** 이동한 화면에서 찾아 강조할 항목 (lib/searchFocus) */
  focus?: { key: string; section: FocusSection };
  /** 자세히 보기 팝업에 보여 줄 것 */
  detail?: SearchDetail;
}

interface SearchDetail {
  /** 본문 전체 (목록에는 이것이 짧게 보인다) */
  text?: string;
  /** 이름: 값 으로 보여 줄 것 (시간, 교시 등) */
  fields?: { label: string; value: string }[];
  labels?: string[];
  attachments?: { name: string; url?: string }[];
}

/** 첨부 목록을 이름과 주소만 남겨 고른다. 문자열 하나만 저장된 옛 첨부도 받는다. */
const attachmentList = (atts: unknown): { name: string; url?: string }[] =>
  Array.isArray(atts)
    ? atts.map((a: any) =>
        typeof a === 'string'
          ? { name: a.split('/').pop() || '이름 없는 파일', url: a }
          : { name: String(a?.name || '이름 없는 파일'), url: a?.url }
      )
    : [];

/** 라벨은 배열(labels)로도, 쉼표로 이은 글자(label)로도 저장돼 있다. */
const labelList = (...sources: unknown[]): string[] => {
  const out: string[] = [];
  for (const src of sources) {
    const items = Array.isArray(src) ? src : typeof src === 'string' ? src.split(',') : [];
    for (const l of items) {
      const name = typeof l === 'string' ? l.trim() : '';
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
};

const BADGES: Record<SearchResultItem['type'], { text: string; className: string }> = {
  memo: { text: '전체 메모', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  event: { text: '일정', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  journal: { text: '기록', className: 'bg-purple-50 text-purple-700 border-purple-200' },
  schedule: { text: '수업', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  schedule_memo: { text: '수업 메모', className: 'bg-lime-50 text-lime-700 border-lime-200' },
  schedule_supplies: { text: '비고', className: 'bg-orange-50 text-orange-700 border-orange-200' },
  eval: { text: '조사표', className: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  attachment: { text: '첨부파일', className: 'bg-rose-50 text-rose-700 border-rose-200' },
};

/** 한 번에 그릴 결과 수. '더 보기'로 이만큼씩 늘린다. */
const PAGE_SIZE = 50;

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
  // 첨부는 일정·기록·수업·메모 어디에나 붙는다. 그래서 갈래가 아니라
  // '붙어 있는 파일만 모아 보기'로 따로 둔다. 검색어를 비우고 이것만 고르면
  // 그 기간에 올린 파일이 한눈에 나온다.
  { id: 'attachment', label: '첨부파일' },
];

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
  useBodyScrollLock(isOpen);
  const vv = useVisualViewport(isOpen);

  const zIndex = useModalLayer(isOpen, onClose);

  const backdrop = useBackdropClose();
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  // 찾은 것을 한꺼번에 다 그리지 않는다. 검색어를 비우고 한 학기를 고르면 수업만으로도
  // 3천 건이 넘는다(하루 6교시 x 과목·메모·비고). 그 카드를 전부 만들고 그리느라
  // 조회는 벌써 끝났는데도 화면이 한참 멈춰 있었다. 조회가 느린 것이 아니었다.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // V3 스타일 필터 및 범위 상태
  const [selectedFilters, setSelectedFilters] = useState<string[]>(['all']);
  const [searchScope, setSearchScope] = useState<string>('year');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { currentDate, setCurrentDate, setScope, selectedGroupId, requestFocus } = useAppStore();
  // 자세히 보기 팝업에 띄운 결과
  const [selected, setSelected] = useState<SearchResultItem | null>(null);

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

  /** 지금 고른 기간의 실제 날짜. '해당 학년도 전체'는 날짜 제한이 없어 빈 값이다. */
  const shownRange = getTargetDateRange() || { start: '', end: '' };

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
      setVisibleCount(PAGE_SIZE);
      const searchResults: SearchResultItem[] = [];

      const range = getTargetDateRange();
      if (searchScope === 'custom' && (!range?.start || !range?.end)) {
        showErrorToast('검색할 시작 날짜와 종료 날짜를 모두 지정해주세요.');
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

      // 메모는 날짜마다 문서가 하나인 다른 항목들과 달리 한 건에 문서 하나라,
      // 문서 이름으로 기간을 자를 수 없다. 만든 날(createdAt)로 거른다.
      // createdAt이 없던 옛 메모는 메모 화면과 같은 방식으로 order에서 되살린다.
      const memoCreatedAt = (data: any): number =>
        data.createdAt || (data.order ? Math.abs(data.order) : 0);

      const memoDateOf = (data: any): string => {
        const ms = memoCreatedAt(data);
        return ms ? formatDateStr(new Date(ms)) : '';
      };

      const memoInRange = (dateStr: string) => {
        if (!range || !range.start || !range.end) return true;
        // 만든 때를 알 수 없는 메모는 기간 때문에 사라지지 않도록 남긴다.
        if (!dateStr) return true;
        return dateStr >= range.start && dateStr <= range.end;
      };

      /**
       * 첨부는 일정·기록·수업·메모에 딸려 있다. 그래서 그 갈래들을 다 읽어야 한다.
       * '첨부파일'만 골랐어도 아래 네 컬렉션을 모두 읽는 까닭이다.
       */
      const wantAttachment = hasType('attachment');

      /** 파일 이름이나 붙어 있던 글에 걸리면 한 건으로 담는다. */
      const pushAttachments = (
        atts: any,
        ctx: {
          key: string;
          dateStr?: string;
          where: string;
          parentText?: string;
          goTo?: 'memo' | 'day';
          focus?: SearchResultItem['focus'];
          labels?: string[];
        }
      ) => {
        if (!wantAttachment || !Array.isArray(atts)) return;
        atts.forEach((att: any, i: number) => {
          // 문자열 하나만 저장된 옛 첨부도 있다
          const name = String((typeof att === 'string' ? att.split('/').pop() : att?.name) || '').trim();
          const shown = name || '이름 없는 파일';
          if (!checkMatch(shown) && !checkMatch(ctx.parentText || '')) return;
          searchResults.push({
            id: `att_${ctx.key}_${i}`,
            type: 'attachment',
            dateStr: ctx.dateStr,
            title: `첨부 · ${ctx.where}${ctx.dateStr ? ` (${ctx.dateStr})` : ''}`,
            snippet: ctx.parentText ? `📎 ${shown}\n${ctx.parentText}` : `📎 ${shown}`,
            goTo: ctx.goTo,
            focus: ctx.focus,
            detail: {
              text: ctx.parentText,
              fields: [{ label: '붙어 있는 곳', value: ctx.where }],
              labels: ctx.labels,
              attachments: attachmentList([att]),
            },
          });
        });
      };

      const promises: Promise<any>[] = [];

      // 1. 메모 (tasks)
      if (hasType('task') || wantAttachment) {
        const col = selectedGroupId ? collection(db, 'groups', selectedGroupId, 'tasks') : collection(db, 'users', user.uid, 'tasks');
        promises.push(getDocs(col).then((snap) => ({ type: 'tasks', snap })));
      }
      
      // 2. 일정 (events)
      if (hasType('event') || wantAttachment) {
        const col = selectedGroupId ? collection(db, 'groups', selectedGroupId, 'events') : collection(db, 'users', user.uid, 'events');
        promises.push(getDocs(query(col, ...dateQuery)).then((snap) => ({ type: 'events', snap })));
      }

      // 3. 기록 (journals)
      if (hasType('journal') || wantAttachment) {
        const col = selectedGroupId ? collection(db, 'groups', selectedGroupId, 'journals') : collection(db, 'users', user.uid, 'journals');
        promises.push(getDocs(query(col, ...dateQuery)).then((snap) => ({ type: 'journals', snap })));
      }

      // 4. 수업, 메모(수업), 비고 (schedules)
      if (hasType('subject') || hasType('memo') || hasType('supplies') || wantAttachment) {
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
            const dateStr = memoDateOf(data);
            if (!memoInRange(dateStr)) return;
            const text = data.content || data.text || '';
            const focus = { key: focusKey.memo(d.id), section: 'memo' as const };
            const labels = labelList(data.labels);
            if (hasType('task') && checkMatch(text)) {
              searchResults.push({
                id: d.id,
                type: 'memo',
                dateStr: dateStr || undefined,
                title: dateStr ? `메모 (${dateStr})` : '메모 (만든 날 모름)',
                snippet: text,
                focus,
                detail: {
                  text,
                  fields: [
                    ...(data.completed ? [{ label: '상태', value: '완료' }] : []),
                    ...(data.favorite ? [{ label: '즐겨찾기', value: '⭐' }] : []),
                  ],
                  labels,
                  attachments: attachmentList(data.attachments),
                },
              });
            }
            pushAttachments(data.attachments, {
              key: `task_${d.id}`,
              dateStr: dateStr || undefined,
              where: '메모',
              parentText: text,
              goTo: 'memo',
              focus,
              labels,
            });
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
              const focus = {
                key: focusKey.event(dateStr, String(item.id || 'ev_' + idx)),
                section: 'event' as const,
              };
              const labels = labelList(item.label);
              if (hasType('event') && checkMatch(item.content)) {
                searchResults.push({
                  id: `ev_${dateStr}_${idx}`,
                  type: 'event',
                  dateStr,
                  title: `일정 (${dateStr})`,
                  snippet: item.content,
                  focus,
                  detail: {
                    text: item.content,
                    fields: [
                      ...(item.time ? [{ label: '알림', value: String(item.time).replace('T', ' ') }] : []),
                      ...(item.completed ? [{ label: '상태', value: '완료' }] : []),
                    ],
                    labels,
                    attachments: attachmentList(item.attachments),
                  },
                });
              }
              pushAttachments(item.attachments, {
                key: `ev_${dateStr}_${idx}`,
                dateStr,
                where: '일정',
                parentText: item.content,
                focus,
                labels,
              });
            });
          });
        } else if (type === 'journals') {
          snap.forEach((d: any) => {
            const dateStr = d.id;
            const entries = d.data().entries || [];
            entries.forEach((entry: any, idx: number) => {
              const focus = {
                key: focusKey.journal(dateStr, String(entry.id || 'jr_' + idx)),
                section: 'journal' as const,
              };
              const labels = labelList(entry.labels, entry.label);
              if (hasType('journal') && checkMatch(entry.content)) {
                searchResults.push({
                  id: `jr_${dateStr}_${idx}`,
                  type: 'journal',
                  dateStr,
                  title: `기록 (${dateStr} - ${entry.label || '일반'})`,
                  snippet: entry.content,
                  focus,
                  detail: { text: entry.content, labels, attachments: attachmentList(entry.attachments) },
                });
              }
              pushAttachments(entry.attachments, {
                key: `jr_${dateStr}_${idx}`,
                dateStr,
                where: '기록',
                parentText: entry.content,
                focus,
                labels,
              });
            });
          });
        } else if (type === 'schedules') {
          snap.forEach((d: any) => {
            const dateStr = d.id;
            const periods = d.data().periods || {};
            Object.entries(periods).forEach(([p, pData]: [string, any]) => {
              const focus = { key: focusKey.period(dateStr, p), section: 'schedule' as const };
              const detail: SearchDetail = {
                text: pData.content || undefined,
                fields: [
                  { label: '교시', value: `${p}교시` },
                  ...(pData.subject ? [{ label: '과목', value: String(pData.subject) }] : []),
                  ...(pData.memo ? [{ label: '수업 메모', value: String(pData.memo) }] : []),
                  ...(pData.supplies ? [{ label: '비고', value: String(pData.supplies) }] : []),
                ],
                attachments: attachmentList(pData.attachments),
              };
              if (hasType('subject') && checkMatch(pData.subject)) {
                searchResults.push({ id: `sc_sub_${dateStr}_${p}`, type: 'schedule', dateStr, title: `수업 (${dateStr} ${p}교시)`, snippet: pData.subject, focus, detail });
              }
              if (hasType('memo') && checkMatch(pData.memo)) {
                searchResults.push({ id: `sc_mem_${dateStr}_${p}`, type: 'schedule_memo', dateStr, title: `수업 메모 (${dateStr} ${p}교시)`, snippet: pData.memo, focus, detail });
              }
              if (hasType('supplies') && checkMatch(pData.supplies)) {
                searchResults.push({ id: `sc_sup_${dateStr}_${p}`, type: 'schedule_supplies', dateStr, title: `비고 (${dateStr} ${p}교시)`, snippet: pData.supplies, focus, detail });
              }
              pushAttachments(pData.attachments, {
                key: `sc_${dateStr}_${p}`,
                dateStr,
                where: `수업 ${p}교시`,
                parentText: pData.subject || pData.memo || '',
                focus,
              });
            });
          });
        } else if (type === 'evaluations') {
          snap.forEach((d: any) => {
            const dateStr = d.id;
            const list = d.data().list || [];
            list.forEach((item: any, idx: number) => {
              if (checkMatch(item.title)) {
                 searchResults.push({ id: `evl_${dateStr}_${idx}`, type: 'eval', dateStr, title: `조사표 (${dateStr})`, snippet: item.title, detail: { text: item.title } });
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

  // 결과를 누르면 먼저 자세히 보여 준다. 목록에는 글이 잘려 보이고,
  // 라벨·첨부는 아예 보이지 않아 맞는 항목인지 알기 어려웠다.
  const handleItemClick = (item: SearchResultItem) => setSelected(item);

  /** 그 항목이 있는 화면으로 가서, 항목이 보이게 스크롤하고 강조한다. */
  const goToItem = (item: SearchResultItem) => {
    // 첨부는 메모에 붙은 것이면 메모 화면으로, 그 밖에는 그 날짜로 간다.
    if (item.type === 'memo' || item.goTo === 'memo') {
      setScope('memo');
    } else if (item.dateStr) {
      setCurrentDate(parseDateStr(item.dateStr));
      setScope('day');
    }
    if (item.focus) requestFocus(item.focus);
    setSelected(null);
    onClose();
  };

  const destinationText = (item: SearchResultItem) =>
    item.type === 'memo' || item.goTo === 'memo'
      ? '메모 화면으로 이동'
      : item.dateStr
      ? `${item.dateStr} 하루 화면으로 이동`
      : '이동';

  return (
    <>
    <div
      className="fixed inset-0 flex items-start justify-center overflow-y-auto p-4"
      style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }}
    >
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" {...backdrop} />

      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl z-10 overflow-hidden flex flex-col max-h-full">
        {/* 머리말 — 다른 팝업과 같은 모양(제목 + ✕)으로 맞춘다.
            예전에는 검색만 제목이 없고, 제목 자리에 검색칸이 들어가 있었다.
            그 줄에 '데이터 찾기'와 ✕까지 함께 밀려 들어가 안내 문구가
            '...설정' 에서 잘렸다. 검색칸은 아랫줄로 내린다. */}
        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-100 bg-slate-50/60 shrink-0">
          <h2 className="text-base font-black text-slate-800 truncate">🔍 검색</h2>
          <button
            type="button"
            onClick={onClose}
            title="닫기"
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 font-bold transition-colors cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>

        {/* 검색어 입력 줄 */}
        <div className="p-4 border-b border-slate-100 flex items-center gap-3">
          <form onSubmit={handleSearch} className="flex-1 min-w-0">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="검색어 입력 후 엔터 (비우면 정한 기간의 모든 데이터)"
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
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all border ${
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
          {/* 드롭다운과 날짜를 한 줄에 둔다.
              기간이 날짜로 바로 보이므로, 드롭다운 이름에 들어 있던 날짜 풀이
              ('1학기 (3월 ~ 8월 15일)')는 뚜다. 같은 말을 두 번 적지 않고,
              그만큼 줄이 짧아져 한 줄에 들어간다. */}
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1.5">
            <span className="text-xs font-bold text-slate-700 whitespace-nowrap shrink-0">
              검색 기간:
            </span>
            <select
              value={searchScope}
              onChange={(e) => setSearchScope(e.target.value)}
              title="메모는 날짜 문서가 아니라 만든 날을 기준으로 거릅니다"
              className="text-xs px-1.5 py-1 border border-slate-200 rounded-lg outline-none bg-white font-semibold cursor-pointer focus:ring-1 focus:ring-primary shrink-0"
            >
              <option value="year">학년도 전체</option>
              <option value="sem1">1학기</option>
              <option value="sem2">2학기</option>
              <option value="month">해당 월</option>
              <option value="week">해당 주</option>
              <option value="day">해당 일</option>
              <option value="custom">직접 지정</option>
            </select>
            
            {/* 고른 기간이 실제로 며칠부터 며칠까지인지 늘 보여 주고, 그 자리에서
                고칠 수 있게 한다. 고치면 '직접 지정'으로 넘어간다. */}
            {searchScope === 'year' ? (
              <span className="text-2xs font-semibold text-slate-400 shrink-0">날짜 제한 없음</span>
            ) : (
              <DateRangeFields
                start={shownRange.start}
                end={shownRange.end}
                onChange={(s, e) => {
                  setCustomStart(s);
                  setCustomEnd(e);
                  setSearchScope('custom');
                }}
              />
            )}
          </div>
        </div>

        {/* 검색 결과 영역 */}
        <div className="p-4 overflow-y-auto overscroll-contain flex-1 min-h-0 space-y-2 bg-slate-50/50" data-scroll-lock>
          {searching ? (
            <div className="py-12 text-center text-slate-500 text-xs font-bold">
              <div className="w-8 h-8 border-2 border-slate-200 border-t-primary rounded-full animate-spin mx-auto mb-3" />
              ⏳ 클라우드에서 데이터를 분석 중입니다...
            </div>
          ) : results.length > 0 ? (
            <>
              <div className="text-xs font-bold text-slate-700 mb-2 pl-1">
                총 {results.length}건의 데이터를 찾았습니다.
                {results.length > visibleCount && (
                  <span className="font-semibold text-slate-500"> (앞에서 {visibleCount}건 표시 중)</span>
                )}
              </div>
              {results.slice(0, visibleCount).map((res) => {
                const { text: badgeText, className: badgeClass } = BADGES[res.type];

                return (
                  <div
                    key={res.id}
                    onClick={() => handleItemClick(res)}
                    className="p-3.5 bg-white hover:bg-blue-50/40 border border-slate-200 hover:border-primary/50 rounded-xl cursor-pointer transition-all flex items-start justify-between gap-3 shadow-sm group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold border ${badgeClass}`}>
                          {badgeText}
                        </span>
                        <span className="text-xs font-bold text-slate-700">{res.title}</span>
                      </div>
                      <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                        {res.snippet}
                      </p>
                    </div>

                    <span className="text-xs text-primary font-bold opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      자세히 ➔
                    </span>
                  </div>
                );
              })}
              {results.length > visibleCount && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="w-full py-2.5 bg-white hover:bg-blue-50/40 border border-slate-200 hover:border-primary/50 rounded-xl text-xs font-bold text-slate-700 transition-colors cursor-pointer"
                >
                  더 보기 (남은 {results.length - visibleCount}건)
                </button>
              )}
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

        {/* 바닥 닫기 줄 — 다른 팝업과 같은 자리에 둔다.
            결과가 길 때 맨 위 ✕까지 올라가지 않아도 닫을 수 있다. */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2 shrink-0">
          <ModalCloseButton onClose={onClose} />
        </div>
      </div>
    </div>

    {/* 자세히 보기. 검색 창 위에 뜨고, 닫으면 검색 결과로 돌아간다. */}
    {selected && (
      <ModalShell
        isOpen
        onClose={() => setSelected(null)}
        width="md"
        title={
          <span className="flex items-center gap-2 min-w-0">
            <span className={`px-2 py-0.5 rounded text-xs font-bold border shrink-0 ${BADGES[selected.type].className}`}>
              {BADGES[selected.type].text}
            </span>
            <span className="truncate">{selected.title}</span>
          </span>
        }
        footer={
          <>
            <ModalCloseButton onClose={() => setSelected(null)} />
            {(selected.dateStr || selected.type === 'memo' || selected.goTo === 'memo') && (
              <button
                type="button"
                onClick={() => goToItem(selected)}
                className="px-4 py-2 bg-primary hover:bg-blue-600 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                {destinationText(selected)} ➔
              </button>
            )}
          </>
        }
      >
        <div className="space-y-3" data-testid="search-detail">
          {selected.detail?.fields && selected.detail.fields.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              {selected.detail.fields.map((field) => (
                <React.Fragment key={field.label}>
                  <dt className="font-bold text-slate-500">{field.label}</dt>
                  <dd className="text-slate-800 whitespace-pre-wrap break-words">{field.value}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}

          {(selected.detail?.text ?? selected.snippet) && (
            <div className="max-h-[50vh] overflow-y-auto p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800 whitespace-pre-wrap break-words leading-relaxed">
              {selected.detail?.text ?? selected.snippet}
            </div>
          )}

          {selected.detail?.labels && selected.detail.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selected.detail.labels.map((label) => (
                <span key={label} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">
                  #{label}
                </span>
              ))}
            </div>
          )}

          {selected.detail?.attachments && selected.detail.attachments.length > 0 && (
            <ul className="space-y-1">
              {selected.detail.attachments.map((att, i) => (
                <li key={`${att.name}-${i}`}>
                  {att.url ? (
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline break-all"
                    >
                      📎 {att.name}
                    </a>
                  ) : (
                    <span className="text-xs font-semibold text-slate-600 break-all">📎 {att.name}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </ModalShell>
    )}
    </>
  );
}
