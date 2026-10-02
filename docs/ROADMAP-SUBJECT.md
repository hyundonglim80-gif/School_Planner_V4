# 18. 교과 전담 모드 — 세션별 작업 계획

2026-10-02 사용자와 정함. ROADMAP.md 18번 항목의 자세한 계획이다. **한 세션(새 대화 하나) = 아래 S 하나**.
낮은 노력 수준(effort)으로 돌려도 같은 결과가 나오게, 읽을 곳·고칠 파일·데이터 모양·함정·확인 항목을 모두 적었다.

## 세션을 시작하면 (매번 이것만)

1. `git pull` → ROADMAP.md '지금 하는 일'에서 이번 세션 번호(S1…)를 본다.
2. **이 파일의 '공통 규칙'과 그 세션 절만 읽는다** (`grep -n "^### S" docs/ROADMAP-SUBJECT.md`로 위치를 찾는다). 다른 세션 절은 읽지 않는다.
3. 그 절의 **먼저 읽을 것**만 읽는다. 큰 파일은 grep으로 위치를 찾아 필요한 부분만.
4. 작업 → 단위 테스트(`npx vitest run`) → `npx tsc -p tsconfig.app.json --noEmit` → `npm run lint`(오류 0) → 빌드 → 그 절의 크롬 점검 →
   설명서·ARCHITECTURE → **이 파일의 체크와 ROADMAP.md '지금 하는 일'을 다음 세션으로** → 커밋·푸시(main = 배포).
5. 끝나면 사용자에게 "S○ 끝. 새 대화에서 '이어서'"라고 알린다. **다음 세션을 같은 대화에서 시작하지 않는다**(토큰).
6. 계획과 코드가 다르거나(함수 이름이 없다, 구조가 다르다) 계획대로 하면 담임 모드가 바뀌면, **멈추고** 아래 '막힌 것'에 적고 사용자에게 묻는다.
   짐작으로 계획을 바꾸지 않는다.

## 결정 (사용자, 2026-10-02)

- 화면에 보이는 교사 유형은 **셋**: 초등 담임 / 교과 전담 / 교과 + 담임(중등 담임).
- 저장은 **두 값**: 수업 단위 `unit`('subject' = 과목 / 'class' = 반+과목) + 담임반 유무 `hasHomeroom`. (담임반이 어느 반인지 `homeroomClass`는 덧붙임)
- 반 표기는 **`5-2`(학년-반)**. 시간표 칸은 `5-2 과학`.
- **교과 출결을 1차에 넣는다**.
- 진행: 단계마다 새 대화. 노력 수준은 아래 표대로.

## 공통 규칙 (모든 세션)

- **지금 사용자(초등 담임)는 아무것도 바뀌면 안 된다.** 설정 문서가 없으면 초등 담임(`unit:'subject', hasHomeroom:true`)이다.
  모드 분기는 늘 `unit === 'class'`일 때만 새 동작을 켠다. 세션마다 담임 회귀 점검(그 절에 적은 기존 크롬 스크립트)을 돌린다.
- **V3와 같이 쓰는 문서에 칸을 더하지 않는다**: 수업 `schedules/{date}.periods.*`, 명렬표 `settings/rosters`(classList 항목 -
  `useRoster`가 모르는 칸을 버린다), 시간표 `settings/timetable_v5`, 출석부 `attendance`. 새 자료는 모두 V4 전용 문서(`users/{uid}/…`, `v4_` 이름).
- 반·과목은 **시간표 칸 글자**(`5-2 과학`)에 담는다 - V3에도 그 글자로 보인다. V4는 `lib/teachingSlot`로 읽어 낸다.
- 쓰기는 바뀐 칸만(`setDoc merge`/`mergeFields`+`deleteField`, 배열은 `arrayUnion/Remove`). 통째로 덮어쓰지 않는다(CLAUDE.md 4장).
  지우기는 휴지통 먼저, 안내는 `showDeletedToast`.
- 모드는 `useTeachingMode()` 하나로만 읽는다(S1에서 만든다). 컴포넌트가 문서를 따로 구독하지 않는다.
- 새 팝업은 `ModalShell`/`PopupFrame`, 오른쪽 칸은 `SidePanelFrame`(`modalConventions.test.ts`). 색은 Tailwind 클래스나 `var(--color-…)`(다크 모드).
- 화면에 새 단추·title을 만들면 기존 점검 스크립트와 이름이 겹치지 않게 `data-…`를 단다(CLAUDE.md 2장).
- 점검 계정: **`teacher3@example.com`(교과 전담, `?as=3`)** - S1에서 만든다. 점검이 바꾼 자료는 끝에 되돌린다.
  점검 날짜는 **2026-11-02(월) ~ 2026-11-27(금)** 4주(seed가 이 기간에 teacher3 수업을 심는다).
- 학년도: 3월~이듬해 2월. 반 목록은 그 학년도 명렬표(`lib/schoolSetting.schoolYearOf(날짜)`).
- 이 파일의 체크는 그 세션 커밋에 함께 넣는다. CLAUDE.md '지금 상태'에는 세션마다 **두 줄 이하**만 더한다(파일이 커지면 매 대화가 비싸진다).

## 세션 표

