// src/components/EntryDrawer.tsx
// 메모와 기록이 같은 오른쪽 배너(드로어)를 쓴다. 두 화면이 각자 입력 폼을 들고
// 있으면 단축키·첨부·라벨 동작이 조금씩 어긋나므로 한 곳에서만 만든다.
import React, { useState, useEffect, useRef } from 'react';
import { showToast, showErrorToast, showErrorToastOnce } from '../utils/toast';
import { auth } from '../lib/firebase';
import { uploadToDrive, attachmentImageSrc, driveUrlToStore, uploadFailReason } from '../lib/driveApi';
import { useAppStore } from '../store/useAppStore';
import { formatDateStr } from '../lib/dateUtils';
import { closeAllModals } from '../hooks/useModalLayer';
import { usePasteImageUpload } from '../hooks/usePasteImageUpload';
import ImageViewerModal, { type ViewerImage } from './ImageViewerModal';
// ⚠️ 그림인지 가리는 규칙은 lib/attachments 한 곳에만 둔다. 예전에는 여기서
//    주소만 보고 가렸는데, 드라이브 주소에는 확장자가 없어(.../file/d/<id>/view)
//    type이 비어 있는 옛 자료는 그림인 줄 못 알아봤다.
import { isImageAttachment } from '../lib/attachments';
import AutoTextarea from './AutoTextarea';
import StudentTagPicker from './StudentTagPicker';
import StudentMentionList from './StudentMentionList';
import { applyMention, findMention, type Mention, type MentionCandidate } from '../lib/mention';
import SidePanelFrame, { sidePanelClass } from './SidePanelFrame';
import { labelPath, orderByTree } from '../lib/labelTree';
import { isTopSideItem } from './PopupFrame';
import EntryTableView from './EntryTableView';
import { isRealTable, normalizeTables, parseClipboardTable, tableForSave, tableSize, type EntryTable } from '../lib/entryTable';

export type EntryKind = 'memo' | 'journal';

export interface EntryAttachment {
  id?: string;
  name: string;
  url: string;
  type?: string;
  size?: number;
  /** 구글 드라이브 파일 id. 이미지 미리보기와 나중의 삭제에 쓴다. */
  driveId?: string;
}

/** 드로어가 수정 대상으로 받는 값. 메모와 기록의 필드 이름 차이를 모두 받아들인다. */
export interface EntrySource {
  /** 수정 대상을 가리키는 값. 기록은 id, 메모는 firestoreId를 쓴다. */
  id?: string;
  firestoreId?: string;
  content?: string;
  text?: string;
  labels?: string[];
  labelIds?: string[];
  label?: string;
  imageUrl?: string;
  attachments?: unknown[];
  linkedItems?: any[];
  /** 붙인 표 (lib/entryTable) */
  tables?: unknown[];
}

/** 저장 버튼을 눌렀을 때 화면으로 돌려주는 값. */
export interface EntryDraft {
  content: string;
  labels: string[];
  attachments: EntryAttachment[];
  linkedItems: any[];
  /**
   * 칸이 열릴 때(또는 마지막으로 저장할 때)의 링크 목록. 저장하는 쪽이 칸에서 더하고 뺀 링크만 서버 목록에
   * 옮기는 데 쓴다(utils/linkUtils.mergeLinkEdits) - 칸을 연 사이 다른 곳에서 걸린 링크를 덮지 않게.
   */
  linkedItemsBase: any[];
  imageUrl?: string;
  /** 붙인 표. 엑셀에서 복사해 본문에 붙여넣으면 생긴다 */
  tables: EntryTable[];
}

