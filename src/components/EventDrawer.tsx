// src/components/EventDrawer.tsx
//
// 일정을 쓰는 오른쪽 칸. 메모·기록 칸(EntryDrawer)과 같은 자리에 같은 방식으로 뜬다.
//
// 예전에는 일정을 쓰는 자리가 화면마다 달랐다. 하루 화면은 목록 안에서 펼쳐지는 칸,
// 주간·월간·년간은 화면을 덮는 '일정 수정' 팝업과 '빠른 추가' 팝업. 팝업은 뒤를
// 가려서 다른 날짜의 일정을 보며 적을 수 없었고, 셋의 구성·저장 규칙이 조금씩 달랐다.
// 이제 어느 화면에서든 이 칸 하나로 새로 쓰고 고친다.
//
// 저장은 열 때의 날짜·공간에 한다. 칸이 열린 채 다른 날짜·화면으로 옮겨 다녀도 그렇다.
import React, { useEffect, useRef, useState } from 'react';
import { useDayData, type EventItem } from '../hooks/useDayData';
import { useLabels } from '../hooks/useLabels';
import { useAppStore } from '../store/useAppStore';
import { useGroupDelete } from '../hooks/useGroupDelete';
import { resolveEventLabelNames, eventDisplayContent } from '../lib/eventLabels';
import { baseContentOf } from '../lib/eventGroups';
import { showToast } from '../utils/toast';
import SidePanelFrame, { sidePanelClass } from './SidePanelFrame';
import EventAlarmModal from './EventAlarmModal';
import PeriodModal from './PeriodModal';
import AutoTextarea from './AutoTextarea';

interface EventDrawerProps {
  /** 어느 날짜의 일정인가 (YYYY-MM-DD) */
  dateStr: string;
  /** 어느 공간의 것인가 (null = 개인) */
  groupId: string | null;
  /** 고치는 일정의 id. 없으면 새로 쓴다. */
  entryId?: string;
  /** 고칠 때 넘기는 그 순간의 일정 (구독이 도착하기 전 빈 칸이 보이지 않게) */
  initial?: EventItem;
  docked: boolean;
  onClose: () => void;
  /** 제목 아래에 적는 한 줄 (예: '9/28(월) 일정 · 개인') */
  subtitle?: string;
  /** '고친 것이 있으면 저장하기'를 밖에서 부를 수 있게 넘겨준다 (EntryDrawer와 같다) */
  flushRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

interface Attrs {
  calendar: boolean;
  forward: boolean;
  period: boolean;
  recur: boolean;
  skip: boolean;
}

const NO_ATTRS: Attrs = { calendar: false, forward: false, period: false, recur: false, skip: false };

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

export default function EventDrawer({
  dateStr,
  groupId,
  entryId,
  initial,
  docked,
  onClose,
  subtitle,
  flushRef,
}: EventDrawerProps) {
  const { openLinkerModal, openLinkViewerModal, openLabelModal } = useAppStore();
  const { eventLabels, getLabelColor, labelsLoaded } = useLabels();
  const { eventList, addEventItem, updateEventItem, deleteEventItem } = useDayData(dateStr, groupId);
  const fId = groupId || 'personal';

  const isEditing = !!entryId;
  const current: EventItem | null = entryId
    ? eventList.find((e) => String(e.id) === String(entryId)) || initial || null
    : null;

  const [text, setText] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [attrs, setAttrs] = useState<Attrs>({ ...NO_ATTRS, calendar: true });
  const [alarmTime, setAlarmTime] = useState('');
  /** 알림을 손댔는가. 손대지 않았으면 저장할 때 알림 값(특히 이미 확인한 표시)을 그대로 둔다. */
  const [alarmDirty, setAlarmDirty] = useState(false);
  /** 새로 쓸 때 담아 두는 링크. 고칠 때는 링크 추가가 곧바로 그 일정에 붙는다. */
  const [newLinks, setNewLinks] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [alarmModalOpen, setAlarmModalOpen] = useState(false);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);