| 세션 | 내용 | 크기 | 권장 노력 | 상태 |
|---|---|---|---|---|
| S1 | 교사 유형 설정 + 점검 계정 teacher3 | 중간 | 중간 | 끝 |
| S2 | 반 표기 읽기(`lib/teachingSlot`) + 시간표·수업 칸 입력 | 중간 | 중간 | 할 일 |
| S3 | 반 중심 수업 칸(하루·주간) + 담임 도구 숨기기 | 중간 | 중간 | 할 일 |
| S4 | 과정: 차시 목록 하나를 여러 반에 (진도 확장) | 큼 | **높음** | 할 일 |
| S5 | 지난 시간 메모 + 반별 진도 현황판 | 중간 | 중간 | 할 일 |
| S6 | 교과 출결: 저장과 입력 칸 | 큼 | **높음** | 할 일 |
| S7 | 교과 출결 누계 + 학급 탭 정리 | 중간 | 중간 | 할 일 |
| S8 | 수업 칸 → 반 도구 + 조사표 반 자동 + 여러 반에 같은 조사표 | 큼 | **높음** | 할 일 |
| S9 | 과정별 평가 모아 보기 | 중간 | 중간 | 할 일 |
| S10 | 마무리: 명령 창·설명서 점검·전체 회귀 | 중간 | 중간 | 할 일 |

'높음'인 세션은 저장 경로나 진도 셈을 바꾼다 - 틀리면 자료가 사라지거나 반 진도가 엉킨다.

## 막힌 것 · 결정 메모

(세션이 계획과 다른 것을 만나면 여기에 적고 사용자에게 묻는다.)

---

### S1. 교사 유형 설정 + 점검 계정

**목표**: 환경설정에서 셋 중 하나를 고르고, 계정에 두 값으로 저장한다. 아직 화면은 바뀌지 않는다(S3부터).

**먼저 읽을 것**: `src/lib/schoolSetting.ts`(계정에 하나인 V4 설정 문서의 본보기 - 구독·저장 모양을 그대로 따른다),
`src/components/SettingsModal.tsx`에서 `SchoolSettingPanel`을 넣은 자리, `src/lib/emulator.ts`(`?as=2`), `tools/seed.mjs`의 두 번째 계정 부분.

**만들 것**
- `src/lib/teachingMode.ts`
  ```ts
  export type LessonUnit = 'subject' | 'class';
  export type TeacherPreset = 'homeroom' | 'subject' | 'subjectHomeroom'; // 초등 담임 / 교과 전담 / 교과+담임
  export interface TeachingMode {
    unit: LessonUnit;            // 저장 값 1
    hasHomeroom: boolean;        // 저장 값 2
    homeroomClass: string;       // '5-2' 또는 '' (담임반이 있을 때만 뜻이 있다)
    subjects: string[];          // 가르치는 과목 ['과학'] - 시간표 칸 제안에 쓴다 (S2)
    classColors: Record<string, string>; // '5-2' → 색 이름 (S3). 없으면 차례대로
    updatedAt?: number;
  }
  export const DEFAULT_TEACHING_MODE: TeachingMode = { unit: 'subject', hasHomeroom: true, homeroomClass: '', subjects: [], classColors: {} };
  export const teachingModeRef = (uid: string) => doc(db, 'users', uid, 'settings', 'v4_teaching');
  export function sanitizeTeachingMode(raw: unknown): TeachingMode;   // 모르는 값·빈 문서 → 기본값으로 채운다
  export function presetOf(m: TeachingMode): TeacherPreset;           // unit 'subject' → 'homeroom' (hasHomeroom이 false여도)
  export function presetPatch(p: TeacherPreset): Pick<TeachingMode, 'unit' | 'hasHomeroom'>;
  export function subscribeTeachingMode(uid: string, cb: (m: TeachingMode, exists: boolean) => void): () => void;
  export async function saveTeachingMode(uid: string, patch: Partial<TeachingMode>): Promise<void>; // setDoc merge + updatedAt
  ```
  - 구독은 `subscribeDocWithServerFallback`(lib/firestoreSubscribe) - 다른 설정과 같게.
  - `exists`: 문서가 있었나. 처음 안내(아래)에 쓴다.
- store(`useAppStore`)에 `teachingMode: TeachingMode`, `teachingModeLoaded: boolean`, `teachingModeExists: boolean` (persist에 넣지 않는다).
  `App.tsx`에서 로그인 뒤 한 번 구독해 넣는다(`usePreferenceSync` 옆).
- `src/hooks/useTeachingMode.ts`: store를 읽어 `{ mode, loaded, preset, isClassUnit: mode.unit === 'class', showHomeroomTools: preset !== 'subject' }`.
- 환경설정 '교사 유형' 구역(학교 설정 근처): 카드 세 개(라디오, `data-teacher-preset="homeroom|subject|subjectHomeroom"`)
  - 초등 담임: "한 반의 여러 과목 - 지금까지의 V4"
  - 교과 전담: "여러 반에 한두 과목 - 알림장·출석부를 숨깁니다"
  - 교과 + 담임: "여러 반에 과목 + 내 담임반 (중등 담임)"
  - 교과 전담·교과+담임이면 **가르치는 과목** 칩 입력(쉼표·Enter로 더하기, ✕로 빼기) → `subjects`.
  - 교과+담임·초등 담임이면 **담임반** 고르기(그 학년도 명렬표의 `학년-반` 목록, 없으면 '명렬표에서 학급을 먼저 만드세요') → `homeroomClass`.
  - 고르는 즉시 저장, '저장했습니다' 안내.
- 처음 안내: `teachingModeLoaded && !teachingModeExists`이면 하루 화면 맨 위에 띠 하나(`data-teacher-mode-banner`):
  "교사 유형을 골라 주세요" + 단추 셋 + '나중에'. 단추를 누르면 `saveTeachingMode(presetPatch(..))`.
  '나중에'는 초등 담임을 저장한다(그래야 다른 기기에도 다시 안 뜬다). 휴대폰에서도 한 줄로 접힌다.
