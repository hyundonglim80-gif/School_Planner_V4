import React, { useEffect, useRef, useState } from 'react';
import type { EventItem } from '../../hooks/useDayData';
import { useAppStore } from '../../store/useAppStore';
import { useLabels } from '../../hooks/useLabels';
import { showToast } from '../../utils/toast';
import { formatDateStr } from '../../lib/dateUtils';
import { resolveEventLabelNames, eventDisplayContent } from '../../lib/eventLabels';
import { useClickOutside } from '../../hooks/useClickOutside';
import EventAlarmModal from '../../components/EventAlarmModal';
import PeriodModal from '../../components/PeriodModal';
import AutoTextarea from '../../components/AutoTextarea';
import EventItemActions from '../../components/EventItemActions';

interface DayEventsProps {
  events: EventItem[];
  onAddEvent: (content: string, options?: Partial<EventItem>) => Promise<void>;
  onToggleEvent: (id: string) => Promise<void>;
  onDeleteEvent: (id: string) => Promise<void>;
  onUpdateEvent?: (id: string, updates: Partial<EventItem>) => Promise<void>;
  onForwardIncomplete?: () => Promise<number>;
  onReorderEvents?: (sourceIndex: number, targetIndex: number) => Promise<void>;
}

/** 라벨 목록이 같은가. 차례까지 같아야 같은 것으로 본다. */
const sameLabels = (a: string[], b: string[]) =>
  a.length === b.length && a.every((name, i) => name === b[i]);