  const panelRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // ─── 라벨에 딸린 속성 ───────────────────────────────────────────
  const labelDef = (name: string) => eventLabels.find((l) => l.name === name);
  const labelPropOf = (names: string[], pick: (def: any) => boolean) =>
    names.some((name) => {
      const def = labelDef(name);
      return def ? pick(def) : false;
    });
  const attrsOfLabel = (def: any): Attrs => ({
    calendar: def.calendar !== false,
    forward: !!(def.forward || def.isForward),
    period: !!def.period,
    recur: !!def.recur,
    skip: !!def.skip,
  });

  /** 이월이 켜진 것으로 보여야 하는가 - 이월 엔진(lib/forwarding의 isForwardTarget)과 같은 순서 */
  const forwardStateOf = (event: any, names: string[]) => {
    if (event?.forwardOptOut === true) return false;
    if (event?.forward === true) return true;
    return labelPropOf(names, (d) => !!(d.forward || d.isForward));
  };

  /**
   * 이월 체크를 저장할 모양으로 바꾼다.
   * 끈 것을 forward: false로만 적으면 라벨을 못 읽던 때 만든 일정이 영영 이월되지 않는다.
   * 이월 라벨을 달고도 일부러 껐을 때만 forwardOptOut으로 남긴다 (하루 화면에서 옮겨 온 규칙).
   */
  const forwardFieldsFor = (on: boolean, names: string[]) => {
    if (on) return { forward: true, forwardOptOut: false };
    return labelPropOf(names, (d) => !!(d.forward || d.isForward))
      ? { forwardOptOut: true }
      : { forward: false, forwardOptOut: false };
  };

  // ─── 칸 채우기 ─────────────────────────────────────────────────
  /**
   * 열었을 때(또는 마지막으로 저장했을 때)의 모습.
   * 다른 항목을 열거나 배경을 눌러 닫을 때, 이것과 달라졌으면 저장한다.
   */
  const snapshotRef = useRef<string | null>(null);
  const snapshotOf = (t: string, l: string[], a: Attrs, alarm: string, links: any[]) =>
    JSON.stringify([t.trim(), l, a, alarm, links.length]);
  const nowSnapshot = snapshotOf(text, labels, attrs, alarmTime, newLinks);
  const untouched = snapshotRef.current === null || (snapshotRef.current === nowSnapshot && !alarmDirty);

  const fill = (item: EventItem | null) => {
    let t = '';
    let l: string[] = [];
    let a: Attrs;
    let alarm = '';
    if (item) {
      l = resolveEventLabelNames(item, eventLabels, { keepUnknown: !labelsLoaded });
      t = eventDisplayContent(item);
      alarm = item.time || '';
      // 저장된 값이 있으면 그 값, 없으면 라벨의 속성. 라벨이 없는 일정은 달력에 보인다.
      a = {
        calendar:
          item.calendar !== undefined
            ? !!item.calendar
            : l.length > 0
            ? labelPropOf(l, (d) => d.calendar !== false)
            : true,
        forward: forwardStateOf(item, l),
        period: item.period !== undefined ? !!item.period : labelPropOf(l, (d) => !!d.period),
        recur: item.recur !== undefined ? !!item.recur : labelPropOf(l, (d) => !!d.recur),
        skip: item.skip !== undefined ? !!item.skip : labelPropOf(l, (d) => !!d.skip),
      };
    } else {
      // 새 일정은 통합 라벨 관리의 맨 위 라벨을 미리 골라 두고, 그 라벨의 속성을 따른다.
      // (안 고른 채 저장되면 어느 갈래에도 걸리지 않는다. 마음에 안 들면 눌러서 뗀다.)
      const top = eventLabels[0];
      l = top?.name ? [top.name] : [];
      a = top ? attrsOfLabel(top) : { ...NO_ATTRS, calendar: true };
    }
    setText(t);
    setLabels(l);
    setAttrs(a);
    setAlarmTime(alarm);
    setAlarmDirty(false);
    setNewLinks([]);
    snapshotRef.current = snapshotOf(t, l, a, alarm, []);
  };

