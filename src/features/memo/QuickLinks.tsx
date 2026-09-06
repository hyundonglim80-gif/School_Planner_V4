import React, { useState, useEffect } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';

export interface QuickLinkItem {
  id: string;
  name: string;
  url: string;
}

const DEFAULT_LINKS: QuickLinkItem[] = [
  { id: 'l1', name: '나이스(NEIS)', url: 'https://www.neis.go.kr' },
  { id: 'l2', name: 'K-에듀파인', url: 'https://klef.sen.go.kr' },
  { id: 'l3', name: '학교 홈페이지', url: 'https://www.school.go.kr' },
];

export default function QuickLinks() {
  const [links, setLinks] = useState<QuickLinkItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const docRef = doc(db, 'users', user.uid, 'settings', 'user_links');
    const unsubscribe = onSnapshot(docRef, (snap) => {
      if (snap.exists() && Array.isArray(snap.data().links)) {
        setLinks(snap.data().links);
      } else {
        setLinks(DEFAULT_LINKS);
      }
    });

    return () => unsubscribe();
  }, [auth.currentUser?.uid]);

  const handleAddLink = async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    const user = auth.currentUser;
    if (!user) return;

    let cleanUrl = newUrl.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    const newLink: QuickLinkItem = {
      id: `link_${Date.now()}`,
      name: newName.trim(),
      url: cleanUrl,
    };

    const updated = [...links, newLink];
    setSaving(true);
    try {
      await setDoc(doc(db, 'users', user.uid, 'settings', 'user_links'), {
        links: updated,
        updatedAt: Date.now(),
      }, { merge: true });
      setNewName('');
      setNewUrl('');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLink = async (id: string) => {
    const user = auth.currentUser;
    if (!user) return;

    const updated = links.filter((l) => l.id !== id);
    setSaving(true);
    try {
      await setDoc(doc(db, 'users', user.uid, 'settings', 'user_links'), {
        links: updated,
        updatedAt: Date.now(),
      }, { merge: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 p-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-base">🔗</span>
          <span className="text-xs font-extrabold text-slate-800">빠른 업무 링크</span>
          <span className="text-[11px] text-slate-400">자주 쓰는 교육 사이트 및 문서 바로가기</span>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 shadow-2xs"
        >
          <span>⚙️</span> 링크 설정
        </button>
      </div>

      {/* 링크 목록 칩들 */}
      <div className="flex flex-wrap gap-2">
        {links.length === 0 ? (
          <span className="text-xs text-slate-400 py-1">등록된 빠른 링크가 없습니다. [⚙️ 링크 설정]에서 등록하세요.</span>
        ) : (
          links.map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50/80 hover:bg-blue-100 border border-blue-200 text-blue-800 rounded-full text-xs font-bold transition-all shadow-2xs group"
            >
              <span>🔗</span>
              <span>{link.name}</span>
              <span className="text-[10px] text-blue-400 group-hover:text-blue-600 transition-colors">↗</span>
            </a>
          ))
        )}
      </div>

      {/* 링크 설정 모달 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚙️</span>
                <h3 className="text-sm font-extrabold text-slate-800">빠른 업무 링크 설정</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-black text-sm p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto text-xs">
              {/* 새 링크 추가 */}
              <div className="space-y-2 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <span className="font-bold text-slate-700 block">+ 새 링크 추가</span>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="사이트 이름 (예: K-에듀파인, 나이스)"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="URL (예: https://neis.go.kr)"
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleAddLink}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-xs transition-all"
                  >
                    추가
                  </button>
                </div>
              </div>

              {/* 현재 링크 목록 */}
              <div className="space-y-2">
                <span className="font-bold text-slate-700 block">등록된 링크 목록 ({links.length})</span>
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                  {links.map((link) => (
                    <div
                      key={link.id}
                      className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <span className="font-bold text-slate-800 truncate">{link.name}</span>
                        <span className="text-[10px] text-slate-400 truncate">{link.url}</span>
                      </div>
                      <button
                        onClick={() => handleDeleteLink(link.id)}
                        className="text-slate-300 hover:text-red-500 font-bold p-1 transition-colors"
                        title="삭제"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end px-5 py-3 border-t border-slate-100 bg-slate-50">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold transition-all"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