- 점검 계정 `teacher3@example.com`(비밀번호 같음):
  - `src/lib/emulator.ts`: `?as=3` → teacher3.
  - `tools/seed.mjs`: teacher3를 만들고 심는다 - `settings/v4_teaching = { unit:'class', hasHomeroom:false, homeroomClass:'', subjects:['과학'], classColors:{} }`,
    `settings/rosters`에 2026학년도 5-1·5-2·5-3·5-4(반마다 학생 5명, 이름 '가1'~'라5'처럼 반마다 다르게),
    `schedules`: 2026-11-02 ~ 11-27 평일, 요일마다 고정 시간표(예: 월 1교시 '5-1 과학' 3교시 '5-2 과학', 화 2교시 '5-3 과학' 4교시 '5-4 과학',
    수 1교시 '5-2 과학' 2교시 '5-1 과학', 목 3교시 '5-4 과학' 5교시 '5-3 과학', 금 1교시 '5-1 과학' 2교시 '5-2 과학' 3교시 '5-3 과학' 4교시 '5-4 과학'),
    수업 칸 모양은 기존 seed와 같게(`{subject, memo:'', supplies:''}`).

**단위 테스트**: `src/lib/teachingMode.test.ts` - 빈 값·이상한 값 → 기본값, `presetOf`·`presetPatch` 셋 왕복, `unit:'subject', hasHomeroom:false` → 'homeroom'.
SettingsModal 테스트가 있으면(`SettingsModal.test.tsx`) 셋이 그려지는지 하나 더한다.

**크롬 점검** `tools/inspect-teaching-mode.mjs` (8항목 안팎):
- teacher3: 환경설정에 '교과 전담'이 골라져 있다, 과목 칩 '과학'.
- teacher3: '교과 + 담임'을 고르면 서버 문서 `unit:'class', hasHomeroom:true` → 담임반 '5-2' 고르기 → `homeroomClass:'5-2'` → **끝에 처음 값으로 되돌린다**.
- seed는 teacher·teacher2에도 초등 담임 문서(`{ unit:'subject', hasHomeroom:true }`)를 심는다 - 다른 점검 스크립트가 처음 안내 띠 없이 돌게.
  (실제 사용자는 문서가 없으니 처음 한 번 띠를 본다 - 그것이 의도다.)
- teacher2: `v4_teaching` 문서를 지운 뒤 열면 처음 안내 띠가 뜬다 → '나중에' → 문서가 초등 담임으로 생기고 띠가 사라진다 → 끝에 seed 값으로 다시 쓴다.
- teacher(기본): 띠가 없고 화면이 지금과 같다.
- 회귀: `node tools/inspect-more-menu.mjs`, `node tools/inspect-class-screen.mjs`.

**설명서**: '설정 · 단축키' 장의 '환경설정'에 '교사 유형' 줄, 그리고 새 주제 `id:'teaching-mode'`('교사 유형 (담임 · 교과 전담)', '수업 · 시간표' 장 맨 앞) -
셋의 차이 표, 저장은 계정에 하나(PC·휴대폰 같다), 바꿔도 자료는 그대로. **ARCHITECTURE 3장** 표에 `v4_teaching` 줄.

- [x] S1 끝 (2026-10-02, 클라우드 세션). `inspect-teaching-mode` 16/16, 회귀 `inspect-more-menu` 33/33 · `inspect-class-screen` 12/12.
  메모: 처음 안내 띠는 '없음'을 서버에 한 번 물어 확인한 뒤에만 뜬다(캐시가 비어 번쩍이지 않게). 서버가 답하지 않으면 띠를 띄우지 않는다.
  `TEACHER_PRESETS`(카드 글)는 `lib/teachingMode`, 저장+안내 `saveTeachingPatch`는 `hooks/useTeachingMode`.
  `inspect-class-screen`은 teacher 계정에 명렬표가 있어야 돈다(seed는 teacher에 명렬표를 심지 않는다 - 새 에뮬레이터면 먼저 학급을 만든다).

---

### S2. 반 표기 읽기 + 시간표·수업 칸 입력

**목표**: 교과 모드에서 시간표·수업 칸에 반을 쉽게 적고, 어떻게 적어도 `5-2 과학` 한 모양으로 저장된다. 초등 담임 모드는 손대지 않는다.

**먼저 읽을 것**: `src/components/TimetableTemplateModal.tsx`의 `handleUpdateSubject`·`handleCellPaste`·과목 `<input>`(placeholder '과목'),
`src/features/day/DaySchedule.tsx`의 수업 고치기(`editSubject`, 저장하는 함수), `src/lib/progress.ts`의 `progressKey`·`scheduleSubjects`.

**만들 것**
- `src/lib/teachingSlot.ts` (순수 함수만, Firestore 없음)
  ```ts
  export interface SlotParts { cls: string; grade: string; classNum: string; subject: string } // cls '5-2', 없으면 ''
  export function parseSlot(text: string): SlotParts;
  export function formatSlot(cls: string, subject: string): string;      // '5-2 과학', 과목이 없으면 '5-2'
  export function normalizeSlotText(text: string): string;               // 반을 찾으면 formatSlot, 못 찾으면 trim만
  export function classLabelOf(r: { grade: string | number; classNum: string | number }): string; // '5-2'
  export function classesForYear(rosters: ClassRoster[], schoolYear: number): { label: string; roster: ClassRoster }[]; // 학년·반 숫자 차례
  export function slotSuggestions(classLabels: string[], subjects: string[]): string[]; // 반×과목, 과목이 없으면 반만
  export function rosterForSlot(rosters: ClassRoster[], text: string, schoolYear: number): ClassRoster | null;
  ```
  - 읽는 모양: `5-2 과학`, `5-2과학`, `5 - 2 과학`, `5–2 과학`(긴 줄표), `５-２`(전각 숫자), `5학년 2반 과학`, `5학년2반`, `05-02 과학` → cls '5-2'.
    학년·반은 1~2자리 숫자. `5-` · `-2` · `과학` · `창체` → cls ''. 과목은 반 뒤 나머지(앞뒤 공백 정리, 가운데 공백 하나로).
  - `1-2차시`처럼 숫자 바로 뒤에 글자가 붙으면? → 반으로 읽는다(시간표 칸에는 차시를 쓰지 않는다). 테스트에 적어 둔다.