interface EntryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  kind: EntryKind;
  /** 수정 대상. null이면 새로 작성하는 경우다. */
  entry: EntrySource | null;
  labelOptions: string[];
  /** 라벨 상위/하위 (하위 이름 → 상위 이름). 주면 하위를 상위 바로 뒤에 들여 보여 준다. */
  labelParents?: Record<string, string>;
  onSave: (draft: EntryDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  /**
   * 메모 ↔ 기록 옮기기. 지금 칸에 적힌 내용(저장 전 고친 것 포함)을 넘긴다.
   * 주면 고치는 중일 때 삭제 옆에 '기록으로 / 메모로' 단추가 생긴다.
   */
  onMove?: (draft: EntryDraft) => void;
  defaultLabel?: string;
  /** 새로 쓸 때 미리 채울 글 (다른 앱에서 공유받은 글). 열 때의 값만 쓴다 */
  draftText?: string;
  /** 새로 쓸 때 붙일 파일 (공유받은 것). 칸에서 '드라이브에 올려 첨부'를 눌러야 올라간다 */
  draftFiles?: File[];
  /**
   * 화면 옆에 붙는 칸으로 그린다 (어두운 배경 없이, 화면을 가리지 않고).
   * 이때는 팝업이 아니므로 화면의 다른 곳을 눌러도, 다른 화면으로 옮겨도 닫히지 않는다.
   */
  docked?: boolean;
  /** 제목 아래에 적는 한 줄 (예: '9/28(월) 기록 · 개인') */
  subtitle?: string;
  /**
   * '고친 것이 있으면 저장하기'를 밖에서 부를 수 있게 넘겨준다.
   * 옆에 붙은 칸에서 다른 항목을 열 때, 쓰던 것을 먼저 저장하려고 쓴다.
   * 저장했거나 저장할 것이 없으면 true.
   */
  flushRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  /** 저장 안 한 것이 있나. ESC로 칸을 모두 닫기 전에 묻는다. */
  unsavedRef?: React.MutableRefObject<(() => boolean) | null>;
}

const KIND_TEXT: Record<EntryKind, { noun: string; contentLabel: string; placeholder: string }> = {
  memo: {
    noun: '메모',
    contentLabel: '메모 내용',
    placeholder: '자유롭게 생각을 기록해보세요... (캡처한 이미지는 Ctrl+V로 첨부)',
  },
  journal: {
    noun: '기록',
    contentLabel: '기록 내용',
    placeholder: '오늘 있었던 일을 기록해보세요... (캡처한 이미지는 Ctrl+V로 첨부)',
  },
};



const normalizeAttachments = (raw: unknown[] | undefined, legacyImageUrl?: string): EntryAttachment[] => {
  const list: EntryAttachment[] = [];
  for (const item of raw || []) {
    if (!item) continue;
    if (typeof item === 'string') {
      const url = item.trim();
      if (!url) continue;
      list.push({ name: url.split('/').pop()?.split('?')[0] || '파일', url, type: '' });
      continue;
    }
    const obj = item as any;
    const url = obj.url || obj.downloadUrl || obj.fileUrl || '';
    if (!url || typeof url !== 'string') continue;
    // ⚠️ 없는 값은 키를 아예 빼야 한다. undefined를 담아 두면 그대로 저장으로
    //    흘러가는데, Firestore는 배열 안에 든 undefined를 거부한다. 게다가 그
    //    오류는 어느 밭인지도 안 알려 준다("found in document …"). 실제로 크기가
    //    안 적힌 옛 첨부가 붙은 메모는 저장할 때마다 실패했다.
    list.push({
      name: obj.name || url.split('/').pop()?.split('?')[0] || '파일',
      url,
      ...(typeof obj.id === 'string' ? { id: obj.id } : {}),
      ...(typeof obj.type === 'string' ? { type: obj.type } : {}),
      ...(typeof obj.size === 'number' ? { size: obj.size } : {}),
      ...(typeof obj.driveId === 'string' ? { driveId: obj.driveId } : {}),
    });
  }
  // 첨부 목록이 없던 구버전 항목은 imageUrl 한 장만 갖고 있다.
  if (list.length === 0 && legacyImageUrl) {
    list.push({ name: '이미지', url: legacyImageUrl, type: 'image' });
  }
  return list;
};

const sourceLabels = (entry: EntrySource): string[] => {
  if (entry.labels && entry.labels.length > 0) return entry.labels;
  if (entry.labelIds && entry.labelIds.length > 0) return entry.labelIds;
  return entry.label ? [entry.label] : [];
};

