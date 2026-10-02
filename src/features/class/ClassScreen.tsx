// src/features/class/ClassScreen.tsx
//
// '학급' 화면 (ROADMAP 16, 2026-10-02 - 결정은 Claude 추천으로 하라고 사용자가 맡겼다).
//
//   학급 운영 도구(출석부·알림장·자리표·발표자 뽑기·학생 누가기록·평가 모아 보기·명렬표)가 ⋮ 메뉴 안에 흩어져 있었다.
//   여기서 학급을 한 번 고르면 그 학급으로 도구를 연다(lib/classMemory - 도구마다의 학급 기억에 같이 적는다).
//   학생 이름을 누르면 그 학생의 누가기록. 오늘 출결은 한 줄로 미리 보인다.
//
//   도구 창은 Layout이 연다(lib/appActions). 새 학급 도구를 만들면 여기 TOOLS에도 한 줄 더한다.
//   교과 모드(ROADMAP-SUBJECT S7): 올해 반을 학년별 줄의 반 색 칩으로 고르고, '교과 출결' 도구(누계)가 붙는다.
//   교과 + 담임은 담임반이 아닌 반에서 출석부·알림장·오늘 출결 대신 교과 출결.
//   학생 명단은 '이름 / 사진'으로 본다(2026-10-02 사용자 요청 - 명렬표 관리의 사진 보기와 같게). 사진은 켤 때만 드라이브를 부른다
//   (useStudentPhotos). 사진을 누르면 크게(ImageViewerModal, 아래 '사진 바꾸기'), 이름을 누르면 누가기록.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRoster, type ClassRoster } from '../../hooks/useRoster';
import { classKeyOf, KIND_LABEL, type AttendanceRecord } from '../../lib/attendance';
import { loadAttendanceDay } from '../../lib/attendanceStore';
import { describeClass } from '../../lib/classPicker';
import { getAcademicYear, formatDateStr } from '../../lib/dateUtils';
import { readHubClass, rememberHubClass } from '../../lib/classMemory';
import { runAppAction } from '../../lib/appActions';
import type { ShortcutId } from '../../lib/shortcuts';
import { useTeachingMode } from '../../hooks/useTeachingMode';
import { useClassColorOf } from '../../hooks/useClassColor';
import { classesForYear, classLabelOf, normalizeSlotText } from '../../lib/teachingSlot';
import { useStudentPhotos } from '../../hooks/useStudentPhotos';
import StudentPhoto from '../../components/roster/StudentPhoto';
import ImageViewerModal from '../../components/ImageViewerModal';
import type { Student } from '../../hooks/useRoster';
import { showErrorToast, showToast } from '../../utils/toast';
import { pickStudentPhotoFromDrive } from '../../components/roster/drivePhotoPick';

/** 학급 화면의 사진 보기 켬/끔 - 이 기기에만 (명렬표 관리의 'sp4-roster-photos'와 따로) */
const PHOTOS_KEY = 'sp4-class-photos';
function readShowPhotos(): boolean {
  try {
    return localStorage.getItem(PHOTOS_KEY) === '1';
  } catch {
    return false;
  }
}

// homeroom: 담임 도구 - 교과 전담(담임반 없음)은 숨긴다 (docs/ROADMAP-SUBJECT.md S3)
// classUnit: 교과 모드 도구 - 초등 담임은 숨긴다 (S7)
const TOOLS: { id: ShortcutId; icon: string; label: string; desc: string; homeroom?: true; classUnit?: true }[] = [
  { id: 'attendance', icon: '📋', label: '출석부', desc: '오늘 출결 체크 · 누계', homeroom: true },
  { id: 'notices', icon: '📢', label: '알림장', desc: '모아 보기 · 쓰기', homeroom: true },
  { id: 'subjectAttendance', icon: '🙋', label: '교과 출결', desc: '반별 결과 · 지각 · 조퇴 누계', classUnit: true },
  { id: 'seating', icon: '🪑', label: '자리표', desc: '자리 · 학생 칸 · 모둠' },
  { id: 'drawStudent', icon: '🎯', label: '발표자 뽑기', desc: '겹치지 않게 차례로' },
  { id: 'studentRecord', icon: '🧑‍🎓', label: '학생 누가기록', desc: '학생마다 기록 · 출결 · 평가' },
  { id: 'evalOverview', icon: '📊', label: '평가 모아 보기', desc: '조사표를 학생 × 평가 표로' },
  { id: 'roster', icon: '🧑‍🤝‍🧑', label: '명렬표 관리', desc: '학생 · 학급 정보' },
];

