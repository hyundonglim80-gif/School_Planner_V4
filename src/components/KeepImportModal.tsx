// src/components/KeepImportModal.tsx
//
// 구글 Keep 메모를 V4 메모로 옮긴다 (Takeout 파일 읽기).
//
// ⚠️ 실시간 연동은 왜 없는가: Keep API는 구글 워크스페이스 조직용이라 관리자가
//    도메인 위임을 걸어 서비스 계정으로만 부를 수 있다. 개인 지메일 계정에는
//    받을 수 있는 권한(scope) 자체가 없어서, 브라우저에서 도는 이 앱이 선생님
//    Keep을 직접 읽을 길이 없다. 그래서 구글이 주는 내보내기를 읽는 쪽으로 간다.
import { useRef, useState } from 'react';
import { showToast, showErrorToast } from '../utils/toast';
import {
  parseKeepFile,
  selectNotesToImport,
  toMemoDraft,
  type KeepNote,
  type KeepImportOptions,
} from '../lib/keepImport';
import ModalShell, { ModalCloseButton } from './ModalShell';

export interface KeepImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 메모 한 건 만들기. 메모 화면의 addMemo를 그대로 받는다. */
  onAddMemo: (data: { content: string; labels?: string[] }) => Promise<unknown>;
}

export default function KeepImportModal({ isOpen, onClose, onAddMemo }: KeepImportModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState<KeepNote[]>([]);
  const [readCount, setReadCount] = useState(0);
  const [opts, setOpts] = useState<KeepImportOptions>({ includeArchived: false, keepLabels: true });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  const picked = selectNotesToImport(notes, opts);

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setBusy(true);
    try {
      const all: KeepNote[] = [];
      for (const file of files) {
        // Takeout 폴더에는 .html 같은 것도 섞여 있다. JSON만 읽고 나머지는 건너뛴다.
        if (!file.name.toLowerCase().endsWith('.json')) continue;
        const text = await file.text();
        all.push(...parseKeepFile(text, file.name));
      }
      setNotes(all);
      setReadCount(files.length);
      if (all.length === 0) {
        showErrorToast('메모를 찾지 못했습니다. Takeout의 Keep 폴더에 있는 .json 파일을 골라 주세요.');
      }
    } catch (err) {
      showErrorToast('파일을 읽지 못했습니다.', err);
    } finally {
      setBusy(false);
      // 같은 파일을 다시 고를 수 있게 비운다
      e.target.value = '';
    }
  };

  const handleImport = async () => {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    setDone(0);
    let made = 0;
    try {
      // 만든 순서대로 넣는다. V4 메모는 나중에 만든 것이 위로 오므로,
      // 옛 메모부터 넣어야 Keep에서 보던 차례와 비슷해진다.
      const ordered = [...picked].sort((a, b) => a.createdAt - b.createdAt);
      for (const note of ordered) {
        await onAddMemo(toMemoDraft(note, opts));
        made += 1;
        setDone(made);
      }
      showToast(`✅ Keep 메모 ${made}건을 가져왔습니다.`);
      setNotes([]);
      setReadCount(0);
      onClose();
    } catch (err) {
      // 도중에 끊겨도 여기까지 들어간 것은 남는다. 몇 건이 들어갔는지 알려 준다.
      showErrorToast(`가져오다 멈췄습니다 (${made}건까지 들어갔습니다).`, err);
    } finally {
      setBusy(false);
    }
  };

  const skipped = notes.length - picked.length;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="lg"
      title="📥 구글 Keep 메모 가져오기"
      footer={
        <>
          <ModalCloseButton onClose={onClose} />
          <button
            type="button"
            onClick={handleImport}
            disabled={busy || picked.length === 0}
            className="px-5 py-2 bg-primary text-white rounded-xl text-xs font-bold shadow-xs hover:bg-primary/90 disabled:opacity-40 transition-all cursor-pointer"
          >
            {busy && done > 0 ? `가져오는 중... (${done}/${picked.length})` : `메모 ${picked.length}건 가져오기`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 leading-relaxed">
          <p className="font-bold mb-1">Keep은 실시간 연동이 안 됩니다</p>
          <p>
            구글이 Keep을 바깥 앱에 열어 주지 않습니다(회사·학교 계정 관리자용 통로만 있고,
            개인 계정에는 받을 수 있는 권한 자체가 없습니다). 대신 구글이 주는 내보내기 파일을
            읽어 옵니다.
          </p>
        </div>

        <div>
          <h3 className="text-xs font-bold text-slate-800 mb-1.5">가져오는 차례</h3>
          <ol className="text-xs text-slate-600 leading-relaxed list-decimal pl-4 space-y-0.5">
            <li>
              <a
                href="https://takeout.google.com/settings/takeout/custom/keep"
                target="_blank"
                rel="noreferrer"
                className="text-primary font-bold underline"
              >
                구글 내보내기(Takeout)
              </a>
              에서 <b>Keep</b>만 골라 내보냅니다.
            </li>
            <li>받은 압축 파일을 풀면 <b>Takeout / Keep</b> 폴더에 메모마다 <b>.json</b> 파일이 하나씩 있습니다.</li>
            <li>아래에서 그 <b>.json 파일을 모두</b> 고릅니다 (폴더째 골라도 됩니다).</li>
          </ol>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
          >
            📂 Keep 파일 고르기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            multiple
            onChange={handleFiles}
            className="hidden"
            aria-label="Keep 파일"
          />
          {readCount > 0 && (
            <span className="text-xs text-slate-500">
              파일 {readCount}개에서 메모 {notes.length}건을 찾았습니다
            </span>
          )}
        </div>

        {notes.length > 0 && (
          <>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={opts.keepLabels}
                  onChange={(e) => setOpts((p) => ({ ...p, keepLabels: e.target.checked }))}
                  className="rounded text-primary focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                />
                Keep의 라벨도 함께 가져오기
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={opts.includeArchived}
                  onChange={(e) => setOpts((p) => ({ ...p, includeArchived: e.target.checked }))}
                  className="rounded text-primary focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                />
                보관(Archive)한 메모도 가져오기
              </label>
              <p className="text-xs text-slate-500 pt-0.5">
                휴지통에 있던 메모는 가져오지 않습니다.
                {skipped > 0 && ` (지금 ${skipped}건이 빠집니다)`}
              </p>
            </div>

            <div>
              <h3 className="text-xs font-bold text-slate-800 mb-1.5">
                가져올 메모 미리보기 ({picked.length}건)
              </h3>
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {picked.slice(0, 20).map((note, i) => (
                  <div key={i} className="px-3 py-2">
                    <p className="text-xs text-slate-800 whitespace-pre-wrap line-clamp-2">{note.content}</p>
                    {note.labels.length > 0 && opts.keepLabels && (
                      <p className="text-xs text-slate-400 mt-0.5">🏷️ {note.labels.join(', ')}</p>
                    )}
                  </div>
                ))}
                {picked.length > 20 && (
                  <p className="px-3 py-2 text-xs text-slate-400">… 그리고 {picked.length - 20}건 더</p>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1.5">
                Keep에 붙어 있던 사진·파일은 함께 오지 않습니다. 어떤 파일이 있었는지는 메모
                끝에 이름으로 남습니다.
              </p>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
