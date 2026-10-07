import React, { useState, useEffect, useRef } from 'react';
import { showToast, showErrorToastOnce } from '../utils/toast';
import { useDayData, type EventItem } from '../hooks/useDayData';
import { useAppStore } from '../store/useAppStore';
import { useLabels } from '../hooks/useLabels';
import { useProgressMarks } from '../hooks/useProgress';
import { slotId } from '../lib/progress';
import ProgressCreateButton from './ProgressCreateButton';
import ProgressMarkLine from './ProgressMarkLine';

import { closeAllModals } from '../hooks/useModalLayer';
import EventAlarmModal from './EventAlarmModal';
import PeriodModal from './PeriodModal';
import GroupDeleteModal from './GroupDeleteModal';
import { baseContentOf, groupIdOf } from '../lib/eventGroups';
import PopupFrame from './PopupFrame';
import AutoTextarea from './AutoTextarea';
import { showDeletedToast } from '../lib/undoToast';
import { useTeachingMode } from '../hooks/useTeachingMode';
import { normalizeSlotText } from '../lib/teachingSlot';
import SlotPairInput from './SlotPairInput';
import { useSlotPairOptions } from '../hooks/useTeachingClasses';

function formatAlarmBadge(time?: string) {
  if (!time) return null;
  const d = new Date(time);
  if (isNaN(d.getTime())) return null;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${m}/${day} ${h}:${min}`;
}

export type DetailEditType = 'schedule' | 'event';

export interface DetailEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: DetailEditType;
  dateStr: string;
  itemId: string | number; // period(number) or event id(string)
  initialData: any; // PeriodSchedule or EventItem
  /** 어느 공간의 것인지. 연결된 링크에서 열 때는 지금 보고 있는 공간과 다를 수 있다. */
  fId?: string;
}

export default function DetailEditModal({
  isOpen,
  onClose,
  type,
  dateStr,
  itemId,
  initialData,
  fId,
}: DetailEditModalProps) {
  // 배경을 눌러 닫을 때는 고친 것을 저장하고 닫는다 (아래 closeByBackdrop).
  // 훅은 상태보다 먼저 불러야 해서, 그때그때의 함수를 ref로 넘긴다.
  const backdropCloseRef = useRef<() => void>(closeAllModals);
  const { selectedGroupId, openLinkerModal, openLinkViewerModal, openEvaluationModal, openLabelModal } = useAppStore();
  // fId를 받으면 그 공간의 것을 고친다 ('personal'은 개인 공간 = groupId 없음).
  const targetGroupId = fId ? (fId === 'personal' ? null : fId) : selectedGroupId;
  const { updateEventItem, deleteEventItem, savePeriod, eventList, schedules } = useDayData(isOpen ? dateStr : '', targetGroupId);
  const { eventLabels } = useLabels();
  // 진도 관리 - 이 교시의 차시와 밀기 (개인 공간의 수업만, docs/ROADMAP.md 5-3). 일정이면 읽지 않는다.
  const { marks: progressMarks } = useProgressMarks(isOpen && type === 'schedule' && !targetGroupId ? dateStr : '');
  const progressMark = type === 'schedule' && !targetGroupId ? progressMarks[slotId(dateStr, itemId)] : undefined;

  const [saving, setSaving] = useState(false);
  /**
   * 사용자가 무언가 고쳤는가. 배경을 눌러 닫을 때 저장할지 가른다.
   * 글자·체크 칸은 onInputCapture로, 라벨 단추는 toggleLabel에서 켠다.
   * (알림은 고르는 즉시 저장되므로 여기서 세지 않는다)
   */
  const touchedRef = useRef(false);
  const [alarmModalOpen, setAlarmModalOpen] = useState(false);
  /** '기간'을 켜서 날짜를 고르는 중인가 */
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  /** 기간·반복으로 묶인 일정을 지우려 할 때, 어디까지 지울지 고르는 중인가 */
  const [groupDeleteOpen, setGroupDeleteOpen] = useState(false);

  // 교과 모드: 과목 칸에 '5-2 과학' 제안 (lib/teachingSlot)
  const { isClassUnit } = useTeachingMode();
  const pairOptions = useSlotPairOptions(dateStr);

  // Edit states
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [supplies, setSupplies] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState<string>('');

  // 개별 일정 속성 상태 (달력 / 이월 / 기간 / 반복 / 수업X)
  const [itemCalendar, setItemCalendar] = useState(true);
  const [itemForward, setItemForward] = useState(false);
  const [itemPeriod, setItemPeriod] = useState(false);
  const [itemRecur, setItemRecur] = useState(false);
  const [itemSkip, setItemSkip] = useState(false);

  const currentItem = type === 'schedule'
    ? schedules[Number(itemId)]
    : eventList.find(e => String(e.id) === String(itemId));
  const currentLinkedItems = currentItem?.linkedItems ?? initialData?.linkedItems ?? [];
  const currentEvent = type === 'event' ? (currentItem as EventItem | undefined) : undefined;

  useEffect(() => {
    if (isOpen && initialData) {
      if (type === 'schedule') {
        // 저장된 지금 값(구독)을 따라간다. 예전에는 열 때 받은 값(initialData)만 보여서, 저장한 뒤 교과 모드가
        // '5-2 과학'으로 다듬은 과목이나 하루 화면에서 고친 과목이 배너에는 옛 글자 그대로 남았다(2026-10-04 신고).
        // 고치고 있는 중(저장 전)에는 적던 것을 덮지 않는다.
        if (touchedRef.current) return;
        const live = (currentItem as any) || initialData;
        setSubject(live.subject || '');
        setContent(live.memo || live.content || '');
        setSupplies(live.supplies || '');
        setImageUrl(live.imageUrl || '');
      } else {
        // Event: currentItem과 initialData를 통합하여 가장 최신 데이터 사용
        const targetItem = currentItem || initialData;

        // 1. 라벨 추출 (문자열, 배열, labelIds, labels 객체, content의 [라벨] 정규식 모두 안전하게 파싱)
        let extractedLabels: string[] = [];
        let rawContent = targetItem.content || '';

        if (targetItem.label) {
          if (typeof targetItem.label === 'string') {
            extractedLabels = targetItem.label.split(',').map((l: string) => l.trim()).filter(Boolean);
          } else if (Array.isArray(targetItem.label)) {
            extractedLabels = targetItem.label.map((l: any) => (typeof l === 'string' ? l : String(l.name || l))).filter(Boolean);
          }
        }

        if (extractedLabels.length === 0 && Array.isArray(targetItem.labelIds) && targetItem.labelIds.length > 0) {
          const found = eventLabels.filter(l => targetItem.labelIds!.includes(l.id));
          extractedLabels = found.map(f => f.name);
        }

        if (extractedLabels.length === 0 && Array.isArray(targetItem.labels) && targetItem.labels.length > 0) {
          extractedLabels = targetItem.labels.map((l: any) => (typeof l === 'string' ? l : l.name)).filter(Boolean);
        }

        // 만약 여전히 라벨이 비어있다면 content에서 [라벨명] 패턴 검사
        if (extractedLabels.length === 0 && rawContent) {
          const match = rawContent.match(/^\[(.*?)\]\s*(.*)$/);
          if (match) {
            extractedLabels = [match[1].trim()];
            rawContent = match[2].trim();
          }
        } else if (extractedLabels.length === 1 && rawContent.startsWith(`[${extractedLabels[0]}]`)) {
          rawContent = rawContent.replace(new RegExp(`^\\[${extractedLabels[0]}\\]\\s*`), '');
        }

        setContent(rawContent);
        setLabels(extractedLabels);
        setImageUrl(targetItem.imageUrl || '');

        // 2. 일정 속성 판단 (개별 일정에 명시된 값이 있으면 최우선, 없으면 부여된 라벨들의 속성)
        // 단, 라벨이 아예 없는 일반 일정은 기본적으로 '달력' 속성을 켜야 합니다.
        const hasCalendarProp = extractedLabels.some(name => {
          const def = eventLabels.find(l => l.name === name);
          return def ? def.calendar !== false : false;
        });
        const hasForwardProp = extractedLabels.some(name => {
          const def = eventLabels.find(l => l.name === name);
          return def ? !!(def.forward || (def as any).isForward) : false;
        });
        const hasPeriodProp = extractedLabels.some(name => {
          const def = eventLabels.find(l => l.name === name);
          return def ? !!def.period : false;
        });
        const hasRecurProp = extractedLabels.some(name => {
          const def = eventLabels.find(l => l.name === name);
          return def ? !!def.recur : false;
        });
        const hasSkipProp = extractedLabels.some(name => {
          const def = eventLabels.find(l => l.name === name);
          return def ? !!def.skip : false;
        });

        setItemCalendar(
          targetItem.calendar !== undefined ? !!targetItem.calendar : (extractedLabels.length > 0 ? hasCalendarProp : true)
        );
        setItemForward(
          targetItem.forward !== undefined ? !!targetItem.forward : hasForwardProp
        );
        setItemPeriod(
          targetItem.period !== undefined ? !!targetItem.period : hasPeriodProp
        );
        setItemRecur(
          targetItem.recur !== undefined ? !!targetItem.recur : hasRecurProp
        );
        setItemSkip(
          targetItem.skip !== undefined ? !!targetItem.skip : hasSkipProp
        );
      }
    }
  }, [isOpen, initialData, currentItem, type, eventLabels]);

  if (!isOpen) return null;

  /**
   * '기간'을 켜면 날짜부터 고르게 한다.
   *
   * 켜 두기만 하면 그 하루에 표시만 남고 여러 날짜에 일정이 생기지 않는다.
   * 팝업을 열 때 이미 켜져 있던 것에는 뜨지 않는다 - 사용자가 직접 켠 순간에만 지난다.
   */
  const turnItemPeriod = (on: boolean) => {
    setItemPeriod(on);
    if (on && type === 'event') setPeriodModalOpen(true);
  };

  const toggleLabel = (labelName: string) => {
    touchedRef.current = true;
    // 기간 라벨을 새로 붙이는 것도 '기간을 켠 것'이다.
    const picked = eventLabels.find(l => l.name === labelName);
    if (!labels.includes(labelName) && picked?.period && type === 'event') setPeriodModalOpen(true);

    setLabels(prev => {
      const willSelect = !prev.includes(labelName);
      const next = willSelect
        ? [...prev, labelName]
        : prev.filter(l => l !== labelName);

      // 새로 라벨이 선택되면 해당 라벨의 기본 속성값 자동 연동
      if (willSelect) {
        const targetLabelDef = eventLabels.find(l => l.name === labelName);
        if (targetLabelDef) {
          setItemCalendar(targetLabelDef.calendar !== false);
          setItemForward(!!(targetLabelDef.forward || (targetLabelDef as any).isForward));
          setItemPeriod(!!targetLabelDef.period);
          setItemRecur(!!targetLabelDef.recur);
          setItemSkip(!!targetLabelDef.skip);
        }
      } else if (next.length === 0) {
        // 라벨이 모두 해제된 경우 속성 기본값 초기화
        setItemCalendar(false);
        setItemForward(false);
        setItemPeriod(false);
        setItemRecur(false);
        setItemSkip(false);
      }
      return next;
    });
  };

  /** 저장한다. 성공하면 true (배경 클릭 저장이 닫아도 되는지 이것으로 안다) */
  const handleSave = async (): Promise<boolean> => {
    try {
      setSaving(true);
      if (type === 'schedule') {
        // 교과 모드만 '5-2 과학' 한 모양으로 (lib/teachingSlot). 초등 담임은 적은 그대로
        const savedSubject = isClassUnit ? normalizeSlotText(subject) : subject;
        await savePeriod(Number(itemId), {
          // 열 때 받은 값이 아니라 지금 값 위에 (그 사이 붙은 링크 등을 옛 값으로 덮지 않게)
          ...((currentItem as any) || initialData),
          subject: savedSubject,
          memo: content,
          content,
          supplies,
          imageUrl,
        });
        // 저장한 모양을 칸에도 (적은 '403과학'이 아니라 저장된 '4-3 과학'). 저장 중 들어온 구독 값은 고치는 중이라 건너뛰었다.
        setSubject(savedSubject);
      } else {
        await updateEventItem(String(itemId), {
          content,
          label: labels.join(','),
          imageUrl,
          calendar: itemCalendar,
          forward: itemForward,
          period: itemPeriod,
          recur: itemRecur,
          skip: itemSkip,
        });
      }
      showToast('✅ 저장되었습니다.');
      touchedRef.current = false;
      return true;
    } catch (err) {
      showErrorToastOnce('저장하지 못했습니다. 창을 닫지 않았으니 다시 저장해 주세요.', err);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // 배경을 누르면: 고친 것이 없으면 그냥 닫고, 있으면 저장한 뒤 닫는다.
  // 저장이 실패하면 닫지 않는다 (적던 것이 사라지면 안 된다).
  // 닫기 단추와 ESC는 지금처럼 '저장 없이 닫기'다.
  backdropCloseRef.current = async () => {
    if (touchedRef.current && !saving) {
      const ok = await handleSave();
      if (!ok) return;
    }
    closeAllModals();
  };

  // 확인창 대신 바로 지우고, 되돌릴 수 있다는 안내를 토스트로 알린다.
  // 다만 기간·반복으로 묶인 일정은 어디까지 지울지 먼저 묻는다.
  const handleDelete = async () => {
    if (type === 'event' && groupIdOf(currentItem || initialData)) {
      setGroupDeleteOpen(true);
      return;
    }
    try {
      setSaving(true);
      if (type === 'schedule') {
        await savePeriod(Number(itemId), {
          subject: '',
          content: '',
          memo: '',
          supplies: '',
          imageUrl: '',
          linkedItems: [],
        });
        showToast(`🗑️ ${itemId}교시 수업 내용을 비웠습니다.`);
      } else {
        const trashId = await deleteEventItem(String(itemId), initialData);
        showDeletedToast('🗑️ 일정을 삭제했습니다. 휴지통에서 복원할 수 있습니다.', trashId);
      }
      onClose();
    } catch (err) {
      showErrorToastOnce('삭제에 실패했습니다.', err);
    } finally {
      setSaving(false);
    }
  };

  const title = type === 'schedule' ? `${itemId}교시 수정` : '일정 수정';

  return (
    <>
<PopupFrame
  isOpen={isOpen}
  onClose={onClose}
  width="md"
  onBackdropClose={() => backdropCloseRef.current()}
  // Ctrl+S = 저장 단추
  onSave={() => { if (!saving) void handleSave(); }}
>
<div className="contents" onInputCapture={() => { touchedRef.current = true; }}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h2 className="text-lg font-black text-slate-800">{title}</h2>
          <div className="flex items-center gap-2">
            <button
            title="닫기"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 font-bold transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 flex-1 min-h-0 overflow-y-auto overscroll-contain" data-scroll-lock>
          {/* Action Buttons - 편집 화면에서도 항상 보인다 */}
          <div className="flex flex-wrap gap-2 mb-5 pb-5 border-b border-slate-100">
              {type === 'schedule' && (
                <>
                  <button
                    type="button"
                    onClick={() => openEvaluationModal(dateStr, 'schedule', Number(itemId), subject)}
                    className="px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    📊 조사표 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => openLinkerModal('schedule', dateStr, undefined, Number(itemId))}
                    className="px-3 py-1.5 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    🔗 링크 추가
                  </button>
                  {currentLinkedItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { openLinkViewerModal('schedule', dateStr, String(itemId), Number(itemId)); }}
                      className="px-3 py-1.5 bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      📑 연결된 링크 ({currentLinkedItems.length})
                    </button>
                  )}
                  {/* 이 교시에 진도가 없으면 그 과목으로 진도 만들기 (19번 U3, 개인 공간만) */}
                  {!progressMark && !targetGroupId && <ProgressCreateButton subject={subject} />}
                </>
              )}
              {type === 'event' && (
                <>
                  <button
                    type="button"
                    onClick={() => setAlarmModalOpen(true)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                      currentEvent?.time
                        ? currentEvent?.alarmTriggered
                          ? 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          : 'bg-blue-50 text-primary hover:bg-blue-100'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    ⏰ {currentEvent?.time ? formatAlarmBadge(currentEvent.time) : '알림 추가'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openLinkerModal('event', dateStr, String(itemId))}
                    className="px-3 py-1.5 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    🔗 링크 추가
                  </button>
                  {currentLinkedItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { openLinkViewerModal('event', dateStr, String(itemId)); }}
                      className="px-3 py-1.5 bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      📑 연결된 링크 ({currentLinkedItems.length})
                    </button>
                  )}
                </>
              )}
            </div>

            {progressMark && (
              <div className="mb-4">
                <ProgressMarkLine mark={progressMark} dateStr={dateStr} period={Number(itemId)} alwaysShowAction />
              </div>
            )}

            <div className="flex flex-col gap-4">
              {type === 'schedule' && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">{isClassUnit ? '학년-반 · 과목' : '과목'}</label>
                    {isClassUnit ? (
                      // 전담: 학년-반 + 과목 두 칸 (2026-10-07)
                      <SlotPairInput
                        value={subject}
                        onValueChange={setSubject}
                        classOptions={pairOptions.classes}
                        subjectOptions={pairOptions.subjects}
                        inputClassName="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                    ) : (
                      <input
                        type="text"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="과목"
                        aria-label="과목"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">비고 / 준비물</label>
                    <input
                      type="text"
                      value={supplies}
                      onChange={(e) => setSupplies(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                </>
              )}
              {type === 'event' && (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-bold text-slate-500">라벨 (다중 선택 가능)</label>
                      <button
                        type="button"
                        onClick={() => openLabelModal('event')}
                        className="text-xs text-primary hover:text-blue-700 font-bold flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer"
                        title="더보기 - 통합 라벨 관리 열기"
                      >
                        <span>⚙️</span>
                        <span>라벨 수정</span>
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {eventLabels.map(l => {
                        const isSelected = labels.includes(l.name);
                        return (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => toggleLabel(l.name)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                              isSelected 
                                ? 'bg-primary text-white border-primary shadow-xs' 
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            {l.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 💡 개별 일정 맞춤 5대 속성 체크박스 */}
                  <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl space-y-1.5">
                    <label className="block text-xs font-bold text-slate-600">
                      속성 설정 <span className="text-xs font-normal text-slate-400">(개별 일정 맞춤 조정)</span>
                    </label>
                    <div className="flex items-center gap-3.5 pt-0.5 text-xs font-medium text-slate-700 flex-wrap">
                      <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900" title="월간/년간 달력에 표시">
                        <input
                          type="checkbox"
                          checked={itemCalendar}
                          onChange={(e) => setItemCalendar(e.target.checked)}
                          className="rounded text-blue-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span className="font-semibold text-xs">달력</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900" title="미완료 시 다음 날로 자동 이월">
                        <input
                          type="checkbox"
                          checked={itemForward}
                          onChange={(e) => setItemForward(e.target.checked)}
                          className="rounded text-emerald-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span className="font-semibold text-xs">이월</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900" title="연속 기간 등록">
                        <input
                          type="checkbox"
                          checked={itemPeriod}
                          onChange={(e) => turnItemPeriod(e.target.checked)}
                          className="rounded text-indigo-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span className="font-semibold text-xs">기간</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900" title="매주/매월 반복">
                        <input
                          type="checkbox"
                          checked={itemRecur}
                          onChange={(e) => setItemRecur(e.target.checked)}
                          className="rounded text-purple-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span className="font-semibold text-xs">반복</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900" title="지정 날짜의 수업 과목 비움">
                        <input
                          type="checkbox"
                          checked={itemSkip}
                          onChange={(e) => setItemSkip(e.target.checked)}
                          className="rounded text-amber-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span className="font-semibold text-xs">수업X</span>
                      </label>
                    </div>
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">
                  {type === 'schedule' ? '수업 메모' : '일정 내용'}
                </label>
                <AutoTextarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full min-h-[68px] px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

            </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50">
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="px-4 py-2 text-xs font-bold text-red-500 hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
            >
              삭제
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors"
              >
                닫기
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-xs font-bold text-white bg-primary hover:bg-blue-600 rounded-xl shadow-xs transition-colors"
              >
                {saving ? '저장 중...' : '저장 완료'}
              </button>
            </div>
          </div>
      </div>
</PopupFrame>

      {type === 'event' && alarmModalOpen && (
        <EventAlarmModal
          isOpen={true}
          onClose={() => setAlarmModalOpen(false)}
          dateStr={dateStr}
          initialTime={currentEvent?.time}
          onSave={async (time) => {
            await updateEventItem(String(itemId), { time, alarmTriggered: false });
          }}
          onTurnOff={async () => {
            await updateEventItem(String(itemId), { time: '', alarmTriggered: false });
          }}
        />
      )}

      {/* 기간 설정. 정하지 않고 닫으면 '기간'도 다시 꺼진다. */}
      {type === 'event' && periodModalOpen && (
        <PeriodModal
          isOpen
          startDate={dateStr}
          defaultContent={baseContentOf(content)}
          labels={labels}
          attrs={{ calendar: itemCalendar, forward: itemForward, skip: itemSkip }}
          // 고치던 한 건을 치우는 일은 팝업이 같은 일괄 쓰기 안에서 한다
          // (따로 지우면 방금 만든 첫날 일정까지 옛 목록에 덮여 사라진다)
          replace={{ dateStr, id: String(itemId) }}
          onClose={() => { setPeriodModalOpen(false); setItemPeriod(false); }}
          onRegistered={() => {
            setPeriodModalOpen(false);
            onClose();
          }}
        />
      )}

      {/* 기간·반복으로 묶인 일정을 지울 때: 이 날만 / 이 날부터 / 전부 */}
      {type === 'event' && groupDeleteOpen && (
        <GroupDeleteModal
          isOpen
          dateStr={dateStr}
          fId={targetGroupId || 'personal'}
          groupId={groupIdOf(currentItem || initialData) || ''}
          content={String((currentItem || initialData)?.content || '')}
          onDeleteThisOnly={async () => {
            const trashId = await deleteEventItem(String(itemId), initialData);
            showDeletedToast('🗑️ 일정을 삭제했습니다. 휴지통에서 복원할 수 있습니다.', trashId);
          }}
          onDeleted={onClose}
          onClose={() => setGroupDeleteOpen(false)}
        />
      )}
    </>
  );
}