- 시간표 창(교과 모드만): 과목 칸 `<input list="sp4-slot-options">` + `<datalist id="sp4-slot-options">`(slotSuggestions), placeholder '5-2 과학',
  칸을 떠날 때(onBlur)와 붙여 넣을 때 칸마다 `normalizeSlotText`. 칸 폭이 좁으면 표에 `min-w`만 늘린다.
- 하루 화면 수업 고치기(교과 모드만): 과목 입력에 같은 datalist, 저장 직전 `normalizeSlotText`. **저장 함수의 다른 칸은 건드리지 않는다.**
- 수업을 고치는 다른 길이 있으면(주간 `PeriodModal` 등) grep으로 찾아 같은 처리를 한다(`grep -rn "subject" src/components/PeriodModal.tsx`).

**함정**: 초등 담임 모드에서 `3-2 국어`를 쓰는 사용자가 있다(진도가 반마다 따로 세는 방법으로 설명서에 적혀 있다). **초등 담임 모드에서는 정규화하지 않는다.**
진도 셈(`progressKey`)도 이 세션에서는 바꾸지 않는다(S4).

**단위 테스트**: `src/lib/teachingSlot.test.ts` - 위 모양 모두, 과목 여러 단어, 빈 칸, `classesForYear` 차례(5-10이 5-9 뒤), 다른 학년도 제외, `rosterForSlot`.

**크롬 점검** `tools/inspect-subject-timetable.mjs` (teacher3, 8항목 안팎): 시간표 창 칸에 '5학년 2반 과학' → 칸을 떠나면 '5-2 과학';
datalist에 '5-1 과학'~'5-4 과학'; 엑셀식 붙여 넣기 `5 - 3 과학\t5학년4반 과학` → 정규화; **저장하지 않고 닫기**(템플릿을 바꾸지 않는다) 또는 바꿨으면 되돌린다;
하루(2026-11-03) 수업 칸에서 과목 '5-1과학' 저장 → 서버 `5-1 과학` → 처음 값으로 되돌린다. 회귀: teacher로 시간표 칸에 '3 - 2 국어' 저장하면 그대로(정규화 X) → 되돌리기.

**설명서**: '시간표 적용(주간 템플릿)'에 "교과 모드: 칸에 `5-2 과학`" 단락, '수업 칸'에 같은 한 줄.

- [ ] S2 끝

---

### S3. 반 중심 수업 칸 + 담임 도구 숨기기

**목표**: 교과 모드의 하루·주간 수업 칸이 반을 크게 보여 주고 반 색을 쓴다. 담임반이 없으면 알림장·출석부·주간학습안내가 메뉴와 하루 화면에서 숨는다.

**먼저 읽을 것**: `DaySchedule.tsx`의 카드 그리기(`data-subject`, `PERIOD_ACCENTS`, `openNotice`/`openAttendance` 단추), `src/features/week/WeekGrid.tsx`의 수업 줄,
`Layout.tsx`의 `moreMenuSections`('수업'·'학급 운영' 구역), `src/features/class/ClassScreen.tsx`의 `TOOLS`.

**만들 것**
- `lib/teachingSlot.ts`에 `classColor(label, mode.classColors, allLabels)`: 정한 색이 없으면 반 차례로 8색 돌려쓰기
  (`sky, emerald, amber, rose, violet, teal, orange, indigo`). 돌려주는 것은 **Tailwind 클래스 묶음**(막대 `border-l-…-500`, 칩 `bg-…-100 text-…-800`) -
  hex를 쓰지 않는다(다크 모드). 클래스 이름은 소스에 통째로 적어야 Tailwind가 만든다(문자열 이어 붙이기 X).
- 하루 화면 카드(교과 모드, 칸 글자에 반이 있을 때만): 큰 글자는 **반**(`data-slot-class`), 그 옆에 과목을 작게. 왼쪽 막대는 반 색.
  반이 없는 칸(`창체`, `자율`)은 지금 모양 그대로.
- 주간 수업 줄(교과 모드): `5-2` 굵게 + 과목 작게, 반 색 칩.
- 담임 도구 숨기기 (`showHomeroomTools === false`, 즉 교과 전담):
  - 하루 화면 수업 머리줄의 📢 알림장·📋 출석부 단추
  - ⋮ 메뉴 '주간학습안내'(수업 구역), '출석부'·'알림장 모아 보기'(학급 운영 구역)
  - 학급 탭 `TOOLS`의 출석부·알림장
  - 단축키·명령 창은 그대로 둔다(자료는 남아 있으니 찾아 쓸 수 있게) - 설명서에 그렇게 적는다.
- 교과+담임: 출석부를 열 때 담임반으로(`homeroomClass`의 그 학년도 classKey - `classKeyOf`, `openEntryPanel({kind:'attendance', classKey})`).
- 환경설정 '교사 유형'의 반 목록 옆에 반 색 고르기(8색 점, 누르면 `classColors` 저장). 작게 - 없어도 차례 색이 나온다.

