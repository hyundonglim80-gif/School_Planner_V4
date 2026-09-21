import React, { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { eventDocPayload } from '../lib/eventText';
import { useAppStore } from '../store/useAppStore';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer, closeAllModals } from '../hooks/useModalLayer';
import { useBackdropClose } from '../hooks/useBackdropClose';
import { showToast, showErrorToast } from '../utils/toast';
import { attachmentImageSrc } from '../lib/driveApi';
import { collectImages, collectFiles, type ViewerImage } from '../lib/attachments';
import ImageViewerModal from './ImageViewerModal';

interface LinkViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceType: string;
  sourceDateStr: string;
  sourceId: string;
  sourcePeriod?: number | string;
  sourceFId?: string;
}

export interface NormalizedLink {
  targetType: 'schedule' | 'event' | 'journal' | 'memo';
  targetId: string;
  targetDate: string;
  targetPeriod?: string | number;
  title: string;
  targetFId: string;
  liveText?: string;
  /** 연결된 항목에 붙어 있는 파일들 (사진·캡처 포함) */
  liveAttachments?: any[];
  /** 붙임 목록이 생기기 전에 쓰던 자리. 옛 자료에 남아 있다. */
  liveImageUrl?: string;
  loadingText?: boolean;
}

export default function LinkViewerModal({
  isOpen,
  onClose,
  sourceType,
  sourceDateStr,
  sourceId,
  sourcePeriod,
  sourceFId,
}: LinkViewerModalProps) {
  useBodyScrollLock(isOpen);

  const vv = useVisualViewport(isOpen);

  const zIndex = useModalLayer(isOpen, onClose);

  const backdrop = useBackdropClose();
  const { selectedGroupId, setCurrentDate, setScope, openDetailEdit, openEntryEditor } = useAppStore();
  const [links, setLinks] = useState<NormalizedLink[]>([]);
  const [loading, setLoading] = useState(false);
  // 붙임 사진 크게 보기
  const [viewerImages, setViewerImages] = useState<ViewerImage[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);

  const getColPath = useCallback((col: string, fId?: string) => {
    const uid = auth.currentUser?.uid;
    const targetFId = fId || selectedGroupId || 'personal';
    return targetFId === 'personal' || !targetFId
      ? `users/${uid}/${col}`
      : `groups/${targetFId}/${col}`;
  }, [selectedGroupId]);

  /**
   * 연결된 항목의 지금 내용을 읽는다. (V3 fetchItemText 이식)
   *
   * 예전에는 글자만 돌려주고 붙임은 버렸다. 그래서 사진을 붙여 둔 기록을
   * 링크로 열면 글만 보이고 사진이 없어, 링크가 엉뚱한 곳을 가리키는 것처럼
   * 보였다. 붙임도 함께 들고 온다. 네 갈래가 모두 같은 자리에 담고 있다.
   */
  const fetchItemContent = useCallback(async (
    type: string,
    dateStr: string,
    id: string,
    period: string | number | undefined,
    fId: string
  ): Promise<{ text: string; attachments: any[]; imageUrl?: string }> => {
    const empty = { text: '', attachments: [] as any[] };
    const of = (item: any, text: string) => ({
      text,
      attachments: item?.attachments || [],
      imageUrl: item?.imageUrl,
    });

    try {
      if (type === 'event') {
        const snap = await getDoc(doc(db, getColPath('events', fId), dateStr));
        if (snap.exists()) {
          const list = snap.data().eventList || [];
          const item = list.find((e: any) => String(e.id) === String(id));
          if (item) return of(item, item.content || item.text || '');
        }
      } else if (type === 'journal') {
        const snap = await getDoc(doc(db, getColPath('journals', fId), dateStr));
        if (snap.exists()) {
          const entries = snap.data().entries || [];
          const item = entries.find((e: any) => String(e.id) === String(id));
          if (item) return of(item, item.content || '');
        }
      } else if (type === 'schedule') {
        const snap = await getDoc(doc(db, getColPath('schedules', fId), dateStr));
        if (snap.exists()) {
          const periods = snap.data().periods || {};
          const p = period ? String(period) : String(id).replace(/.*_/, '');
          const item = periods[p];
          if (item) {
            const subjectStr = item.subject ? `[${item.subject}] ` : '';
            return of(item, `${subjectStr}${item.memo || item.content || ''}`.trim());
          }
        }
      } else if (type === 'memo') {
        const snap = await getDoc(doc(db, getColPath('tasks', fId), id));
        if (snap.exists()) {
          const item = snap.data();
          return of(item, item.content || item.text || '');
        }
      }
    } catch (err) {
      console.warn('fetchItemContent failed:', err);
    }
    return empty;
  }, [getColPath]);

  // 링크 목록 조회 (V3 호환 구조 추출)
  const fetchLinks = useCallback(async () => {
    setLoading(true);
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setLoading(false);
      return;
    }

    try {
      const activeFId = sourceFId || selectedGroupId || 'personal';
      let foundRawLinks: any[] = [];

      if (sourceType === 'event') {
        const snap = await getDoc(doc(db, getColPath('events', activeFId), sourceDateStr));
        if (snap.exists()) {
          const ev = (snap.data().eventList || []).find((e: any) => String(e.id) === String(sourceId));
          if (ev?.linkedItems) foundRawLinks = [...ev.linkedItems];
          if (snap.data().links?.[`event_${sourceId}`]) {
            foundRawLinks = [...foundRawLinks, ...snap.data().links[`event_${sourceId}`]];
          }
        }
      } else if (sourceType === 'journal') {
        const snap = await getDoc(doc(db, getColPath('journals', activeFId), sourceDateStr));
        if (snap.exists()) {
          const j = (snap.data().entries || []).find((e: any) => String(e.id) === String(sourceId));
          if (j?.linkedItems) foundRawLinks = [...j.linkedItems];
          if (snap.data().links?.[`journal_${sourceId}`]) {
            foundRawLinks = [...foundRawLinks, ...snap.data().links[`journal_${sourceId}`]];
          }
        }
      } else if (sourceType === 'schedule' || sourceType === 'schedule_header') {
        const snap = await getDoc(doc(db, getColPath('schedules', activeFId), sourceDateStr));
        if (snap.exists()) {
          const pKey = sourcePeriod ? String(sourcePeriod) : String(sourceId);
          const p = (snap.data().periods || {})[pKey];
          if (p?.linkedItems) foundRawLinks = [...p.linkedItems];
          if (snap.data().links?.[`schedule_${pKey}`]) {
            foundRawLinks = [...foundRawLinks, ...snap.data().links[`schedule_${pKey}`]];
          }
        }
      } else if (sourceType === 'memo') {
        const snap = await getDoc(doc(db, getColPath('tasks', activeFId), sourceId));
        if (snap.exists()) {
          if (snap.data().linkedItems) foundRawLinks = [...snap.data().linkedItems];
        }
      }

      // V3 및 V4 구버전 호환 정규화
      const normalizedMap = new Map<string, NormalizedLink>();

      foundRawLinks.forEach((raw) => {
        const targetType = (raw.targetType || raw.type || 'event') as NormalizedLink['targetType'];
        const targetId = String(raw.targetId || raw.id || '');
        const targetDate = String(raw.targetDate || raw.dateStr || '');
        const targetPeriod = raw.targetPeriod !== undefined ? raw.targetPeriod : (raw.period !== undefined ? raw.period : undefined);
        const title = raw.title || raw.text || '';
        const targetFId = raw.targetFId || raw.fId || activeFId;

        const uniqueKey = targetId || `${targetType}_${targetDate}_${targetPeriod || ''}_${title}`;

        if (!normalizedMap.has(uniqueKey) && targetId) {
          normalizedMap.set(uniqueKey, {
            targetType,
            targetId,
            targetDate,
            targetPeriod,
            title,
            targetFId,
            liveText: raw.text || raw.title || '',
            loadingText: true,
          });
        }
      });

      const initialLinks = Array.from(normalizedMap.values());
      setLinks(initialLinks);
      setLoading(false);

      // 비동기로 실시간 본문 로드
      const updatedLinks = await Promise.all(
        initialLinks.map(async (item) => {
          const live = await fetchItemContent(
            item.targetType,
            item.targetDate,
            item.targetId,
            item.targetPeriod,
            item.targetFId
          );
          return {
            ...item,
            liveText: live.text || item.title || '(내용 없음)',
            liveAttachments: live.attachments,
            liveImageUrl: live.imageUrl,
            loadingText: false,
          };
        })
      );
      setLinks(updatedLinks);
    } catch (e) {
      console.error('fetchLinks failed:', e);
      setLoading(false);
    }
  }, [sourceType, sourceDateStr, sourceId, sourcePeriod, sourceFId, selectedGroupId, getColPath, fetchItemContent]);

  useEffect(() => {
    if (isOpen) {
      fetchLinks();
    } else {
      setLinks([]);
    }
  }, [isOpen, fetchLinks]);

  // 해당 화면으로 이동 (V3 navigateAndClose 이식)
  const handleNavigate = (link: NormalizedLink) => {
    onClose();
    if (link.targetType === 'memo') {
      setScope('memo');
    } else if (link.targetDate) {
      const parts = link.targetDate.split('-');
      if (parts.length === 3) {
        setCurrentDate(new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
      } else {
        setCurrentDate(new Date(link.targetDate));
      }
      setScope('day');
    } else {
      showToast('이동할 수 없는 항목입니다.');
    }
  };

  /**
   * 연결된 항목을 제대로 된 편집기로 연다.
   *
   * 예전에는 여기서 글자만 고칠 수 있는 칸이 열렸다. 그래서 캡처 이미지를 붙이거나
   * 파일을 달거나 라벨·링크를 손대려면, 그 항목이 있는 날짜로 직접 옮겨 가야 했다.
   * 화면에서 쓰는 것과 같은 편집기를 그대로 연다.
   *   일정·수업 -> 일정 수정 팝업
   *   기록·메모 -> 옆 배너 (첨부·라벨·링크까지 그대로)
   */
  const handleEdit = async (link: NormalizedLink) => {
    const fId = link.targetFId || selectedGroupId || 'personal';

    if (link.targetType === 'journal' || link.targetType === 'memo') {
      openEntryEditor({
        kind: link.targetType,
        dateStr: link.targetDate,
        id: String(link.targetId),
        fId,
      });
      return;
    }

    if (link.targetType === 'event') {
      openDetailEdit({
        type: 'event',
        dateStr: link.targetDate,
        itemId: String(link.targetId),
        // 실제 내용은 팝업이 그 날짜를 읽어 최신으로 채운다. 그 전까지 보여 줄 값만 넘긴다.
        initialData: { id: link.targetId, content: link.liveText || '' },
        fId,
      });
      return;
    }

    // 수업은 교시 하나가 통째로 대상이다. 팝업이 initialData를 그대로 쓰므로 먼저 읽어 둔다.
    const period = link.targetPeriod ?? String(link.targetId).replace(/.*_/, '');
    try {
      const snap = await getDoc(doc(db, getColPath('schedules', link.targetFId), link.targetDate));
      const periods = snap.exists() ? snap.data().periods || {} : {};
      const raw = periods[String(period)];
      const data =
        typeof raw === 'string'
          ? { subject: raw, memo: '', supplies: '' }
          : raw || { subject: '', memo: '', supplies: '' };
      openDetailEdit({
        type: 'schedule',
        dateStr: link.targetDate,
        itemId: Number(period),
        initialData: data,
        fId,
      });
    } catch (e) {
      showErrorToast('수업 정보를 불러오지 못했습니다.', e);
    }
  };

  // 단방향 링크 데이터 삭제 도우미 (V3 _removeLinkFromSide 이식)
  const removeLinkFromSide = async (
    type: string,
    dateStr: string,
    id: string,
    period: string | number | undefined,
    fId: string,
    targetIdToRemove: string
  ) => {
    const colPath = getColPath(
      type === 'event'
        ? 'events'
        : type === 'journal'
        ? 'journals'
        : type === 'schedule' || type === 'schedule_header'
        ? 'schedules'
        : 'tasks',
      fId
    );

    try {
      if (type === 'event') {
        const ref = doc(db, colPath, dateStr);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const list = snap.data().eventList || [];
          const item = list.find((e: any) => String(e.id) === String(id));
          if (item && item.linkedItems) {
            item.linkedItems = item.linkedItems.filter(
              (l: any) => String(l.targetId || l.id) !== String(targetIdToRemove)
            );
            await setDoc(ref, eventDocPayload(list), { merge: true });
          }
        }
      } else if (type === 'journal') {
        const ref = doc(db, colPath, dateStr);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const list = snap.data().entries || [];
          const item = list.find((e: any) => String(e.id) === String(id));
          if (item && item.linkedItems) {
            item.linkedItems = item.linkedItems.filter(
              (l: any) => String(l.targetId || l.id) !== String(targetIdToRemove)
            );
            await setDoc(ref, { entries: list, updatedAt: Date.now() }, { merge: true });
          }
        }
      } else if (type === 'schedule' || type === 'schedule_header') {
        const ref = doc(db, colPath, dateStr);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const periods = snap.data().periods || {};
          const pKey = period ? String(period) : String(id).replace(/.*_/, '');
          const item = periods[pKey];
          if (item && item.linkedItems) {
            item.linkedItems = item.linkedItems.filter(
              (l: any) => String(l.targetId || l.id) !== String(targetIdToRemove)
            );
            await setDoc(ref, { periods, updatedAt: Date.now() }, { merge: true });
          }
        }
      } else if (type === 'memo') {
        const ref = doc(db, colPath, id);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const linkedItems = snap.data().linkedItems || [];
          const filtered = linkedItems.filter(
            (l: any) => String(l.targetId || l.id) !== String(targetIdToRemove)
          );
          await setDoc(ref, { linkedItems: filtered, updatedAt: Date.now() }, { merge: true });
        }
      }
    } catch (err) {
      console.error('removeLinkFromSide error:', err);
    }
  };

  // 양방향 링크 삭제 (V3 deleteLinkConnection 이식)
  const handleDeleteConnection = async (link: NormalizedLink) => {
    if (!window.confirm('이 연결을 해제하시겠습니까? (양쪽 모두에서 연결이 끊어집니다)')) return;

    const sType = sourceType;
    const sDate = sourceDateStr;
    const sPeriod = sourcePeriod || (sType === 'schedule' ? sourceId : '');
    const sFId = sourceFId || selectedGroupId || 'personal';

    const actualSourceId =
      (sType === 'schedule' || sType === 'schedule_header')
        ? `class_${sDate}_${sPeriod}`
        : sourceId;

    const actualTargetId =
      link.targetType === 'schedule'
        ? `class_${link.targetDate}_${link.targetPeriod || link.targetId.replace(/.*_/, '')}`
        : link.targetId;

    try {
      // 1. 출발지에서 타겟 제거
      await removeLinkFromSide(sType, sDate, actualSourceId, sPeriod, sFId, actualTargetId);
      // 2. 도착지에서 출발지 제거
      await removeLinkFromSide(link.targetType, link.targetDate, actualTargetId, link.targetPeriod, link.targetFId, actualSourceId);

      setLinks((prev) => prev.filter((l) => l.targetId !== link.targetId));
      showToast('✅ 연결을 해제했습니다.');
    } catch (e: any) {
      showErrorToast('연결 해제 중 오류가 발생했습니다.', e);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-start justify-center overflow-y-auto p-4 bg-black/40 backdrop-blur-sm animate-fade-in" style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }}
      {...backdrop}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-full flex flex-col border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
            <span>📑</span> 연결된 데이터 확인 (수정/이동 가능)
          </h3>
          <button
            title="닫기"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* 본문 링크 목록 */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-4 bg-slate-50/50 space-y-3" data-scroll-lock>
          {loading ? (
            <div className="text-center py-12 text-slate-400 flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-slate-300 border-t-primary rounded-full animate-spin" />
              <p className="text-xs font-bold text-blue-600">실시간 데이터를 불러오는 중입니다...⏳</p>
            </div>
          ) : links.length === 0 ? (
            <div className="text-center py-12 text-slate-400 flex flex-col items-center gap-2">
              <span className="text-3xl opacity-50">📂</span>
              <p className="text-xs font-medium">연결된 항목의 데이터를 찾을 수 없습니다.</p>
            </div>
          ) : (
            links.map((link) => {
              const icon =
                link.targetType === 'event'
                  ? '📌'
                  : link.targetType === 'journal'
                  ? '📔'
                  : link.targetType === 'memo'
                  ? '📝'
                  : '🏫';

              const typeLabel =
                link.targetType === 'event'
                  ? '일정'
                  : link.targetType === 'journal'
                  ? '기록'
                  : link.targetType === 'memo'
                  ? '메모'
                  : '수업';

              let displayTitle = `[${link.targetDate || '날짜없음'}] ${typeLabel}`;
              if (link.targetType === 'schedule' && link.targetPeriod) {
                displayTitle += ` (${link.targetPeriod}교시)`;
              }

              return (
                <div
                  key={link.targetId}
                  className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm hover:border-slate-300 transition-colors"
                >
                  <div className="flex justify-between items-center gap-2 mb-2 pb-2 border-b border-slate-100">
                    <span className="font-bold text-blue-700 text-xs flex items-center gap-1">
                      <span>{icon}</span> {displayTitle}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDeleteConnection(link)}
                        className="px-2 py-1 text-xs font-bold bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                        title="이 연결을 삭제합니다"
                      >
                        🗑️ 삭제
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNavigate(link)}
                        className="px-2.5 py-1 text-xs font-bold bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                        title="해당 페이지로 이동"
                      >
                        📌 이동
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEdit(link)}
                        className="px-2.5 py-1 text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors cursor-pointer"
                        title={
                          link.targetType === 'journal' || link.targetType === 'memo'
                            ? '기록·메모 배너를 연다 (첨부·라벨·링크까지)'
                            : '일정 수정 팝업을 연다'
                        }
                      >
                        ✏️ 수정
                      </button>
                    </div>
                  </div>

                  <div className="p-2.5 bg-slate-50/70 border border-slate-100 rounded-lg text-xs font-medium text-slate-800 whitespace-pre-wrap break-words leading-relaxed min-h-[36px]">
                    {link.loadingText ? (
                      <span className="text-slate-400">데이터를 불러오는 중...</span>
                    ) : (
                      link.liveText || <span className="text-slate-400">(내용 없음)</span>
                    )}
                  </div>

                  {/* 붙임. 사진은 눌러서 크게 보고, 그 밖의 파일은 새 창에서 연다.
                      글만 보이고 사진이 없으면 링크가 엉뚱한 곳을 가리키는 것처럼
                      보인다. 실제로 그렇게 보였다. */}
                  {(() => {
                    const live = { attachments: link.liveAttachments, imageUrl: link.liveImageUrl };
                    const images = collectImages(live, attachmentImageSrc);
                    const files = collectFiles(live);
                    if (images.length === 0 && files.length === 0) return null;

                    return (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {images.map((img, i) => (
                          <button
                            key={img.url}
                            type="button"
                            onClick={() => {
                              setViewerImages(images);
                              setViewerIndex(i);
                            }}
                            title={img.name}
                            className="w-14 h-14 rounded-lg overflow-hidden border border-slate-200 hover:border-primary transition-colors shrink-0"
                          >
                            <img src={img.url} alt={img.name} loading="lazy" className="w-full h-full object-cover" />
                          </button>
                        ))}
                        {files.map((att, i) => (
                          <a
                            key={att.url || i}
                            href={att.url}
                            target="_blank"
                            rel="noreferrer"
                            title={att.name}
                            className="max-w-[150px] truncate px-2 py-1 rounded-lg border border-slate-200 bg-white text-2xs font-bold text-slate-600 hover:border-primary hover:text-primary transition-colors"
                          >
                            📎 {att.name || '첨부 파일'}
                          </a>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              );
            })
          )}
        </div>

        {/* 모달 하단 닫기 */}
        <div className="px-6 py-3.5 bg-white border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>

      {/* 사진 크게 보기. 링크 팝업 위에 뜬다. */}
      {viewerImages && (
        <ImageViewerModal
          isOpen
          images={viewerImages}
          startIndex={viewerIndex}
          onClose={() => setViewerImages(null)}
        />
      )}
    </div>
  );
}
