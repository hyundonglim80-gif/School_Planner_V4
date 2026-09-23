//src/components/BackupModal.tsx

import React, { useState, useEffect } from 'react';
import { showToast, showErrorToast, showToastAfterReload } from '../utils/toast';
import { collection, getDocs, doc, setDoc, query, where, documentId, getDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useGroups } from '../hooks/useGroups';
import { useMemos } from '../hooks/useMemos';
import { fileLooksLikeKeep } from '../lib/keepImport';
import KeepImportModal from './KeepImportModal';
import { useAppStore } from '../store/useAppStore';
import { readEventList, eventContentOf } from '../lib/eventText';
import { formatDate } from '../lib/dateUtils';
import { exportCalendarData, labelNamesOf } from '../lib/calendarSync';
import { getValidGoogleToken } from '../lib/googleApi';
import { exportToSheets, importFromSheets, sheetUrlOf } from '../lib/sheetsSync';
import { useLabels } from '../hooks/useLabels';
import { useTimetableTemplate } from '../hooks/useTimetableTemplate';
import { parseCsv } from '../lib/csv';
import { parseRosterCsvRows, mergeRosters, ROSTER_CSV_HEADER } from '../lib/rosterCsv';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer } from '../hooks/useModalLayer';
import { useBackdropClose } from '../hooks/useBackdropClose';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type PeriodType = 'current' | 'today' | 'week' | 'month' | 'sem1' | 'sem2' | 'year' | 'all' | 'custom';
type ExportTarget = 'calendar' | 'sheets' | 'csv' | 'json';

