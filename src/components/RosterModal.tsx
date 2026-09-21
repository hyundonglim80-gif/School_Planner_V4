import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { showToast, showErrorToast } from '../utils/toast';
import { useAppStore } from '../store/useAppStore';
import { useRoster, type ClassRoster, type Student } from '../hooks/useRoster';
import { downloadCSV, parseCSV } from '../utils/csvHelper';
import {
  buildRosterCsvRows,
  parseRosterCsvRows,
  mergeRosters,
  ROSTER_CSV_HEADER,
} from '../lib/rosterCsv';
import { downloadCsv, parseCsv } from '../lib/csv';
import { moveToTrash } from '../utils/trashHelper';
import ModalShell, { ModalCloseButton } from './ModalShell';
import RosterManageTab, { type RosterView } from './roster/RosterManageTab';
import RosterSearchTab from './roster/RosterSearchTab';
import RosterMemorizeTab from './roster/RosterMemorizeTab';
import PhotoStatusBar from './roster/PhotoStatusBar';
import { useStudentPhotos } from '../hooks/useStudentPhotos';
import {
  yearOptions,
  gradeOptions,
  classNumOptions,
  indexOfPick,
  pickOfIndex,
  reconcilePick,
  type ClassPick,
} from '../lib/classPicker';
import { classFolderName } from '../lib/studentPhotoNames';
import { formatBytes } from '../lib/imageShrink';
import { openManagedPhotoFolder } from '../lib/studentPhotos';
import { diagnosePhotos } from '../lib/photoDiagnosis';
import type { QuizStudent } from '../hooks/usePhotoQuiz';

type RosterTab = 'manage' | 'search' | 'memorize';

/**
 * 학급별 탭 이름.
 *
 * 한동안 이 탭을 '명렬표_'로 부르려 했다. 그런데 이 탭에는 학급 명단만이
 * 아니라 V3가 내보낸 조사표(평가) 자료도 같이 들어간다. 안에 든 것이 명단
 * 하나가 아니므로 '조사표_'라는 원래 이름을 그대로 둔다.
 */
const ROSTER_SHEET_PREFIX = '조사표_';
/** 이름을 바꿨던 동안 만들어진 탭. [restoreRosterSheetTitles]가 되돌린다. */
const RENAMED_ROSTER_SHEET_PREFIX = '명렬표_';

/**
 * '명렬표_'로 바뀐 탭을 다시 '조사표_'로 되돌린다.
 *
 * 탭 이름을 바꾸는 판을 한 번 내보냈다가 물렀다. 그 사이에 시트 동기화를 누른
 * 사람은 탭 이름이 이미 바뀌어 있어, 그대로 두면 명단을 못 찾는다. 탭 이름만
 * 고칠 뿐 칸 안의 값은 건드리지 않는다. 되돌릴 것이 없으면 아무 일도 하지
 * 않으므로, 바뀐 탭이 다 돌아온 뒤에는 이 함수를 지워도 된다.
 */