export default function ClassScreen() {
  const { rosterList, loading } = useRoster();
  const { showHomeroomTools: modeHomeroomTools, isClassUnit, preset, mode } = useTeachingMode();
  const [classKey, setClassKey] = useState<string | null>(null);
  const colorOf = useClassColorOf();

  // 처음 학급: 학급 화면에서 마지막에 고른 것 → 출석부·자리표에서 마지막에 연 것 → 올해 학년도의, 학생이 있는 첫 학급
  useEffect(() => {
    if (loading || classKey || rosterList.length === 0) return;
    const remembered = readHubClass();
    const ay = getAcademicYear();
    const withStudents = rosterList.filter((c) => (c.students || []).length > 0);
    const pick =
      rosterList.find((c) => classKeyOf(c) === remembered) ||
      withStudents.find((c) => Number(c.year) === ay) ||
      withStudents[0] ||
      rosterList[0];
    setClassKey(classKeyOf(pick));
    rememberHubClass(classKeyOf(pick));
  }, [loading, rosterList, classKey]);

  const cls: ClassRoster | null = rosterList.find((c) => classKeyOf(c) === classKey) || null;
  // 교과 + 담임: 담임반이 아닌 반에서는 담임 도구를 숨긴다 (그 반은 교과 출결로)
  const showHomeroomTools =
    modeHomeroomTools &&
    !(preset === 'subjectHomeroom' && cls && normalizeSlotText(mode.homeroomClass) !== classLabelOf(cls));
  // 교과 모드: 올해 반을 학년별로 (학년·반 차례)
  const gradeRows = useMemo(() => {
    if (!isClassUnit) return [];
    const rows: { grade: string; classes: { label: string; key: string }[] }[] = [];
    for (const c of classesForYear(rosterList, getAcademicYear())) {
      const grade = c.label.split('-')[0];
      let row = rows.find((r) => r.grade === grade);
      if (!row) rows.push((row = { grade, classes: [] }));
      row.classes.push({ label: c.label, key: classKeyOf(c.roster) });
    }
    return rows;
  }, [isClassUnit, rosterList]);
  const students = useMemo(
    () => (cls?.students || []).filter((s) => s.isActive !== false).sort((a, b) => Number(a.num) - Number(b.num)),
    [cls],
  );

  // ── 사진 (명렬표 관리의 사진 보기와 같은 훅 - 켤 때만 드라이브를 부른다) ──
  const [showPhotos, setShowPhotos] = useState<boolean>(readShowPhotos);
  const photoState = useStudentPhotos(cls, students, showPhotos);
  const [photoViewer, setPhotoViewer] = useState<{ student: Student; url: string } | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const setPhotoMode = (next: boolean) => {
    if (next === showPhotos) return;
    try {
      localStorage.setItem(PHOTOS_KEY, next ? '1' : '0');
    } catch {
      /* 시크릿 모드 등 - 이번 판에서만 */
    }
    setShowPhotos(next);
    // 권한 창은 누른 그 자리에서만 열린다 - 상태가 바뀌기를 기다리지 않고 바로 부른다 (RosterModal.togglePhotos와 같다)
    if (next) photoState.authorize().catch((e: any) => showErrorToast(e?.message || '사진을 불러오지 못했습니다.'));
  };
  const authorizePhotos = () =>
    photoState.authorize().catch((e: any) => showErrorToast(e?.message || '사진을 불러오지 못했습니다.'));
  const uploadPhoto = async (student: Student, file: File) => {
    try {
      await photoState.upload(student, file);
      showToast(`✅ ${student.name || student.num + '번'} 사진을 올렸습니다.`);
    } catch (e: any) {
      showErrorToast(e?.message || '사진을 올리지 못했습니다.');
    }
  };
  const pickDrivePhoto = (student: Student) => pickStudentPhotoFromDrive(student, (file) => uploadPhoto(student, file));
  const openRecord = (num: number) => {
    if (classKey) rememberHubClass(classKey);
    runAppAction({ id: 'studentRecord', classKey: classKey || undefined, num });
  };
  /** 학년도 최근 것부터 */
  const sortedClasses = useMemo(
    () => [...rosterList].sort((a, b) => Number(b.year) - Number(a.year) || String(a.grade).localeCompare(String(b.grade)) || Number(a.classNum) - Number(b.classNum)),
    [rosterList],
  );

  // 오늘 출결 (출석한 학생은 기록이 없다 - 기록된 학생만)
  const today = formatDateStr(new Date());
  const [todayRecords, setTodayRecords] = useState<AttendanceRecord[] | null>(null);
  useEffect(() => {
    if (!cls || !showHomeroomTools) return;
    let alive = true;
    setTodayRecords(null);
    loadAttendanceDay({ classKey: classKeyOf(cls), year: Number(cls.year), grade: String(cls.grade), classNum: String(cls.classNum) }, today)
      .then((day) => {
        if (alive) setTodayRecords(Object.values(day.records || {}).sort((a, b) => a.num - b.num));
      })
      .catch(() => {
        if (alive) setTodayRecords([]);
      });
    return () => {
      alive = false;
    };
  }, [cls, today, showHomeroomTools]);

  const choose = (key: string) => {
    setClassKey(key);
    rememberHubClass(key);
  };
  const open = (id: ShortcutId) => {
    if (classKey) rememberHubClass(classKey);
    runAppAction({ id, classKey: classKey || undefined });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-primary" />
        <p className="text-xs text-slate-400 font-medium">명렬표를 불러오는 중...</p>
      </div>
    );
  }

  if (rosterList.length === 0) {
    return (
      <div className="max-w-xl mx-auto text-center py-16 flex flex-col items-center gap-3" data-class-screen>
        <p className="text-4xl">🏫</p>
        <p className="font-bold text-slate-700">아직 학급(명렬표)이 없습니다.</p>
        <p className="text-sm text-slate-500">명렬표를 만들면 이 화면에서 출석부·자리표·누가기록·평가를 학급별로 엽니다.</p>
        <button type="button" onClick={() => open('roster')} className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-sm">
          🧑‍🤝‍🧑 명렬표 만들기
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in pb-12 flex flex-col gap-4" data-class-screen>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-black text-slate-800">🏫 학급</h2>
        <select
          aria-label="학급 고르기"
          value={classKey || ''}
          onChange={(e) => choose(e.target.value)}
          className="px-3 py-1.5 border border-slate-200 rounded-xl font-bold text-sm bg-white"
        >
          {sortedClasses.map((c) => (
            <option key={classKeyOf(c)} value={classKeyOf(c)}>
              {describeClass(c)} ({(c.students || []).filter((s) => s.isActive !== false).length}명)
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-400">고른 학급으로 아래 도구가 열립니다.</span>
      </div>

      {/* 교과 모드: 올해 반을 학년별 줄의 반 색 칩으로 */}
      {gradeRows.length > 0 && (
        <div className="flex flex-col gap-1.5" data-class-grade-rows>
          {gradeRows.map((row) => (
            <div key={row.grade} className="flex flex-wrap items-center gap-1.5" data-class-grade={row.grade}>
              <span className="w-12 shrink-0 text-xs font-black text-slate-500">{row.grade}학년</span>
              {row.classes.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  data-class-chip={c.label}
                  aria-pressed={c.key === classKey}
                  onClick={() => choose(c.key)}
                  className={`px-3 py-1 rounded-lg text-sm font-black border border-transparent ${colorOf(c.label).chip} ${
                    c.key === classKey ? 'ring-2 ring-offset-1 ring-slate-500' : 'opacity-70 hover:opacity-100'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 오늘 출결 한 줄 (교과 전담은 출석부를 숨긴다) */}
      {showHomeroomTools && (
      <button
        type="button"
        data-class-today
        onClick={() => open('attendance')}
        className="text-left bg-white border border-slate-200 rounded-2xl px-4 py-3 hover:bg-slate-50 flex flex-wrap items-center gap-x-3 gap-y-1"
      >
        <span className="font-black text-sm text-slate-700">📋 오늘 출결</span>
        {todayRecords === null ? (
          <span className="text-xs text-slate-400">불러오는 중...</span>
        ) : todayRecords.length === 0 ? (
          <span className="text-sm text-emerald-700 font-bold">적힌 결석·지각·조퇴·결과가 없습니다</span>
        ) : (
          todayRecords.map((r) => (
            <span key={r.num} className="text-sm text-slate-700">
              <span className="font-bold">
                {r.num} {r.name}
              </span>{' '}
              <span className="text-rose-600 font-bold">{KIND_LABEL[r.kind]}</span>
            </span>
          ))
        )}
        <span className="ml-auto text-xs font-bold text-primary">출석부 열기 →</span>
      </button>
      )}

      {/* 도구 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
        {TOOLS.filter((t) => (showHomeroomTools || !t.homeroom) && (isClassUnit || !t.classUnit)).map((t) => (
          <button
            key={t.id}
            type="button"
            data-class-tool={t.id}
            onClick={() => open(t.id)}
            className="text-left bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 hover:border-primary/50 hover:shadow-sm transition-all flex flex-col gap-1"
          >
            <span className="text-2xl leading-none">{t.icon}</span>
            <span className="font-black text-sm text-slate-800">{t.label}</span>
            <span className="text-xs text-slate-500">{t.desc}</span>
          </button>
        ))}
      </div>

      {/* 학생 명단 - 이름 / 사진. 이름을 누르면 그 학생의 누가기록 */}
      <section className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4" data-class-students>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h3 className="font-black text-sm text-slate-700">
            🧑‍🎓 학생 {students.length}명{' '}
            <span className="text-xs font-semibold text-slate-400">
              - {showPhotos ? '사진을 누르면 크게, 이름을 누르면 누가기록' : '누르면 그 학생의 누가기록'}
            </span>
          </h3>
          {showPhotos && photoState.status === 'ready' && students.length > 0 && (
            <span className="text-xs font-semibold text-slate-400" data-class-photo-count>
              사진 {students.length - photoState.missing.length}/{students.length}명
            </span>
          )}
          <div className="ml-auto flex gap-1 bg-slate-100 rounded-lg p-1" role="group" aria-label="명단 보기">
            {([false, true] as const).map((on) => (
              <button
                key={String(on)}
                type="button"
                data-class-view={on ? 'photo' : 'name'}
                aria-pressed={showPhotos === on}
                onClick={() => setPhotoMode(on)}
                title={on ? '구글 드라이브의 학생 사진으로 봅니다 (명렬표 관리의 사진과 같습니다)' : '번호와 이름으로 봅니다'}
                className={`rounded-md px-2.5 py-1 text-xs font-bold transition-colors cursor-pointer ${
                  showPhotos === on ? 'bg-white text-slate-800 shadow-2xs' : 'text-slate-500'
                }`}
              >
                {on ? '📷 사진' : '이름'}
              </button>
            ))}
          </div>
        </div>

        {/* 사진을 불러오지 못한 까닭 (명단은 그대로 보인다) */}
        {showPhotos && students.length > 0 && (
          photoState.status === 'needs-auth' ? (
            <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 flex-wrap">
              <span>구글 연결이 끊겨 사진을 불러오지 못했습니다.</span>
              <button
                type="button"
                data-class-photo-auth
                onClick={authorizePhotos}
                className="px-2.5 py-1 bg-primary hover:bg-primary/90 rounded text-xs font-bold text-white cursor-pointer shrink-0"
              >
                구글 연결하고 사진 불러오기
              </button>
            </div>
          ) : photoState.status === 'error' ? (
            <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 flex-wrap">
              <span>{photoState.error || '사진 폴더를 읽지 못했습니다.'}</span>
              <button
                type="button"
                onClick={() => open('roster')}
                className="px-2.5 py-1 bg-white border border-red-300 rounded text-xs font-bold text-red-700 hover:bg-red-100 cursor-pointer shrink-0"
              >
                명렬표 관리에서 사진 폴더 보기
              </button>
            </div>
          ) : photoState.status === 'checking' || photoState.status === 'loading' || photoState.resolving ? (
            <p className="mb-2 text-xs text-slate-400 font-semibold">
              사진을 불러오는 중... ({students.length - photoState.missing.length}/{students.length})
            </p>
          ) : null
        )}

        {students.length === 0 ? (
          <p className="text-sm text-slate-400">이 학급에 학생이 없습니다. 명렬표 관리에서 더합니다.</p>
        ) : showPhotos ? (
          /* 명렬표 관리의 타일 보기와 같은 카드. 휴대폰 세 칸(한 칸이 너무 좁으면 얼굴·이름을 못 읽는다) */
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-2" data-class-photo-grid>
            {students.map((s) => {
              const photo = photoState.photos.get(Number(s.num));
              return (
                <div key={s.num} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs" data-class-photo-card={s.num}>
                  <StudentPhoto
                    url={photo?.url}
                    name={s.name}
                    shape="card"
                    canUpload
                    uploading={photoState.uploading === Number(s.num)}
                    onUpload={(file) => uploadPhoto(s, file)}
                    loose={photo?.exact === false}
                    onOpen={photo?.url ? () => setPhotoViewer({ student: s, url: photo.url }) : undefined}
                    onPickDrive={() => pickDrivePhoto(s)}
                  />
                  <button
                    type="button"
                    data-class-student={s.num}
                    onClick={() => openRecord(Number(s.num))}
                    title="이 학생의 누가기록"
                    className="w-full flex items-center gap-1 px-1.5 py-1.5 sm:gap-1.5 sm:px-2 hover:bg-primary/5 text-left min-w-0"
                  >
                    <span className="bg-blue-50 text-primary rounded text-2xs font-extrabold px-1 sm:px-1.5 py-0.5 shrink-0">{s.num}</span>
                    <span className="text-xs font-extrabold text-slate-800 truncate">{s.name}</span>
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-1.5">
            {students.map((s) => (
              <button
                key={s.num}
                type="button"
                data-class-student={s.num}
                onClick={() => openRecord(Number(s.num))}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-slate-200 hover:bg-primary/5 hover:border-primary/40 text-sm text-left min-w-0"
              >
                <span className="text-xs font-bold text-slate-400 tabular-nums shrink-0">{s.num}</span>
                <span className="font-bold text-slate-800 truncate">{s.name}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 학생 사진을 크게 띄운 창 - 명렬표 관리와 같다. 바꾸는 단추는 아래에 */}
      {photoViewer && (
        <>
          <ImageViewerModal
            isOpen
            onClose={() => setPhotoViewer(null)}
            images={[{ url: photoViewer.url, name: `${photoViewer.student.num}번 ${photoViewer.student.name}` }]}
            footer={
              <>
              <button
                type="button"
                onClick={() => replaceInputRef.current?.click()}
                disabled={photoState.uploading === Number(photoViewer.student.num)}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-white/15 text-white hover:bg-white/25 transition-colors cursor-pointer disabled:opacity-50"
              >
                {photoState.uploading === Number(photoViewer.student.num) ? '올리는 중...' : '📷 사진 바꾸기'}
              </button>
              <button
                type="button"
                data-photo-drive-replace
                onClick={async () => {
                  if (await pickDrivePhoto(photoViewer.student)) setPhotoViewer(null);
                }}
                disabled={photoState.uploading === Number(photoViewer.student.num)}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-white/15 text-white hover:bg-white/25 transition-colors cursor-pointer disabled:opacity-50"
              >
                ☁️ 드라이브에서 고르기
              </button>
              </>
            }
          />
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            ref={replaceInputRef}
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              await uploadPhoto(photoViewer.student, file);
              setPhotoViewer(null);
            }}
          />
        </>
      )}
    </div>
  );
}