export default function EntryDrawer({
  isOpen,
  onClose,
  kind,
  entry,
  labelOptions,
  labelParents = {},
  onSave,
  onDelete,
  onMove,
  defaultLabel,
  draftText,
  draftFiles,
  docked = false,
  subtitle,
  flushRef,
  unsavedRef,
}: EntryDrawerProps) {
  const { openLabelModal, openLinkerModal, currentDate } = useAppStore();
  const formattedDate = formatDateStr(new Date(currentDate));
  const text = KIND_TEXT[kind];

  // 옆에 붙는 방식·ESC·배경 누르기는 SidePanelFrame이 맡는다
  const panelRef = useRef<HTMLElement>(null);
  // 배경을 눌러 닫을 때는 고친 것을 저장하고 닫는다 (아래 backdropCloseRef).
  const backdropCloseRef = useRef<() => void>(closeAllModals);

  const [content, setContent] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  // 라벨이 늦게 풀릴 때 '사용자가 손댔나'를 보려고 지금 값을 들고 있는다
  const selectedLabelsRef = useRef<string[]>([]);
  selectedLabelsRef.current = selectedLabels;
  /** 미리 골라 둘 라벨. 배너를 여는 그 순간의 값만 쓴다. */
  const defaultLabelRef = useRef(defaultLabel);
  defaultLabelRef.current = defaultLabel;
  /** 공유받은 글·파일도 배너를 여는 그 순간의 값만 쓴다 (저장 뒤 고치는 칸이 되면 넘어오지 않는다) */
  const draftTextRef = useRef(draftText);
  draftTextRef.current = draftText;
  const draftFilesRef = useRef(draftFiles);
  draftFilesRef.current = draftFiles;
  /** 공유받았지만 아직 드라이브에 올리지 않은 파일 */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachments, setAttachments] = useState<EntryAttachment[]>([]);
  const [linkedItems, setLinkedItems] = useState<any[]>([]);
  const [tables, setTables] = useState<EntryTable[]>([]);

  const [saving, setSaving] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  /** 학생 태그 고르는 칸 (기록에만) */
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  /**
   * '@이름'으로 학생 태그 넣기 (기록에만, ROADMAP 10-1). 목록은 StudentMentionList가 그리고,
   * 키보드는 글 칸이 받는다(목록으로 초점을 옮기면 한글 조합이 끊긴다).
   */
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<Mention | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionCandidates = useRef<MentionCandidate[]>([]);
  const updateMention = (el: HTMLTextAreaElement) => {
    if (kind !== 'journal') return;
    const next = findMention(el.value, el.selectionStart ?? el.value.length);
    if (!next || next.query !== mention?.query || next.start !== mention?.start) setMentionIndex(0);
    setMention(next);
  };
  const pickMention = (c: MentionCandidate) => {
    const el = contentRef.current;
    if (!mention || !el) return;
    const r = applyMention(el.value, mention, c.tag);
    setContent(r.text);
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.caret, r.caret);
    });
  };
  const onMentionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!mention || e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      // 목록만 닫는다. 쓰는 칸 전체가 닫히면(전역 ESC) 적던 것이 사라진다
      e.preventDefault();
      e.stopPropagation();
      setMention(null);
      return;
    }
    const list = mentionCandidates.current;
    if (list.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setMentionIndex((i) => (i + step + list.length) % list.length);
    } else if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      pickMention(list[Math.min(mentionIndex, list.length - 1)]);
    }
  };
  // saving 상태는 다음 그림에서야 반영되므로, 연달아 들어온 저장을 막는 데는 쓸 수 없다.
  const savingRef = useRef(false);

  const handleSubmitRef = useRef<() => void>(() => {});

  /**
   * 배너를 열었을 때(또는 마지막으로 저장했을 때)의 모습.
   * 배경을 눌러 닫을 때 이것과 달라졌으면 저장한다. 첨부·링크·라벨까지 본다.
   */
  const snapshotRef = useRef('');
  const formSnapshot = (c: string, l: string[], a: EntryAttachment[], k: any[], t: EntryTable[] = []) =>
    JSON.stringify([c.trim(), l, a.map((x) => x.url), k.map((x) => x?.id ?? x?.targetId ?? JSON.stringify(x)), t]);

  // ⚠️ 이 효과는 '수정 대상이 바뀔 때'만 돌아야 한다. entry 객체 자체를 의존성으로
  // 잡으면 안 된다. 기록 화면은 라벨을 이름으로 풀어 넘기느라 그릴 때마다 새 객체를
  // 만드는데, 그러면 화면이 한 번 다시 그려질 때마다 이 효과가 돌아 폼이 통째로
  // 되돌아간다. 링크 추가 팝업을 열고 닫는 것만으로도 다시 그려지므로, '연결 저장'을
  // 눌러 담은 링크와 쓰던 글이 창이 닫히는 순간 사라졌다. 대상을 가리키는 값으로만 본다.
  const entryKey = entry ? String(entry.id ?? entry.firestoreId ?? '') : null;
  const entryRef = useRef<EntrySource | null>(entry);
  entryRef.current = entry;
  /** 칸이 열릴 때(또는 마지막 저장 때)의 링크 목록 (EntryDraft.linkedItemsBase) */
  const baseLinksRef = useRef<any[]>([]);

  useEffect(() => {
    const source = entryRef.current;
    if (source) {
      const c = source.content || source.text || '';
      const l = sourceLabels(source);
      const k = source.linkedItems || [];
      const a = normalizeAttachments(source.attachments, source.imageUrl);
      const t = normalizeTables(source.tables);
      setContent(c);
      setSelectedLabels(l);
      setLinkedItems(k);
      setAttachments(a);
      setTables(t);
      snapshotRef.current = formSnapshot(c, l, a, k, t);
      baseLinksRef.current = k;
      openedLabelsRef.current = JSON.stringify(l);
    } else {
      // 공유받은 글은 채워 두되 기준(snapshot)은 빈 칸으로 둔다 - 저장하지 않고 닫으면 묻는다
      setContent(draftTextRef.current || '');
      setPendingFiles(draftFilesRef.current || []);
      // 미리 골라 둘 라벨은 '열 때'의 값으로 정한다. 라벨은 구독으로 들어와서
      // 열고 나서 바뀔 수 있는데, 그 변화를 좇아 여기가 다시 돌면 적고 있던
      // 내용까지 함께 지워진다. 그래서 ref로 읽고 deps에서는 뺀다.
      const preset = defaultLabelRef.current;
      const l = preset && preset !== '전체' ? [preset] : [];
      setSelectedLabels(l);
      setAttachments([]);
      setLinkedItems([]);
      setTables([]);
      snapshotRef.current = formSnapshot('', l, [], [], []);
      baseLinksRef.current = [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryKey, isOpen]);

  // 라벨이 늦게 풀리는 경우. 기록은 라벨을 id로 들고 있어서 라벨 목록으로 이름을 푸는데,
  // 칸을 여는 순간에는 라벨 목록이 아직 기본값이라 이름이 안 풀려 체크가 하나도 안 된 채
  // 열렸다(위 효과는 대상이 바뀔 때만 돌아 다시 채우지 않는다). 풀린 라벨이 바뀌면, 사용자가
  // 라벨을 아직 손대지 않았을 때만 따라간다 - 고르던 것을 덮어쓰지 않는다.
  const openedLabelsRef = useRef('[]');
  const sourceLabelsKey = entry ? JSON.stringify(sourceLabels(entry)) : '';
  useEffect(() => {
    const source = entryRef.current;
    if (!source || !sourceLabelsKey || sourceLabelsKey === openedLabelsRef.current) return;
    const next: string[] = JSON.parse(sourceLabelsKey);
    const untouched = JSON.stringify(selectedLabelsRef.current) === openedLabelsRef.current;
    openedLabelsRef.current = sourceLabelsKey;
    if (!untouched) return;
    setSelectedLabels(next);
    // '고친 것이 있나'를 재는 기준도 풀린 라벨로 맞춘다 (라벨만 풀렸다고 고친 것으로 치지 않게)
    try {
      const snap = JSON.parse(snapshotRef.current);
      snap[1] = next;
      snapshotRef.current = JSON.stringify(snap);
    } catch {
      /* 기준을 못 읽으면 그대로 둔다 */
    }
  }, [sourceLabelsKey]);

  useEffect(() => {
    handleSubmitRef.current = () => handleSubmit();
  }, [content, selectedLabels, attachments, linkedItems, tables]);

  // 💡 Esc로 닫는 동작은 useModalLayer의 전역 규칙(열린 팝업 전부 닫기)에 맡긴다.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      // 옆에 붙은 칸은 왼쪽 화면과 함께 쓴다. 왼쪽에서 누른 Ctrl+S(일정 저장 등)까지
      // 여기서 가로채면 두 곳이 함께 저장된다. 이 칸 안에 있을 때만 받는다.
      // 커서가 이 칸 안에 있을 때. 쓰는 칸이 여럿 쌓이면(휴대폰도) 커서가 든 칸만 저장한다.
      // 커서가 아무 데도 없으면(칸의 빈 곳·왼쪽 화면을 누른 뒤) 오른쪽 줄 맨 위 칸이 받는다 -
      // 예전에는 이때 아무 칸도 받지 않아 'Ctrl+S가 가끔 안 먹는' 것처럼 보였다.
      const active = document.activeElement;
      const inside = !!panelRef.current?.contains(active);
      const nowhere = !active || active === document.body;
      if (!inside && !(nowhere && isTopSideItem(panelRef.current))) return;
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
        e.preventDefault();
        // 키를 누른 채로 두면 브라우저가 keydown을 되풀이해 보낸다.
        // 되풀이분까지 저장하면 같은 메모가 여러 개 만들어진다.
        if (e.repeat) return;
        handleSubmitRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, docked]);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const viewerImages: ViewerImage[] = attachments
    .filter(isImageAttachment)
    .map((att) => ({ url: attachmentImageSrc(att), name: att.name }));

  // 첨부는 두 화면이 서로 다른 모양으로 저장해 왔다. 기록은 type에 'image'/'file'과
  // id를, 메모는 MIME 타입을 쓴다. 저장된 형태를 바꾸지 않도록 여기서 맞춰준다.
  const makeAttachment = (
    name: string,
    url: string,
    mimeType: string,
    size?: number,
    seq = 0,
    driveId?: string
  ): EntryAttachment => {
    const isImage = mimeType.startsWith('image/');
    // size도 driveId와 같이 있을 때만 담는다 (undefined를 담으면 저장이 통째로 막힌다)
    const optional = {
      ...(typeof size === 'number' ? { size } : {}),
      ...(driveId ? { driveId } : {}),
    };
    if (kind === 'journal') {
      return {
        id: `file_${Date.now()}_${seq}`,
        name,
        url,
        type: isImage ? 'image' : 'file',
        ...optional,
      };
    }
    return {
      name,
      url,
      type: mimeType || 'application/octet-stream',
      ...optional,
    };
  };

  // 캡처 이미지를 Ctrl+V로 붙여넣으면 하단 첨부 목록에 이미지로 추가된다.
  // ⚠️ 훅은 반드시 아래 early return 위에서 호출해야 한다 (Rules of Hooks).
  const { handlePaste, pasting } = usePasteImageUpload((images) => {
    setAttachments((prev) => [
      ...prev,
      ...images.map((img, i) =>
        makeAttachment(img.name, img.url, img.mimeType || 'image/png', img.size, i, img.driveId)
      ),
    ]);
  });

  /**
   * 엑셀·한셀·구글 시트·웹의 표를 붙여넣으면 표로 붙인다. 표로 처리했으면(또는 글자로 흘려보내야 하면) true.
   * 엑셀은 표와 함께 그 범위의 그림도 복사하므로, 그림 올리기보다 먼저 본다.
   */
  const handleTablePaste = (e: React.ClipboardEvent): boolean => {
    const html = e.clipboardData?.getData('text/html') || '';
    const parsed = parseClipboardTable(html);
    if (!parsed) return false;
    if ('error' in parsed) {
      e.preventDefault();
      showErrorToast(parsed.error);
      return true;
    }
    // 한 칸만 복사했으면 글자로 붙인다 (그림으로 올라가지 않게 여기서 멈춘다)
    if (!isRealTable(parsed)) return true;
    e.preventDefault();
    setTables((prev) => [...prev, parsed]);
    const { rows, cols } = tableSize(parsed);
    showToast(`▦ 표를 붙였습니다 (${rows}줄 × ${cols}열)`);
    return true;
  };

  if (!isOpen) return null;

  const toggleLabel = (label: string) => {
    setSelectedLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    await uploadFiles(files);
  };

  /** 공유받은 파일을 올린다. 올라간 것만 목록에서 뺀다 */
  const uploadPendingFiles = async () => {
    const files = pendingFiles;
    const done = await uploadFiles(files);
    setPendingFiles((prev) => prev.filter((f) => !done.includes(f)));
  };

  /** 파일을 드라이브에 올려 첨부에 붙인다. 올라간 파일을 돌려준다 */
  const uploadFiles = async (files: File[]): Promise<File[]> => {
    if (files.length === 0) return [];

    const user = auth.currentUser;
    if (!user) {
      showToast('로그인이 필요합니다.');
      return [];
    }

    const uploaded: EntryAttachment[] = [];
    const done: File[] = [];
    try {
      setUploadingFiles(true);
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // 이미지도 압축하지 않고 원본 그대로 올린다. 화면 캡처는 글자가 많아
        // 다시 인코딩하면 읽기 어려워진다.
        const drive = await uploadToDrive(file, file.name);
        uploaded.push(
          makeAttachment(file.name, driveUrlToStore(file.type, drive), file.type, file.size, i, drive.id)
        );
        done.push(file);
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (error) {
      console.error('파일 업로드 에러:', error);
      // 앞서 올라간 파일은 붙여 둔다. 예전엔 하나라도 실패하면 이미 올린 것까지 버려서, 드라이브에만 남고
      // 다시 올리면 두 벌이 됐다.
      const reason = uploadFailReason(error);
      const why = reason ? `\n${reason}` : '';
      if (uploaded.length > 0) {
        setAttachments((prev) => [...prev, ...uploaded]);
        showErrorToast(`파일 ${files.length}개 중 ${uploaded.length}개만 올렸습니다. 나머지를 다시 올려 주세요.${why}`);
      } else {
        showErrorToast(`파일 업로드에 실패했습니다.${why}`);
      }
    } finally {
      setUploadingFiles(false);
    }
    return done;
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (att: EntryAttachment) => {
    const name = att?.name || '';
    const type = att?.type || '';
    if (isImageAttachment(att)) return '🖼️';
    if (type.includes('pdf') || name.endsWith('.pdf')) return '📄';
    if (name.match(/\.(doc|docx|hwp|hwpx|txt)$/i)) return '📝';
    if (name.match(/\.(xls|xlsx|csv)$/i)) return '📊';
    if (name.match(/\.(zip|7z|tar|gz|rar)$/i)) return '🗜️';
    return '📁';
  };

  const openLinker = () => {
    openLinkerModal('manual', formattedDate, undefined, undefined, (links) => {
      setLinkedItems((prev) => [...prev, ...links]);
    });
  };

  const handleRemoveLink = (index: number) => {
    setLinkedItems((prev) => prev.filter((_, i) => i !== index));
  };

  /** 저장한다. 저장했거나 저장할 것이 없으면 true, 실패했으면 false */
  const handleSubmit = async (e?: React.FormEvent): Promise<boolean> => {
    if (e) e.preventDefault();
    if (!content.trim() && attachments.length === 0 && tables.length === 0) return true;
    // 앞선 저장이 아직 끝나지 않았다면 그냥 흘려보낸다.
    // 안 그러면 새 항목을 만드는 중에 또 만들어 같은 내용이 두 개가 된다.
    if (savingRef.current) return false;
    savingRef.current = true;

    try {
      setSaving(true);
      await onSave({
        content: content.trim(),
        labels: selectedLabels,
        attachments,
        linkedItems,
        linkedItemsBase: baseLinksRef.current,
        imageUrl: attachments.find(isImageAttachment)?.url,
        tables: tables.map(tableForSave),
      });
      // 저장해도 배너는 닫지 않는다. 닫기 버튼이나 배경 클릭으로만 닫힌다.
      showToast(`✅ ${text.noun}을(를) 저장했습니다.`);
      snapshotRef.current = formSnapshot(content, selectedLabels, attachments, linkedItems, tables);
      baseLinksRef.current = linkedItems;
      return true;
    } catch (error) {
      // 저장 함수가 이미 안내했으면(ShownError) 또 띄우지 않는다
      showErrorToastOnce(`${text.noun} 저장에 실패했습니다. 적은 내용은 칸에 남아 있습니다.`, error);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const isEditing = !!entry;

  // 배경을 누르면: 고친 것이 없으면 그냥 닫고, 있으면 저장한 뒤 닫는다.
  // 저장이 실패했거나 파일이 올라가는 중이면 닫지 않는다 (적던 것이 사라지면 안 된다).
  // 닫기 단추·✕·ESC는 지금처럼 '저장 없이 닫기'다.
  const saveIfChanged = async (): Promise<boolean> => {
    if (uploadingFiles || pasting) return false;
    // 공유받은 파일은 칸을 닫으면 사라진다 - 올리거나 빼기 전에는 닫지 않는다
    if (pendingFiles.length > 0) {
      showToast('📥 공유받은 파일을 먼저 드라이브에 올리거나 빼 주세요.');
      return false;
    }
    const changed = formSnapshot(content, selectedLabels, attachments, linkedItems, tables) !== snapshotRef.current;
    return changed ? handleSubmit() : true;
  };
  if (flushRef) flushRef.current = saveIfChanged;
  if (unsavedRef)
    unsavedRef.current = () =>
      pendingFiles.length > 0 || formSnapshot(content, selectedLabels, attachments, linkedItems, tables) !== snapshotRef.current;

  // 배경을 누르면 이 칸만 닫는다. 칸이 여럿 쌓여 있을 때 아래 칸까지 적던 것째 닫히면 안 된다.
  backdropCloseRef.current = async () => {
    if (!(await saveIfChanged())) return;
    onClose();
  };

  const panel = (
      <div className={sidePanelClass(docked)}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-800">
              {isEditing ? `${text.noun} 수정` : `새 ${text.noun}`}
            </h3>
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

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-6" data-scroll-lock>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-600">
              {text.contentLabel} <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <AutoTextarea
                ref={contentRef}
                autoFocus
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  updateMention(e.target);
                }}
                onKeyDown={onMentionKeyDown}
                // 커서만 옮겨도(누르기·화살표) '@' 밖으로 나가면 목록을 닫는다
                onSelect={(e) => mention && updateMention(e.currentTarget)}
                onBlur={() => setMention(null)}
                onPaste={(e) => {
                  if (handleTablePaste(e)) return;
                  handlePaste(e);
                }}
                placeholder={text.placeholder}
                className="w-full min-h-[84px] p-4 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-slate-800 leading-relaxed placeholder-slate-400 text-sm"
              />
              {kind === 'journal' && mention && (
                <StudentMentionList
                  query={mention.query}
                  activeIndex={mentionIndex}
                  onCandidates={(list) => {
                    mentionCandidates.current = list;
                  }}
                  onPick={pickMention}
                />
              )}
            </div>
            <p className="text-2xs text-slate-400">
              ▦ 엑셀·한셀·구글 시트에서 복사해 여기에 붙여넣으면 서식째 표로 붙습니다.
              {kind === 'journal' ? ' @이름을 치면 학생 태그를 고릅니다.' : ''}
            </p>
            {/* 붙인 표 (lib/entryTable). 칸을 눌러 글자를 고치고, 줄·열을 더하고 뺀다 */}
            {tables.map((t, i) => (
              <EntryTableView
                key={t.id}
                table={t}
                title={tables.length > 1 ? `표 ${i + 1}` : '표'}
                onChange={(next) => setTables((prev) => prev.map((x) => (x.id === t.id ? next : x)))}
                onRemove={() => setTables((prev) => prev.filter((x) => x.id !== t.id))}
              />
            ))}
            {/* 학생 태그 (#26040305). 붙여 두면 '학생 누가기록'에 모인다. */}
            {kind === 'journal' && (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setTagPickerOpen((v) => !v)}
                  className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  title="학생을 골라 #학년도학년반번호 태그를 붙입니다. 학생 누가기록에 모입니다."
                >
                  🧑‍🎓 학생 태그 {tagPickerOpen ? '닫기' : '넣기'}
                </button>
                {tagPickerOpen && (
                  <StudentTagPicker
                    picked={content}
                    onPick={(tag) =>
                      setContent((prev) => {
                        if (prev.includes(tag)) return prev;
                        const base = prev.replace(/\s+$/, '');
                        return base ? `${base} ${tag}` : tag;
                      })
                    }
                  />
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-600">
                라벨 태그 (다중 선택 가능)
              </label>
              <button
                type="button"
                onClick={() => openLabelModal(kind)}
                className="text-xs text-primary hover:text-blue-700 font-bold flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-blue-50 transition-colors cursor-pointer"
                title="더보기 - 통합 라벨 관리 열기"
              >
                <span>⚙️</span>
                <span>라벨 수정</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {orderByTree(labelOptions, labelParents).map(({ name: label, depth }) => {
                const isSelected = selectedLabels.includes(label);
                return (
                  <button
                    key={label}
                    type="button"
                    title={labelPath(label, labelParents)}
                    onClick={() => toggleLabel(label)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {depth === 1 && (
                      <span className="mr-0.5 opacity-60" aria-hidden>
                        └
                      </span>
                    )}
                    {isSelected ? '✓ ' : ''}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-600">
                첨부 및 링크 ({attachments.length + linkedItems.length}개)
              </label>
              {pasting && (
                <span className="text-xs font-bold text-primary">⏳ 붙여넣은 이미지 업로드 중...</span>
              )}
            </div>

            {pendingFiles.length > 0 && (
              <div data-shared-files className="rounded-xl border border-sky-200 bg-sky-50 p-2.5 space-y-2">
                <div className="text-xs font-bold text-sky-800">📥 공유받은 파일 {pendingFiles.length}개 - 아직 첨부되지 않았습니다</div>
                <ul className="text-xs text-slate-600 space-y-0.5">
                  {pendingFiles.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="truncate">
                      · {f.name} <span className="text-slate-400">{formatFileSize(f.size)}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void uploadPendingFiles()}
                    disabled={uploadingFiles}
                    className="flex-1 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold disabled:opacity-60"
                  >
                    {uploadingFiles ? '⏳ 올리는 중...' : '드라이브에 올려 첨부'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingFiles([])}
                    disabled={uploadingFiles}
                    className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50"
                  >
                    빼기
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <label className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer border border-dashed border-slate-300 shadow-2xs">
                <span>{uploadingFiles ? '⏳' : '📎'}</span>
                <span>{uploadingFiles ? '업로드 중...' : '파일 첨부'}</span>
                <input
                  type="file"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={uploadingFiles}
                />
              </label>
              <button
                type="button"
                onClick={openLinker}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-50 hover:bg-yellow-50 text-slate-700 hover:text-yellow-800 rounded-xl text-xs font-bold transition-colors cursor-pointer border border-dashed border-slate-300 hover:border-yellow-300 shadow-2xs"
              >
                <span>🔗</span>
                <span>링크 추가</span>
              </button>
            </div>

            {attachments.length > 0 && (
              <div className="space-y-2 pt-1">
                {attachments.map((att, idx) => {
                  // 이미지는 내용을 바로 알아볼 수 있도록 큰 미리보기로 보여준다.
                  if (isImageAttachment(att)) {
                    return (
                      <div
                        key={`${att.url}-${idx}`}
                        className="relative bg-slate-50 border border-slate-200 rounded-xl overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const i = viewerImages.findIndex((v) => v.url === attachmentImageSrc(att));
                            setViewerIndex(i >= 0 ? i : 0);
                            setViewerOpen(true);
                          }}
                          className="block w-full cursor-pointer"
                          title="클릭하여 크게 보기"
                        >
                          <img
                            src={attachmentImageSrc(att)}
                            alt={att.name}
                            className="w-full max-h-64 object-contain bg-white"
                            loading="lazy"
                          />
                        </button>
                        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-t border-slate-200">
                          <span className="text-xs text-slate-500 truncate" title={att.name}>
                            🖼️ {att.name}
                            {att.size ? ` · ${formatFileSize(att.size)}` : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveAttachment(idx)}
                            className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0"
                            title="이미지 삭제"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={`${att.url}-${idx}`}
                      className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl gap-2 hover:bg-slate-100/80 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="text-xl shrink-0">{getFileIcon(att)}</span>
                        <div className="min-w-0 flex-1">
                          <a
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-bold text-slate-800 hover:text-primary truncate block hover:underline"
                            title={att.name}
                          >
                            {att.name}
                          </a>
                          {att.size && (
                            <span className="text-xs text-slate-400 block">
                              {formatFileSize(att.size)}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(idx)}
                        className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0"
                        title="파일 삭제"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {linkedItems.length > 0 && (
              <div className="space-y-2 pt-1">
                {linkedItems.map((link, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2.5 bg-yellow-50 border border-yellow-200 rounded-xl gap-2 hover:bg-yellow-100 transition-colors w-full"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="text-base shrink-0">🔗</span>
                      <span className="text-xs font-bold text-yellow-800 truncate block">
                        {link.title || link.text || '연결된 항목'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveLink(idx)}
                      className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50/50">
          <div className="flex items-center gap-1">
            {isEditing && onDelete && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await onDelete();
                  } catch (e) {
                    // 지우지 못했으면 칸을 닫지 않는다
                    showErrorToastOnce(`${text.noun}을(를) 지우지 못했습니다.`, e);
                    return;
                  }
                  onClose();
                }}
                className="px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-100 rounded-xl transition-colors cursor-pointer"
              >
                삭제
              </button>
            )}
            {isEditing && onMove && (
              <button
                type="button"
                onClick={() =>
                  onMove({
                    content: content.trim(),
                    labels: selectedLabels,
                    attachments,
                    linkedItems,
                    linkedItemsBase: baseLinksRef.current,
                    imageUrl: attachments.find(isImageAttachment)?.url,
                    tables: tables.map(tableForSave),
                  })
                }
                disabled={saving || uploadingFiles}
                title={kind === 'memo' ? '이 메모를 기록으로 옮기기 (날짜를 고른다)' : '이 기록을 메모로 옮기기 (첫 줄에 날짜를 남긴다)'}
                className="px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                {kind === 'memo' ? '↔ 기록으로' : '↔ 메모로'}
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || uploadingFiles}
              className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
            >
              닫기
            </button>
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={saving || uploadingFiles || (!content.trim() && attachments.length === 0 && tables.length === 0)}
              className="px-5 py-2 text-sm font-bold text-white bg-primary hover:bg-blue-600 rounded-xl shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>저장 중...</span>
                </>
              ) : (
                <span>저장</span>
              )}
            </button>
          </div>
        </div>
      </div>
  );

  const viewer = (
    <ImageViewerModal
      isOpen={viewerOpen}
      onClose={() => setViewerOpen(false)}
      images={viewerImages}
      startIndex={viewerIndex}
    />
  );

  return (
    <SidePanelFrame
      docked={docked}
      onClose={onClose}
      onBackdropClose={() => backdropCloseRef.current()}
      ariaLabel={`${text.noun} 쓰기`}
      panelRef={panelRef}
    >
      {panel}
      {viewer}
    </SidePanelFrame>
  );
}