**함정**: 숨기는 메뉴 항목 때문에 `tools/inspect-more-menu.mjs`의 항목 수가 바뀌면 안 된다 - 그 스크립트는 teacher(초등 담임)로 돈다. 확인만 한다.

**단위 테스트**: `classColor`(차례·정한 색·모르는 색), DaySchedule 테스트(`DaySchedule.test.tsx` 방식으로 store에 교과 모드를 넣고 `data-slot-class` 확인,
초등 담임은 `data-subject`가 지금처럼).

**크롬 점검** `tools/inspect-subject-view.mjs` (teacher3 2026-11-02, 10항목 안팎): 1교시 카드 큰 글자 '5-1'·작은 '과학'; 막대 색이 반마다 다르다;
알림장·출석부 단추 없음; ⋮에 출석부·알림장 모아 보기·주간학습안내 없음; 학급 탭에 출석부 없음; 주간에 '5-2' 칩;
교과+담임으로 바꾸면 출석부가 다시 보이고 담임반으로 열린다 → 되돌리기. 회귀: `inspect-more-menu.mjs`, `inspect-class-screen.mjs`, `DaySchedule` 관련 기존 점검(`grep -ln "data-subject" tools/`).

**설명서**: '교사 유형' 주제에 "교과 모드의 수업 칸"과 숨는 것 목록, '하루' 주제에 한 줄. ARCHITECTURE 8장 '교과 전담 모드' 요점 시작.

- [ ] S3 끝

---

### S4. 과정 — 차시 목록 하나를 여러 반에 (권장 노력: 높음)

**목표**: '5학년 과학' 차시 목록을 한 번 붙여 넣고 5-1~5-4를 고르면, 반마다 제 수업 칸에서 따로 센다. 한 반만 밀어도 그 반만 밀린다.

**먼저 읽을 것**: `src/lib/progress.ts` 전체(514줄 - `computeProgress`·`progressUntil`·`progressMarks`·`saveProgressPlan`·`sanitizePlan`),
`src/lib/progress.test.ts`의 구성, `src/components/ProgressModal.tsx`의 새 진도 만들기·목록, `src/hooks/useProgress.ts`, ARCHITECTURE 8장 '진도 관리'.

**데이터** (`users/{uid}/v4_progress/{id}`, V4 전용 - 칸만 더한다)
```
{ key, startDate, lessons, bumps,           // 지금 그대로
  subject?: '과학', classes?: ['5-1','5-2'] } // 있으면 '과정'
```
- `planKeys(plan): string[]` = `classes`가 있으면 `classes.map(c => formatSlot(c, subject))`, 없으면 `[plan.key]`.
  과정을 저장할 때도 `key = planKeys(plan)[0]`을 채워 둔다(옛 코드가 key를 읽어도 깨지지 않게).
- 칸 글자 견주기: 과정은 `normalizeSlotText(칸) === 열쇠`, 옛 진도는 지금처럼 `progressKey` (옛 진도의 견주기를 바꾸지 않는다).
- `bumps`는 과정 하나에 한 배열 - 한 선생님은 같은 날·같은 교시에 두 반을 가르칠 수 없으니 `날짜#교시`가 반마다 저절로 다르다.
  밀기는 지금처럼 `setProgressBump`(arrayUnion/Remove 한 칸).

**고칠 것**
- `computeProgress(plan, subjectsByDate, isOffDay, until, keyOverride?)` - 열쇠 하나로 센다(과정이면 반마다 한 번씩 부른다).
  `matching` 견주기만 위 규칙으로. 반환 모양은 그대로.
- `progressUntil(plan, plans, key)` - 같은 **열쇠**를 가진 다른 진도(과정·옛 진도 모두) 가운데 늦게 시작하는 것.
- `progressMarks`: 진도마다 `planKeys`를 돌며 반마다 센다. `ProgressMark`에 `cls?: string`을 더한다.
- `sanitizePlan`: `subject`(문자열), `classes`(문자열 배열, `5-2` 모양만, 중복 제거) 읽기.
- `saveProgressPlan`: 두 칸을 함께 merge 저장(bumps는 지금처럼 빼고).
- ProgressModal(교과 모드에서만 보이는 것): '새 진도' → **'과정 (여러 반)'** 단추(`data-new-course`): 과목 고르기(`subjects`), 반 체크(classesForYear),
  시작일, 차시 표 붙여 넣기(지금 것 그대로). 목록에서 과정은 '5학년 과학 · 5-1, 5-2, 5-3, 5-4'처럼. 고칠 때 반을 더하고 뺄 수 있다.
  학년: 고른 반이 모두 같은 학년이면 '5학년 과학', 섞이면 '과학 (5-1 외 3)'.

**함정**
- 옛 진도(`classes` 없음)의 결과가 하나라도 바뀌면 안 된다 - `progress.test.ts`의 기존 테스트를 고치지 말고 **모두 통과**해야 한다.
- 같은 반 열쇠를 옛 진도와 과정이 함께 가지면 `progressUntil` 규칙(늦게 시작한 쪽이 이어받음)을 따른다 - 테스트에 넣는다.
- `progressMarks`의 `break`(목록이 끝나면 멈춤)는 **반마다** 따로여야 한다(한 반이 끝났다고 다른 반을 멈추지 않는다).

**단위 테스트**: 과정 두 반이 다른 요일 - 각자 0,1,2…; 한 반만 밀기; 반 하나를 빼면 그 반 표시가 사라짐; 옛 진도와 같은 열쇠; 정규화
(`5-1과학` 칸도 센다); 목록이 끝난 반과 안 끝난 반.