  // 라벨·일정은 구독으로 들어와서 칸을 여는 순간에는 아직 없을 수 있다. 도착하면 채운다.
  // 다른 기기에서 고친 것도 따라간다. 단, 손대기 시작했으면 적던 것을 덮지 않는다.
  const untouchedRef = useRef(untouched);
  untouchedRef.current = untouched;
  const itemKey = current ? JSON.stringify(current) : '';
  useEffect(() => {
    if (!untouchedRef.current) return;
    if (isEditing && !current) return;
    fill(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey, eventLabels, labelsLoaded]);

  // ─── 고치기 ────────────────────────────────────────────────────
  const setAttr = (key: keyof Attrs, on: boolean) => {
    setAttrs((prev) => ({ ...prev, [key]: on }));
    // 기간은 '언제부터 언제까지'를 정해야 뜻이 생긴다. 켜는 순간 날짜부터 고르게 한다.
    if (key === 'period' && on) setPeriodModalOpen(true);
  };

  // 라벨을 새로 고르면 그 라벨의 기본 속성을 그대로 따라간다. 모두 떼면 속성도 모두 끈다.
  const toggleLabel = (name: string) => {
    if (labels.includes(name)) {
      const next = labels.filter((l) => l !== name);
      setLabels(next);
      if (next.length === 0) setAttrs(NO_ATTRS);
      return;
    }
    setLabels([...labels, name]);
    const def = labelDef(name);
    if (def) {
      setAttrs(attrsOfLabel(def));
      // 기간 라벨을 붙이는 것도 '기간을 켠 것'이다
      if (def.period) setPeriodModalOpen(true);
    }
  };

  // ─── 저장 ──────────────────────────────────────────────────────
  /** 저장한다. 저장했거나 저장할 것이 없으면 true */
  const handleSave = async (): Promise<boolean> => {
    const content = text.trim();
    if (!content) {
      // 지우기는 삭제 단추로만 한다. 내용을 다 지운 채 저장해도 일정은 남는다.
      showToast('일정 내용을 입력하세요.');
      return false;
    }
    // 앞선 저장이 끝나기 전에 또 들어오면 같은 일정이 두 개 생긴다
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    // labelIds에는 이름이 아니라 실제 라벨 ID를 넣는다 (V3가 ID로 찾는다).
    // label만 바꾸고 옛 labelIds를 두면, 뗀 라벨이 labelIds로 되살아난다.
    const labelIds = labels
      .map((n) => labelDef(n)?.id)
      .filter((id): id is string => !!id);
    const fields = {
      label: labels.join(','),
      labelIds,
      calendar: attrs.calendar,
      ...forwardFieldsFor(attrs.forward, labels),
      period: attrs.period,
      recur: attrs.recur,
      skip: attrs.skip,
    };
    try {
      if (entryId) {
        await updateEventItem(entryId, {
          content,
          ...fields,
          ...(alarmDirty ? { time: alarmTime || '', alarmTriggered: false } : {}),
        });
        snapshotRef.current = snapshotOf(content, labels, attrs, alarmTime, newLinks);
        setAlarmDirty(false);
        showToast('✅ 일정을 저장했습니다.');
      } else {
        await addEventItem(content, {
          ...fields,
          linkedItems: newLinks,
          time: alarmTime || undefined,
        });
        showToast('✅ 일정을 추가했습니다.');
        // 하루치를 연달아 적는 자리다. 칸은 닫지 않고 비운 뒤 초점을 돌려준다.
        fill(null);
        textRef.current?.focus();
      }
      return true;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const saveIfChanged = async (): Promise<boolean> => {
    // 내용을 다 지운 것은 '지우기'로 보지 않는다. 저장하지 않고 넘어간다.
    if (untouched || !text.trim()) return true;
    return handleSave();
  };
  if (flushRef) flushRef.current = saveIfChanged;

  // 좁은 화면에서 배경을 누르면: 고친 것이 있으면 저장하고 닫는다. 실패하면 닫지 않는다.
  // 이 칸만 닫는다. 칸이 여럿 쌓여 있을 때 아래 칸까지 적던 것째 닫히면 안 된다.
  const closeByBackdrop = async () => {
    if (!(await saveIfChanged())) return;
    onClose();
  };

  // Ctrl+S. 옆에 붙은 칸은 왼쪽 화면과 함께 쓰므로, 이 칸 안에 있을 때만 받는다.
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 커서가 이 칸 안에 있을 때만. 쓰는 칸이 여럿 쌓이면(휴대폰도) 커서가 든 칸만 저장한다.
      if (!panelRef.current?.contains(document.activeElement)) return;
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
        e.preventDefault();
        if (e.repeat) return;
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [docked]);

  // ─── 지우기 ────────────────────────────────────────────────────
  // 기간·반복으로 묶인 일정은 어디까지 지울지 먼저 묻는다
  const { requestDelete, groupDeleteModal } = useGroupDelete({
    fId,
    deleteOne: async (_d, id, item) => {
      await deleteEventItem(id, item);
      showToast('🗑️ 일정을 삭제했습니다. 휴지통에서 복원할 수 있습니다.');
      onClose();
    },
    onDeleted: onClose,
  });

  const linkedCount = isEditing ? (current?.linkedItems || []).length : newLinks.length;

  const panel = (
    <div className={sidePanelClass(docked)}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-slate-800">{isEditing ? '일정 수정' : '새 일정'}</h3>
          {subtitle && <p className="text-xs font-bold text-primary mt-0.5 truncate">{subtitle}</p>}
          <p className="text-xs text-slate-400 mt-0.5">
            빠른 저장 단축키: Ctrl + S{docked ? ' · 다른 화면으로 옮겨도 이 칸은 남습니다' : ''}
          </p>
        </div>
        <button
          title="닫기"
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          ✕
        </button>
      </div>

      {isEditing && !current ? (
        <div className="flex-1 flex items-center justify-center text-xs text-slate-400">일정을 불러오는 중...</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-5" data-scroll-lock>
          {/* 버튼 줄 */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setAlarmModalOpen(true)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                alarmTime
                  ? !alarmDirty && current?.alarmTriggered
                    ? 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    : 'text-primary bg-blue-50 hover:bg-blue-100'
                  : 'text-slate-600 bg-slate-100 hover:bg-slate-200'
              }`}
            >
              ⏰ {alarmTime ? formatAlarmBadge(alarmTime) : '알림 추가'}
            </button>
            <button
              type="button"
              onClick={() =>
                entryId
                  ? openLinkerModal('event', dateStr, entryId, undefined, undefined, fId)
                  : openLinkerModal('manual', dateStr, undefined, undefined, (links) =>
                      setNewLinks((prev) => [...prev, ...links])
                    )
              }
              className="px-3 py-1.5 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              🔗 링크 추가
            </button>
            {isEditing && linkedCount > 0 && (
              <button
                type="button"
                onClick={() => openLinkViewerModal('event', dateStr, entryId, undefined, fId)}
                className="px-3 py-1.5 bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                📑 연결된 링크 ({linkedCount})
              </button>
            )}
          </div>

          {/* 새로 쓸 때 담아 둔 링크 */}
          {!isEditing && newLinks.length > 0 && (
            <div className="flex flex-wrap gap-1.5 -mt-2">
              {newLinks.map((link, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1 bg-yellow-50 border border-yellow-200 pl-2 pr-1 py-1 rounded-md"
                >
                  <span className="text-xs font-bold text-yellow-800 truncate max-w-[180px]">
                    🔗 {link.title || link.text || '연결된 항목'}
                  </span>
                  <button
                    type="button"
                    title="링크 빼기"
                    onClick={() => setNewLinks((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-slate-400 hover:text-red-500 p-0.5 text-xs cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

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
                const isSelected = labels.includes(l.name);
                const c = getLabelColor(l.name);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => toggleLabel(l.name)}
                    aria-pressed={isSelected}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all border cursor-pointer ${
                      isSelected
                        ? 'ring-2 ring-primary ring-offset-1 shadow-xs'
                        : 'opacity-70 hover:opacity-100 bg-white text-slate-600 border-slate-200'
                    }`}
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
              {(
                [
                  ['calendar', '달력', '월간/년간 달력에 표시', 'text-blue-600'],
                  ['forward', '이월', '미완료 시 다음 날로 자동 이월', 'text-emerald-600'],
                  ['period', '기간', '연속 기간 등록', 'text-indigo-600'],
                  ['recur', '반복', '매주/매월 반복', 'text-purple-600'],
                  ['skip', '수업X', '지정 날짜의 수업 과목 비움', 'text-amber-600'],
                ] as const
              ).map(([key, name, title, color]) => (
                <label
                  key={key}
                  className="flex items-center gap-1.5 cursor-pointer select-none hover:text-slate-900"
                  title={title}
                >
                  <input
                    type="checkbox"
                    checked={attrs[key]}
                    onChange={(e) => setAttr(key, e.target.checked)}
                    className={`rounded ${color} focus:ring-0 w-3.5 h-3.5 cursor-pointer`}
                  />
                  <span className="font-semibold text-xs">{name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 일정 내용 */}
          <div>
            <span className="block text-xs font-bold text-slate-500 mb-1">일정 내용</span>
            <AutoTextarea
              ref={textRef}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="새로운 일정을 입력하세요..."
              className="w-full min-h-[84px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder-slate-400"
            />
          </div>
        </div>
      )}

      <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50/50">
        {isEditing && current ? (
          <button
            type="button"
            onClick={() => requestDelete(dateStr, entryId!, current)}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-100 rounded-xl transition-colors cursor-pointer"
          >
            삭제
          </button>
        ) : (
          <div />
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !text.trim()}
            className="px-5 py-2 text-sm font-bold text-white bg-primary hover:bg-blue-600 rounded-xl shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <SidePanelFrame
      docked={docked}
      onClose={onClose}
      onBackdropClose={() => void closeByBackdrop()}
      ariaLabel="일정 쓰기"
      panelRef={panelRef}
    >
      {panel}

      {alarmModalOpen && (
        <EventAlarmModal
          isOpen
          onClose={() => setAlarmModalOpen(false)}
          dateStr={dateStr}
          initialTime={alarmTime}
          onSave={(time) => {
            setAlarmTime(time);
            setAlarmDirty(true);
          }}
          onTurnOff={() => {
            setAlarmTime('');
            setAlarmDirty(true);
          }}
        />
      )}

      {/* 기간 설정. 정하지 않고 닫으면 '기간'도 다시 꺼진다 (하루짜리 일정에 쓸모없는 표시만 남는다). */}
      {periodModalOpen && (
        <PeriodModal
          isOpen
          groupId={groupId}
          startDate={dateStr}
          defaultContent={isEditing ? baseContentOf(text) : text.trim()}
          labels={labels}
          attrs={{ calendar: attrs.calendar, forward: attrs.forward, skip: attrs.skip }}
          // 고치던 한 건은 여러 날짜의 묶음이 된다. 그 한 건을 치우는 일은 팝업이 같은
          // 일괄 쓰기 안에서 한다 - 따로 지우면 방금 만든 첫날 일정까지 옛 목록에 덮인다.
          replace={entryId ? { dateStr, id: entryId } : undefined}
          onClose={() => {
            setPeriodModalOpen(false);
            setAttrs((prev) => ({ ...prev, period: false }));
          }}
          onRegistered={() => {
            setPeriodModalOpen(false);
            // 고치던 한 건은 묶음으로 바뀌어 사라졌다. 새 일정이면 이어 쓰게 비운다.
            if (entryId) onClose();
            else fill(null);
          }}
        />
      )}

      {groupDeleteModal}
    </SidePanelFrame>
  );
}
