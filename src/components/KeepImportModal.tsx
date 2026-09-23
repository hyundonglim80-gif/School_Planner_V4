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
  assetKey,
  type KeepNote,
  type KeepImportOptions,
} from '../lib/keepImport';
import { uploadToDrive, driveUrlToStore } from '../lib/driveApi';
import ModalShell, { ModalCloseButton } from './ModalShell';

interface MemoDraft {
  content: string;
  labels?: string[];
  attachments?: { name: string; url: string; type?: string; size?: number }[];
  imageUrl?: string;
}

export interface KeepImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 메모 한 건 만들기. 메모 화면의 addMemo를 그대로 받는다. */
  onAddMemo: (data: MemoDraft) => Promise<unknown>;
}

export default function KeepImportModal({ isOpen, onClose, onAddMemo }: KeepImportModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  /**
   * 고른 파일을 묶음으로 쌓아 둔다.
   *
   * 한 번에 다 고르지 못하는 경우가 많다. Takeout의 Keep 폴더에는 파일이 수백 개라
   * 나눠 고르기도 하고, 폴더가 여러 개로 갈려 오기도 한다. 예전에는 새로 고를 때마다
   * 앞서 고른 것이 통째로 날아가서, 두 번째 묶음만 들어갔다.
   *
   * 같은 파일을 또 골라도 한 번만 센다. 이름·크기·고친 때가 같으면 같은 파일로 본다.
   */
  const [batches, setBatches] = useState<{ key: string; notes: KeepNote[] }[]>([]);
  /**
   * 메모에 딸려 있던 사진·파일. Takeout은 그림을 메모와 같은 폴더에 따로 둔다
   * (메모의 .json 안에는 파일 이름만 적혀 있다). 그래서 폴더째 고르면 여기 모였다가,
   * 가져올 때 이름으로 짝을 찾아 드라이브에 올린다.
   */
  const [assets, setAssets] = useState<Map<string, File>>(new Map());
  const [opts, setOpts] = useState<KeepImportOptions>({ includeArchived: false, keepLabels: true });
  const [withFiles, setWithFiles] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [step, setStep] = useState('');

  const notes = batches.flatMap((b) => b.notes);
  const picked = selectNotesToImport(notes, opts);

  /** 고른 메모가 달고 있는 파일 중, 실제로 짝을 찾은 것 */
  const matchedAssets = new Set(
    picked.flatMap((n) => n.attachmentNames.map(assetKey)).filter((k) => assets.has(k))
  );

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(e.target.files || []);
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      const fresh: { key: string; notes: KeepNote[] }[] = [];
      const freshAssets = new Map<string, File>();
      let skippedKind = 0;
      for (const file of chosen) {
        const lower = file.name.toLowerCase();
        // .json은 메모, 사진·소리 파일은 메모에 딸린 것으로 받아 둔다.
        // .html 처럼 같은 내용을 한 번 더 담은 것만 건너뛴다.
        if (!lower.endsWith('.json')) {
          if (/\.(jpe?g|png|gif|webp|heic|bmp|3gp|m4a|mp3|wav|pdf)$/.test(lower)) {
            freshAssets.set(assetKey(file.name), file);
          } else {
            skippedKind += 1;
          }
          continue;
        }
        const text = await file.text();
        fresh.push({
          key: `${file.name}|${file.size}|${file.lastModified}`,
          notes: parseKeepFile(text, file.name),
        });
      }

      if (freshAssets.size > 0) {
        setAssets((prev) => new Map([...prev, ...freshAssets]));
      }

      // 알림은 상태 바꾸는 함수 안에서 띄우지 않는다. React가 그 함수를 두 번
      // 부를 수 있어(개발 모드) 같은 알림이 두 번 뜬다.
      const seen = new Set(batches.map((b) => b.key));
      const added = fresh.filter((b) => !seen.has(b.key));
      const again = fresh.length - added.length;
      if (added.length > 0) setBatches((prev) => [...prev, ...added]);

      const assetTail = freshAssets.size > 0 ? ` · 사진·파일 ${freshAssets.size}개` : '';
      if (added.length === 0 && fresh.length > 0) {
        showToast(`이미 고른 파일입니다 (${again}개).${assetTail}`);
      } else if (added.length > 0) {
        const foundNotes = added.reduce((n, b) => n + b.notes.length, 0);
        const tail = again > 0 ? ` (이미 고른 ${again}개는 건너뜀)` : '';
        showToast(`📂 파일 ${added.length}개에서 메모 ${foundNotes}건을 더했습니다.${assetTail}${tail}`);
      } else if (freshAssets.size > 0) {
        showToast(`🖼️ 사진·파일 ${freshAssets.size}개를 받아 두었습니다.`);
      }

      if (fresh.length === 0 && freshAssets.size === 0) {
        showErrorToast(
          `메모 파일을 찾지 못했습니다${skippedKind > 0 ? ` (.json이 아닌 파일 ${skippedKind}개)` : ''}. ` +
            'Takeout의 Keep 폴더에 있는 .json 파일을 골라 주세요.'
        );
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
    setStep('');
    let made = 0;
    let uploaded = 0;
    let failedUpload = 0;
    // 같은 파일을 두 메모가 함께 달고 있을 수 있다. 한 번만 올린다.
    const cache = new Map<string, { name: string; url: string; type?: string; size?: number }>();

    try {
      // 만든 순서대로 넣는다. V4 메모는 나중에 만든 것이 위로 오므로,
      // 옛 메모부터 넣어야 Keep에서 보던 차례와 비슷해진다.
      const ordered = [...picked].sort((a, b) => a.createdAt - b.createdAt);
      for (const note of ordered) {
        const attachments: { name: string; url: string; type?: string; size?: number }[] = [];
        const missing: string[] = [];

        for (const raw of note.attachmentNames) {
          const key = assetKey(raw);
          const file = withFiles ? assets.get(key) : undefined;
          if (!file) {
            missing.push(raw);
            continue;
          }
          const already = cache.get(key);
          if (already) {
            attachments.push(already);
            continue;
          }
          try {
            setStep(`사진·파일 올리는 중... ${file.name}`);
            const drive = await uploadToDrive(file, file.name);
            const made2 = {
              name: file.name,
              url: driveUrlToStore(file.type, drive),
              type: file.type || 'application/octet-stream',
              size: file.size,
            };
            cache.set(key, made2);
            attachments.push(made2);
            uploaded += 1;
          } catch (err) {
            // 올리기가 막혀도 메모는 들어가야 한다. 어떤 파일이었는지는 글로 남긴다.
            console.error('Keep 첨부 올리기 실패:', err);
            failedUpload += 1;
            missing.push(raw);
          }
        }

        setStep('');
        const draft = toMemoDraft(note, opts, missing);
        const firstImage = attachments.find((a) => (a.type || '').startsWith('image/'));
        await onAddMemo({
          ...draft,
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(firstImage ? { imageUrl: firstImage.url } : {}),
        });
        made += 1;
        setDone(made);
      }

      const tail = [
        uploaded > 0 ? `사진·파일 ${uploaded}개 함께` : '',
        failedUpload > 0 ? `${failedUpload}개는 올리지 못해 이름만 남김` : '',
      ]
        .filter(Boolean)
        .join(', ');
      showToast(`✅ Keep 메모 ${made}건을 가져왔습니다.${tail ? ` (${tail})` : ''}`);
      setBatches([]);
      setAssets(new Map());
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
            {busy && step
              ? step
              : busy && done > 0
              ? `가져오는 중... (${done}/${picked.length})`
              : `메모 ${picked.length}건 가져오기`}
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
            <li>
              받은 압축 파일을 풀면 <b>Takeout / Keep</b> 폴더에 메모마다 <b>.json</b> 파일이
              하나씩 있고, 메모에 붙어 있던 <b>사진·파일도 같은 폴더</b>에 함께 있습니다.
            </li>
            <li>
              아래에서 그 폴더의 <b>파일을 모두</b> 고릅니다(전체 선택). 사진까지 같이 골라야
              메모에 다시 붙습니다. <b>여러 번 나눠 골라도</b> 됩니다 — 고른 것이 쌓입니다.
            </li>
          </ol>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
          >
            📂 {batches.length > 0 ? 'Keep 파일 더 고르기' : 'Keep 파일 고르기'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json,image/*,audio/*,.pdf,.3gp"
            multiple
            onChange={handleFiles}
            className="hidden"
            aria-label="Keep 파일"
          />
          {(batches.length > 0 || assets.size > 0) && (
            <>
              <span className="text-xs text-slate-500">
                지금까지 메모 {notes.length}건
                {assets.size > 0 && ` · 사진·파일 ${assets.size}개`}
              </span>
              <button
                type="button"
                onClick={() => {
                  setBatches([]);
                  setAssets(new Map());
                }}
                disabled={busy}
                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold disabled:opacity-40 cursor-pointer"
              >
                고른 파일 비우기
              </button>
            </>
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
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={withFiles}
                  onChange={(e) => setWithFiles(e.target.checked)}
                  className="rounded text-primary focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                />
                사진·파일도 함께 붙이기
                <span className="font-normal text-slate-400">
                  {matchedAssets.size > 0
                    ? `(짝을 찾은 파일 ${matchedAssets.size}개를 드라이브에 올립니다)`
                    : '(같이 고른 사진·파일이 없습니다)'}
                </span>
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
                사진·파일은 구글 드라이브에 올려 메모에 붙입니다(다른 첨부와 같은 자리입니다).
                같이 고르지 않았거나 올리지 못한 것은 메모 끝에 이름으로 남습니다.
              </p>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