**크롬 점검** `tools/inspect-course.mjs` (teacher3, 12항목 안팎): 과정 '5학년 과학'(5-1~5-4, 2026-11-02 시작, 차시 6개) 만들기 → 11-02 1교시(5-1) '1차시', 3교시(5-2) '1차시',
11-04 1교시(5-2) '2차시'; 5-2의 11-02를 밀면 5-2만 하나씩 밀리고 5-1은 그대로; 되돌리기; 과정 지우기 → 휴지통 → 되살리기 → 다시 지워 정리.
회귀: `node tools/inspect-progress.mjs`(39항목, teacher - 옛 진도).

**설명서**: '진도 관리' 주제에 '과정(여러 반)' 단락 - 만드는 법, 반마다 따로 센다, 한 반만 밀기. ARCHITECTURE 3장 v4_progress 줄에 `subject·classes`, 8장 진도 요점.

- [ ] S4 끝

---

### S5. 지난 시간 메모 + 반별 진도 현황판

**목표**: 교과 모드 수업 칸에 그 반의 **바로 앞 수업 메모**가 한 줄 보인다. 진도 창에서 과정의 반별 위치를 한눈에 본다.

**먼저 읽을 것**: `progress.ts`의 `subscribeProgressInputs`(수업 문서를 이미 범위로 읽는다), `useProgress.ts`의 `useProgressMarks` 범위,
DaySchedule 카드에서 `ProgressMarkLine`을 그리는 자리, ProgressModal의 진도 하나 보기.

**만들 것**
- `ProgressInputs`에 `notesByDate: Record<날짜, Record<교시, string>>` - 같은 스냅숏에서 `memo`(없으면 `content`)의 첫 줄을 모은다.
  **읽기를 더 하지 않는다**(이미 받는 문서에서 꺼낸다).
- `lib/teachingSlot.ts`(또는 `lib/classLessons.ts`): `previousSlotOf(subjectsByDate, text, date, period)` - 같은 정규화 글자의 바로 앞 교시(같은 날 앞 교시 포함).
- 하루 카드(교과 모드, 반이 있을 때): `data-prev-note` 한 줄 "지난 시간 11/2(월) 3교시: 실험 2모둠 못 끝냄" - 메모가 없으면 줄 없음. 누르면 그날로 간다(날짜 이동 함수는 기존 것을 찾아 쓴다).
- ProgressModal 과정 보기에 **반별 현황표**(`data-course-status`): 줄 = 반, 칸 = 지난 수업(날짜·차시), 다음 수업(날짜·교시·차시), 진도(n/전체),
  차이(가장 앞선 반보다 2차시 이상 늦으면 빨간 '2차시 늦음'). 줄 끝 '다음 수업 밀기'(그 반 다음 교시 bump) - 되돌리기는 지금 밀기 안내와 같게.
  셈은 순수 함수 `courseStatus(plan, timelinesByKey, today)`로.

**단위 테스트**: `previousSlotOf`(같은 날 앞 교시, 주말 건너, 처음이면 null), `courseStatus`(늦음 표시, 끝난 반), notesByDate 모으기.

**크롬 점검** `tools/inspect-course-status.mjs` (teacher3): 11-02 3교시(5-2)에 메모 '실험 못 끝냄' 저장 → 11-04 1교시(5-2) 카드에 지난 시간 줄 →
5-1 카드에는 없음; 진도 창 현황표 4줄; 5-3을 두 번 밀면 '2차시 늦음'; 되돌리고 메모 지우기. 회귀: `inspect-progress.mjs`.

**설명서**: '수업 칸'·'진도 관리'에 한 단락씩.

- [ ] S5 끝

---

### S6. 교과 출결 — 저장과 입력 칸 (권장 노력: 높음)

**목표**: 교과 모드 수업 칸에서 그 반 그 교시의 결과·지각·조퇴를 적는다. 담임 출석부와 따로 둔다.

**먼저 읽을 것**: `src/lib/attendance.ts`(종류·사유 이름), `src/lib/attendanceStore.ts`(**바뀐 학생만 쓰는 방법** - 그대로 따른다),
`src/components/AttendanceDrawer.tsx`의 학생 줄·종류 고르기(나눠 쓸 수 있으면 컴포넌트로 뽑는다), `EntryPanelHost.tsx`의 칸 종류(kind) 다루기.

**데이터** `users/{uid}/v4_subjectAttendance/{classKey}_{date}` (V4 전용)
```
{ classKey, year, grade, classNum, date,
  periods: { "3": { "12": { num: 12, name: '홍길동', kind: 'absent'|'late'|'early', reason: 'sick'|'unexcused'|'other'|'approved', note?: '' } } },
  updatedAt }
```
- 이름: absent = '결과', late = '지각', early = '조퇴'. 사유는 출석부 `REASONS`/`REASON_LABEL`을 그대로.
- 쓰기: `setDoc(ref, {classKey, …, periods: {[p]: {[num]: rec}}, updatedAt}, { mergeFields: ['classKey','year','grade','classNum','date','updatedAt', new FieldPath('periods', p, String(num))] })`,
  지우기는 그 FieldPath에 `deleteField()`. **문서·교시를 통째로 쓰지 않는다.** 읽기는 `getDocTrustingServer`.
- 기록 자동 줄(`autoJournal`)은 만들지 않는다(담임 출석부만 기록을 만든다).

