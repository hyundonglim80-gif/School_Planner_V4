import React, { useState } from 'react';
import { useGroups } from '../hooks/useGroups';
import { auth } from '../lib/firebase';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface GroupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function GroupModal({ isOpen, onClose }: GroupModalProps) {
  useBodyScrollLock(isOpen);
  const { groups, createGroup, joinGroup, leaveGroup, deleteGroup } = useGroups();
  const [activeTab, setActiveTab] = useState<'list' | 'create' | 'join'>('list');
  const [newGroupName, setNewGroupName] = useState('');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentUserId = auth.currentUser?.uid;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim() || loading) return;

    try {
      setLoading(true);
      await createGroup(newGroupName.trim());
      setNewGroupName('');
      setActiveTab('list');
    } catch (err: any) {
      alert(err.message || '그룹 생성 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCodeInput.trim() || loading) return;

    try {
      setLoading(true);
      await joinGroup(inviteCodeInput.trim());
      setInviteCodeInput('');
      setActiveTab('list');
    } catch (err: any) {
      alert(err.message || '그룹 참여 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopyFeedback(code);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 백드롭 */}
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={onClose} />

      {/* 모달 박스 */}
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl z-10 overflow-hidden flex flex-col max-h-[90vh]">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="text-xl">👥</span>
            <h3 className="text-lg font-bold text-slate-800">공유 그룹 관리</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 탭 네비게이션 */}
        <div className="flex border-b border-slate-100 px-6 pt-2 gap-4">
          <button
            onClick={() => setActiveTab('list')}
            className={`pb-3 text-xs font-bold transition-all border-b-2 ${
              activeTab === 'list'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            내 그룹 ({groups.length})
          </button>
          <button
            onClick={() => setActiveTab('create')}
            className={`pb-3 text-xs font-bold transition-all border-b-2 ${
              activeTab === 'create'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            + 새 그룹 만들기
          </button>
          <button
            onClick={() => setActiveTab('join')}
            className={`pb-3 text-xs font-bold transition-all border-b-2 ${
              activeTab === 'join'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            초대 코드로 참여
          </button>
        </div>

        {/* 탭 본문 */}
        <div className="p-6 overflow-y-auto flex-1 min-h-0" data-scroll-lock>
          {activeTab === 'list' && (
            <div className="space-y-3">
              {groups.length > 0 ? (
                groups.map((group) => {
                  const isOwner = group.ownerId === currentUserId;
                  return (
                    <div
                      key={group.id}
                      className="p-4 rounded-xl border border-slate-200/80 bg-slate-50/40 flex items-center justify-between gap-4"
                    >
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-bold text-sm text-slate-800">{group.name}</h4>
                          {isOwner && (
                            <span className="px-2 py-0.5 rounded-full text-[15px] font-extrabold bg-blue-100 text-blue-700">
                              그룹장
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          <span>개설자: {group.ownerName}</span>
                          <span>멤버: {group.members?.length || 1}명</span>
                        </div>

                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-slate-500 font-medium">초대 코드:</span>
                          <span className="px-2 py-0.5 bg-white border border-slate-200 rounded font-mono font-bold text-xs text-slate-700 select-all">
                            {group.inviteCode}
                          </span>
                          <button
                            onClick={() => handleCopyCode(group.inviteCode)}
                            className="px-2 py-0.5 text-[16.5px] font-bold text-primary hover:bg-blue-50 rounded transition-colors"
                          >
                            {copyFeedback === group.inviteCode ? '복사됨!' : '코드 복사'}
                          </button>
                        </div>
                      </div>

                      <div>
                        {isOwner ? (
                          <button
                            onClick={() => {
                              if (window.confirm(`'${group.name}' 그룹을 영구 삭제하시겠습니까?`)) {
                                deleteGroup(group.id);
                              }
                            }}
                            className="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-xs font-bold transition-colors"
                          >
                            삭제
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              if (window.confirm(`'${group.name}' 그룹에서 탈퇴하시겠습니까?`)) {
                                leaveGroup(group.id);
                              }
                            }}
                            className="px-3 py-1.5 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-lg text-xs font-bold transition-colors"
                          >
                            탈퇴
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-10 text-slate-400 text-xs">
                  <span className="text-3xl block mb-2">👥</span>
                  <p>참여 중인 공유 그룹이 없습니다.</p>
                  <p className="mt-1 text-slate-400">상단 탭에서 새 그룹을 만들거나 초대 코드로 참여해 보세요.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'create' && (
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  새 그룹 이름
                </label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="예: 3학년 2반 교과협의회, 교무기획부"
                  className="w-full px-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  autoFocus
                />
                <p className="text-[16.5px] text-slate-400 mt-1">
                  그룹이 생성되면 6자리 고유 초대 코드가 발급됩니다.
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={!newGroupName.trim() || loading}
                  className="px-5 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-xl text-xs font-bold shadow-xs transition-all disabled:opacity-40"
                >
                  {loading ? '생성 중...' : '그룹 만들기'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'join' && (
            <form onSubmit={handleJoin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  초대 코드 입력
                </label>
                <input
                  type="text"
                  value={inviteCodeInput}
                  onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                  placeholder="6자리 코드 입력 (예: X9K2LM)"
                  maxLength={10}
                  className="w-full px-4 py-2.5 text-sm uppercase tracking-widest font-mono font-bold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  autoFocus
                />
                <p className="text-[16.5px] text-slate-400 mt-1">
                  다른 선생님께 전달받은 초대 코드를 입력해 그룹에 참여하세요.
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={!inviteCodeInput.trim() || loading}
                  className="px-5 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-xl text-xs font-bold shadow-xs transition-all disabled:opacity-40"
                >
                  {loading ? '참여 중...' : '그룹 참여하기'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
