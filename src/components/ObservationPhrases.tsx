// src/components/ObservationPhrases.tsx
//
// 관찰 문구 단추 (ROADMAP 10-2). 누르면 그 문구로 곧바로 한 줄을 남긴다(부르는 쪽이 저장 - 오늘 기록에 학생 태그를 붙여).
// '✏️ 문구'로 고치기: 문구 빼기(✕)·더하기. 목록은 계정에 하나(lib/observationPhrases), 자리표 학생 칸과 학생 기록(누가기록)이 같이 쓴다.
import React, { useEffect, useState } from 'react';
import { auth } from '../lib/firebase';
import {
  DEFAULT_PHRASES,
  MAX_PHRASE_LENGTH,
  MAX_PHRASES,
  saveObservationPhrases,
  subscribeObservationPhrases,
} from '../lib/observationPhrases';
import { showErrorToast, showToast } from '../utils/toast';

interface ObservationPhrasesProps {
  onPick: (phrase: string) => void;
  disabled?: boolean;
}

export default function ObservationPhrases({ onPick, disabled }: ObservationPhrasesProps) {
  const uid = auth.currentUser?.uid;
  const [phrases, setPhrases] = useState<string[]>(DEFAULT_PHRASES);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!uid) return;
    return subscribeObservationPhrases(uid, setPhrases, (err) => console.warn('관찰 문구를 불러오지 못했습니다:', err));
  }, [uid]);

  const save = async (next: string[]) => {
    if (!uid) return;
    try {
      await saveObservationPhrases(uid, next);
    } catch (e) {
      showErrorToast('관찰 문구를 저장하지 못했습니다. 네트워크를 확인해 주세요.', e);
    }
  };

  const add = () => {
    const p = draft.replace(/\s+/g, ' ').trim().slice(0, MAX_PHRASE_LENGTH);
    if (!p) return;
    if (phrases.includes(p)) return showToast('이미 있는 문구입니다.');
    if (phrases.length >= MAX_PHRASES) return showToast(`문구는 ${MAX_PHRASES}개까지 둘 수 있습니다.`);
    setDraft('');
    void save([...phrases, p]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1.5" data-observation-phrases>
      {phrases.map((p) => (
        <span key={p} className="inline-flex items-center">
          <button
            type="button"
            onClick={() => (editing ? undefined : onPick(p))}
            disabled={disabled && !editing}
            data-observation-phrase={p}
            title={editing ? undefined : `'${p}'을(를) 오늘 기록에 남깁니다`}
            className={`px-2 py-0.5 border text-2xs font-bold ${
              editing
                ? 'rounded-l-full bg-white border-slate-200 text-slate-500 cursor-default'
                : 'rounded-full bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100 disabled:opacity-40'
            }`}
          >
            {p}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => void save(phrases.filter((x) => x !== p))}
              aria-label={`'${p}' 빼기`}
              className="px-1.5 py-0.5 rounded-r-full border border-l-0 border-slate-200 bg-white text-2xs text-slate-400 hover:text-red-500"
            >
              ✕
            </button>
          )}
        </span>
      ))}
      {editing && (
        <span className="inline-flex items-center gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                add();
              }
            }}
            maxLength={MAX_PHRASE_LENGTH}
            placeholder="새 문구"
            aria-label="새 관찰 문구"
            className="w-28 px-2 py-0.5 border border-slate-200 rounded-full text-2xs"
          />
          <button type="button" onClick={add} className="px-2 py-0.5 rounded-full bg-slate-800 text-white text-2xs font-bold">
            ＋
          </button>
        </span>
      )}
      <button
        type="button"
        onClick={() => setEditing(!editing)}
        aria-pressed={editing}
        className="px-2 py-0.5 rounded-full text-2xs font-bold text-slate-400 hover:text-slate-700"
      >
        {editing ? '✓ 다 고침' : '✏️ 문구'}
      </button>
    </div>
  );
}