**만들 것**
- `src/lib/subjectAttendance.ts`(이름·셈: 교시 하나 요약 '결과 2 · 지각 1', 학생 하나 누계), `src/lib/subjectAttendanceStore.ts`(load/save/clear/loadForClass).
- 오른쪽 칸 `SubjectAttendancePanel`(`SidePanelFrame`, ariaLabel '교과 출결'): 그 반 학생(isActive) 줄, 누르면 종류 고르기(결과/지각/조퇴/출석으로),
  사유·메모. 바꿀 때마다 그 학생만 저장. 위에 '5-2 · 11/2(월) 3교시 · 과학'.
  `EntryPanelTarget.kind`에 `'subjectAttendance'`와 `period`·`classKey`를 더한다(EntryPanelHost가 그린다).
- 하루 카드(교과 모드, 반의 명렬표가 있을 때): 작은 단추 '출결'(`data-subject-attendance`) + 적힌 것이 있으면 '결과 2' 표.
- 교과+담임이고 그 반이 담임반이면 칸 위에 그날 담임 출석부의 결석 학생을 흐리게 "담임 출석부: 결석 3번" (읽기만).

**함정**: 같은 날 두 교시를 열어 각각 적어도 서로 덮지 않아야 한다(FieldPath). 명렬표 번호가 바뀌어도 `name`이 남는다. 명렬표가 없는 반은 단추를 숨긴다.

**단위 테스트**: 요약·누계 셈, 저장 함수가 만드는 mergeFields(목으로 `setDoc` 인자를 본다 - `attendanceStore`에 테스트가 있으면 그 방식).

**크롬 점검** `tools/inspect-subject-attendance.mjs` (teacher3 2026-11-02, 10항목 안팎): 1교시(5-1) 출결 → 2번 결과(질병) → 서버 `periods.1.2`;
3교시(5-2)도 1번 지각 → 1교시 기록이 그대로; 새로고침해도 보임; 2번을 출석으로 → 그 칸만 사라짐; 카드 표 '결과 1'; 끝에 문서 지우기.
회귀: 담임 출석부 점검(`grep -ln "출석부" tools/inspect-*.mjs`에서 출석부 전용 스크립트).

**설명서**: 새 주제 `id:'subject-attendance'`('교과 출결', 학급 운영 장) - 담임 출석부와 다른 점, 적는 법. ARCHITECTURE 3장 줄.

- [ ] S6 끝

---

### S7. 교과 출결 누계 + 학급 탭 정리

**목표**: 반마다 학기 교과 출결 누계를 보고 CSV·인쇄한다. 학급 탭이 교과 모드에 맞게 반을 학년별로 묶는다.

**먼저 읽을 것**: `ClassScreen.tsx` 전체(200줄), 담임 출석부의 누계 화면(`AttendanceDrawer`의 summary 탭), `lib/print.printNode`, 학생 누가기록 창(단축키 id `studentRecord`)에서 출결을 그리는 곳.

**만들 것**
- 누계 화면(오른쪽 칸 `SubjectAttendancePanel`의 '누계' 탭 또는 `SubjectAttendanceSummary`): 반 고르기, 학기(1·2학기, `semesterOf`), 줄 = 학생, 칸 = 결과·지각·조퇴 횟수,
  학생을 누르면 날짜·교시 목록. CSV(`overviewCsvRows`처럼 BOM 붙인 UTF-8), 인쇄(`printNode`, `data-print-hide`).
- 학급 탭(교과 모드): 반 목록을 학년별 줄로, 반 칩에 반 색. 도구에 '교과 출결'(누계 열기) 추가. 담임반이 아닌 반에서는 출석부·알림장 대신 교과 출결.
- 학생 누가기록: 교과 모드면 그 학생의 교과 출결 줄도 날짜 차례에 섞는다(`[교과 출결] 11/2 3교시 결과(질병)`).
- 단축키·명령 창에 `subjectAttendance`(이름 '교과 출결 누계') - `COMMAND_META`를 함께 채워야 빌드된다(CLAUDE.md 6-2).

**단위 테스트**: 학기 누계 셈, CSV 줄.

**크롬 점검** `tools/inspect-subject-attendance-summary.mjs`: 출결 몇 개 심고(서버에 직접) → 누계 수 → CSV 내려받기 글 → 학급 탭 학년 묶음·'교과 출결' 도구 → 누가기록 줄 → 정리.
회귀: `inspect-class-screen.mjs`(teacher).

**설명서**: '교과 출결'에 누계, '학급 탭' 주제에 교과 모드 모양.

- [ ] S7 끝

---

### S8. 수업 칸 → 반 도구 + 조사표 반 자동 + 여러 반에 같은 조사표 (권장 노력: 높음)

**목표**: 교과 모드 수업 칸에서 그 반의 자리표·뽑기·명렬표·조사표로 바로 간다. 조사표를 만들면 반·과목이 자동으로 골라지고,
'같은 과정의 다른 반에도' 체크로 반마다 **같은 차시를 하는 교시**에 같은 조사표가 생긴다.

**먼저 읽을 것**: `src/lib/classMemory.ts`(`rememberHubClass` - 도구가 열 학급을 정한다), `src/lib/appActions.ts`(`runAppAction`),
`EvaluationModal.tsx`의 새 조사표 만들기(`selectedRoster`, `rosterMeta`, `defaultSubject`, 저장 길), `useEvaluation.ts`의 저장(트랜잭션), `evalList.evalDocPayload`.

**만들 것**
- 하루 카드(교과 모드, 반의 명렬표가 있을 때) 작은 줄 `data-class-tools`: 🪑 자리표 · 🎯 뽑기 · 📊 조사표 · 출결(S6).
  자리표·뽑기는 `rememberHubClass(classKey)` 뒤 `runAppAction({ id: 'seating' | 'drawStudent' })`.
- EvaluationModal: 수업 칸에서 열 때 칸 글자를 `parseSlot` → 그 학년도 `rosterForSlot`이 있으면 그 학급을 고르고 과목은 `subject`(반 글자 빼고).
  **이미 저장된 조사표를 열 때는 바꾸지 않는다**(지금 학급 그대로).
