// src/components/roster/RosterManageTab.tsx
//
// 관리 탭. 예전 명렬표 팝업의 본문을 그대로 옮겨 오고 두 가지를 더했다.
//   · 이름 옆 사진 썸네일
//   · 목록 / 타일 두 가지 보기
//
// 값을 들고 있는 것은 RosterModal이다. 여기서는 그리고, 눌린 것을 올려 보낸다.
import React from 'react';
import type { Student } from '../../hooks/useRoster';
import StudentPhoto from './StudentPhoto';
import type { StudentPhoto as PhotoEntry } from '../../hooks/useStudentPhotos';

export type RosterView = 'list' | 'tile';

interface RosterManageTabProps {
  students: Student[];
  view: RosterView;
  /** 사진 칸을 낼 것인가. 꺼져 있으면 열 자체가 없다. */
  showPhoto: boolean;
  photos: Map<number, PhotoEntry>;
  /** 사진 폴더가 연결되어 올릴 수 있는 상태인가 */
  canUploadPhoto: boolean;
  /** 지금 올리고 있는 학생의 번호 */
  uploadingNum: number | null;
  onUploadPhoto: (student: Student, file: File) => void;
  onUpdateStudent: (idx: number, field: keyof Student, val: any) => void;
  onRemoveStudent: (idx: number) => void;
  /** 검색 탭에서 넘어온 학생을 잠깐 짚어 준다 */
  highlightNum?: number | null;
}

export default function RosterManageTab({
  students,
  view,
  showPhoto,
  photos,
  canUploadPhoto,
  uploadingNum,
  onUploadPhoto,
  onUpdateStudent,
  onRemoveStudent,
  highlightNum,
}: RosterManageTabProps) {
  if (students.length === 0) {
    return (
      <div className="border border-slate-200 rounded-xl py-10 text-center text-xs text-slate-400 font-semibold">
        등록된 학생이 없습니다. 위의 '📊 시트 동기화' 또는 '+ 학생 추가'를 이용하세요.
      </div>
    );
  }

  if (view === 'tile') {
    return (
      <div className="grid grid-cols-6 gap-2">
        {students.map((st, idx) => {
          const photo = photos.get(st.num);
          return (
            <div
              key={`${st.num}-${idx}`}
              className={`border rounded-xl overflow-hidden bg-white shadow-2xs transition-all ${
                highlightNum === st.num ? 'border-primary ring-2 ring-primary/20' : 'border-slate-200'
              } ${st.isActive === false ? 'opacity-45' : ''}`}
            >
              <div className="relative">
                <StudentPhoto
                  url={photo?.url}
                  name={st.name}
                  shape="card"
                  canUpload={canUploadPhoto}
                  uploading={uploadingNum === st.num}
                  onUpload={(file) => onUploadPhoto(st, file)}
                  loose={photo?.exact === false}
                />
                {st.isActive === false && (
                  <span className="absolute top-1.5 left-1.5 bg-slate-600/90 text-white text-2xs font-bold rounded px-1.5 py-0.5">
                    전출
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <span className="bg-blue-50 text-primary rounded text-2xs font-extrabold px-1.5 py-0.5 shrink-0">
                  {st.num}
                </span>
                <input
                  type="text"
                  value={st.name || ''}
                  onChange={(e) => onUpdateStudent(idx, 'name', e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-xs font-extrabold text-slate-800 focus:outline-none focus:bg-slate-50 rounded px-0.5"
                />
                <button
                  type="button"
                  onClick={() => onRemoveStudent(idx)}
                  title="삭제"
                  className="text-slate-300 hover:text-red-500 font-black text-xs transition-colors cursor-pointer shrink-0"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
      <table className="w-full text-xs text-left border-collapse">
        <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
          <tr>
            {showPhoto && <th className="p-2.5 text-center w-13">사진</th>}
            <th className="p-2.5 text-center w-16">번호</th>
            <th className="p-2.5 w-27">이름</th>
            <th className="p-2.5 text-center w-17">성별</th>
            <th className="p-2.5 text-center w-19">상태</th>
            <th className="p-2.5">특이사항/조사표 메모</th>
            <th className="p-2.5 text-center w-9"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {students.map((st, idx) => {
            const photo = photos.get(st.num);
            return (
              <tr
                key={`${st.num}-${idx}`}
                className={`transition-colors ${
                  highlightNum === st.num ? 'bg-blue-50' : 'hover:bg-slate-50/80'
                } ${st.isActive === false ? 'opacity-40 bg-slate-100' : ''}`}
              >
                {showPhoto && (
                  <td className="p-1.5">
                    <div className="flex items-center justify-center">
                      <StudentPhoto
                        url={photo?.url}
                        name={st.name}
                        shape="circle"
                        size={32}
                        canUpload={canUploadPhoto}
                        uploading={uploadingNum === st.num}
                        onUpload={(file) => onUploadPhoto(st, file)}
                        loose={photo?.exact === false}
                      />
                    </div>
                  </td>
                )}
                <td className="p-1.5 text-center">
                  <input
                    type="number"
                    value={st.num || ''}
                    onChange={(e) => onUpdateStudent(idx, 'num', parseInt(e.target.value, 10) || 0)}
                    className="no-spinner w-12 text-center bg-white border border-slate-200 rounded px-1 py-1 font-bold text-slate-700 focus:outline-none"
                  />
                </td>
                <td className="p-1.5">
                  <input
                    type="text"
                    value={st.name || ''}
                    onChange={(e) => onUpdateStudent(idx, 'name', e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded px-2 py-1 font-bold text-slate-800 focus:outline-none"
                  />
                </td>
                <td className="p-1.5 text-center">
                  <select
                    value={st.gender || ''}
                    onChange={(e) => onUpdateStudent(idx, 'gender', e.target.value)}
                    className="bg-white border border-slate-200 rounded px-1.5 py-1 text-slate-700 font-medium focus:outline-none"
                  >
                    <option value="">-</option>
                    <option value="M">남</option>
                    <option value="F">여</option>
                  </select>
                </td>
                <td className="p-1.5 text-center">
                  <select
                    value={st.isActive !== false ? 'true' : 'false'}
                    onChange={(e) => onUpdateStudent(idx, 'isActive', e.target.value === 'true')}
                    className={`border rounded px-1.5 py-1 font-bold focus:outline-none ${
                      st.isActive !== false
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-200 text-slate-600 border-slate-300'
                    }`}
                  >
                    <option value="true">재학</option>
                    <option value="false">전출</option>
                  </select>
                </td>
                <td className="p-1.5">
                  <input
                    type="text"
                    value={st.note || ''}
                    onChange={(e) => onUpdateStudent(idx, 'note', e.target.value)}
                    placeholder="특이사항, 조사표 내용, 상담 기록..."
                    className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-slate-600 focus:outline-none"
                  />
                </td>
                <td className="p-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => onRemoveStudent(idx)}
                    className="text-slate-300 hover:text-red-500 font-black p-1 transition-colors cursor-pointer"
                    title="삭제"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