export default function DayEvents({
  events,
  onAddEvent,
  onToggleEvent,
  onDeleteEvent,
  onUpdateEvent,
  onForwardIncomplete,
  onReorderEvents,
}: DayEventsProps) {
  const [newText, setNewText] = useState('');
  const [newLabels, setNewLabels] = useState<string[]>([]);
  // 새 일정의 개별 속성 (달력 / 이월 / 기간 / 반복 / 수업X)
  const [newCalendar, setNewCalendar] = useState(true);
  const [newForward, setNewForward] = useState(false);
  const [newPeriod, setNewPeriod] = useState(false);
  const [newRecur, setNewRecur] = useState(false);
  const [newSkip, setNewSkip] = useState(false);
  const [newLinkedItems, setNewLinkedItems] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const { openLinkerModal, openLinkViewerModal, openLabelModal, currentDate, isMultiSelectMode, selectedEventIds, toggleEventSelection } = useAppStore();
  const { eventLabels, getLabelColor, labelsLoaded } = useLabels();
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editLabel, setEditLabel] = useState<string | undefined>(undefined);
  const [editAlarmTime, setEditAlarmTime] = useState('');
  const [editAlarmDirty, setEditAlarmDirty] = useState(false);
  const [editAlarmModalOpen, setEditAlarmModalOpen] = useState(false);

  // 개별 일정 속성 (달력 / 이월 / 기간 / 반복 / 수업X)
  const [editCalendar, setEditCalendar] = useState(true);
  const [editForward, setEditForward] = useState(false);
  const [editPeriod, setEditPeriod] = useState(false);
  const [editRecur, setEditRecur] = useState(false);
  const [editSkip, setEditSkip] = useState(false);

  // 페이지의 다른 곳을 누르면 '닫기'와 같게 수정 섹션을 닫는다
  const editRef = useClickOutside<HTMLDivElement>(editingId !== null, () => setEditingId(null));

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  /**
   * 새 일정 칸.
   *
   * 저장해도 칸은 닫지 않는다 — 하루치를 연달아 적는 자리이기 때문이다.
   * 그런데 저장 단추를 누르면 그 단추가 잠깐 꺼지면서 초점이 몸통으로 달아난다.
   * 그러면 (1) 이어서 치려면 칸을 한 번 더 눌러야 하고 (2) ESC로 닫는 길이
   * 이 칸의 onKeyDown 하나뿐이라 ESC도 먹지 않는다. 저장한 뒤 초점을 돌려준다.
   */
  const newTextRef = useRef<HTMLTextAreaElement>(null);
  const [alarmTarget, setAlarmTarget] = useState<EventItem | null>(null);
  const [newAlarmTime, setNewAlarmTime] = useState('');
  const [newAlarmModalOpen, setNewAlarmModalOpen] = useState(false);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const formattedDate = formatDateStr(new Date(currentDate));

  /* '기간'을 켜면 곧바로 기간 설정 팝업을 띄운다 (V3와 같다).
     기간은 하루짜리 속성이 아니라 '언제부터 언제까지'를 정해야 뜻이 생긴다.
     V4에는 그 자리가 없어서, 체크해도 그날 하루에 표시만 남고 아무 일도
     일어나지 않았다. 체크상자와 기간 라벨 어느 쪽으로 켜도 여기서 받는다. */
  useEffect(() => {
    if (isFormOpen && newPeriod) setPeriodModalOpen(true);
  }, [isFormOpen, newPeriod]);

  /**
   * 새 일정을 열 때 미리 골라 둘 라벨. 통합 라벨 관리의 맨 위 하나다.
   *
   * 매번 손으로 고르게 하면 안 고른 채로 저장되기 쉽고, 그러면 그 일정은
   * 어느 갈래에도 걸리지 않는다. 마음에 안 들면 눌러서 뗄 수 있다.
   * 기록·메모도 같은 방식으로 맨 위 라벨을 골라 둔다.
   */
  const defaultNewLabels = () => (eventLabels[0]?.name ? [eventLabels[0].name] : []);

  /* 칸을 열 때와 라벨이 늦게 도착했을 때 맨 위 라벨을 골라 둔다.
     라벨은 구독으로 들어와서, 칸을 여는 순간에는 아직 비어 있을 수 있다.
     이미 손댄 뒤라면 건드리지 않는다 — 고르던 것을 덮어쓰게 된다. */
  useEffect(() => {
    if (!isFormOpen || newLabels.length > 0 || newText.trim()) return;
    const preset = defaultNewLabels();
    if (preset.length > 0) setNewLabels(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFormOpen, eventLabels]);

  /**
   * 새 일정 칸에 아직 아무것도 손대지 않았는가.
   *
   * 글자뿐 아니라 라벨·알림·링크와 단추들(달력·이월·기간·반복·수업X)까지 본다.
   * 라벨만 골라 두고 잠깐 다른 데를 눌렀는데 골라 둔 것이 사라지면, 잘못 누른
   * 한 번에 한 일이 날아간 셈이 된다.
   */
  const isNewFormUntouched =
    !newText.trim() &&
    // 미리 골라 둔 라벨은 사용자가 고른 것이 아니다. 그대로면 손대지 않은
    // 것으로 본다. (뗀 채로 비어 있는 것도 마찬가지)
    sameLabels(newLabels, defaultNewLabels()) &&
    !newAlarmTime &&
    newLinkedItems.length === 0 &&
    newCalendar && // 처음부터 켜져 있다
    !newForward &&
    !newPeriod &&
    !newRecur &&
    !newSkip;

  /* 열어만 두고 딴 데를 누르면 닫는다. 빈 칸이 남아 있으면 '일정을 적다 만
     것'처럼 보여서, 실제로는 아무것도 안 적었는데 계속 눈에 걸린다.
     적다 만 것이 있으면 그대로 둔다 ('취소'를 눌러야 닫힌다). */
  const addFormRef = useClickOutside<HTMLFormElement>(
    isFormOpen && isNewFormUntouched,
    () => setIsFormOpen(false)
  );

  const formatAlarmBadge = (time?: string) => {
    if (!time) return null;
    const d = new Date(time);
    if (isNaN(d.getTime())) return null;
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${h}:${min}`;
  };

  // 라벨 해석은 lib/eventLabels 한 곳에서만 한다. 화면마다 다르게 풀면 라벨 이름을
  // 바꿀 때 칩이 보이는 화면과 안 보이는 화면이 갈린다.
  const getEventLabelInfo = (event: EventItem) => {
    const names = resolveEventLabelNames(event, eventLabels, { keepUnknown: !labelsLoaded });
    return {
      names,
      labelDefs: names.map((name) => eventLabels.find((l) => l.name === name)),
      cleanContent: eventDisplayContent(event),
    };
  };

  // 라벨에 딸린 기본 속성. 개별 일정에 값이 없으면 이걸로 판단한다.
  // 라벨이 '이월'을 뜻하는가 (선택된 라벨 기준)
  const labelSaysForward = (names: string[]) =>
    labelPropOf(names, (d) => !!(d.forward || d.isForward));

  /** 화면에 켜진 것으로 보여야 하는가 — isForwardTarget과 같은 순서로 판단한다 */
  const forwardStateOf = (event: any, names: string[]) => {
    if (event?.forwardOptOut === true) return false;
    if (event?.forward === true) return true;
    return labelSaysForward(names);
  };

  /**
   * 이월 토글을 저장할 모양으로 바꾼다.
   *
   * 끈 상태를 forward: false로 적어 두면 안 된다. 라벨 정의를 아직 못 읽은
   * 채로 일정을 만들면 이월 라벨을 골라도 토글이 꺼진 채 저장되어, 그 일정은
   * 영영 이월되지 않는다. 실제로 그 일로 며칠치 일정이 통째로 멈췄다.
   * 그래서 '끈다'는 뜻은 사용자가 이월 라벨을 달고도 일부러 끈 경우에만,
   * forwardOptOut으로 분명하게 남긴다.
   */
  const forwardFieldsFor = (on: boolean, names: string[]) => {
    if (on) return { forward: true, forwardOptOut: false };
    // 끈 상태에서 '이월하지 않겠다'고 단정할 수 있는 건, 붙은 라벨이 이월
    // 라벨인 줄 알면서도 껐을 때뿐이다. 라벨을 아직 모르면 forward: false만
    // 남는데, 이 값은 더 이상 이월을 막지 않으므로 나중에 라벨이 읽히면
    // 그때 라벨이 제대로 판단한다.
    return labelSaysForward(names)
      ? { forwardOptOut: true }
      : { forward: false, forwardOptOut: false };
  };

  const labelPropOf = (names: string[], pick: (def: any) => boolean) =>
    names.some((name) => {
      const def = eventLabels.find((l) => l.name === name);
      return def ? pick(def) : false;
    });

  const startEditing = (event: EventItem) => {
    const info = getEventLabelInfo(event);
    setEditingId(event.id);
    setEditText(info.cleanContent);
    setEditLabel(info.names.length > 0 ? info.names.join(',') : undefined);
    setEditAlarmTime(event.time || '');
    setEditAlarmDirty(false);

    // 라벨이 아예 없는 일반 일정은 기본적으로 '달력' 속성을 켠다.
    setEditCalendar(
      event.calendar !== undefined
        ? !!event.calendar
        : info.names.length > 0
        ? labelPropOf(info.names, (d) => d.calendar !== false)
        : true
    );
    // 이월 여부를 푸는 규칙은 실제 이월 엔진(lib/forwarding의 isForwardTarget)과
    // 같아야 한다. 예전에는 저장된 forward를 먼저 봤는데, 라벨을 못 읽던 때 만든
    // 일정에는 forward: false가 굳어 있어 실제로는 이월되는 일정이 화면에서는
    // 꺼진 것으로 보였다.
    setEditForward(forwardStateOf(event, info.names));
    setEditPeriod(event.period !== undefined ? !!event.period : labelPropOf(info.names, (d) => !!d.period));
    setEditRecur(event.recur !== undefined ? !!event.recur : labelPropOf(info.names, (d) => !!d.recur));
    setEditSkip(event.skip !== undefined ? !!event.skip : labelPropOf(info.names, (d) => !!d.skip));
  };

  const saveEditing = async (id: string) => {
    if (!editText.trim()) {
      await onDeleteEvent(id);
      setEditingId(null);
      showToast('🗑️ 일정을 삭제했습니다. 휴지통에서 복원할 수 있습니다.');
      return;
    }
    if (onUpdateEvent) {
      await onUpdateEvent(id, {
        content: editText.trim(),
        label: editLabel || undefined,
        calendar: editCalendar,
        ...forwardFieldsFor(editForward, editLabel ? editLabel.split(',') : []),
        period: editPeriod,
        recur: editRecur,
        skip: editSkip,
        // 💡 알림을 실제로 건드린 경우에만 time/alarmTriggered를 갱신 (건드리지 않았다면
        // 기존 알림 상태 - 특히 이미 확인 처리된 alarmTriggered - 를 그대로 보존한다)
        ...(editAlarmDirty ? { time: editAlarmTime || '', alarmTriggered: false } : {}),
      });
    }
    setEditingId(null);
    showToast('✅ 일정을 저장했습니다.');
  };

  const deleteEditing = async (id: string) => {
    await onDeleteEvent(id);
    setEditingId(null);
    showToast('🗑️ 일정을 삭제했습니다. 휴지통에서 복원할 수 있습니다.');
  };

  const handleEditLabelToggle = (labelName: string) => {
    setEditLabel(prev => {
      const currentLabels = prev ? prev.split(',').filter(Boolean) : [];
      const willSelect = !currentLabels.includes(labelName);

      // 라벨을 새로 고르면 그 라벨의 기본 속성을 그대로 따라간다 ('일정 수정' 팝업과 동일)
      if (willSelect) {
        const def = eventLabels.find((l) => l.name === labelName);
        if (def) {
          setEditCalendar(def.calendar !== false);
          setEditForward(!!(def.forward || (def as any).isForward));
          setEditPeriod(!!def.period);
          setEditRecur(!!def.recur);
          setEditSkip(!!def.skip);
        }
        return [...currentLabels, labelName].join(',');
      }

      const next = currentLabels.filter(l => l !== labelName);
      if (next.length === 0) {
        setEditCalendar(false);
        setEditForward(false);
        setEditPeriod(false);
        setEditRecur(false);
        setEditSkip(false);
      }
      return next.length > 0 ? next.join(',') : undefined;
    });
  };

  /** 새 일정 칸을 처음 상태로 되돌린다 */
  const resetNewForm = () => {
    setNewText('');
    setNewLabels(defaultNewLabels());
    setNewLinkedItems([]);
    setNewAlarmTime('');
    setNewCalendar(true);
    setNewForward(false);
    setNewPeriod(false);
    setNewRecur(false);
    setNewSkip(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;
    try {
      setSubmitting(true);
      const labelStr = newLabels.length > 0 ? newLabels.join(',') : undefined;
      await onAddEvent(newText.trim(), {
        label: labelStr,
        linkedItems: newLinkedItems,
        time: newAlarmTime || undefined,
        calendar: newCalendar,
        ...forwardFieldsFor(newForward, newLabels),
        period: newPeriod,
        recur: newRecur,
        skip: newSkip,
      });
      resetNewForm();
      // 이어서 바로 칠 수 있게, 그리고 ESC가 다시 먹게 초점을 돌려준다
      newTextRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  // 수정 폼과 같이, 라벨을 새로 고르면 그 라벨의 기본 속성을 그대로 따라간다.
  const handleLabelToggle = (labelName: string) => {
    setNewLabels(prev => {
      if (prev.includes(labelName)) {
        const next = prev.filter(l => l !== labelName);
        if (next.length === 0) {
          setNewCalendar(false);
          setNewForward(false);
          setNewPeriod(false);
          setNewRecur(false);
          setNewSkip(false);
        }
        return next;
      }
      const def = eventLabels.find((l) => l.name === labelName);
      if (def) {
        setNewCalendar(def.calendar !== false);
        setNewForward(!!(def.forward || (def as any).isForward));
        setNewPeriod(!!def.period);
        setNewRecur(!!def.recur);
        setNewSkip(!!def.skip);
      }
      return [...prev, labelName];
    });
  };

  const openLinker = () => {
    openLinkerModal('manual', formattedDate, undefined, undefined, (links) => {
      setNewLinkedItems(prev => [...prev, ...links]);
    });
  };

  return (
    <>
    <div className={`bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 flex flex-col ${isCollapsed ? '' : 'h-full'}`}>
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${isCollapsed ? '' : 'mb-4'}`}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-slate-400 hover:text-slate-700 text-xs px-1 py-0.5 rounded hover:bg-slate-100 transition-colors"
            title={isCollapsed ? '펼치기' : '접기'}
          >
            {isCollapsed ? '▶' : '▼'}
          </button>
          <span className="text-xl">📅</span>
          <h3 className="text-base font-extrabold text-slate-800">일정</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {events.length}
          </span>
        </div>
        
        {!isCollapsed && !isFormOpen && (
          <button
            onClick={() => setIsFormOpen(true)}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
          >
            + 새 일정
          </button>
        )}
      </div>

      {!isCollapsed && (
        <>
      {/* 새 일정 추가 - '일정 수정'과 같은 구성으로 맞춘다 */}
      {isFormOpen && (
        <form
          ref={addFormRef}
          onSubmit={handleSubmit}
          className="p-3.5 mb-4 rounded-xl border border-primary/50 bg-blue-50/30 flex flex-col gap-3 shadow-xs"
        >
          {/* 버튼 줄 */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setNewAlarmModalOpen(true)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                newAlarmTime
                  ? 'text-primary bg-blue-50 hover:bg-blue-100'
                  : 'text-slate-600 bg-slate-100 hover:bg-slate-200'
              }`}
            >
              ⏰ {newAlarmTime ? formatAlarmBadge(newAlarmTime) : '알림 추가'}
            </button>
            <button
              type="button"
              onClick={openLinker}
              className="px-3 py-1.5 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              🔗 링크 추가
            </button>
            {newLinkedItems.length > 0 && (
              <span className="px-3 py-1.5 bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold flex items-center gap-1.5">
                📑 연결된 링크 ({newLinkedItems.length})
              </span>
            )}
          </div>

          {/* 라벨 (다중 선택 가능) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-slate-500">라벨 (다중 선택 가능)</span>
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
            <div className="flex flex-wrap items-center gap-1.5">
              {eventLabels.map((l) => {
                const isSelected = newLabels.includes(l.name);
                const c = getLabelColor(l.name);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => handleLabelToggle(l.name)}
                    aria-pressed={isSelected}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all border ${isSelected ? 'ring-2 ring-primary ring-offset-1 shadow-xs' : 'opacity-70 hover:opacity-100 bg-white text-slate-600 border-slate-200'}`}
                    style={isSelected ? { backgroundColor: c.bg, color: c.text, borderColor: c.border } : {}}
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 개별 일정 맞춤 5대 속성 */}
          <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl space-y-1.5">
            <span className="block text-xs font-bold text-slate-600">
              속성 설정 <span className="text-xs font-normal text-slate-400">(개별 일정 맞춤 조정)</span>
            </span>
            <div className="flex items-center gap-3.5 pt-0.5 text-xs font-medium text-slate-700 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900" title="월간/년간 달력에 표시">
                <input type="checkbox" checked={newCalendar} onChange={(e) => setNewCalendar(e.target.checked)} className="rounded text-blue-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer" />
                <span className="font-semibold text-xs">달력</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900" title="미완료 시 다음 날로 자동 이월">
                <input type="checkbox" checked={newForward} onChange={(e) => setNewForward(e.target.checked)} className="rounded text-emerald-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer" />
                <span className="font-semibold text-xs">이월</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900" title="연속 기간 등록">
                <input type="checkbox" checked={newPeriod} onChange={(e) => setNewPeriod(e.target.checked)} className="rounded text-indigo-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer" />
                <span className="font-semibold text-xs">기간</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900" title="매주/매월 반복">
                <input type="checkbox" checked={newRecur} onChange={(e) => setNewRecur(e.target.checked)} className="rounded text-purple-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer" />
                <span className="font-semibold text-xs">반복</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900" title="지정 날짜의 수업 과목 비움">
                <input type="checkbox" checked={newSkip} onChange={(e) => setNewSkip(e.target.checked)} className="rounded text-amber-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer" />
                <span className="font-semibold text-xs">수업X</span>
              </label>
            </div>
          </div>

          {/* 일정 내용 */}
          <div>
            <span className="block text-xs font-bold text-slate-500 mb-1">일정 내용</span>
            <AutoTextarea
              ref={newTextRef}
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setIsFormOpen(false);
                if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
                  e.preventDefault();
                  handleSubmit(e as any);
                }
              }}
              placeholder="새로운 일정을 입력하세요..."
              className="w-full min-h-[52px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder-slate-400"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setIsFormOpen(false); setNewAlarmTime(''); }}
              className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 transition-colors"
            >
              닫기
            </button>
            <button
              type="submit"
              disabled={!newText.trim() || submitting}
              className="px-4 py-1.5 bg-primary hover:bg-blue-600 disabled:opacity-40 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
            >
              저장
            </button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[110px]">
        {events.length > 0 ? (
          events.map((event, idx) => {
            const isEditing = editingId === event.id;
            const info = getEventLabelInfo(event);

            if (isEditing) {
              const currentEditLabels = editLabel ? editLabel.split(',').filter(Boolean) : [];
              return (
                <div
                  key={event.id}
                  ref={editRef}
                  className="p-3.5 rounded-xl border border-primary/50 bg-blue-50/30 flex flex-col gap-3 shadow-xs transition-all"
                >
                  {/* 버튼 줄 - '일정 수정' 팝업과 같은 구성 */}
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditAlarmModalOpen(true)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                        editAlarmTime
                          ? 'text-primary bg-blue-50 hover:bg-blue-100'
                          : 'text-slate-600 bg-slate-100 hover:bg-slate-200'
                      }`}
                    >
                      ⏰ {editAlarmTime ? formatAlarmBadge(editAlarmTime) : '알림 추가'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openLinkerModal('event', formattedDate, event.id)}
                      className="px-3 py-1.5 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      🔗 링크 추가
                    </button>
                    {(event.linkedItems || []).length > 0 && (
                      <button
                        type="button"
                        onClick={() => openLinkViewerModal('event', formattedDate, event.id)}
                        className="px-3 py-1.5 bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        📑 연결된 링크 ({(event.linkedItems || []).length})
                      </button>
                    )}
                  </div>

                  {/* 라벨 (다중 선택 가능) */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-slate-500">라벨 (다중 선택 가능)</span>
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
                    <div className="flex flex-wrap items-center gap-1.5">
                      {eventLabels.map((l) => {
                        const isSelected = currentEditLabels.includes(l.name);
                        const c = getLabelColor(l.name);
                        return (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => handleEditLabelToggle(l.name)}
                            className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all border ${isSelected ? 'ring-2 ring-primary ring-offset-1 shadow-xs' : 'opacity-70 hover:opacity-100 bg-white text-slate-600 border-slate-200'}`}
                            style={isSelected ? { backgroundColor: c.bg, color: c.text, borderColor: c.border } : {}}
                          >
                            {l.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 개별 일정 맞춤 5대 속성 */}
                  <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl space-y-1.5">
                    <span className="block text-xs font-bold text-slate-600">
                      속성 설정 <span className="text-xs font-normal text-slate-400">(개별 일정 맞춤 조정)</span>
                    </span>
                    <div className="flex items-center gap-3.5 pt-0.5 text-xs font-medium text-slate-700 flex-wrap">
                      <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900" title="월간/년간 달력에 표시">
                        <input type="checkbox" checked={editCalendar} onChange={(e) => setEditCalendar(e.target.checked)} className="rounded text-blue-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer" />
                        <span className="font-semibold text-xs">달력</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900" title="미완료 시 다음 날로 자동 이월">
                        <input type="checkbox" checked={editForward} onChange={(e) => setEditForward(e.target.checked)} className="rounded text-emerald-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer" />
                        <span className="font-semibold text-xs">이월</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900" title="연속 기간 등록">
                        <input type="checkbox" checked={editPeriod} onChange={(e) => setEditPeriod(e.target.checked)} className="rounded text-indigo-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer" />
                        <span className="font-semibold text-xs">기간</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900" title="매주/매월 반복">
                        <input type="checkbox" checked={editRecur} onChange={(e) => setEditRecur(e.target.checked)} className="rounded text-purple-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer" />
                        <span className="font-semibold text-xs">반복</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900" title="지정 날짜의 수업 과목 비움">
                        <input type="checkbox" checked={editSkip} onChange={(e) => setEditSkip(e.target.checked)} className="rounded text-amber-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer" />
                        <span className="font-semibold text-xs">수업X</span>
                      </label>
                    </div>
                  </div>

                  {/* 일정 내용 */}
                  <div>
                    <span className="block text-xs font-bold text-slate-500 mb-1">일정 내용</span>
                    <AutoTextarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditingId(null);
                        if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
                          e.preventDefault();
                          saveEditing(event.id);
                        }
                      }}
                      className="w-full min-h-[52px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      autoFocus
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => deleteEditing(event.id)}
                      className="px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
                    >
                      삭제
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 transition-colors"
                      >
                        닫기
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEditing(event.id)}
                        className="px-4 py-1.5 bg-primary text-white text-xs font-bold rounded-xl hover:bg-blue-600 transition-colors shadow-xs"
                      >
                        저장 완료
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={event.id}
                onClick={() => {
                  if (isMultiSelectMode) toggleEventSelection(event.id, formattedDate);
                  else startEditing(event);
                }}
                title={isMultiSelectMode ? '' : '클릭하여 수정'}
                className={`group flex items-start justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                  isMultiSelectMode ? 'hover:bg-slate-50' : ''
                } ${
                  selectedEventIds.includes(event.id)
                    ? 'border-primary ring-1 ring-primary bg-primary/5'
                    : event.completed
                    ? 'bg-slate-50 border-slate-100 text-slate-400'
                    : 'bg-white border-slate-200/60 hover:border-slate-300 text-slate-800'
                }`}
              >
                <div className="flex-1 min-w-0 pointer-events-auto flex items-start">
                  {!isMultiSelectMode && (
                    <div className="flex flex-col items-center gap-0.5 shrink-0 px-0.5 mr-1.5 mt-0.5">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); if (idx > 0 && onReorderEvents) onReorderEvents(idx, idx - 1); }}
                        disabled={idx === 0}
                        className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-xs"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); if (idx < events.length - 1 && onReorderEvents) onReorderEvents(idx, idx + 1); }}
                        disabled={idx === events.length - 1}
                        className="text-slate-300 hover:text-primary disabled:opacity-30 disabled:hover:text-slate-300 p-0.5 leading-none text-xs"
                      >
                        ▼
                      </button>
                    </div>
                  )}

                  <div className="leading-relaxed text-sm break-words flex-1">
                    {isMultiSelectMode && (
                      <input
                        type="checkbox"
                        checked={selectedEventIds.includes(event.id)}
                        readOnly
                        className="inline-block align-middle mr-1.5 pointer-events-none w-4 h-4 rounded text-primary border-slate-300"
                      />
                    )}

                    {/* 라벨 칩 (유효한 라벨만 렌더링): 클릭 시 완료 처리 (이월 속성 라벨이면 이월도 정지) */}
                    {info.names.length > 0 && info.names.map((name, i) => {
                      const color = getLabelColor(name);
                      const def = info.labelDefs[i];
                      const isForward = !!(def && (def.forward || (def as any).isForward));
                      return (
                        <span
                          key={name}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isMultiSelectMode) onToggleEvent(event.id);
                          }}
                          title={isMultiSelectMode ? '' : (isForward ? '클릭하여 완료 처리 (이월 정지)' : '클릭하여 완료 처리')}
                          className={`inline-block align-middle mr-1.5 text-xs font-bold px-2 py-0.5 rounded-md shadow-2xs whitespace-nowrap ${isMultiSelectMode ? '' : 'cursor-pointer'}`}
                          style={{
                            backgroundColor: event.completed ? '#f1f5f9' : color.bg,
                            color: event.completed ? '#94a3b8' : color.text,
                            border: '1px solid ' + (event.completed ? '#e2e8f0' : color.border)
                          }}
                        >
                          {name}
                        </span>
                      );
                    })}

                    {/* 일정 알림(⏰): 알림이 설정된 일정에만 표시 (없는 일정까지 아이콘이 보이면
                        전부 알림이 걸린 것처럼 헷갈리므로, 알림 추가는 새 일정/수정 폼의 버튼으로) */}
                    {!isMultiSelectMode && event.time && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setAlarmTarget(event); }}
                        title="클릭하여 알림 시간 변경"
                        className={`inline-flex items-center align-middle mr-1.5 text-xs font-bold px-1.5 py-0.5 rounded-md border transition-colors cursor-pointer ${
                          event.alarmTriggered
                            ? 'text-slate-400 bg-slate-100 border-slate-200'
                            : 'text-primary bg-blue-50 border-blue-200'
                        }`}
                      >
                        ⏰ {formatAlarmBadge(event.time)}
                      </button>
                    )}

                    {/* 본문 텍스트: 항목을 클릭하면 이 자리에서 바로 수정한다 */}
                    <span
                      className={`inline align-middle ${
                        event.completed ? 'line-through text-slate-400' : ''
                      }`}
                    >
                      {info.cleanContent}
                    </span>

                    {/* 연결된 링크 */}
                    {event.linkedItems && event.linkedItems.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openLinkViewerModal('event', formattedDate, event.id); }}
                        className="inline-flex align-middle ml-1 bg-yellow-100 text-yellow-800 text-xs px-1.5 py-0.5 rounded font-bold border border-yellow-300 hover:bg-yellow-200 transition-colors cursor-pointer items-center gap-1"
                        title={`링크된 항목 ${event.linkedItems.length}개`}
                      >
                        🔗 {event.linkedItems.length}
                      </button>
                    )}

                    {/* 첨부파일 블록 */}
                    {event.attachments && event.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5 block">
                        {event.attachments.map((att, idx) => (
                          att.type === 'image' ? (
                            <a key={idx} href={att.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="block w-8 h-8 rounded overflow-hidden border border-slate-200">
                              <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                            </a>
                          ) : (
                            <a key={idx} href={att.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="block px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 truncate max-w-[150px] hover:bg-slate-100 transition-colors" title={att.name}>
                              📎 {att.name}
                            </a>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {!isMultiSelectMode && (
                  <EventItemActions
                    onEdit={() => startEditing(event)}
                    onDelete={() => deleteEditing(event.id)}
                  />
                )}
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center text-slate-400 text-xs">
            <span className="text-3xl mb-2">📋</span>
            <p>오늘의 일정이 없습니다.</p>
            <p className="mt-1 text-slate-400">+ 새 일정 버튼을 눌러 추가해보세요.</p>
          </div>
        )}
      </div>
        </>
      )}
    </div>

    {alarmTarget && (
      <EventAlarmModal
        isOpen={true}
        onClose={() => setAlarmTarget(null)}
        dateStr={formattedDate}
        initialTime={alarmTarget.time}
        onSave={async (time) => {
          if (onUpdateEvent) await onUpdateEvent(alarmTarget.id, { time, alarmTriggered: false });
        }}
        onTurnOff={async () => {
          if (onUpdateEvent) await onUpdateEvent(alarmTarget.id, { time: '', alarmTriggered: false });
        }}
      />
    )}

    {newAlarmModalOpen && (
      <EventAlarmModal
        isOpen={true}
        onClose={() => setNewAlarmModalOpen(false)}
        dateStr={formattedDate}
        initialTime={newAlarmTime}
        onSave={(time) => setNewAlarmTime(time)}
        onTurnOff={() => setNewAlarmTime('')}
      />
    )}

    {/* 기간 설정. 닫기만 하면 '기간'은 다시 꺼진다 - 기간을 안 정한 채로 켜져 있으면
        하루짜리 일정에 쓸모없는 표시만 남는다 (V3도 취소하면 되돌린다). */}
    {periodModalOpen && (
      <PeriodModal
        isOpen
        startDate={formattedDate}
        defaultContent={newText.trim()}
        labels={newLabels}
        attrs={{ calendar: newCalendar, forward: newForward, skip: newSkip }}
        onClose={() => { setPeriodModalOpen(false); setNewPeriod(false); }}
        onRegistered={() => {
          setPeriodModalOpen(false);
          resetNewForm();
          setIsFormOpen(false);
        }}
      />
    )}

    {editAlarmModalOpen && editingId && (
      <EventAlarmModal
        isOpen={true}
        onClose={() => setEditAlarmModalOpen(false)}
        dateStr={formattedDate}
        initialTime={editAlarmTime}
        onSave={(time) => { setEditAlarmTime(time); setEditAlarmDirty(true); }}
        onTurnOff={() => { setEditAlarmTime(''); setEditAlarmDirty(true); }}
      />
    )}
    </>
  );
}