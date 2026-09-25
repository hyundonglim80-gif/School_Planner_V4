// src/features/memo/MemoQuickAdd.tsx
//
// V3 메모 화면의 입력 칸. 배너를 열지 않고 화면 위에서 바로 적어 넣는다.
//   [라벨 고르기 ....................] [⚙️ 설정] [📥 Keep]
//   [ 새 할 일이나 메모를 추가하세요    ] [📎] [추가]
// Ctrl+Enter 또는 Ctrl+S로도 추가한다. 고친 뒤의 자세한 편집(링크 등)은
// 카드를 눌러 여는 오른쪽 배너에서 한다.
import React, { useRef, useState } from 'react';
import AutoTextarea from '../../components/AutoTextarea';
import { uploadToDrive, driveUrlToStore } from '../../lib/driveApi';
import { auth } from '../../lib/firebase';
import { showToast, showErrorToast } from '../../utils/toast';
import type { MemoAttachment } from '../../hooks/useMemos';

interface MemoQuickAddProps {
  labelOptions: string[];
  /** 고른 라벨. 화면에서 거르개를 바꾸면 그 라벨로 다시 맞춰 준다. */
  labels: string[];
  onLabelsChange: (labels: string[]) => void;
  getLabelColor: (name: string) => { bg: string; text: string; border: string };
  onAdd: (draft: { content: string; labels: string[]; attachments: MemoAttachment[] }) => Promise<unknown>;
  onOpenLabelSettings: () => void;
  onOpenKeepImport: () => void;
}

export default function MemoQuickAdd({
  labelOptions,
  labels,
  onLabelsChange,
  getLabelColor,
  onAdd,
  onOpenLabelSettings,
  onOpenKeepImport,
}: MemoQuickAddProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<MemoAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // 추가가 끝나기 전에 한 번 더 눌리면(키를 누른 채 두거나 두 번 빨리 누르면)
  // 같은 메모가 두 개 생긴다. 다음 그림을 기다리지 않도록 ref로 막는다.
  const submittingRef = useRef(false);

  const toggleLabel = (name: string) => {
    onLabelsChange(labels.includes(name) ? labels.filter((l) => l !== name) : [...labels, name]);
  };

  const submit = async () => {
    const content = text.trim();
    if (submittingRef.current || uploading) return;
    if (!content && attachments.length === 0) return;
    submittingRef.current = true;
    const pending = attachments;
    // 칸을 먼저 비운다. 저장을 기다리는 동안 다시 눌러도 빈 칸이라 아무 일도 없다.
    setText('');
    setAttachments([]);
    try {
      await onAdd({ content, labels, attachments: pending });
    } catch (error) {
      console.error('메모 추가 실패:', error);
      setText(content);
      setAttachments(pending);
      showErrorToast('메모를 추가하지 못했습니다.');
    } finally {
      submittingRef.current = false;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isSave = (e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key === 's' || e.key === 'S');
    if (!isSave) return;
    e.preventDefault();
    // 배너의 Ctrl+S 처리(창 전체에서 듣는다)까지 가지 않게 한다.
    e.stopPropagation();
    if (e.repeat) return;
    void submit();
  };

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!auth.currentUser) {
      showToast('로그인이 필요합니다.');
      return;
    }
    setUploading(true);
    try {
      const uploaded: MemoAttachment[] = [];
      for (const file of Array.from(files)) {
        const drive = await uploadToDrive(file, file.name);
        uploaded.push({
          name: file.name,
          url: driveUrlToStore(file.type, drive),
          type: file.type || 'application/octet-stream',
          size: file.size,
          driveId: drive.id,
        });
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (error) {
      console.error('파일 업로드 에러:', error);
      showErrorToast('파일 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-3 sm:p-5">
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex flex-wrap gap-1 flex-1 min-w-0" aria-label="새 메모 라벨">
          {labelOptions.map((name) => {
            const on = labels.includes(name);
            const color = getLabelColor(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggleLabel(name)}
                aria-pressed={on}
                title={on ? `'${name}' 라벨 빼기` : `'${name}' 라벨 붙이기`}
                className={`px-2 py-0.5 rounded-full text-xs border transition-all cursor-pointer ${
                  on ? 'font-bold' : 'font-medium bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                }`}
                style={on ? { backgroundColor: color.bg, color: color.text, borderColor: color.border } : undefined}
              >
                {name}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenLabelSettings}
            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold cursor-pointer"
            title="메모 라벨 설정"
          >
            ⚙️<span className="hidden sm:inline"> 설정</span>
          </button>
          <button
            type="button"
            onClick={onOpenKeepImport}
            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold cursor-pointer"
            title="구글 Keep에서 내보낸 메모 가져오기"
          >
            📥<span className="hidden sm:inline"> Keep 가져오기</span>
          </button>
        </div>
      </div>

      <div className="flex items-start gap-1.5 sm:gap-2">
        <AutoTextarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="새 할 일이나 메모를 추가하세요"
          aria-label="새 메모 내용"
          rows={1}
          className="flex-1 min-w-0 min-h-11 px-3 py-2.5 border-2 border-slate-200 focus:border-slate-400 rounded-xl text-sm sm:text-base leading-snug outline-none resize-none overflow-hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="h-11 px-3 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-xl text-base cursor-pointer disabled:opacity-50 shrink-0"
          title="파일/문서 첨부"
        >
          📎
        </button>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={handleFiles} />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={uploading}
          className="h-11 px-4 sm:px-5 bg-primary hover:bg-blue-600 text-white rounded-xl text-sm sm:text-base font-bold cursor-pointer disabled:opacity-50 shrink-0"
          title="추가 (Ctrl+Enter)"
        >
          추가
        </button>
      </div>

      {uploading && (
        <p className="mt-2 text-xs font-bold text-primary">⏳ 구글 드라이브로 파일을 올리는 중...</p>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {attachments.map((a, i) => (
            <span
              key={`${a.url}-${i}`}
              className="inline-flex items-center gap-1.5 max-w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700"
            >
              <span className="truncate max-w-40">📄 {a.name}</span>
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                className="w-4 h-4 flex items-center justify-center rounded-full bg-rose-500 text-white text-2xs cursor-pointer shrink-0"
                title="첨부 빼기"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
