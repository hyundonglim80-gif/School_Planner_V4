// src/components/LinkPreviewCards.tsx
//
// 글 안의 사이트 주소·지도 링크 미리보기 카드 (lib/linkPreview, 2026-10-07).
// 메모·기록 카드(펼쳤을 때)와 쓰는 칸 글 아래에 보인다. 누르면 새 탭으로 연다(카드의 '고치기'로 번지지 않게 막는다).
// 구글 지도는 '지도 보기'를 누를 때만 작은 지도를 띄운다 - 목록에 지도가 여러 개 뜨면 무겁다.
import React, { useMemo, useState } from 'react';
import { previewsOf, type LinkPreview } from '../lib/linkPreview';

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

function Card({ p }: { p: LinkPreview }) {
  const [mapOpen, setMapOpen] = useState(false);
  const [iconOk, setIconOk] = useState(true);
  return (
    <div data-link-preview={p.kind} className="rounded-xl border border-slate-200 bg-slate-50/70 overflow-hidden" onClick={stop}>
      <a href={p.url} target="_blank" rel="noreferrer" onClick={stop} className="flex items-center gap-2.5 p-2 hover:bg-white transition-colors min-w-0">
        {p.kind === 'youtube' && p.thumb ? (
          <img src={p.thumb} alt="" loading="lazy" className="w-24 h-[54px] object-cover rounded-lg shrink-0 bg-slate-200" />
        ) : p.kind === 'map' ? (
          <span className="w-10 h-10 shrink-0 rounded-lg bg-emerald-100 flex items-center justify-center text-xl">🗺️</span>
        ) : p.icon && iconOk ? (
          <img src={p.icon} alt="" loading="lazy" onError={() => setIconOk(false)} className="w-8 h-8 shrink-0 rounded" />
        ) : (
          <span className="w-8 h-8 shrink-0 rounded bg-slate-200 flex items-center justify-center">🔗</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold text-slate-800 truncate">{p.title}</span>
          <span className="block text-2xs text-slate-500 truncate">
            {p.service ? `${p.service} · ` : ''}
            {p.kind === 'site' ? p.sub || '/' : p.domain}
          </span>
        </span>
        <span className="text-2xs text-slate-400 shrink-0">열기 ↗</span>
      </a>
      {p.embed && (
        <div className="border-t border-slate-200">
          {mapOpen ? (
            <iframe title={`${p.title} 지도`} src={p.embed} loading="lazy" className="w-full h-48 border-0" referrerPolicy="no-referrer-when-downgrade" />
          ) : (
            <button type="button" data-link-preview-map onClick={(e) => { stop(e); setMapOpen(true); }} className="w-full py-1 text-2xs font-bold text-emerald-700 hover:bg-emerald-50">
              🗺️ 지도 보기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function LinkPreviewCards({ text, className = '' }: { text: string; className?: string }) {
  const list = useMemo(() => previewsOf(text), [text]);
  if (list.length === 0) return null;
  return (
    <div className={`grid gap-1.5 ${className}`} data-link-previews>
      {list.map((p) => (
        <Card key={p.url} p={p} />
      ))}
    </div>
  );
}