- '같은 과정의 다른 반에도 만들기'(`data-course-evals`, 새로 만들 때만, 그 교시에 과정 표시가 있을 때만): 순수 함수
  `planCourseEvals(mark, plan, timelinesByKey)` → 다른 반마다 같은 차시(`index`)를 하는 첫 교시 `{cls, date, period}` 또는 '아직 시간표에 없음'.
  저장: 반마다 그 날짜 조사표 문서에 **기존 저장 길(useEvaluation의 트랜잭션)로 하나씩** 더한다 - 같은 제목·종류·단계·방법, `records` 빈 것,
  `rosterMeta`·`studentsSnapshot`은 **그 반 명렬표**로. 끝나면 "5-2·5-3에 만들었습니다 · 5-4는 아직 시간표에 없음" 안내.
- `ProgressTimeline`에서 차시 → 교시 찾기 `slotOfLesson(timeline, index)`.

**함정**: 조사표 문서는 V3와 함께 쓴다 - 쓰기는 반드시 `evalDocPayload`(두 이름), 읽기는 `readEvalList`(CLAUDE.md 3장). 반마다 날짜가 달라 문서가 여러 개다 -
하나가 실패하면 성공한 것을 알리고 실패한 반을 알려 준다(되돌리지 않는다). 모둠 평가면 `groups`는 비운다(반마다 모둠이 다르다).

**단위 테스트**: `parseSlot`→학급 고르기, `slotOfLesson`, `planCourseEvals`(밀린 반, 시간표에 없는 반, 같은 반 제외).

**크롬 점검** `tools/inspect-course-evals.mjs` (teacher3, S4 과정을 심고 시작): 11-02 1교시(5-1) 조사표 열기 → 학급 5-1·과목 '과학' 골라짐 →
'다른 반에도' 체크로 만들기 → 서버: 11-02 3교시(5-2)·11-03 2교시(5-3)·11-03 4교시(5-4)에 같은 제목, rosterMeta 반마다 맞음 → 자리표 단추가 5-1로 열림 → 정리(조사표·과정 지우기).
회귀: `inspect-eval-overview.mjs`, `inspect-student-card.mjs`(teacher).

**설명서**: '조사표' 주제에 교과 모드 단락, '수업 칸'에 반 도구 줄.

- [ ] S8 끝

---

### S9. 과정별 평가 모아 보기

**목표**: 과정 하나의 조사표를 반 × 평가 표로 보고(반마다 완료 몇/몇), 칸을 누르면 그 반 조사표로 간다.

**먼저 읽을 것**: `EvalOverviewModal.tsx`(346줄), `lib/evalArchive.loadClassEvals`, `lib/evalSummary`(`filterEvals`·`sortEvals`·`evalColumnTitle`·`overviewCsvRows`).

**만들 것**
- EvalOverviewModal 위에 탭 '학급별'(지금) / '과정별'(`data-overview-course`, 교과 모드만).
- 과정별: 과정 고르기 → 반마다 `loadClassEvals` → **제목이 같은 조사표를 한 칸으로** 묶는 순수 함수 `groupCourseEvals(evalsByClass)`
  (제목+종류로 묶고, 날짜는 반마다 다르다) → 줄 = 반, 칸 = '완료 18/25'(점수·체크가 있는 학생 수 / 그 반 학생 수), 아직 없으면 '-'.
  칸을 누르면 `openEvaluationModal(날짜, 'schedule', 교시, 과목, evalId)`. CSV.

**단위 테스트**: `groupCourseEvals`(같은 제목 다른 날짜, 한 반에만 있는 것, 종류가 다른 같은 제목).

**크롬 점검** `tools/inspect-course-overview.mjs`: S8 방식으로 조사표 셋 심기(서버에 직접) → 과정별 표 4줄 → 한 반에 점수 넣고 다시 열면 숫자 바뀜 → 칸 누르면 조사표 창 → 정리.
회귀: `inspect-eval-overview.mjs`.

**설명서**: '평가 모아 보기' 주제에 과정별 단락.

- [ ] S9 끝

---

### S10. 마무리

**목표**: 교과 모드 전체를 한 번 훑어 빠진 곳을 메우고, 담임 모드가 그대로인지 크게 확인한다.

**할 일**
- 명령 창: '교사 유형 바꾸기'(환경설정 열기), '교과 출결 누계', '과정 만들기'(진도 창) - `COMMAND_META`.
- 설명서 '교사 유형' 주제를 처음부터 끝까지 다시 읽고, S1~S9가 더한 단락을 한 흐름으로 정리(교과 전담 선생님이 처음 쓰는 순서:
  유형 고르기 → 명렬표에 반 만들기 → 시간표에 `5-2 과학` → 시간표 적용 → 과정 만들기 → 수업 칸에서 출결·조사표).
- 휴대폰 폭(390px)에서 교과 모드 하루 카드·교과 출결 칸이 넘치지 않는지 **이 세션에서만** 한 번 본다(CLAUDE.md 2장 - 사용자에게 알리고).
- 점검: S1~S9의 `inspect-*` 모두 + 설명서 전체 점검(`tools/inspect-manual.mjs`, 8~10분) + `inspect-progress`·`inspect-class-screen`·`inspect-more-menu`.
- CLAUDE.md '지금 상태'의 전담 줄을 3~4줄로 줄이고, 자세한 것은 ARCHITECTURE 8장 '교과 전담 모드'로 옮긴다.
- ROADMAP.md 18번 상태 `끝`.

- [ ] S10 끝