async function restoreRosterSheetTitles(token: string, spreadsheetId: string): Promise<number> {
  try {
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!metaRes.ok) return 0;

    const meta = await metaRes.json();
    const sheets: any[] = meta?.sheets || [];
    const titles = new Set(sheets.map((s) => s?.properties?.title).filter(Boolean));

    const requests = sheets
      .filter((s) => String(s?.properties?.title || '').startsWith(RENAMED_ROSTER_SHEET_PREFIX))
      .map((s) => {
        const title = String(s.properties.title);
        const newTitle = ROSTER_SHEET_PREFIX + title.slice(RENAMED_ROSTER_SHEET_PREFIX.length);
        if (titles.has(newTitle)) return null;
        titles.add(newTitle);
        return {
          updateSheetProperties: {
            properties: { sheetId: s.properties.sheetId, title: newTitle },
            fields: 'title',
          },
        };
      })
      .filter(Boolean);

    if (requests.length === 0) return 0;

    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });
    return res.ok ? requests.length : 0;
  } catch (e) {
    console.warn('조사표 탭 이름 되돌리기 실패:', e);
    return 0;
  }
}

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
  const [loadingSheet, setLoadingSheet] = useState(false);
  const googleAccessToken = useAppStore((st) => st.googleAccessToken);
  const [saving, setSaving] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const allClassesInputRef = React.useRef<HTMLInputElement>(null);
  const bulkPhotoInputRef = React.useRef<HTMLInputElement>(null);
  /** 여러 장 올린 뒤의 결과. 짝을 못 지은 파일을 알려 주려고 남긴다. */
  const [bulkReport, setBulkReport] = useState<{
    picked: number;
    uploaded: number;
    /** 번호 없이 이름만 보고 짝지은 것. 눈으로 확인하시라고 적어 둔다. */
    weak: string[];
    unmatched: string[];
    notPhotos: string[];
    duplicates: string[];
    failed: string[];
    /** '12.4MB → 1.1MB' 처럼 줄어든 용량 */
    saved: string;
  } | null>(null);
  /** 타일 위로 파일을 끌어왔는가 */
  const [dragging, setDragging] = useState(false);

  const [tab, setTab] = useState<RosterTab>('manage');
  /**
   * 사진 보기. 꺼져 있으면 드라이브를 아예 부르지 않는다.
   *
   * 명단만 고치러 들어온 사람에게까지 구글을 두드릴 까닭이 없다. 껐다 켠
   * 것은 기억해 둔다 — 쓰는 사람은 늘 켜 두거나 늘 꺼 두지, 매번 고르지 않는다.
   */
  const [showPhotos, setShowPhotos] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sp4-roster-photos') === '1';
    } catch {
      return false;
    }
  });
  const [view, setView] = useState<RosterView>('list');
  const [editingClass, setEditingClass] = useState(false);
  /** 검색 탭에서 누른 학생을 관리 탭에서 잠깐 짚어 준다 */
  const [highlightNum, setHighlightNum] = useState<number | null>(null);

  // 저장 시점에 삭제된 학급/학생을 찾아내기 위한, 모달을 연 시점의 원본 스냅샷
  const originalClassesRef = React.useRef<ClassRoster[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    if (rosterList && rosterList.length > 0) {
      setCurrentClasses(JSON.parse(JSON.stringify(rosterList)));
      originalClassesRef.current = JSON.parse(JSON.stringify(rosterList));
    } else {
      setCurrentClasses([
        {
          year: new Date().getFullYear(),
          grade: '1',
          classNum: '1',
          students: [],
        },
      ]);
      originalClassesRef.current = [];
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
        }
      } catch (e) {
        console.error(e);
      }
    };
    loadBackupConfig();
  }, [isOpen, rosterList]);

  const currentClass = currentClasses[currentIndex] || {
    year: new Date().getFullYear(),
    grade: '',
    classNum: '',
    students: [],
  };

  const students = currentClass.students || [];
  const activeCount = students.filter((s) => s.isActive !== false).length;
  const inactiveCount = students.length - activeCount;

  // ── 사진 ────────────────────────────────────────────────────
  // 훅은 반드시 이른 return 위에 두어야 한다. 팝업이 닫힌 동안에는 학급을
  // null로 넘겨 드라이브를 부르지 않게 한다.
  const photoState = useStudentPhotos(isOpen ? currentClass : null, students, showPhotos);

  /**
   * 사진이 있는 재학생만 암기 판에 올린다.
   *
   * useMemo를 쓰는 까닭: 이 배열이 매번 새로 만들어지면 usePhotoQuiz가
   * 명단이 바뀐 줄 알고 판을 다시 짠다. O/X를 누를 때마다 판이 처음으로
   * 돌아가 버린다.
   */
  const quizCandidates: QuizStudent[] = React.useMemo(
    () =>
      students
        .filter((s) => s.isActive !== false && s.name && s.name !== '000')
        .map((s) => ({
          num: s.num,
          name: s.name,
          gender: s.gender,
          note: s.note,
          url: photoState.photos.get(s.num)?.url || '',
        }))
        .filter((s) => s.url),
    [students, photoState.photos]
  );

  // ── 학년도 / 학년 / 반 세 칸 ────────────────────────────────
  const pick = pickOfIndex(currentClasses, currentIndex);

  const applyPick = (want: ClassPick) => {
    const fixed = reconcilePick(currentClasses, want);
    const idx = indexOfPick(currentClasses, fixed);
    if (idx >= 0) setCurrentIndex(idx);
  };

  const photoSummary =
    showPhotos && photoState.status === 'ready' && students.length > 0
      ? `사진 ${students.length - photoState.missing.length}/${students.length}명`
      : '';

  /** 사진이 안 붙었을 때 어디서 끊겼는지 (lib/photoDiagnosis.ts) */
  const diagnosis = diagnosePhotos({
    scan: photoState.scan,
    className: classFolderName(currentClass),
    studentCount: students.length,
    matchedCount: students.length - photoState.missing.length,
    hasLegacyRoot: !!photoState.folders.root,
    pickedFolderName: photoState.classFolder?.name,
  });

  /**
   * 아래 '사진 폴더' 단추.
   *
   * 이 학급을 위해 따로 고른 폴더가 있으면 그것을, 없으면 앱이 맡아 두는
   * School_Planner/Students_Poto/2026-3-1 을 연다(없으면 만들어서 연다).
   * 열어 보고 사진을 직접 넣어 보려는 사람을 위한 자리다.
   */
  const handleOpenPhotoFolder = async () => {
    if (photoState.classFolder) {
      window.open(`https://drive.google.com/drive/folders/${photoState.classFolder.id}`, '_blank');
      return;
    }
    try {
      const url = await openManagedPhotoFolder(currentClass);
      window.open(url, '_blank');
    } catch (e: any) {
      showErrorToast(e?.message || '폴더를 열지 못했습니다.');
    }
  };

  /**
   * 사진 보기를 켜고 끈다.
   *
   * 켤 때는 필요하면 구글 권한 창까지 여기서 띄운다. 예전에는 켜기만 하고,
   * 연결이 없으면 '구글 연결이 끊겼습니다' 띠를 내어 단추를 한 번 더 누르게
   * 했다. 사진을 보겠다고 누른 사람에게 같은 뜻을 두 번 묻는 셈이었다.
   *
   * 권한 창은 누른 그 순간에만 열 수 있다(브라우저가 팝업을 막는다). 그래서
   * 상태가 바뀌기를 기다리지 않고 이 자리에서 바로 부른다.
   */
  const togglePhotos = () => {
    const next = !showPhotos;
    try {
      localStorage.setItem('sp4-roster-photos', next ? '1' : '0');
    } catch {
      /* 시크릿 모드 등. 이번 판에서만 켜진다. */
    }
    // 사진을 끄면 타일 보기는 뜻이 없다 (빈 칸만 늘어선다)
    if (!next) setView('list');
    setShowPhotos(next);

    if (next) {
      photoState.authorize().catch((e: any) => {
        showErrorToast(e?.message || '사진을 불러오지 못했습니다.');
      });
    }
  };

  /** 못 읽는 폴더에 묶인 것을 풀고 앱이 맡아 두는 자리로 되돌아간다 */
  const handleForgetClassFolder = async () => {
    try {
      await photoState.forgetClassFolder();
      showToast('✅ 앱이 맡아 두는 사진 폴더를 다시 씁니다.');
    } catch (e: any) {
      showErrorToast(e?.message || '되돌리지 못했습니다.');
    }
  };

  /** 고른 폴더를 드라이브에서 열어 본다. 엉뚱한 폴더인지 눈으로 가리려는 것. */
  const handleOpenPickedFolder = () => {
    const id = photoState.classFolder?.id || photoState.scan?.folderId;
    if (!id) return showErrorToast('열어 볼 폴더가 없습니다.');
    window.open(`https://drive.google.com/drive/folders/${id}`, '_blank');
  };

  /**
   * 이 학급의 폴더를 직접 고른다.
   *
   * drive.file 권한은 고른 폴더의 바로 아래 자식까지만 열어 준다. 위쪽 폴더를
   * 골랐을 때 2026-3-1 폴더는 보여도 그 안의 사진은 안 보이는 까닭이다.
   * 학급마다 한 번씩 고르면 그 뒤로는 기억해 두고 다시 묻지 않는다.
   */
  const handlePickClassFolder = async () => {
    try {
      const picked = await photoState.connectForClass();
      if (picked) {
        showToast(`✅ ${classFolderName(currentClass)} 사진을 '${picked.name}' 폴더에서 읽습니다.`);
      }
    } catch (e: any) {
      showErrorToast(e?.message || '폴더를 연결하지 못했습니다.');
    }
  };

  /**
   * 사진 여러 장을 한꺼번에 올린다.
   *
   * 스물다섯 명을 하나씩 누르게 할 수는 없다. 파일 이름에 이미 누구인지가
   * 적혀 있으므로 그걸 읽어 짝짓는다(lib/photoBulkUpload.ts).
   */
  const handleBulkUpload = async (fileList: FileList | File[] | null) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) {
      // 말없이 되돌아 나가면 단추가 고장 난 것처럼 보인다
      return showErrorToast('고른 파일이 없습니다.');
    }
    setBulkReport(null);
    try {
      const { plan, failed, before, after } = await photoState.uploadMany(files);
      const uploaded = plan.matched.length - failed.length;
      setBulkReport({
        picked: files.length,
        uploaded,
        weak: plan.matched
          .filter((m) => m.by !== 'numAndName')
          .map((m) => `${m.student.num}번 ${m.student.name} ← ${m.file.name}`),
        unmatched: plan.unmatched.map((f) => f.name),
        notPhotos: plan.notPhotos.map((f) => f.name),
        duplicates: plan.duplicates.map((f) => f.name),
        failed,
        saved: before > after ? `${formatBytes(before)} → ${formatBytes(after)}` : '',
      });
      if (uploaded > 0) showToast(`✅ 사진 ${uploaded}장을 올렸습니다.`);
    } catch (e: any) {
      showErrorToast(e?.message || '사진을 올리지 못했습니다.');
    }
  };

  const handleUploadPhoto = async (student: Student, file: File) => {
    try {
      await photoState.upload(student, file);
      showToast(`✅ ${student.name || student.num + '번'} 사진을 올렸습니다.`);
    } catch (e: any) {
      showErrorToast(e?.message || '사진을 올리지 못했습니다.');
    }
  };

  /** 검색 결과에서 학생을 누르면 그 학급의 관리 탭으로 데려간다 */
  const handleOpenStudentFromSearch = (cls: ClassRoster, student: Student) => {
    const idx = indexOfPick(currentClasses, {
      year: String(cls.year),
      grade: String(cls.grade),
      classNum: String(cls.classNum),
    });
    if (idx >= 0) setCurrentIndex(idx);
    setTab('manage');
    setHighlightNum(student.num);
    // 짚어 주는 것은 잠깐이면 된다. 계속 켜 두면 어느 줄을 고쳐야 할지 헷갈린다.
    window.setTimeout(() => setHighlightNum(null), 2500);
  };

  if (!isOpen) return null;

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


  // 📊 구글 시트에서 명단 불러오기 (V3 로직 완벽 연동)
  const handleImportFromGoogleSheet = async () => {
    const { year, grade, classNum } = currentClass;
    if (!year || !grade || !classNum) {
      return showErrorToast('가져올 학급의 학년도, 학년, 반 정보를 먼저 위 칸에 입력해주세요.');
    }

    if (!spreadsheetId) {
      await handleOpenGoogleSheet();
      return;
    }

    // V3 호환: Google Sheets API v4 + OAuth 토큰 방식 (CORS 문제 해결)
    const token = googleAccessToken || sessionStorage.getItem('google_api_token');
    if (!token) {
      showErrorToast('구글 로그인이 필요합니다.\n로그아웃 후 다시 로그인해주세요.');
      return;
    }

    const sheetName = `${ROSTER_SHEET_PREFIX}${year}-${grade}-${classNum}`;
    setLoadingSheet(true);

    try {
      // 0. 잠깐 '명렬표_'로 바뀌었던 탭이 있으면 '조사표_'로 되돌린다.
      //    되돌릴 것이 없으면 아무 일도 하지 않고 지나간다.
      const restoredCount = await restoreRosterSheetTitles(token, spreadsheetId);
      if (restoredCount > 0) {
        showToast(`📊 시트 탭 ${restoredCount}개의 이름을 '조사표_'로 되돌렸습니다.`);
      }

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

          showErrorToast(`✅ 시트 생성이 완료되었습니다!\n\n곧 열리는 구글 시트의 [${sheetName}] 탭에 학생 번호와 이름을 등록하신 뒤, 앱으로 돌아와 다시 '구글 시트에서 불러오기'를 눌러주세요.`);
          window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, '_blank');
        }
        return;
      }

      const data = await res.json();
      const rows: string[][] = data.values || [];

      if (rows.length === 0) {
        showErrorToast(`[${sheetName}] 시트에 등록된 학생 데이터가 없습니다.\n시트에 번호와 이름을 등록해주세요.`);
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
        showErrorToast('유효한 학생 데이터(번호, 이름)를 찾지 못했습니다.\n시트의 A열과 B열에 데이터를 올바르게 입력했는지 확인해주세요.');
        return;
      }

      // 시트에는 번호·이름·성별밖에 없다. 전출 표시와 특이사항은 앱에만 있어,
      // 시트로 통째로 갈아엎으면 전출한 학생이 전부 재학으로 되살아났다.
      // 앱에 있던 값을 이어 붙이고, 시트에서 빠진 전출 학생은 남겨 둔다.
      // 지난 조사표가 그 학생을 가리키고 있기 때문이다.
      const previous: Student[] = currentClasses[currentIndex]?.students || [];
      const keyOf = (num: number, name: string) => `${num} ${String(name || '').trim()}`;
      const prevByKey = new Map(previous.map((s) => [keyOf(s.num, s.name), s]));

      const merged: Student[] = parsedStudents.map((st) => {
        const old = prevByKey.get(keyOf(st.num, st.name));
        return old
          ? { ...st, isActive: old.isActive !== false, note: st.note || old.note || '' }
          : st;
      });

      const fromSheet = new Set(merged.map((s) => keyOf(s.num, s.name)));
      const keptLeavers = previous.filter(
        (s) => s.isActive === false && !fromSheet.has(keyOf(s.num, s.name))
      );

      const leaverMsg = keptLeavers.length > 0 ? `\n전출한 학생 ${keptLeavers.length}명은 그대로 둡니다.` : '';

      if (
        confirm(
          `[${sheetName}] 시트에서 총 ${parsedStudents.length}명의 학생을 찾았습니다.\n현재 앱의 명단을 이 데이터로 교체하시겠습니까?${leaverMsg}`
        )
      ) {
        const updated = [...currentClasses];
        updated[currentIndex] = {
          ...updated[currentIndex],
          students: [...merged, ...keptLeavers].sort((a, b) => a.num - b.num),
        };
        setCurrentClasses(updated);
        showErrorToast('✅ 성공적으로 반영되었습니다.\n하단 \'클라우드 저장\' 버튼을 눌러 완전히 적용해주세요.');
      }
    } catch (e: any) {
      console.error(e);
      if (e.message && (e.message.includes('401') || e.message.includes('403'))) {
        showErrorToast('구글 API 권한이 거부되었습니다.\n\n[해결 방법]\n1. 로그아웃합니다.\n2. 다시 로그인할 때 뜨는 구글 팝업창에서 모든 접근 권한 체크박스를 반드시 체크해주세요!');
      } else {
        showErrorToast('구글 시트 연동 중 오류가 발생했습니다: ' + e.message);
      }
    } finally {
      setLoadingSheet(false);
    }
  };

  const handleDownloadCSV = () => {
    if (students.length === 0) {
      showErrorToast('다운로드할 명단이 없습니다.');
      return;
    }
    const filename = `${currentClass.year}년_${currentClass.grade}학년_${currentClass.classNum}반_명렬표.csv`;
    downloadCSV(students, filename);
  };

  /**
   * 모든 학급을 한 파일에 담는다.
   *
   * 옆의 ↓CSV는 지금 고른 학급 하나만 담는다. 학년 초에 여러 반 명단을
   * 한꺼번에 받아 넣을 때는 학급 수만큼 같은 일을 되풀이해야 했다.
   * 학년도·학년·반 칸으로 학급을 가르므로 한 파일로 오간다.
   *
   * 예전에는 이 기능이 '내보내기/가져오기' 화면에 있었다. 그 화면은 날짜별
   * 자료를 다루는 곳이라 명렬표만 성격이 달랐고, 이름도 '조사표'로 잘못
   * 붙어 있었다. 명단을 다루는 이 화면이 제자리다.
   */
  const handleDownloadAllCSV = async () => {
    const user = auth.currentUser;
    if (!user) return;

    // 화면에서 고치는 중인 것이 아니라 저장된 것을 담는다. 아직 저장하지 않은
    // 수정까지 담으면, 파일과 클라우드가 서로 다른 것을 담게 된다.
    const snap = await getDoc(doc(db, 'users', user.uid, 'settings', 'rosters'));
    const classList: any[] = snap.exists()
      ? snap.data().classList || snap.data().rosters || snap.data().list || []
      : [];

    const rows = buildRosterCsvRows(classList);
    if (rows.length <= 1) {
      return showErrorToast('내보낼 명단이 없습니다.');
    }

    downloadCsv(rows, `School_Planner_명렬표_전체_${new Date().toISOString().slice(0, 10)}.csv`);
    showToast(`✅ 학급 ${classList.length}개, 학생 ${rows.length - 1}명을 CSV로 내보냈습니다.`);
  };

  /** 전체 학급 CSV를 되읽는다. 파일에 없는 학급은 그대로 둔다. */
  const handleUploadAllCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;

    const user = auth.currentUser;
    if (!user) return;

    try {
      const table = parseCsv(await file.text());
      const header = (table[0] || []).map((h) => String(h ?? '').trim());
      if (!['학년도', '학년', '반', '번호', '이름'].every((key) => header.includes(key))) {
        return showErrorToast(
          `전체 학급 CSV가 아닙니다. 머리말에 ${ROSTER_CSV_HEADER.join(', ')} 가 있어야 합니다.\n한 학급짜리 파일은 옆의 [↑ CSV]로 넣어 주세요.`
        );
      }

      const { classList: incoming, skipped } = parseRosterCsvRows(table);
      if (incoming.length === 0) {
        return showErrorToast('CSV에서 학생을 찾지 못했습니다. 번호·이름·학년·반이 채워져 있는지 확인해 주세요.');
      }

      const summary = incoming
        .map((c) => `${c.year}년 ${c.grade}학년 ${c.classNum}반 (${c.students.length}명)`)
        .join('\n');
      if (!confirm(`다음 학급의 명단을 파일 내용으로 바꿉니다.\n\n${summary}\n\n파일에 없는 학급은 그대로 둡니다.\n계속할까요?`)) {
        return;
      }

      const rosterRef = doc(db, 'users', user.uid, 'settings', 'rosters');
      const snap = await getDoc(rosterRef);
      const current: any[] = snap.exists()
        ? snap.data().classList || snap.data().rosters || snap.data().list || []
        : [];
      const merged = mergeRosters(current, incoming);

      // V3는 classList, V4는 rosters라는 이름으로 같은 것을 읽는다
      await setDoc(rosterRef, { classList: merged, rosters: merged, updatedAt: Date.now() }, { merge: true });

      setCurrentClasses(JSON.parse(JSON.stringify(merged)));
      originalClassesRef.current = JSON.parse(JSON.stringify(merged));
      setCurrentIndex(0);

      const students = incoming.reduce((sum, c) => sum + c.students.length, 0);
      showToast(
        `✅ 학급 ${incoming.length}개, 학생 ${students}명을 되돌렸습니다.` +
          (skipped > 0 ? ` (읽지 못한 줄 ${skipped}개는 건너뛰었습니다)` : '')
      );
    } catch (err) {
      showErrorToast('CSV를 읽는 중 오류가 발생했습니다.', err);
    }
  };

  const handleUploadCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const parsedStudents = await parseCSV(file);
      if (parsedStudents.length === 0) {
        showToast('CSV 파일에서 학생 정보를 찾지 못했습니다.');
        return;
      }
      
      if (confirm(`CSV 파일에서 총 ${parsedStudents.length}명의 학생을 찾았습니다.\n현재 앱의 명단을 이 데이터로 덮어쓰시겠습니까?`)) {
        const updated = [...currentClasses];
        updated[currentIndex] = {
          ...updated[currentIndex],
          students: parsedStudents,
        };
        setCurrentClasses(updated);
        showErrorToast('✅ 성공적으로 반영되었습니다.\n하단 \'클라우드 저장\' 버튼을 눌러 완전히 적용해주세요.');
      }
    } catch (err: any) {
      showErrorToast('CSV 불러오기 오류: ' + err.message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /**
   * 새 학급 추가.
   *
   * ⚠️ 예전에는 학년·반을 빈 값으로 두고 아래 칸에서 채우게 했다. 학급을
   *    고르는 자리가 목록 하나였을 때는 그래도 됐다(빈 학급도 목록에 보였다).
   *    지금은 학년도·학년·반 세 칸으로 고르는데, 빈 값은 그 목록에 오르지
   *    않는다. 빈 학급을 만들면 방금 만든 학급으로 돌아갈 길이 없어진다.
   *    그래서 지금 보고 있는 학급 옆의 빈 번호로 채워서 만든다.
   */
  const handleAddNewClass = () => {
    const year = Number(currentClass.year) || new Date().getFullYear();
    const grade = String(currentClass.grade || '1');
    const taken = new Set(
      currentClasses
        .filter((c) => Number(c.year) === year && String(c.grade) === grade)
        .map((c) => String(c.classNum))
    );
    let classNum = 1;
    while (taken.has(String(classNum))) classNum += 1;

    const updated = [...currentClasses, { year, grade, classNum: String(classNum), students: [] }];
    setCurrentClasses(updated);
    setCurrentIndex(updated.length - 1);
    // 방금 만든 학급의 학년·반을 바로 고칠 수 있게 편집 칸을 펼쳐 준다
    setEditingClass(true);
  };

  // 현재 학급 삭제
  const handleDeleteCurrentClass = () => {
    if (currentClasses.length <= 1) {
      if (confirm('모든 학급 정보를 비우시겠습니까?')) {
        // 여기도 빈 학년·반으로 두면 세 칸 선택에서 사라진다 (위 주석 참고)
        setCurrentClasses([
          {
            year: new Date().getFullYear(),
            grade: '1',
            classNum: '1',
            students: [],
          },
        ]);
        setCurrentIndex(0);
        setEditingClass(true);
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
    // 한 명 삭제는 묻지 않는다. 저장할 때 휴지통으로 가므로 되돌릴 수 있다.
    const updated = [...currentClasses];
    updated[currentIndex].students = students.filter((_, i) => i !== idx);
    setCurrentClasses(updated);
    showToast(`🗑️ '${name}' 학생을 지웠습니다. 저장하면 휴지통으로 갑니다.`);
  };

  // 학생 전체 삭제
  const handleRemoveAllStudents = () => {
    if (students.length === 0) return showErrorToast('삭제할 학생이 없습니다.');
    if (confirm('현재 학급의 모든 학생을 삭제하시겠습니까?\n(하단 클라우드 저장을 눌러야 최종 반영됩니다.)')) {
      const updated = [...currentClasses];
      updated[currentIndex].students = [];
      setCurrentClasses(updated);
    }
  };

  // 학급 식별 키 (id가 없어 year+grade+classNum 조합으로 식별)
  const classKey = (c: ClassRoster) => `${c.year}_${c.grade}_${c.classNum}`;

  // 저장 직전, 모달을 처음 열었을 때와 비교해 삭제된 학급/학생을 찾아 휴지통으로 보낸다.
  const trashRemovedRosterEntries = async () => {
    const original = originalClassesRef.current;

    for (const origClass of original) {
      const key = classKey(origClass);
      const stillExists = currentClasses.find((c) => classKey(c) === key);

      if (!stillExists) {
        // 학급 전체가 삭제됨
        try {
          await moveToTrash({
            id: `roster_class_${key}_${Date.now()}`,
            type: 'roster',
            content: `${origClass.year}년 ${origClass.grade}학년 ${origClass.classNum}반 (학급 전체, 학생 ${(origClass.students || []).length}명)`,
            data: { kind: 'class', class: origClass },
          });
        } catch (err) {
          console.error('학급 휴지통 이동 실패:', err);
        }
        continue;
      }

      // 학급은 남아있으므로 학생 단위로 비교
      const currentStudentNums = new Set((stillExists.students || []).map((s) => s.num));
      for (const student of origClass.students || []) {
        if (!currentStudentNums.has(student.num)) {
          try {
            await moveToTrash({
              id: `roster_student_${key}_${student.num}_${Date.now()}`,
              type: 'roster',
              content: `${student.name && student.name !== '000' ? student.name : student.num + '번'} (${origClass.grade}학년 ${origClass.classNum}반)`,
              data: {
                kind: 'student',
                classKey: { year: origClass.year, grade: origClass.grade, classNum: origClass.classNum },
                student,
              },
            });
          } catch (err) {
            console.error('학생 휴지통 이동 실패:', err);
          }
        }
      }
    }
  };

  // 최종 저장
  const handleSave = async () => {
    setSaving(true);
    try {
      await trashRemovedRosterEntries();
      await saveRosterList(currentClasses);
      originalClassesRef.current = JSON.parse(JSON.stringify(currentClasses));
      showToast('✅ 학급 정보가 저장되었습니다.');
    } catch (e) {
      console.error('명렬표 저장 오류:', e);
      showErrorToast('명렬표 저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };


  // ── 화면 ────────────────────────────────────────────────────
  //
  // 껍데기(배경·스크롤 잠금·겹침 차례)는 ModalShell에 맡긴다. 예전에는 그
  // 스무 줄이 이 파일에도 복사돼 있었다.
  /* 구글 연결이 끊겼을 때의 띠. 팝업을 여는 것만으로 로그인 창을 띄우지
     않기로 했으므로(useStudentPhotos 참고), 눌러 주실 때까지 기다린다.
     관리 탭과 암기 탭이 같은 것을 쓴다. */
  /* 구글 연결이 안 됐을 때의 띠.
     '사진 불러오기' 단추는 뺐다. 위쪽 '사진'을 누르면 필요한 로그인까지
     그 자리에서 하므로, 같은 뜻을 두 번 묻는 단추였다. 권한 창을 닫았거나
     거절한 사람에게 무엇을 하면 되는지만 알려 준다. */
  const needsAuthBand = (
    <div className="text-2xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2">
      구글 연결이 끊겨 사진을 불러오지 못했습니다. 위쪽 <strong className="text-slate-700">사진</strong> 단추를
      다시 누르면 연결합니다. 명단은 그대로 쓰실 수 있습니다.
    </div>
  );

  const tabs: { id: RosterTab; label: string }[] = [
    { id: 'manage', label: '관리' },
    { id: 'search', label: '검색' },
    { id: 'memorize', label: '암기' },
  ];

  const selectCls =
    'appearance-none bg-white border border-blue-200 rounded-lg pl-2.5 pr-6 py-1.5 text-xs font-bold text-slate-700 shadow-2xs focus:outline-none focus:border-primary cursor-pointer';

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="4xl"
      bare
      title="학급 정보(명렬표) 관리"
      footer={
        <div className="w-full flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleOpenGoogleSheet}
              title="연결된 구글 시트를 새 창에서 엽니다"
              className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M3 15h18M9 3v18" />
              </svg>
              명렬표 시트
            </button>
            <button
              type="button"
              onClick={handleOpenPhotoFolder}
              title={
                photoState.folder
                  ? `드라이브에서 ${photoState.folder.name || '사진 폴더'}를 엽니다`
                  : '사진 폴더를 연결합니다'
              }
              className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
              사진 폴더
            </button>
          </div>

          <div className="flex items-center gap-2">
            <ModalCloseButton onClose={onClose} />
            <button
              title="저장"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <span>💾</span> {saving ? '저장 중...' : '클라우드 저장'}
            </button>
          </div>
        </div>
      }
    >
      {/* 왼쪽 학년도·학년·반, 오른쪽 세 탭 */}
      <div className="flex items-center justify-between gap-2.5 px-4 py-2.5 bg-blue-50 border-b border-blue-100 flex-wrap shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <select
              value={pick.year}
              onChange={(e) => applyPick({ ...pick, year: e.target.value })}
              className={selectCls}
              title="학년도"
            >
              {yearOptions(currentClasses).map((y) => (
                <option key={y} value={y}>{y}학년도</option>
              ))}
            </select>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">▾</span>
          </div>
          <div className="relative">
            <select
              value={pick.grade}
              onChange={(e) => applyPick({ ...pick, grade: e.target.value })}
              className={selectCls}
              title="학년"
            >
              {gradeOptions(currentClasses, pick.year).map((g) => (
                <option key={g} value={g}>{g}학년</option>
              ))}
            </select>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">▾</span>
          </div>
          <div className="relative">
            <select
              value={pick.classNum}
              onChange={(e) => applyPick({ ...pick, classNum: e.target.value })}
              className={selectCls}
              title="반"
            >
              {classNumOptions(currentClasses, pick.year, pick.grade).map((c) => (
                <option key={c} value={c}>{c}반</option>
              ))}
            </select>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">▾</span>
          </div>

          <button
            type="button"
            onClick={() => setEditingClass((v) => !v)}
            title="학급을 더하거나 지우고, 학년·반 숫자를 고칩니다"
            className={`border rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              editingClass
                ? 'bg-primary text-white border-primary'
                : 'bg-transparent text-primary border-blue-200 hover:bg-blue-100'
            }`}
          >
            학급 편집
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* 사진 보기. 켜야 드라이브를 부른다. */}
          <button
            type="button"
            onClick={togglePhotos}
            title={
              showPhotos
                ? '사진 칸을 감추고 구글 드라이브를 부르지 않습니다'
                : '사진 칸을 내고 구글 드라이브에서 사진을 불러옵니다'
            }
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold border transition-colors cursor-pointer ${
              showPhotos
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-slate-600 border-blue-200 hover:bg-blue-100'
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <circle cx="12" cy="12.5" r="3.5" />
            </svg>
            사진
          </button>

          <div className="flex gap-1 bg-blue-100 rounded-xl p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-lg px-6 py-1.5 text-xs font-extrabold transition-colors cursor-pointer ${
                  tab === t.id
                    ? 'bg-white text-primary shadow-2xs'
                    : 'bg-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 학급 편집 — 세 칸으로 고르게 되면서 학급 자체를 손볼 자리가 없어졌다.
          늘 펼쳐 두면 본문이 좁아지므로 누를 때만 나온다. */}
      {editingClass && (
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-2xs font-extrabold text-slate-500 tracking-wide">
              지금 고른 학급의 학년도·학년·반을 고칩니다
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleAddNewClass}
                className="px-2.5 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-xs font-bold shadow-2xs transition-all cursor-pointer"
              >
                + 새 학급 추가
              </button>
              <button
                type="button"
                onClick={handleDeleteCurrentClass}
                className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg text-xs font-bold transition-all cursor-pointer"
              >
                학급 삭제
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-2xs font-bold text-slate-500 mb-1">학년도</label>
              <input
                type="number"
                value={currentClass.year || new Date().getFullYear()}
                onChange={(e) =>
                  handleUpdateClassMeta('year', parseInt(e.target.value, 10) || new Date().getFullYear())
                }
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-2xs font-bold text-slate-500 mb-1">학년</label>
              <input
                type="text"
                value={currentClass.grade || ''}
                onChange={(e) => handleUpdateClassMeta('grade', e.target.value)}
                placeholder="예: 3"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-2xs font-bold text-slate-500 mb-1">반</label>
              <input
                type="text"
                value={currentClass.classNum || ''}
                onChange={(e) => handleUpdateClassMeta('classNum', e.target.value)}
                placeholder="예: 2"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          <p className="text-2xs text-slate-400 font-semibold">
            학년·반을 고치면 사진 폴더 이름(2026-3-2)도 달라집니다. 드라이브의 폴더 이름도 함께
            바꿔 주셔야 사진이 이어집니다.
          </p>
        </div>
      )}

      <div className="px-4 py-3.5 flex flex-col gap-2.5">
        {tab === 'manage' && (
          <>
            <div className="flex items-center justify-between gap-1.5 flex-wrap">
              <div className="text-xs text-slate-600 font-bold">
                총 <span className="text-primary font-extrabold">{students.length}</span>명
                (재학 <span className="text-emerald-600">{activeCount}</span>명
                {inactiveCount > 0 && <span className="text-slate-400">, 전출 {inactiveCount}명</span>})
                {photoSummary && <span className="text-slate-400 font-semibold"> · {photoSummary}</span>}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {showPhotos && (
                <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                  {(['list', 'tile'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setView(v)}
                      className={`rounded-md px-2.5 py-1 text-xs font-bold transition-colors cursor-pointer ${
                        view === v ? 'bg-white text-slate-800 shadow-2xs' : 'text-slate-500'
                      }`}
                    >
                      {v === 'list' ? '목록' : '타일'}
                    </button>
                  ))}
                </div>
                )}

                <button
                  onClick={handleImportFromGoogleSheet}
                  disabled={loadingSheet}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-all flex items-center gap-1 cursor-pointer disabled:opacity-60"
                  title="연결된 구글 시트의 [조사표_학년-반] 탭에서 명단과 조사표를 가져옵니다"
                >
                  <span>📊</span>
                  {loadingSheet ? '시트 읽는 중...' : '시트 동기화'}
                </button>

                <div className="flex items-center gap-1 bg-slate-100 rounded-lg px-1.5 py-1">
                  <input type="file" accept=".csv" ref={fileInputRef} onChange={handleUploadCSV} className="hidden" />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2 py-0.5 bg-white text-slate-700 border border-slate-300 rounded text-xs font-bold hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
                    title="CSV 업로드"
                  >
                    ↑ CSV
                  </button>
                  <button
                    onClick={handleDownloadCSV}
                    className="px-2 py-0.5 bg-white text-slate-700 border border-slate-300 rounded text-xs font-bold hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
                    title="지금 고른 학급만 CSV로 내려받기"
                  >
                    ↓ CSV
                  </button>
                </div>

                <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-1.5 py-1">
                  <span className="text-2xs font-bold text-amber-700 px-0.5">전체 학급</span>
                  <input type="file" accept=".csv" ref={allClassesInputRef} onChange={handleUploadAllCSV} className="hidden" />
                  <button
                    onClick={() => allClassesInputRef.current?.click()}
                    className="px-2 py-0.5 bg-white text-amber-800 border border-amber-300 rounded text-xs font-bold hover:bg-amber-100 transition-colors shadow-2xs cursor-pointer"
                    title="모든 학급이 담긴 CSV를 올립니다. 파일에 없는 학급은 그대로 둡니다."
                  >
                    ↑ CSV
                  </button>
                  <button
                    onClick={handleDownloadAllCSV}
                    className="px-2 py-0.5 bg-white text-amber-800 border border-amber-300 rounded text-xs font-bold hover:bg-amber-100 transition-colors shadow-2xs cursor-pointer"
                    title="모든 학급의 명단을 한 파일로 내려받습니다. (학년도, 학년, 반, 번호, 이름, 성별, 상태, 특이사항)"
                  >
                    ↓ CSV
                  </button>
                </div>

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
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold border border-slate-200 transition-all cursor-pointer"
                  >
                    + 학생 추가
                  </button>
                </div>

                {/* 사진 여러 장. 파일 이름으로 학생을 알아서 짝짓는다. */}
                {showPhotos && (
                <>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  ref={bulkPhotoInputRef}
                  onChange={(e) => {
                    // ⚠️ 먼저 배열로 옮겨 담고 나서 입력칸을 비운다.
                    //    e.target.files는 입력칸에 살아 붙어 있는 목록이라,
                    //    value를 비우면 들고 있던 그 목록도 함께 비워진다.
                    //    참조만 넘겼더니 받는 쪽에서 0개로 보였다.
                    const picked = Array.from(e.target.files || []);
                    e.target.value = '';
                    void handleBulkUpload(picked);
                  }}
                  className="hidden"
                />
                <button
                  onClick={() => bulkPhotoInputRef.current?.click()}
                  disabled={!!photoState.bulk}
                  className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold shadow-2xs transition-all flex items-center gap-1 cursor-pointer disabled:opacity-60"
                  title="사진 여러 장을 한꺼번에 고르면 파일 이름으로 학생을 짝지어 올립니다"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <circle cx="12" cy="12.5" r="3.5" />
                  </svg>
                  {photoState.bulk
                    ? `올리는 중 ${photoState.bulk.done}/${photoState.bulk.total}`
                    : '사진 여러 장'}
                </button>
                </>
                )}

                <button
                  onClick={handleRemoveAllStudents}
                  className="px-2 py-1 text-slate-400 hover:text-red-500 text-xs font-bold transition-colors cursor-pointer"
                  title="학생 명단 전체 비우기"
                >
                  전체 삭제
                </button>
              </div>
            </div>

            {/* 타일·목록 위로 사진을 끌어다 놓아도 올라가게 한다.
                스물세 장을 창에서 고르는 것보다 폴더에서 끌어 오는 쪽이 자연스럽다. */}
            <div
              onDragOver={(e) => {
                if (!showPhotos || !e.dataTransfer.types.includes('Files')) return;
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                // 자식 위로 옮겨 갈 때도 leave가 난다. 실제로 벗어났을 때만 끈다.
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDragging(false);
              }}
              onDrop={(e) => {
                if (!showPhotos || !e.dataTransfer.types.includes('Files')) return;
                e.preventDefault();
                setDragging(false);
                void handleBulkUpload(e.dataTransfer.files);
              }}
              className={`relative rounded-xl transition-colors ${
                dragging ? 'ring-2 ring-primary ring-offset-2 bg-blue-50/40' : ''
              }`}
            >
              {dragging && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-blue-50/80 pointer-events-none">
                  <span className="text-sm font-extrabold text-primary">
                    여기에 놓으면 파일 이름으로 학생을 찾아 올립니다
                  </span>
                </div>
              )}
              <RosterManageTab
                students={students}
                view={view}
                showPhoto={showPhotos}
                photos={photoState.photos}
                canUploadPhoto
                uploadingNum={photoState.uploading}
                onUploadPhoto={handleUploadPhoto}
                onUpdateStudent={handleUpdateStudent}
                onRemoveStudent={handleRemoveStudent}
                highlightNum={highlightNum}
              />
            </div>

            {/* 여러 장 올리는 중. 단추 문구는 툴바에 묻혀 안 보인다. */}
            {photoState.bulk && (
              <div className="flex items-center gap-2 rounded-lg px-2.5 py-2 border border-blue-200 bg-blue-50">
                <span className="text-2xs font-bold text-primary whitespace-nowrap">
                  사진 올리는 중 {photoState.bulk.done} / {photoState.bulk.total}
                </span>
                <span className="flex-1 h-1.5 rounded-full bg-blue-200 overflow-hidden">
                  <span
                    className="block h-full bg-primary rounded-full transition-all duration-200"
                    style={{
                      width: `${
                        photoState.bulk.total > 0
                          ? Math.round((photoState.bulk.done / photoState.bulk.total) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </span>
              </div>
            )}

            {/* 여러 장 올린 뒤의 결과. 한 장도 못 올렸을 때야말로 꼭 보여야
                하므로 늘 낸다. 토스트로 흘려보내면 무엇을 손봐야 하는지가
                같이 사라진다. */}
            {bulkReport && (
                <div
                  className={`flex items-start justify-between gap-2 rounded-lg px-2.5 py-2 border ${
                    bulkReport.uploaded === 0
                      ? 'border-red-200 bg-red-50'
                      : 'border-amber-200 bg-amber-50'
                  }`}
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span
                      className={`text-2xs font-bold ${
                        bulkReport.uploaded === 0 ? 'text-red-700' : 'text-amber-800'
                      }`}
                    >
                      고른 파일 {bulkReport.picked}개 중 {bulkReport.uploaded}장을 올렸습니다.
                      {bulkReport.saved && ` 용량 ${bulkReport.saved}`}
                      {bulkReport.unmatched.length > 0 &&
                        ` 짝을 못 찾은 파일 ${bulkReport.unmatched.length}개: ${bulkReport.unmatched
                          .slice(0, 5)
                          .join(', ')}${bulkReport.unmatched.length > 5 ? ' …' : ''}`}
                    </span>
                    {bulkReport.weak.length > 0 && (
                      <span className="text-2xs text-slate-600 font-semibold">
                        번호 없이 이름만 보고 짝지은 것 {bulkReport.weak.length}건 — 맞는지 봐 주세요:{' '}
                        {bulkReport.weak.slice(0, 5).join(' · ')}
                        {bulkReport.weak.length > 5 ? ' …' : ''}
                      </span>
                    )}
                    {bulkReport.notPhotos.length > 0 && (
                      <span className="text-2xs text-slate-500 font-semibold">
                        사진이 아닌 파일 {bulkReport.notPhotos.length}개는 건너뛰었습니다.
                      </span>
                    )}
                    {bulkReport.duplicates.length > 0 && (
                      <span className="text-2xs text-slate-500 font-semibold">
                        같은 학생에게 두 장이 걸려 {bulkReport.duplicates.length}개는 건너뛰었습니다.
                      </span>
                    )}
                    {bulkReport.failed.length > 0 && (
                      <span className="text-2xs text-red-700 font-semibold">
                        올리다 실패한 파일 {bulkReport.failed.length}개: {bulkReport.failed.slice(0, 3).join(', ')}
                      </span>
                    )}
                    {bulkReport.unmatched.length > 0 && (
                      <span className="text-2xs text-slate-500 font-semibold">
                        파일 이름에 학생 이름이나 번호가 들어 있어야 찾습니다. 빈 칸을 눌러 하나씩 올리셔도 됩니다.
                      </span>
                    )}
                    {bulkReport.picked === 0 && (
                      <span className="text-2xs text-slate-500 font-semibold">
                        고른 파일이 없습니다. 창에서 사진을 고르신 뒤 '열기'를 눌러 주세요.
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setBulkReport(null)}
                    className="text-amber-700 hover:text-amber-900 font-black text-xs shrink-0 cursor-pointer"
                    title="닫기"
                  >
                    ✕
                  </button>
                </div>
              )}

            {/* 사진 상태 한 줄. 사진 보기를 켰을 때만 뜬다 — 꺼 두신 분께
                폴더 이야기를 늘어놓을 까닭이 없다. 사진이 없어도 관리 탭은
                그대로 쓸 수 있어야 하므로 여기를 막지는 않는다. */}
            {showPhotos &&
              (photoState.status === 'needs-auth' ? (
              needsAuthBand
            ) : photoState.status === 'error' ? (
              <div className="flex items-center justify-between gap-2 text-2xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 flex-wrap">
                <span>{photoState.error}</span>
                <button
                  type="button"
                  onClick={handlePickClassFolder}
                  className="px-2.5 py-1 bg-white border border-red-300 rounded text-2xs font-bold text-red-700 hover:bg-red-100 transition-colors cursor-pointer"
                >
                  이 학급 폴더 고르기
                </button>
              </div>
            ) : photoState.status === 'loading' || photoState.resolving ? (
              <div className="text-2xs text-slate-400 font-semibold px-0.5">
                사진을 불러오는 중... ({students.length - photoState.missing.length}/{students.length})
              </div>
            ) : (
              /* 사진이 안 붙었을 때 '없음'이라고만 하면 아직 안 올린 것인지,
                 폴더를 못 읽은 것인지, 이름이 틀린 것인지 가릴 수 없다.
                 어디서 끊겼는지는 lib/photoDiagnosis.ts가 가린다. */
              <PhotoStatusBar
                diagnosis={diagnosis}
                where={
                  photoState.classFolder
                    ? `고른 폴더 : ${photoState.classFolder.name}`
                    : photoState.folder
                      ? `${photoState.folder.name} / ${classFolderName(currentClass)}`
                      : undefined
                }
                onOpenFolder={handleOpenPickedFolder}
                onForgetPicked={handleForgetClassFolder}
                onPickClassFolder={handlePickClassFolder}
              />
              ))}
          </>
        )}

        {tab === 'search' && (
          <RosterSearchTab
            classes={currentClasses}
            pick={pick}
            photos={photoState.photos}
            photoFolderReady={photoState.status === 'ready'}
            onOpenStudent={handleOpenStudentFromSearch}
          />
        )}

        {tab === 'memorize' && (
          <>
            {/* 사진 없이는 얼굴을 보고 이름을 맞힐 수가 없다. 판이 왜 비었는지
                말해 주지 않으면 사진을 안 올린 줄 알고 드라이브를 뒤지러 간다. */}
            {!showPhotos && (
              <div className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 border border-slate-200 bg-slate-50 flex-wrap">
                <span className="text-2xs font-bold text-slate-600">
                  사진 보기가 꺼져 있습니다. 얼굴이 있어야 이름을 맞힐 수 있습니다.
                </span>
                <button
                  type="button"
                  onClick={togglePhotos}
                  className="px-2.5 py-1 bg-primary hover:bg-primary/90 rounded text-2xs font-bold text-white transition-colors cursor-pointer"
                >
                  사진 켜기
                </button>
              </div>
            )}
              {/* 판이 비었는데 까닭을 안 알려 주면 '사진을 안 올렸나' 하고
                  드라이브를 뒤지러 간다. 관리 탭과 같은 띠를 여기에도 낸다. */}
            {showPhotos && quizCandidates.length === 0 && photoState.status === 'needs-auth' && needsAuthBand}
            {showPhotos && quizCandidates.length === 0 && photoState.status === 'ready' && (
                <PhotoStatusBar
                  diagnosis={diagnosis}
                  onPickClassFolder={handlePickClassFolder}
                    onOpenFolder={handleOpenPickedFolder}
                  onForgetPicked={handleForgetClassFolder}
                />
              )}
              <RosterMemorizeTab
                cls={currentClass}
                candidates={quizCandidates}
                withoutPhoto={
                  students.filter((s) => s.isActive !== false && !photoState.photos.has(s.num))
                    .length
                }
              />
          </>
        )}
      </div>
    </ModalShell>
  );
}
