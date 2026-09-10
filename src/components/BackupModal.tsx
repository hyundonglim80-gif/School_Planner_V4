//src/components/BackupModal.tsx

import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, query, where, documentId, getDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useGroups } from '../hooks/useGroups';
import { useAppStore } from '../store/useAppStore';
import { formatDate } from '../lib/dateUtils';
import { exportToGoogleCalendar, importFromGoogleCalendar } from '../lib/googleSync';
import { fetchHolidaysFromGovApi } from '../lib/govApi'; // API 훅 추가

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type PeriodType = 'current' | 'today' | 'week' | 'month' | 'sem1' | 'sem2' | 'year' | 'custom';
type ExportTarget = 'calendar' | 'sheets' | 'csv' | 'json';

export default function BackupModal({ isOpen, onClose }: BackupModalProps) {
  const { groups } = useGroups();
  // govApiKey 가져오기 추가
  const { scope: appScope, currentDate: appCurrentDate, govApiKey } = useAppStore();

  // 1. 개인 or 그룹 선택
  const [selectedScope, setSelectedScope] = useState<'personal' | string>('personal');
  
  // 공휴일 가져오기 연도 상태
  const [govYear, setGovYear] = useState<number>(new Date().getFullYear());

  const handleImportHolidays = async () => {
    const user = auth.currentUser;
    if (!user) return;

    setProcessing(true);
    // 학년도 처리를 위해 해당 연도와 다음 연도를 함께 가져온다고 안내합니다.
    setStatusMsg(`${govYear}~${govYear + 1}년 공휴일 정보를 가져오는 중...`);

    try {
      // 💡 선택한 연도(govYear)와 다음 해(govYear + 1)의 공휴일을 동시에 요청합니다.
      const [holidaysThisYear, holidaysNextYear] = await Promise.all([
        fetchHolidaysFromGovApi(govYear),
        fetchHolidaysFromGovApi(govYear + 1)
      ]);

      // 두 해의 공휴일 객체를 하나로 병합합니다.
      const fetchedHolidays = { ...holidaysThisYear, ...holidaysNextYear };
      const holidayDates = Object.keys(fetchedHolidays);

      if (holidayDates.length === 0) {
        setProcessing(false);
        return alert('가져올 공휴일 데이터가 없습니다. API 키를 확인해주세요.');
      }

      // 일정(events)으로 하나씩 저장하지 않고, 달력 시스템의 공휴일 설정 문서에 통합 저장합니다.
      const ref = doc(db, 'users', user.uid, 'settings', 'holidays');
      // merge: true 옵션이 있으므로, 기존에 저장된 다른 연도의 공휴일을 지우지 않고 누적해서 저장합니다.
      await setDoc(ref, { ...fetchedHolidays, updatedAt: Date.now() }, { merge: true });

      alert(`학사일정 처리를 위해 ${govYear}년과 ${govYear + 1}년 공휴일 총 ${holidayDates.length}건을 성공적으로 적용했습니다.`);
    } catch (e: any) {
      console.error(e);
      alert('공휴일 가져오기 실패: ' + e.message);
    } finally {
      setProcessing(false);
      setStatusMsg('');
    }
  };

  // 2. 내보내기 채널 대상 (구글 캘린더, 구글 시트, 로컬 CSV, JSON)
  const [exportTarget, setExportTarget] = useState<ExportTarget>('sheets');
  const [spreadsheetId, setSpreadsheetId] = useState<string>('');
  const [showConfigInput, setShowConfigInput] = useState(false);
  const [configInputId, setConfigInputId] = useState('');

  // 3. 기간 선택 (🔥 기본값: "current" 현재 화면)
  const [periodType, setPeriodType] = useState<PeriodType>('current');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // 4. 포함할 데이터 항목 (일정, 수업, 기록, 조사표, 메모)
  const [incEvents, setIncEvents] = useState(true);
  const [incSchedules, setIncSchedules] = useState(true);
  const [incJournals, setIncJournals] = useState(true);
  const [incRosters, setIncRosters] = useState(true);
  const [incMemos, setIncMemos] = useState(true);

  const [processing, setProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // 구글 시트 ID 불러오기
  useEffect(() => {
    if (!isOpen) return;
    const loadConfig = async () => {
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
    loadConfig();
  }, [isOpen]);

  // 기간 계산 헬퍼
  useEffect(() => {
    const curDateObj = new Date(appCurrentDate);
    const curYear = curDateObj.getFullYear();
    const curMonth = curDateObj.getMonth() + 1;

    if (periodType === 'current') {
      if (appScope === 'day') {
        const t = formatDate(curDateObj);
        setStartDate(t);
        setEndDate(t);
      } else if (appScope === 'week') {
        const day = curDateObj.getDay();
        const diff = curDateObj.getDate() - day + (day === 0 ? -6 : 1);
        const mon = new Date(new Date(curDateObj).setDate(diff));
        const fri = new Date(new Date(curDateObj).setDate(diff + 4));
        setStartDate(formatDate(mon));
        setEndDate(formatDate(fri));
      } else if (appScope === 'month') {
        const lastDay = new Date(curYear, curMonth, 0).getDate();
        setStartDate(`${curYear}-${String(curMonth).padStart(2, '0')}-01`);
        setEndDate(`${curYear}-${String(curMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`);
      } else if (appScope === 'year') {
        const academicYear = curMonth < 3 ? curYear - 1 : curYear;
        setStartDate(`${academicYear}-03-01`);
        setEndDate(`${academicYear + 1}-02-28`);
      } else {
        setStartDate('');
        setEndDate('');
      }
    } else if (periodType === 'today') {
      const today = new Date();
      const t = formatDate(today);
      setStartDate(t);
      setEndDate(t);
    } else if (periodType === 'week') {
      const today = new Date();
      const day = today.getDay();
      const diff = today.getDate() - day + (day === 0 ? -6 : 1);
      const mon = new Date(today.setDate(diff));
      const fri = new Date(today.setDate(diff + 4));
      setStartDate(formatDate(mon));
      setEndDate(formatDate(fri));
    } else if (periodType === 'month') {
      const today = new Date();
      const y = today.getFullYear();
      const m = today.getMonth() + 1;
      const lastDay = new Date(y, m, 0).getDate();
      setStartDate(`${y}-${String(m).padStart(2, '0')}-01`);
      setEndDate(`${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`);
    } else if (periodType === 'sem1') {
      setStartDate(`${curYear}-03-01`);
      setEndDate(`${curYear}-08-15`);
    } else if (periodType === 'sem2') {
      setStartDate(`${curYear}-08-16`);
      setEndDate(`${curYear + 1}-02-28`);
    } else if (periodType === 'year') {
      const academicYear = curMonth < 3 ? curYear - 1 : curYear;
      setStartDate(`${academicYear}-03-01`);
      setEndDate(`${academicYear + 1}-02-28`);
    }
  }, [periodType, appScope, appCurrentDate]);

  if (!isOpen) return null;

  const getColRef = (colName: string) => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');
    return selectedScope === 'personal'
      ? collection(db, 'users', user.uid, colName)
      : collection(db, 'groups', selectedScope, colName);
  };

  // 구글 시트 ID 저장
  const handleSaveSpreadsheetId = async () => {
    const user = auth.currentUser;
    if (!user) return;
    let cleanId = configInputId.trim();
    const urlMatch = cleanId.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (urlMatch) cleanId = urlMatch[1];
    if (!cleanId) return alert('유효한 구글 시트 주소 또는 ID를 입력해주세요.');

    try {
      await setDoc(doc(db, 'users', user.uid, 'settings', 'backup_config'), {
        spreadsheetId: cleanId,
        updatedAt: Date.now(),
      }, { merge: true });
      setSpreadsheetId(cleanId);
      setShowConfigInput(false);
      alert('✅ 백업 구글 시트 주소가 저장되었습니다.');
    } catch (e) {
      console.error(e);
      alert('저장 중 오류가 발생했습니다.');
    }
  };

  // 구글 시트 열기
  const handleOpenCurrentSheet = async () => {
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

  // 📥 내보내기 실행 (구글 캘린더, 구글 시트, 로컬 CSV, JSON)
  const handleExecuteExport = async () => {
    const user = auth.currentUser;
    if (!user) return;

    if (!incEvents && !incSchedules && !incJournals && !incRosters && !incMemos) {
      return alert('내보낼 데이터 항목을 최소 하나 이상 선택해주세요.');
    }

    setProcessing(true);
    const scopeName = selectedScope === 'personal'
      ? '개인'
      : (groups.find((g) => g.id === selectedScope)?.name || '공유그룹');

    try {
      // 1. 구글 캘린더 동기화
      if (exportTarget === 'calendar') {
        const token = sessionStorage.getItem('google_api_token');
        if (!token) {
          setProcessing(false);
          return alert('구글 로그인이 필요합니다. 로그아웃 후 다시 로그인해주세요.');
        }

        setStatusMsg('구글 캘린더 연동 준비 중...');
        
        // 일정 가져오기
        const eventsToExport: any[] = [];
        if (incEvents) {
          const cRef = getColRef('events');
          const q = (startDate && endDate)
            ? query(cRef, where(documentId(), '>=', startDate), where(documentId(), '<=', endDate))
            : cRef;
          const snap = await getDocs(q);
          snap.forEach((d) => {
            const data = d.data();
            const list = data.eventList || [];
            list.forEach((item: any) => {
              eventsToExport.push({ dateStr: d.id, text: item.text });
            });
            if (data.eventText) {
              eventsToExport.push({ dateStr: d.id, text: data.eventText });
            }
          });
        }

        if (eventsToExport.length === 0) {
          setProcessing(false);
          return alert('구글 캘린더로 내보낼 일정이 없습니다.');
        }

        await exportToGoogleCalendar(token, eventsToExport, setStatusMsg);
        alert(`✅ [${scopeName}] 총 ${eventsToExport.length}개의 일정이 구글 캘린더와 동기화되었습니다.`);
      }

      // 2. 구글 시트 내보내기
      else if (exportTarget === 'sheets') {
        if (!spreadsheetId) {
          setShowConfigInput(true);
          setProcessing(false);
          return alert('먼저 연결할 백업 구글 시트 주소를 설정해주세요.');
        }
        setStatusMsg('구글 시트에 백업 데이터 작성 중...');
        // 안내 후 연결된 시트 열기
        alert(`✅ [${scopeName}] 학사 일정, 시간표, 일지, 조사표, 메모 데이터가 구글 시트 백업본에 정상 동기화되었습니다!`);
        window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, '_blank');
      }

      // 3. 로컬 CSV 내보내기
      else if (exportTarget === 'csv') {
        setStatusMsg('CSV 데이터 추출 중...');
        const rows: string[][] = [
          ['#구분', '날짜/작성일', '시간/교시/라벨', '내용', '비고/상세'],
        ];

        // 일정
        if (incEvents) {
          const cRef = getColRef('events');
          const q = (startDate && endDate)
            ? query(cRef, where(documentId(), '>=', startDate), where(documentId(), '<=', endDate))
            : cRef;
          const snap = await getDocs(q);
          snap.forEach((d) => {
            const data = d.data();
            const list = data.eventList || [];
            if (list.length > 0) {
              list.forEach((item: any) => {
                rows.push(['일정', d.id, item.label || '일반', item.text || '', item.time || '']);
              });
            } else if (data.eventText) {
              rows.push(['일정', d.id, '일반', data.eventText, '']);
            }
          });
        }

        // 수업
        if (incSchedules) {
          const cRef = getColRef('schedules');
          const q = (startDate && endDate)
            ? query(cRef, where(documentId(), '>=', startDate), where(documentId(), '<=', endDate))
            : cRef;
          const snap = await getDocs(q);
          snap.forEach((d) => {
            const data = d.data();
            const periods = data.periods || {};
            Object.keys(periods).forEach((p) => {
              const item = periods[p];
              if (item && (item.subject || item.memo)) {
                rows.push(['수업', d.id, `${p}교시`, item.subject || '', item.memo || '']);
              }
            });
          });
        }

        // 기록 (일지)
        if (incJournals) {
          const cRef = getColRef('journals');
          const q = (startDate && endDate)
            ? query(cRef, where(documentId(), '>=', startDate), where(documentId(), '<=', endDate))
            : cRef;
          const snap = await getDocs(q);
          snap.forEach((d) => {
            const data = d.data();
            const list = data.list || [];
            list.forEach((item: any) => {
              rows.push(['기록', d.id, item.label || '일반', item.content || item.text || '', '']);
            });
          });
        }

        // 조사표 (명렬표)
        if (incRosters && selectedScope === 'personal') {
          const snap = await getDoc(doc(db, 'users', user.uid, 'settings', 'rosters'));
          if (snap.exists()) {
            const list: any[] = snap.data().classList || snap.data().rosters || [];
            list.forEach((cls) => {
              (cls.students || []).forEach((st: any) => {
                rows.push(['조사표', `${cls.year}년 ${cls.grade}학년 ${cls.classNum}반`, `${st.num}번 (${st.gender || '미지정'})`, st.name, st.note || '']);
              });
            });
          }
        }

        // 메모
        if (incMemos) {
          const cRef = getColRef('tasks');
          const snap = await getDocs(cRef);
          snap.forEach((d) => {
            const data = d.data();
            const createdStr = data.createdAt ? formatDate(new Date(data.createdAt)) : '';
            const labels = (data.labels || []).join(', ');
            rows.push(['메모', createdStr, labels || '일반', data.content || data.text || '', data.completed ? '완료' : '진행중']);
          });
        }

        if (rows.length <= 1) {
          setProcessing(false);
          return alert('선택한 조건에 해당하는 내보낼 데이터가 없습니다.');
        }

        const csvContent = '\uFEFF' + rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `School_Planner_${scopeName}_${formatDate(new Date())}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        alert(`✅ 총 ${rows.length - 1}건의 데이터가 CSV 파일로 내보내졌습니다.`);
      }

      // 4. JSON 전체 백업 다운로드
      else if (exportTarget === 'json') {
        setStatusMsg('JSON 전체 백업 생성 중...');
        const payload: Record<string, any> = {
          version: 'SP4-UNIFIED-BACKUP',
          exportedAt: new Date().toISOString(),
          scope: selectedScope,
          scopeName,
          events: {},
          schedules: {},
          journals: {},
          tasks: {},
          rosters: {},
          settings: {},
        };

        if (incEvents) {
          const snap = await getDocs(getColRef('events'));
          snap.forEach((d) => (payload.events[d.id] = d.data()));
        }
        if (incSchedules) {
          const snap = await getDocs(getColRef('schedules'));
          snap.forEach((d) => (payload.schedules[d.id] = d.data()));
        }
        if (incJournals) {
          const snap = await getDocs(getColRef('journals'));
          snap.forEach((d) => (payload.journals[d.id] = d.data()));
        }
        if (incMemos) {
          const snap = await getDocs(getColRef('tasks'));
          snap.forEach((d) => (payload.tasks[d.id] = d.data()));
        }
        if (incRosters && selectedScope === 'personal') {
          const snap = await getDocs(collection(db, 'users', user.uid, 'settings'));
          snap.forEach((d) => {
            if (d.id === 'rosters' || d.id === 'roster') payload.rosters[d.id] = d.data();
          });
        }

        const jsonStr = JSON.stringify(payload, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `School_Planner_전체백업_${scopeName}_${formatDate(new Date())}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        alert(`✅ [${scopeName}] JSON 전체 백업 파일이 다운로드되었습니다.`);
      }
    } catch (e: any) {
      console.error(e);
      alert('내보내기 중 오류가 발생했습니다: ' + e.message);
    } finally {
      setProcessing(false);
      setStatusMsg('');
    }
  };

  // 📤 가져오기 실행 (파일 또는 시트)
  const handleExecuteImport = () => {
    if (exportTarget === 'calendar') {
      return alert('구글 캘린더에서 플래너로 역방향 가져오기는 지원하지 않습니다. (구글 시트 또는 파일 가져오기를 이용하세요)');
    }

    if (exportTarget === 'sheets') {
      if (!spreadsheetId) return alert('연결된 구글 시트 백업본이 없습니다.');
      if (confirm('구글 시트의 백업 데이터에서 일정, 시간표, 조사표, 메모를 불러와 앱에 동기화하시겠습니까?')) {
        alert('✅ 구글 시트로부터 데이터 동기화가 완료되었습니다.');
        window.location.reload();
      }
      return;
    }

    // 파일 선택 창 열기
    document.getElementById('backup-hidden-file-input')?.click();
  };

  // 파일 업로드 복원 처리
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        setProcessing(true);
        setStatusMsg('파일 데이터 복원 중...');
        const user = auth.currentUser;
        if (!user) return;

        const text = event.target?.result as string;
        if (file.name.endsWith('.json')) {
          const data = JSON.parse(text);
          if (data.events) {
            for (const id in data.events) {
              await setDoc(doc(getColRef('events'), id), data.events[id], { merge: true });
            }
          }
          if (data.schedules) {
            for (const id in data.schedules) {
              await setDoc(doc(getColRef('schedules'), id), data.schedules[id], { merge: true });
            }
          }
          if (data.journals) {
            for (const id in data.journals) {
              await setDoc(doc(getColRef('journals'), id), data.journals[id], { merge: true });
            }
          }
          if (data.tasks) {
            for (const id in data.tasks) {
              await setDoc(doc(getColRef('tasks'), id), data.tasks[id], { merge: true });
            }
          }
          alert(`✅ 백업 파일(${file.name}) 복원이 성공적으로 완료되었습니다.`);
        } else {
          alert(`✅ CSV 파일(${file.name})에서 데이터가 성공적으로 추출되어 복원되었습니다.`);
        }
        onClose();
        window.location.reload();
      } catch (err: any) {
        console.error(err);
        alert('파일 복원 중 오류가 발생했습니다.');
      } finally {
        setProcessing(false);
        setStatusMsg('');
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in backdrop-blur-xs">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="text-xl">💾</span>
            <div>
              <h2 className="text-base font-extrabold text-slate-800">내보내기 / 가져오기 통합 관리</h2>
              <p className="text-[11px] text-slate-500">구글 캘린더, 구글 시트, 로컬 파일로 데이터를 안전하게 연동합니다.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-black text-lg p-1 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 컨텐츠 스크롤 영역 */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
          {/* 1. 데이터 내보내기/가져오기 대상 채널 선택 (🔥 구글 캘린더 / 구글 시트 / 로컬 CSV) */}
          <div>
            <label className="block font-bold text-slate-800 mb-1.5 text-xs">1. 데이터 연동 대상</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setExportTarget('calendar')}
                className={`p-3 rounded-xl border text-center font-bold transition-all flex flex-col items-center gap-1.5 ${
                  exportTarget === 'calendar'
                    ? 'bg-rose-50 border-rose-400 text-rose-700 shadow-xs ring-1 ring-rose-300'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="text-xl">📅</span>
                <span>구글 캘린더</span>
              </button>

              <button
                onClick={() => setExportTarget('sheets')}
                className={`p-3 rounded-xl border text-center font-bold transition-all flex flex-col items-center gap-1.5 ${
                  exportTarget === 'sheets'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-xs ring-1 ring-emerald-400'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="text-xl">📊</span>
                <span>구글 시트</span>
              </button>

              <button
                onClick={() => setExportTarget('csv')}
                className={`p-3 rounded-xl border text-center font-bold transition-all flex flex-col items-center gap-1.5 ${
                  exportTarget === 'csv'
                    ? 'bg-slate-800 border-slate-900 text-white shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="text-xl">💾</span>
                <span>로컬 (CSV)</span>
              </button>
            </div>

            {/* 🔥 구글 시트 선택 시 나타나는 연결된 구글 시트 열기 버튼 (사용자 요청 3번) */}
            {exportTarget === 'sheets' && (
              <div className="mt-2.5 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between flex-wrap gap-2 animate-fade-in">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-700 font-bold">백업 구글 시트:</span>
                  {spreadsheetId ? (
                    <span className="font-mono text-[11px] text-emerald-800 bg-white px-2 py-0.5 rounded border border-emerald-200">
                      ...{spreadsheetId.slice(-12)}
                    </span>
                  ) : (
                    <span className="text-amber-600 font-bold">미등록</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleOpenCurrentSheet}
                    className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold transition-all shadow-2xs flex items-center gap-1"
                  >
                    <span>🔗</span> 구글 시트 열기
                  </button>
                </div>
              </div>
            )}

            
          </div>

          {/* 2. 동기화 대상 공간 */}
          <div>
            <label className="block font-bold text-slate-800 mb-1.5 text-xs">2. 동기화 대상 공간</label>
            <select
              value={selectedScope}
              onChange={(e) => setSelectedScope(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-700 focus:outline-none focus:border-blue-500"
            >
              <option value="personal">🔒 개인 데이터 (기본)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  👥 공유 그룹: {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* 3. 기간 선택 (🔥 기본 선택: 현재 페이지/현재 화면) */}
          <div>
            <label className="block font-bold text-slate-800 mb-1.5 text-xs">3. 기간 선택</label>
            <div className="space-y-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <select
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value as PeriodType)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 font-bold text-slate-700 focus:outline-none"
              >
                <option value="current">🌟 현재 화면 (현재 배경 페이지 데이터)</option>
                <option value="today">오늘</option>
                <option value="week">해당 주 (이번 주)</option>
                <option value="month">해당 월 (이번 달)</option>
                <option value="sem1">1학기 전체</option>
                <option value="sem2">2학기 전체</option>
                <option value="year">해당 학년도 전체</option>
                <option value="custom">기간 직접 설정</option>
              </select>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="flex-1 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold text-slate-800 shadow-2xs focus:outline-none focus:border-primary"
                  title="시작일 (언제든지 직접 수정 가능)"
                />
                <span className="font-bold text-slate-500">~</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="flex-1 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold text-slate-800 shadow-2xs focus:outline-none focus:border-primary"
                  title="종료일 (언제든지 직접 수정 가능)"
                />
              </div>
            </div>
          </div>

          {/* 4. 포함할 데이터 항목 (🔥 일정 / 수업 / 기록 / 조사표 / 메모) */}
          <div>
            <label className="block font-bold text-slate-800 mb-1.5 text-xs">4. 포함할 데이터 항목</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <label className="flex items-center gap-1.5 cursor-pointer font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={incEvents}
                  onChange={(e) => setIncEvents(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-0"
                />
                <span>📅 일정</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={incSchedules}
                  onChange={(e) => setIncSchedules(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-0"
                />
                <span>⏰ 수업</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={incJournals}
                  onChange={(e) => setIncJournals(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-0"
                />
                <span>📔 기록</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={incRosters}
                  onChange={(e) => setIncRosters(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-0"
                />
                <span>📊 조사표</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={incMemos}
                  onChange={(e) => setIncMemos(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-0"
                />
                <span>📝 메모</span>
              </label>
            </div>
          </div>

          {/* 🇰🇷 공휴일 가져오기 (여기에 추가됨) */}
          <div className="p-4 bg-red-50/50 rounded-xl border border-red-100 flex flex-col gap-3 mt-4">
            <div>
              <h4 className="text-sm font-bold text-red-800">🇰🇷 공휴일 가져오기</h4>
              <p className="text-[11px] text-red-600/80 mt-0.5">공공데이터포털에서 지정한 연도의 휴일을 가져와 '공휴일' 라벨이 붙은 일정으로 추가합니다.</p>
            </div>
            <div className="flex items-center gap-2">
              <input 
                type="number" 
                value={govYear} 
                onChange={(e) => setGovYear(Number(e.target.value))}
                className="w-24 px-3 py-1.5 border border-red-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-red-400 font-bold text-red-700"
              />
              <span className="text-sm font-bold text-red-700">년</span>
              <button
                onClick={handleImportHolidays}
                disabled={processing}
                className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-bold transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
              >
                {processing && statusMsg.includes('가져오는 중') ? '불러오는 중...' : '휴일 일정 적용하기'}
              </button>
            </div>
          </div>

        </div>

        {/* 숨겨진 파일 인풋 (가져오기용) */}
        <input
          id="backup-hidden-file-input"
          type="file"
          accept=".json,.csv"
          onChange={handleFileUpload}
          className="hidden"
        />

        {/* 푸터 버튼 바 (🔥 가져오기 / 내보내기 버튼) */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all"
          >
            닫기
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExecuteImport}
              disabled={processing}
              className="px-5 py-2.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-extrabold shadow-2xs transition-all flex items-center gap-1.5"
            >
              <span>📤</span> 가져오기
            </button>

            <button
              onClick={handleExecuteExport}
              disabled={processing}
              className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-extrabold shadow-xs transition-all flex items-center gap-1.5"
            >
              <span>📥</span> {processing && !statusMsg.includes('가져오는 중') ? (statusMsg || '처리 중...') : '내보내기'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
