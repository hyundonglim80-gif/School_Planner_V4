import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useRoster, type ClassRoster, type Student } from '../hooks/useRoster';

interface RosterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function RosterModal({ isOpen, onClose }: RosterModalProps) {
  const { rosterList, saveRosterList } = useRoster();

  const [currentClasses, setCurrentClasses] = useState<ClassRoster[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [addCount, setAddCount] = useState<string>('');
  const [spreadsheetId, setSpreadsheetId] = useState<string>('');
  const [showConfigInput, setShowConfigInput] = useState(false);
  const [configInputId, setConfigInputId] = useState('');
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    if (rosterList && rosterList.length > 0) {
      setCurrentClasses(JSON.parse(JSON.stringify(rosterList)));
    } else {
      setCurrentClasses([
        {
          year: new Date().getFullYear(),
          grade: '1',
          classNum: '1',
          students: [],
        },
      ]);
    }
    setCurrentIndex(0);

    // 구글 시트 ID 가져오기
    const loadBackupConfig = async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const snap = await getDoc(doc(db, 'users', user.uid, 'settings', 'backup_config'));
        if (snap.exists() && snap.data().spreadsheetId) {
          setSpreadsheetId(snap.data().spreadsheetId);
          setConfigInputId(snap.data().spreadsheetId);
        }
      } catch (e) {
        console.error(e);
      }
    };
    loadBackupConfig();
  }, [isOpen, rosterList]);

  if (!isOpen) return null;

  const currentClass = currentClasses[currentIndex] || {
    year: new Date().getFullYear(),
    grade: '',
    classNum: '',
    students: [],
  };

  const students = currentClass.students || [];
  const activeCount = students.filter((s) => s.isActive !== false).length;
  const inactiveCount = students.length - activeCount;

  // 구글 시트 열기
  const handleOpenGoogleSheet = async () => {
    if (spreadsheetId) {
      window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, '_blank');
      return;
    }

    const input = prompt('연결할 백업 구글 스프레드시트의 주소(URL) 또는 ID를 입력해주세요:');
    if (!input || !input.trim()) return;

    let cleanId = input.trim();
    const match = cleanId.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match) cleanId = match[1];

    const user = auth.currentUser;
    if (user) {
      await setDoc(doc(db, 'users', user.uid, 'settings', 'backup_config'), {
        spreadsheetId: cleanId,
        updatedAt: Date.now(),
      }, { merge: true });
      setSpreadsheetId(cleanId);
      window.open(`https://docs.google.com/spreadsheets/d/${cleanId}/edit`, '_blank');
    }
  };

  // 구글 시트 ID 저장
  const handleSaveSpreadsheetId = async () => {
    const user = auth.currentUser;
    if (!user) return;
    let cleanId = configInputId.trim();
    // URL 형태로 입력했을 때 ID만 추출
    const urlMatch = cleanId.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (urlMatch) {
      cleanId = urlMatch[1];
    }

    if (!cleanId) return alert('유효한 구글 시트 ID나 URL을 입력해주세요.');

    try {
      await setDoc(doc(db, 'users', user.uid, 'settings', 'backup_config'), {
        spreadsheetId: cleanId,
        updatedAt: Date.now(),
      }, { merge: true });
      setSpreadsheetId(cleanId);
      setShowConfigInput(false);
      alert('✅ 구글 시트가 연결되었습니다.');
    } catch (e) {
      console.error(e);
      alert('설정 저장 중 오류가 발생했습니다.');
    }
  };

  // 📊 구글 시트에서 명단 불러오기 (V3 로직 완벽 연동)
  const handleImportFromGoogleSheet = async () => {
    const { year, grade, classNum } = currentClass;
    if (!year || !grade || !classNum) {
      return alert('가져올 학급의 학년도, 학년, 반 정보를 먼저 위 칸에 입력해주세요.');
    }

    if (!spreadsheetId) {
      await handleOpenGoogleSheet();
      return;
    }

    // V3 호환: Google Sheets API v4 + OAuth 토큰 방식 (CORS 문제 해결)
    const token = sessionStorage.getItem('google_api_token');
    if (!token) {
      alert('구글 로그인이 필요합니다.\n로그아웃 후 다시 로그인해주세요.');
      return;
    }

    const sheetName = `조사표_${year}-${grade}-${classNum}`;
    setLoadingSheet(true);

    try {
      // 1. Google Sheets API v4로 데이터 요청 (V3와 동일한 방식)
      const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A:Z`;
      const res = await fetch(apiUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        // 시트가 없을 경우 자동 생성 (V3 로직)
        if (confirm(`[${sheetName}] 탭이 백업 시트에 존재하지 않습니다.\n해당 학급의 시트 탭을 자동으로 생성하시겠습니까?`)) {
          // 시트 탭 추가
          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] })
          });

          // 기본 헤더 행 쓰기
          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1?valueInputOption=USER_ENTERED`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [['번호', '이름', '성별']] })
          });

          alert(`✅ 시트 생성이 완료되었습니다!\n\n곧 열리는 구글 시트의 [${sheetName}] 탭에 학생 번호와 이름을 등록하신 뒤, 앱으로 돌아와 다시 '구글 시트에서 불러오기'를 눌러주세요.`);
          window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, '_blank');
        }
        return;
      }

      const data = await res.json();
      const rows: string[][] = data.values || [];

      if (rows.length === 0) {
        alert(`[${sheetName}] 시트에 등록된 학생 데이터가 없습니다.\n시트에 번호와 이름을 등록해주세요.`);
        window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, '_blank');
        return;
      }

      // 2. 헤더 행 찾기 및 학생 데이터 파싱 (V3 로직)
      const parsedStudents: Student[] = [];
      let startIndex = 0;

      const headerIndex = rows.findIndex(r => r[0] === '번호' || r[0] === '순번');
      if (headerIndex !== -1) startIndex = headerIndex + 1;

      for (let i = startIndex; i < rows.length; i++) {
        const row = rows[i];
        const num = parseInt(row[0], 10);
        const name = row[1] ? row[1].trim() : '';
        const genderRaw = row[2] ? row[2].trim() : '';
        const gender = (genderRaw === '남' || genderRaw.toUpperCase() === 'M') ? 'M' : (genderRaw === '여' || genderRaw.toUpperCase() === 'F') ? 'F' : '';
        const note = row.slice(3).filter(Boolean).join(' ');

        if (!isNaN(num) && name) {
          parsedStudents.push({ num, name, gender, isActive: true, note });
        }
      }

      if (parsedStudents.length === 0) {
        alert('유효한 학생 데이터(번호, 이름)를 찾지 못했습니다.\n시트의 A열과 B열에 데이터를 올바르게 입력했는지 확인해주세요.');
        return;
      }

      if (confirm(`[${sheetName}] 시트에서 총 ${parsedStudents.length}명의 학생을 찾았습니다.\n현재 앱의 명단을 이 데이터로 교체하시겠습니까?`)) {
        const updated = [...currentClasses];
        updated[currentIndex] = {
          ...updated[currentIndex],
          students: parsedStudents,
        };
        setCurrentClasses(updated);
        alert('✅ 성공적으로 반영되었습니다.\n하단 \'클라우드 저장\' 버튼을 눌러 완전히 적용해주세요.');
      }
    } catch (e: any) {
      console.error(e);
      if (e.message && (e.message.includes('401') || e.message.includes('403'))) {
        alert('구글 API 권한이 거부되었습니다.\n\n[해결 방법]\n1. 로그아웃합니다.\n2. 다시 로그인할 때 뜨는 구글 팝업창에서 모든 접근 권한 체크박스를 반드시 체크해주세요!');
      } else {
        alert('구글 시트 연동 중 오류가 발생했습니다: ' + e.message);
      }
    } finally {
      setLoadingSheet(false);
    }
  };

  // 학급 변경
  const handleChangeClass = (idx: number) => {
    setCurrentIndex(idx);
  };

  // 새 학급 추가
  const handleAddNewClass = () => {
    const newCls: ClassRoster = {
      year: new Date().getFullYear(),
      grade: '',
      classNum: '',
      students: [],
    };
    const updated = [...currentClasses, newCls];
    setCurrentClasses(updated);
    setCurrentIndex(updated.length - 1);
  };

  // 현재 학급 삭제
  const handleDeleteCurrentClass = () => {
    if (currentClasses.length <= 1) {
      if (confirm('모든 학급 정보를 비우시겠습니까?')) {
        setCurrentClasses([
          {
            year: new Date().getFullYear(),
            grade: '',
            classNum: '',
            students: [],
          },
        ]);
        setCurrentIndex(0);
      }
      return;
    }

    const className = `${currentClass.year}년 ${currentClass.grade ? currentClass.grade + '학년 ' : ''}${currentClass.classNum ? currentClass.classNum + '반' : ''}`;
    if (confirm(`정말 [${className}] 학급을 삭제하시겠습니까?`)) {
      const updated = currentClasses.filter((_, i) => i !== currentIndex);
      setCurrentClasses(updated);
      setCurrentIndex(Math.max(0, currentIndex - 1));
    }
  };

  // 학급 메타 수정
  const handleUpdateClassMeta = (field: 'year' | 'grade' | 'classNum', val: any) => {
    const updated = [...currentClasses];
    updated[currentIndex] = {
      ...updated[currentIndex],
      [field]: val,
    };
    setCurrentClasses(updated);
  };

  // 학생 N명 추가
  const handleAddStudents = () => {
    const count = parseInt(addCount, 10) || 1;
    if (count < 1) return;

    const updated = [...currentClasses];
    const currentStudents = [...(updated[currentIndex].students || [])];
    const startNum = currentStudents.length + 1;

    for (let i = 0; i < count; i++) {
      currentStudents.push({
        num: startNum + i,
        name: '000',
        gender: '',
        isActive: true,
        note: '',
      });
    }

    updated[currentIndex].students = currentStudents;
    setCurrentClasses(updated);
    setAddCount('');
  };

  // 학생 개별 수정
  const handleUpdateStudent = (idx: number, field: keyof Student, val: any) => {
    const updated = [...currentClasses];
    const currentStudents = [...(updated[currentIndex].students || [])];
    currentStudents[idx] = {
      ...currentStudents[idx],
      [field]: val,
    };
    updated[currentIndex].students = currentStudents;
    setCurrentClasses(updated);
  };

  // 학생 개별 삭제
  const handleRemoveStudent = (idx: number) => {
    const student = students[idx];
    const name = student.name === '000' || !student.name ? `${student.num}번` : student.name;
    if (confirm(`'${name}' 학생을 명단에서 삭제하시겠습니까?\n(이미 평가나 일지 기록이 있다면 '전출' 처리를 권장합니다.)`)) {
      const updated = [...currentClasses];
      updated[currentIndex].students = students.filter((_, i) => i !== idx);
      setCurrentClasses(updated);
    }
  };

  // 학생 전체 삭제
  const handleRemoveAllStudents = () => {
    if (students.length === 0) return alert('삭제할 학생이 없습니다.');
    if (confirm('현재 학급의 모든 학생을 삭제하시겠습니까?\n(하단 클라우드 저장을 눌러야 최종 반영됩니다.)')) {
      const updated = [...currentClasses];
      updated[currentIndex].students = [];
      setCurrentClasses(updated);
    }
  };

  // 최종 저장
  const handleSave = async () => {
    setSaving(true);
    try {
      await saveRosterList(currentClasses);
      alert('✅ 학급 정보(명렬표 및 조사표 데이터)가 성공적으로 저장되었습니다.');
      onClose();
    } catch (e) {
      console.error('명렬표 저장 오류:', e);
      alert('명렬표 저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in backdrop-blur-xs">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* 모달 상단 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="text-xl">🧑‍🤝‍🧑</span>
            <div>
              <h2 className="text-base font-extrabold text-slate-800">학급 정보(명렬표) 관리</h2>
              <p className="text-[11px] text-slate-500">구글 시트 연동으로 학급 명렬표 및 학생 조사표 데이터를 관리합니다.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-black text-lg p-1 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 구글 시트 연동 설정 바 */}
        <div className="bg-emerald-50/70 border-b border-emerald-100 px-6 py-2.5 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-emerald-800">📊 연결된 구글 시트:</span>
            {spreadsheetId ? (
              <span className="text-emerald-700 font-mono text-[11px] bg-white px-2 py-0.5 rounded border border-emerald-200">
                ...{spreadsheetId.slice(-10)}
              </span>
            ) : (
              <span className="text-amber-600 font-bold">미연결</span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleOpenGoogleSheet}
              className="px-3 py-1 bg-white hover:bg-emerald-100 text-emerald-800 rounded-lg font-bold border border-emerald-300 transition-colors shadow-2xs flex items-center gap-1"
            >
              <span>🔗</span> 구글 시트 열기
            </button>
          </div>
        </div>

        {/* 구글 시트 주소/ID 입력 폼 (토글 시) */}
        

        {/* 학급 선택 바 */}
        <div className="flex items-center justify-between px-6 py-3 bg-blue-50 border-b border-blue-100 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-blue-900">학급 선택:</span>
            <select
              value={currentIndex}
              onChange={(e) => handleChangeClass(Number(e.target.value))}
              className="bg-white border border-blue-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs focus:outline-none"
            >
              {currentClasses.map((cls, idx) => (
                <option key={idx} value={idx}>
                  {cls.year}년 {cls.grade ? `${cls.grade}학년 ` : ''}{cls.classNum ? `${cls.classNum}반` : '학급'}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleAddNewClass}
              className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-all"
            >
              + 새 학급 추가
            </button>
            <button
              onClick={handleDeleteCurrentClass}
              className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg text-xs font-bold transition-all"
            >
              학급 삭제
            </button>
          </div>
        </div>

        {/* 메인 컨텐츠 영역 */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* 학급 메타 정보 입력 */}
          <div className="grid grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">학년도</label>
              <input
                type="number"
                value={currentClass.year || new Date().getFullYear()}
                onChange={(e) => handleUpdateClassMeta('year', parseInt(e.target.value, 10) || new Date().getFullYear())}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">학년</label>
              <input
                type="text"
                value={currentClass.grade || ''}
                onChange={(e) => handleUpdateClassMeta('grade', e.target.value)}
                placeholder="예: 3"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">반</label>
              <input
                type="text"
                value={currentClass.classNum || ''}
                onChange={(e) => handleUpdateClassMeta('classNum', e.target.value)}
                placeholder="예: 2"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* 학생 추가 및 컨트롤 바 */}
          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
            <div className="text-xs text-slate-600 font-bold">
              총 <span className="text-blue-600 font-extrabold">{students.length}</span>명
              (재학 <span className="text-emerald-600">{activeCount}</span>명
              {inactiveCount > 0 && <span className="text-slate-400">, 전출 {inactiveCount}명</span>})
            </div>

            <div className="flex items-center gap-2">
              {/* 🔥 구글 시트에서 불러오기 버튼 (사용자 요청 2번) */}
              <button
                onClick={handleImportFromGoogleSheet}
                disabled={loadingSheet}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-all flex items-center gap-1"
                title="연결된 구글 시트의 [조사표_학년-반] 탭에서 명단과 조사표를 가져옵니다"
              >
                <span>📊</span>
                {loadingSheet ? '시트 읽는 중...' : '구글 시트에서 불러오기'}
              </button>

              {/* N명 추가 */}
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={addCount}
                  onChange={(e) => setAddCount(e.target.value)}
                  placeholder="인원"
                  className="w-14 px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-center focus:outline-none"
                />
                <button
                  onClick={handleAddStudents}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold border border-slate-200 transition-all"
                >
                  + 학생 추가
                </button>
              </div>

              {/* 전체 삭제 */}
              <button
                onClick={handleRemoveAllStudents}
                className="px-2 py-1 text-slate-400 hover:text-red-500 text-xs font-bold transition-colors"
                title="학생 명단 전체 비우기"
              >
                전체 삭제
              </button>
            </div>
          </div>

          {/* 학생 명렬표 테이블 */}
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 text-slate-600 font-bold sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className="p-2.5 text-center w-14">번호</th>
                    <th className="p-2.5 w-32">이름</th>
                    <th className="p-2.5 text-center w-20">성별</th>
                    <th className="p-2.5 text-center w-20">상태</th>
                    <th className="p-2.5">특이사항/조사표 메모</th>
                    <th className="p-2.5 text-center w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-slate-400">
                        등록된 학생이 없습니다. 상단의 '📊 구글 시트에서 불러오기' 또는 '+ 학생 추가'를 이용하세요.
                      </td>
                    </tr>
                  ) : (
                    students.map((st, idx) => (
                      <tr
                        key={idx}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          st.isActive === false ? 'opacity-40 bg-slate-100' : ''
                        }`}
                      >
                        <td className="p-1.5 text-center">
                          <input
                            type="number"
                            value={st.num || ''}
                            onChange={(e) => handleUpdateStudent(idx, 'num', parseInt(e.target.value, 10) || 0)}
                            className="w-10 text-center bg-white border border-slate-200 rounded px-1 py-1 font-bold text-slate-700 focus:outline-none"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="text"
                            value={st.name || ''}
                            onChange={(e) => handleUpdateStudent(idx, 'name', e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded px-2 py-1 font-bold text-slate-800 focus:outline-none"
                          />
                        </td>
                        <td className="p-1.5 text-center">
                          <select
                            value={st.gender || ''}
                            onChange={(e) => handleUpdateStudent(idx, 'gender', e.target.value)}
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
                            onChange={(e) => handleUpdateStudent(idx, 'isActive', e.target.value === 'true')}
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
                            onChange={(e) => handleUpdateStudent(idx, 'note', e.target.value)}
                            placeholder="특이사항, 조사표 내용, 상담 기록..."
                            className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-slate-600 focus:outline-none"
                          />
                        </td>
                        <td className="p-1.5 text-center">
                          <button
                            onClick={() => handleRemoveStudent(idx)}
                            className="text-slate-300 hover:text-red-500 font-black p-1 transition-colors"
                            title="삭제"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 푸터 영역 */}
        <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-slate-100 bg-slate-50">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all"
          >
            닫기
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            <span>💾</span> {saving ? '저장 중...' : '클라우드 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