export default function BackupModal({ isOpen, onClose }: BackupModalProps) {
  useBodyScrollLock(isOpen);

  const vv = useVisualViewport(isOpen);

  const zIndex = useModalLayer(isOpen, onClose);

  const backdrop = useBackdropClose();
  const { groups } = useGroups();
  // Keep 파일을 여기에 넣는 일이 잦다. 그때는 Keep 전용 창으로 그대로 넘긴다.
  const [keepFiles, setKeepFiles] = useState<File[] | null>(null);
  const { eventLabels, journalLabels } = useLabels();
  const { templates, currentTemplateName } = useTimetableTemplate();
  const { scope: appScope, currentDate: appCurrentDate } = useAppStore();

  // 1. 개인 or 그룹 선택
  const [selectedScope, setSelectedScope] = useState<'personal' | string>('personal');

  // Keep 창에 넘길 것들. 고른 공간(개인/공유그룹)의 메모를 본다.
  const { memos, addMemo, updateMemo } = useMemos(
    selectedScope === 'personal' ? null : selectedScope
  );
  
  // 2. 내보내기 채널 대상 (구글 캘린더, 구글 시트, 로컬 CSV, JSON)
  const [exportTarget, setExportTarget] = useState<ExportTarget>('sheets');
  const [spreadsheetId, setSpreadsheetId] = useState<string>('');
  // 시트 주소를 손으로 넣는 화면은 없앴다. 만들어 둔 것이 없으면 내보낼 때
  // 새로 만들고 그 주소를 users/{uid}/settings/backup_config 에 적어 둔다.

  // 3. 기간 선택 (🔥 기본값: "current" 현재 화면)
  const [periodType, setPeriodType] = useState<PeriodType>('current');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // 4. 포함할 데이터 항목 (일정, 수업, 기록, 명렬표, 조사표, 메모)
  //
  // 명렬표(학급 명단)와 조사표(평가·체크·메모)는 다른 것이다. 예전에는 명렬표를
  // 담는 칸 하나를 '조사표'라 불러, 조사표를 골랐다고 여긴 사람이 실제로는
  // 명단만 내보냈다. 둘을 갈라 둔다.
  const [incEvents, setIncEvents] = useState(true);
  const [incSchedules, setIncSchedules] = useState(true);
  const [incJournals, setIncJournals] = useState(true);
  const [incRosters, setIncRosters] = useState(true);
  const [incEvals, setIncEvals] = useState(true);
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
    } else if (periodType === 'all') {
      // 날짜를 비우면 아래에서 기간 조건 없이 전부 읽는다
      setStartDate('');
      setEndDate('');
    }
  }, [periodType, appScope, appCurrentDate]);

  if (!isOpen) return null;

  // 대상마다 담을 수 있는 것이 다르다. 캘린더에는 조사표를 넣을 자리가 없고,
  // 구글 시트에는 명렬표를 쓰는 곳이 없다. 담지도 못하는 것을 골라 두면
  // 골랐다고 여긴 것이 말없이 빠지므로, 담을 수 있는 것만 보여 준다.
  const ITEMS = [
    { key: 'event', label: '📅 일정', checked: incEvents, setChecked: setIncEvents },
    { key: 'class', label: '⏰ 수업', checked: incSchedules, setChecked: setIncSchedules },
    { key: 'journal', label: '📔 기록', checked: incJournals, setChecked: setIncJournals },
    { key: 'roster', label: '🧑‍🤝‍🧑 명렬표', checked: incRosters, setChecked: setIncRosters },
    { key: 'eval', label: '📊 조사표', checked: incEvals, setChecked: setIncEvals },
    { key: 'memo', label: '📝 메모', checked: incMemos, setChecked: setIncMemos },
  ] as const;

  const ITEMS_BY_TARGET: Record<ExportTarget, readonly string[]> = {
    // 캘린더에는 일정·수업·기록만 올라간다
    calendar: ['event', 'class', 'journal'],
    // 명렬표는 시트 쪽에서 '학급 정보 관리' 화면이 따로 맡는다
    sheets: ['event', 'class', 'journal', 'eval', 'memo'],
    // 사람이 읽는 표라 조사표(학생별 결과)는 담지 않는다
    csv: ['event', 'class', 'journal', 'roster', 'memo'],
    json: ['event', 'class', 'journal', 'roster', 'eval', 'memo'],
    // 명렬표만 담는 대상은 없앴다. 전체 학급 CSV는 명단을 다루는 자리인
    // '학급 정보(명렬표) 관리' 화면으로 옮겼다.
  };

  const availableItems = ITEMS.filter((it) => ITEMS_BY_TARGET[exportTarget].includes(it.key));
  const nothingPicked = availableItems.length > 0 && availableItems.every((it) => !it.checked);

  // calendarSync는 경로 문자열을 받는다. 참조를 만드는 쪽과 같은 규칙을 쓴다.
  const getColPath = (colName: string) => {
    const uid = auth.currentUser?.uid;
    return selectedScope === 'personal' ? `users/${uid}/${colName}` : `groups/${selectedScope}/${colName}`;
  };

  const getColRef = (colName: string) => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');
    return selectedScope === 'personal'
      ? collection(db, 'users', user.uid, colName)
      : collection(db, 'groups', selectedScope, colName);
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

    // 지금 대상이 담을 수 있는 것 중에 고른 것이 하나도 없을 때만 막는다.
    // 예전에는 조사표를 세지 않아, 조사표만 골라도 아무것도 안 골랐다고 했다.
    if (nothingPicked) {
      return showErrorToast('내보낼 데이터 항목을 최소 하나 이상 선택해주세요.');
    }

    setProcessing(true);
    const scopeName = selectedScope === 'personal'
      ? '개인'
      : (groups.find((g) => g.id === selectedScope)?.name || '공유그룹');

    try {
      // 1. 구글 캘린더 동기화
      // 상단 '캘린더' 버튼과 같은 구현(lib/calendarSync)을 쓴다. 예전에는 여기만
      // 따로 간단한 코드를 두어, 다시 누를 때마다 같은 일정이 또 생기고
      // 종일 일정의 끝 날짜도 잘못 들어갔다.
      if (exportTarget === 'calendar') {
        if (!startDate || !endDate) {
          setProcessing(false);
          return showErrorToast('구글 캘린더로 보낼 기간을 정해 주세요.');
        }

        setStatusMsg('구글 권한을 확인하는 중...');
        const token = await getValidGoogleToken();
        if (!token) {
          setProcessing(false);
          return showErrorToast('구글 권한을 받지 못했습니다.');
        }

        const result = await exportCalendarData({
          token,
          startStr: startDate,
          endStr: endDate,
          mode: 'merge',
          include: { event: incEvents, class: incSchedules, journal: incJournals },
          colPathOf: (col) => getColPath(col),
          periodNames: templates[currentTemplateName]?.names || ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시'],
          eventLabels,
          journalLabels,
          onProgress: (msg) => setStatusMsg(msg),
        });

        const total = result.counts.event + result.counts.class + result.counts.journal;
        showToast(`✅ [${scopeName}] ${total}건을 구글 캘린더에 반영했습니다.`);
      }

      // 2. 구글 시트 내보내기
      else if (exportTarget === 'sheets') {
        if (!startDate || !endDate) {
          setProcessing(false);
          return showErrorToast("시트로 보낼 기간을 정해 주세요. ('전체 기간'은 시트에 담기에 너무 큽니다)");
        }

        setStatusMsg('구글 권한을 확인하는 중...');
        const token = await getValidGoogleToken();
        if (!token) {
          setProcessing(false);
          return showErrorToast('구글 권한을 받지 못했습니다.');
        }

        const result = await exportToSheets({
          token,
          uid: user.uid,
          scope: selectedScope,
          colPathOf: (col) => getColPath(col),
          startStr: startDate,
          endStr: endDate,
          include: {
            event: incEvents,
            class: incSchedules,
            journal: incJournals,
            evaluation: incEvals,
            memo: incMemos,
          },
          periodNames: templates[currentTemplateName]?.names || ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시'],
          eventLabels,
          journalLabels,
          onProgress: (msg) => setStatusMsg(msg),
        });

        setSpreadsheetId(result.spreadsheetId);
        showToast(
          `✅ [${scopeName}] ${result.days}일치와 메모 ${result.memos}건, 조사표 ${result.evaluations}건을 구글 시트에 썼습니다.`
        );
        window.open(sheetUrlOf(result.spreadsheetId), '_blank');
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
            // readEventList는 V3가 쓰던 eventText 형식도 함께 읽어준다.
            // 예전에는 eventList만 보고, 라벨도 item.label 하나만 봐서
            // labelIds로 담긴 대부분의 라벨이 빈칸으로 나갔다.
            readEventList(d.data()).forEach((item: any) => {
              const labels = labelNamesOf(item, eventLabels);
              rows.push([
                '일정',
                d.id,
                labels.length > 0 ? labels.join(', ') : '일반',
                eventContentOf(item),
                item.completed ? '완료' : '',
              ]);
            });
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
            // 기록은 entries에 담긴다. list를 보고 있어서 늘 0건이 나왔다.
            // (list는 아주 예전 형식이라 폴백으로만 둔다)
            const list = data.entries || data.list || [];
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
          return showErrorToast('선택한 조건에 해당하는 내보낼 데이터가 없습니다.');
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

        showToast(`✅ 총 ${rows.length - 1}건의 데이터가 CSV 파일로 내보내졌습니다.`);
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
          evaluations: {},
          rosters: {},
          settings: {},
        };

        // 고른 기간을 따른다. 예전에는 기간을 정해도 JSON만 늘 전체를 담아서,
        // 화면에서 고른 것과 파일에 든 것이 달랐다.
        // 기간 전체를 담으려면 '전체 기간'을 고른다.
        payload.period = startDate && endDate ? { startDate, endDate } : 'all';

        const inRange = (cRef: any) =>
          startDate && endDate
            ? query(cRef, where(documentId(), '>=', startDate), where(documentId(), '<=', endDate))
            : cRef;

        if (incEvents) {
          const snap = await getDocs(inRange(getColRef('events')));
          snap.forEach((d) => (payload.events[d.id] = d.data()));
        }
        if (incSchedules) {
          const snap = await getDocs(inRange(getColRef('schedules')));
          snap.forEach((d) => (payload.schedules[d.id] = d.data()));
        }
        if (incJournals) {
          const snap = await getDocs(inRange(getColRef('journals')));
          snap.forEach((d) => (payload.journals[d.id] = d.data()));
        }
        if (incEvals) {
          const snap = await getDocs(inRange(getColRef('evaluations')));
          snap.forEach((d) => (payload.evaluations[d.id] = d.data()));
        }
        if (incMemos) {
          const snap = await getDocs(getColRef('tasks'));
          snap.forEach((d) => (payload.tasks[d.id] = d.data()));
        }
        // 설정도 함께 담는다. 예전에는 settings 칸을 만들어 두고 비운 채로 내보내서,
        // '전체 백업'인데 라벨·시간표·환경설정·D-Day가 들어 있지 않았다.
        // 복원해도 그것들은 돌아오지 않았다.
        if (selectedScope === 'personal') {
          const snap = await getDocs(collection(db, 'users', user.uid, 'settings'));
          snap.forEach((d) => {
            // 구글 시트 주소 같은 연결 정보는 기기에 매인 값이라 뺀다
            if (d.id === 'backup_config') return;
            payload.settings[d.id] = d.data();
            if (incRosters && (d.id === 'rosters' || d.id === 'roster')) payload.rosters[d.id] = d.data();
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
        showToast(`✅ [${scopeName}] JSON 전체 백업 파일이 다운로드되었습니다.`);
      }
    } catch (e: any) {
      console.error(e);
      showErrorToast('내보내기 중 오류가 발생했습니다: ' + e.message);
    } finally {
      setProcessing(false);
      setStatusMsg('');
    }
  };

  // 📤 가져오기 실행 (파일 또는 시트)
  const handleExecuteImport = () => {
    if (exportTarget === 'calendar') {
      return showErrorToast('구글 캘린더에서 플래너로 역방향 가져오기는 지원하지 않습니다. (구글 시트 또는 파일 가져오기를 이용하세요)');
    }

    if (exportTarget === 'sheets') {
      void handleImportFromSheets();
      return;
    }

    // 파일 선택 창 열기 (JSON 백업 또는 조사표 CSV)
    document.getElementById('backup-hidden-file-input')?.click();
  };

  // 시트에서 되읽기. 시트를 사람이 고쳐서 쓰는 경우가 있어 되읽기가 필요하다.
  const handleImportFromSheets = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const scopeLabel =
      selectedScope === 'personal' ? '개인' : groups.find((g) => g.id === selectedScope)?.name || '공유그룹';

    // 시트에 있는 날짜의 내용이 통째로 시트 것으로 바뀐다. 먼저 묻는다.
    const ok = confirm(
      `[${scopeLabel}]에 구글 시트의 내용을 되돌립니다.

시트에 적힌 날짜의 일정·수업·기록은 시트 내용으로 바뀝니다.
되돌릴 수 없습니다. 계속할까요?`
    );
    if (!ok) return;

    setProcessing(true);
    try {
      setStatusMsg('구글 권한을 확인하는 중...');
      const token = await getValidGoogleToken();
      if (!token) {
        setProcessing(false);
        return showErrorToast('구글 권한을 받지 못했습니다.');
      }

      const counts = await importFromSheets({
        token,
        uid: user.uid,
        scope: selectedScope,
        colPathOf: (col) => getColPath(col),
        include: {
          event: incEvents,
          class: incSchedules,
          journal: incJournals,
          evaluation: incEvals,
          memo: incMemos,
        },
        onProgress: (msg) => setStatusMsg(msg),
      });

      showToast(
        `✅ [${scopeLabel}] 일정 ${counts.events}건, 수업 ${counts.schedules}일, 기록 ${counts.journals}건, 조사표 ${counts.evaluations}건, 메모 ${counts.memos}건을 되돌렸습니다.`
      );
      onClose();
      window.location.reload();
    } catch (e: any) {
      console.error(e);
      showErrorToast('시트에서 가져오는 중 오류가 발생했습니다: ' + (e?.message || e));
    } finally {
      setProcessing(false);
      setStatusMsg('');
    }
  };

  // 가져오기로 되돌릴 갈래. '4. 포함할 데이터 항목'에서 고른 것만 되돌린다.
  //
  // ⚠️ 예전에는 고르든 말든 파일에 든 것을 전부 되돌렸다. 메모만 가져오려고
  //    메모만 골라 두어도 그날 일정·수업·기록까지 백업 시점 것으로 바뀌었다.
  //    같은 화면에서 고른 항목이 내보낼 때만 쓰이고 가져올 때는 무시되던 셈이다.
  const IMPORT_KINDS = [
    { bag: 'events', label: '일정', unit: '일', on: incEvents },
    { bag: 'schedules', label: '수업', unit: '일', on: incSchedules },
    { bag: 'journals', label: '기록', unit: '일', on: incJournals },
    { bag: 'tasks', label: '메모', unit: '건', on: incMemos },
    { bag: 'evaluations', label: '조사표', unit: '건', on: incEvals },
    { bag: 'rosters', label: '명렬표', unit: '개', on: incRosters },
  ] as const;

  /** 백업 JSON 한 덩이를 고른 항목에 맞춰 되돌린다 */
  const applyBackupJson = async (data: any, uid: string, withSettings: boolean) => {
    const put = async (colName: string, bag: any) => {
      for (const id in bag || {}) {
        await setDoc(doc(getColRef(colName), id), bag[id], { merge: true });
      }
    };

    if (incEvents) await put('events', data.events);
    if (incSchedules) await put('schedules', data.schedules);
    if (incJournals) await put('journals', data.journals);
    if (incMemos) await put('tasks', data.tasks);
    if (incEvals) await put('evaluations', data.evaluations);

    // 설정과 명렬표는 개인 공간에만 있다. 예전에는 백업에 담기지도,
    // 복원되지도 않아서 라벨과 시간표가 그대로 사라진 채로 남았다.
    if (selectedScope === 'personal') {
      if (withSettings) {
        for (const id in data.settings || {}) {
          if (id === 'backup_config') continue;
          await setDoc(doc(db, 'users', uid, 'settings', id), data.settings[id], { merge: true });
        }
      }
      if (incRosters) {
        for (const id in data.rosters || {}) {
          await setDoc(doc(db, 'users', uid, 'settings', id), data.rosters[id], { merge: true });
        }
      }
    }
  };

  /**
   * JSON 백업을 되돌린다. 파일을 여러 개 골라도 한 번에 받는다.
   *
   * 백업은 기간을 나눠 받는 일이 많아(학기별로 따로 받아 두는 식) 되돌릴 때도
   * 여러 개를 함께 고르게 된다. 예전에는 한 번에 하나뿐이라 파일 수만큼 이
   * 과정을 되풀이해야 했고, 그때마다 화면이 새로고침되어 더 번거로웠다.
   */
  const importJsonFiles = async (files: File[], skippedCsv: number) => {
    const user = auth.currentUser;
    if (!user) return;

    const scopeLabel =
      selectedScope === 'personal' ? '개인' : groups.find((g) => g.id === selectedScope)?.name || '공유그룹';

    setProcessing(true);
    setStatusMsg('파일을 읽는 중...');

    const parsed: { name: string; data: any }[] = [];
    const broken: string[] = [];
    for (const file of files) {
      try {
        parsed.push({ name: file.name, data: JSON.parse(await file.text()) });
      } catch {
        // 한 파일이 깨졌다고 나머지까지 멈추지 않는다
        broken.push(file.name);
      }
    }

    const stop = (msg: string) => {
      setProcessing(false);
      setStatusMsg('');
      showErrorToast(msg);
    };

    if (parsed.length === 0) {
      return stop(`읽을 수 있는 백업 파일이 없습니다. (${broken.join(', ') || '파일 없음'})`);
    }

    // 고른 갈래가 실제로 몇 건 들어오는지 미리 센다
    const counts = IMPORT_KINDS.filter((k) => k.on)
      .map((k) => {
        const n = parsed.reduce((sum, p) => sum + Object.keys(p.data[k.bag] || {}).length, 0);
        return n > 0 ? `${k.label} ${n}${k.unit}` : null;
      })
      .filter(Boolean)
      .join(', ');

    if (!counts) {
      return stop("고른 항목에 해당하는 내용이 파일에 없습니다. '4. 포함할 데이터 항목'을 확인해 주세요.");
    }

    // 설정(라벨·시간표·환경설정)에는 체크상자가 없다. 항목을 하나라도 줄여 골랐다면
    // '이것만 가져오겠다'는 뜻으로 보고 설정은 건드리지 않는다. 메모만 가져오려다
    // 라벨과 시간표가 통째로 바뀌는 일이 없어야 한다.
    const withSettings = selectedScope === 'personal' && availableItems.every((it) => it.checked);

    const ok = confirm(
      `[${scopeLabel}]에 백업 파일 ${parsed.length}개를 복원합니다.\n\n` +
        parsed.map((p) => `· ${p.name}`).join('\n') +
        `\n\n${counts}\n` +
        (withSettings
          ? '설정(라벨·시간표·환경설정)도 함께 복원합니다.\n'
          : '고른 항목만 복원합니다 (설정은 그대로 둡니다).\n') +
        (broken.length > 0 ? `\n읽지 못한 파일 ${broken.length}개는 건너뜁니다.\n` : '') +
        (skippedCsv > 0 ? `\nCSV 파일 ${skippedCsv}개는 따로 가져와 주세요.\n` : '') +
        '\n같은 날짜에 지금 들어 있는 내용은 백업 시점 것으로 바뀝니다.\n되돌릴 수 없습니다. 계속할까요?'
    );
    if (!ok) {
      setProcessing(false);
      setStatusMsg('');
      return;
    }

    try {
      let nth = 0;
      for (const p of parsed) {
        nth += 1;
        setStatusMsg(`복원 중... (${nth}/${parsed.length}) ${p.name}`);
        await applyBackupJson(p.data, user.uid, withSettings);
      }
      // 바로 아래에서 새로고침하므로 지금 띄우면 읽기도 전에 쓸려 나간다.
      // 새로고침을 건너온 뒤에 띄우도록 맡긴다.
      showToastAfterReload(`✅ 백업 파일 ${parsed.length}개를 복원했습니다.`);
      onClose();
      window.location.reload();
    } catch (err) {
      console.error(err);
      showErrorToast('파일 복원 중 오류가 발생했습니다.');
    } finally {
      setProcessing(false);
      setStatusMsg('');
    }
  };

  /**
   * CSV는 명렬표만 되읽는다. 일정·수업·기록 CSV는 사람이 보라고 만든 것이라
   * 되돌릴 수 있을 만큼의 정보(항목 id 등)가 들어 있지 않다.
   * 예전에는 파일을 읽지도 않고 "복원되었습니다"라고 알린 뒤 새로고침했다.
   *
   * 내보내는 자리는 '학급 정보(명렬표) 관리'로 옮겼지만, 되읽는 길은 여기도
   * 열어 둔다. 예전에 이 화면에서 받아 둔 파일이 있기 때문이다.
   */
  const importRosterCsv = async (file: File, totalCsv: number) => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      setProcessing(true);
      setStatusMsg('파일 데이터 복원 중...');

      const text = await file.text();
      const table = parseCsv(text);
      const header = (table[0] || []).map((h) => String(h ?? '').trim());
      const looksLikeRoster = ['번호', '이름'].every((key) => header.includes(key));

      if (!looksLikeRoster) {
        showErrorToast(
          `명렬표 CSV가 아닙니다. 머리말에 ${ROSTER_CSV_HEADER.join(', ')} 가 있어야 합니다.
일정·수업·기록은 JSON 백업 파일로 복원해 주세요.`
        );
        return;
      }
      if (selectedScope !== 'personal') {
        showErrorToast('명렬표는 개인 공간에만 있습니다. 대상 공간을 개인으로 바꿔 주세요.');
        return;
      }

      const { classList: incoming, skipped } = parseRosterCsvRows(table);
      if (incoming.length === 0) {
        showErrorToast('CSV에서 학생을 찾지 못했습니다. 번호·이름·학년·반이 채워져 있는지 확인해 주세요.');
        return;
      }

      const summary = incoming
        .map((c) => `${c.year}년 ${c.grade}학년 ${c.classNum}반 (${c.students.length}명)`)
        .join('\n');
      const ok = confirm(
        `다음 학급의 명단을 파일 내용으로 바꿉니다.

${summary}

파일에 없는 학급은 그대로 둡니다.${totalCsv > 1 ? `\n(명렬표 CSV는 한 번에 하나씩만 읽습니다. 고른 ${totalCsv}개 중 첫 파일을 씁니다)` : ''}
계속할까요?`
      );
      if (!ok) return;

      const rosterRef = doc(db, 'users', user.uid, 'settings', 'rosters');
      const snap = await getDoc(rosterRef);
      const current: any[] = snap.exists()
        ? snap.data().classList || snap.data().rosters || snap.data().list || []
        : [];

      await setDoc(
        rosterRef,
        { classList: mergeRosters(current, incoming), updatedAt: Date.now() },
        { merge: true }
      );

      const students = incoming.reduce((sum, c) => sum + c.students.length, 0);
      showToast(
        `✅ 학급 ${incoming.length}개, 학생 ${students}명을 되돌렸습니다.` +
          (skipped > 0 ? ` (읽지 못한 줄 ${skipped}개는 건너뛰었습니다)` : '')
      );
      onClose();
      window.location.reload();
    } catch (err: any) {
      console.error(err);
      showErrorToast('파일 복원 중 오류가 발생했습니다.');
    } finally {
      setProcessing(false);
      setStatusMsg('');
    }
  };

  // 파일 업로드 복원 처리. JSON은 여러 개, 명렬표 CSV는 하나씩 받는다.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(e.target.files || []);
    // 같은 파일을 다시 고를 수 있게 비운다 (위에서 이미 목록을 받아 두었다)
    if (e.target) e.target.value = '';
    if (chosen.length === 0) return;

    const json = chosen.filter((f) => f.name.toLowerCase().endsWith('.json'));
    const csv = chosen.filter((f) => !f.name.toLowerCase().endsWith('.json'));

    // 구글 Keep에서 내보낸 파일이면 Keep 전용 창으로 넘긴다. 생김새가 아주 달라서
    // (갈래별 묶음이 아니라 메모 한 건의 모양) 백업 복원 길로는 읽을 수 없고,
    // Keep 쪽은 라벨·사진·중복 건너뛰기를 따로 챙겨야 한다.
    // 사진도 함께 넘겨야 메모에 다시 붙일 수 있으므로 고른 것을 통째로 넘긴다.
    if (json.length > 0 && (await fileLooksLikeKeep(await json[0].text()))) {
      setKeepFiles(chosen);
      showToast('📥 구글 Keep 파일이네요. Keep 전용 가져오기 창으로 넘깁니다.');
      return;
    }

    if (json.length > 0) await importJsonFiles(json, csv.length);
    else await importRosterCsv(csv[0], csv.length);
  };
  return (
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-black/50 p-4 animate-fade-in backdrop-blur-xs" style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }} {...backdrop}>
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-full" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="text-xl">💾</span>
            <div>
              <h2 className="text-base font-extrabold text-slate-800">내보내기 / 가져오기 통합 관리</h2>
              <p className="text-xs text-slate-500">구글 캘린더, 구글 시트, 로컬 파일로 데이터를 안전하게 연동합니다.</p>
            </div>
          </div>
          <button
            title="닫기"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-black text-lg p-1 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 컨텐츠 스크롤 영역 */}
        <div className="p-6 overflow-y-auto overscroll-contain space-y-4 flex-1 min-h-0 text-xs" data-scroll-lock>
          {/* 1. 데이터 내보내기/가져오기 대상 채널 선택 (🔥 구글 캘린더 / 구글 시트 / 로컬 CSV) */}
          <div>
            <label className="block font-bold text-slate-800 mb-1.5 text-xs">1. 데이터 연동 대상</label>
            <div className="grid grid-cols-4 gap-1">
              <button
                onClick={() => setExportTarget('calendar')}
                title="캘린더"
                className={`px-1 py-1.5 rounded-lg border text-center font-bold transition-all flex flex-col items-center gap-0.5 leading-tight ${
                  exportTarget === 'calendar'
                    ? 'bg-rose-50 border-rose-400 text-rose-700 shadow-xs ring-1 ring-rose-300'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="text-sm">📅</span>
                <span className="text-2xs">캘린더</span>
              </button>

              <button
                onClick={() => setExportTarget('sheets')}
                title="구글 시트"
                className={`px-1 py-1.5 rounded-lg border text-center font-bold transition-all flex flex-col items-center gap-0.5 leading-tight ${
                  exportTarget === 'sheets'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-xs ring-1 ring-emerald-400'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="text-sm">📊</span>
                <span className="text-2xs">구글 시트</span>
              </button>

              <button
                onClick={() => setExportTarget('csv')}
                title="CSV"
                className={`px-1 py-1.5 rounded-lg border text-center font-bold transition-all flex flex-col items-center gap-0.5 leading-tight ${
                  exportTarget === 'csv'
                    ? 'bg-slate-800 border-slate-900 text-white shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="text-sm">💾</span>
                <span className="text-2xs">CSV</span>
              </button>

              {/* JSON은 만들어져 있었는데 고르는 버튼이 없어 닿을 수 없었다 */}
              <button
                onClick={() => setExportTarget('json')}
                title="JSON"
                className={`px-1 py-1.5 rounded-lg border text-center font-bold transition-all flex flex-col items-center gap-0.5 leading-tight ${
                  exportTarget === 'json'
                    ? 'bg-indigo-50 border-indigo-400 text-indigo-800 shadow-xs ring-1 ring-indigo-300'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="text-sm">🗄️</span>
                <span className="text-2xs">JSON</span>
              </button>

            </div>

            {/* 시트 주소를 보여주던 칸은 없앴다. 시트 id는 사람이 알아볼 값이 아니고,
                손으로 넣는 자리도 없앴으므로(내보낼 때 없으면 만들어 준다) 남길 이유가 없다. */}
            {exportTarget === 'sheets' && (
              <div className="mt-2.5 animate-fade-in">
                <button
                  onClick={handleOpenCurrentSheet}
                  className="w-full px-3 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold transition-all shadow-2xs flex items-center justify-center gap-1.5"
                >
                  <span>🔗</span> 구글 시트 열기
                </button>
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
            {/* 조사표와 설정(라벨·시간표·환경설정·D-Day)은 개인 공간에만 있다.
                예전에는 그룹을 골라도 아무 말 없이 빠져서, 담긴 줄 알기 쉬웠다. */}
            {selectedScope !== 'personal' && (
              <p className="mt-1.5 text-amber-600 font-bold">
                조사표와 설정(라벨·시간표·환경설정·D-Day)은 개인 공간에만 있어 이번 내보내기에 담기지 않습니다.
              </p>
            )}
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
                <option value="all">전체 기간 (날짜 제한 없음)</option>
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

          {/* 4. 포함할 데이터 항목. 지금 고른 대상이 담을 수 있는 것만 보인다. */}
          {availableItems.length > 0 && (
            <div>
              <label className="block font-bold text-slate-800 mb-1.5 text-xs">4. 포함할 데이터 항목</label>
              <div className="flex items-center justify-between gap-1 bg-slate-50 px-2.5 py-2 rounded-xl border border-slate-200 flex-wrap">
                {availableItems.map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center gap-1 cursor-pointer font-bold text-slate-700 shrink-0"
                  >
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(e) => item.setChecked(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-0 accent-blue-600"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* 숨겨진 파일 인풋 (가져오기용) */}
        {/* JSON 백업은 여러 개를 한 번에 고를 수 있다. 백업을 기간별로 나눠 받아
            두는 일이 많아(학기별 등) 되돌릴 때도 여러 개를 함께 고르게 된다. */}
        <input
          id="backup-hidden-file-input"
          type="file"
          accept=".json,.csv"
          multiple
          onChange={handleFileUpload}
          className="hidden"
          aria-label="가져올 백업 파일"
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
              title="JSON 백업은 여러 개를 한 번에 고를 수 있습니다. '4. 포함할 데이터 항목'에서 고른 것만 되돌립니다."
              className="px-5 py-2.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-extrabold shadow-2xs transition-all flex items-center gap-1.5"
            >
              <span>📤</span> 가져오기
            </button>

            <button
            title="내보내기"
              onClick={handleExecuteExport}
              disabled={processing}
              className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-extrabold shadow-xs transition-all flex items-center gap-1.5"
            >
              <span>📥</span> {processing && !statusMsg.includes('가져오는 중') ? (statusMsg || '처리 중...') : '내보내기'}
            </button>
          </div>
        </div>
      </div>

      {/* Keep 파일을 넣었을 때. 라벨 등록·사진 붙이기·중복 건너뛰기를 그 창이 맡는다. */}
      {keepFiles && (
        <KeepImportModal
          isOpen
          onClose={() => setKeepFiles(null)}
          initialFiles={keepFiles}
          onAddMemo={addMemo}
          existingMemos={memos}
          onUpdateMemo={updateMemo}
        />
      )}
    </div>
  );
}
