# 19. 다듬기 + 메모·기록 하나로 — 세션별 작업 계획

2026-10-06 사용자와 정함. ROADMAP.md 19번 항목의 자세한 계획이다. **한 세션(새 대화 하나) = 아래 U 하나**.
사용자 요청(진도 관리·하루 수업 칸·메모 화면·명령 창·#라벨·구글 캘린더·월간 칩·직관성, 체크리스트, 메모·기록 통합)에
Claude의 권장 의견(대화에서 제시)을 반영했다. 요청과 다르게 한 것은 '결정' 절에 까닭과 함께 적었다.

## 세션을 시작하면 (매번 이것만)

1. `git pull` → ROADMAP.md '지금 하는 일'에서 이번 세션 번호(U1…)를 본다.
2. **이 파일의 '결정'·'공통 규칙'과 그 세션 절만 읽는다** (`grep -n "^### U" docs/ROADMAP-REFINE.md`). 다른 세션 절은 읽지 않는다.
3. 그 절의 **먼저 읽을 것**만 읽는다. 큰 파일은 grep으로 위치를 찾아 필요한 부분만.
4. 작업 → `npx vitest run` → `npx tsc -p tsconfig.app.json --noEmit` → `npm run lint`(오류 0) → 빌드 → 그 절의 크롬 점검 →
   설명서(`helpTopics.ts`)·ARCHITECTURE → **이 파일의 체크와 ROADMAP.md '지금 하는 일'을 다음 세션으로** → 커밋·푸시.
5. 끝나면 "U○ 끝. 새 대화에서 '이어서'"라고 알린다. 다음 세션을 같은 대화에서 시작하지 않는다(토큰).
6. 계획과 코드가 다르거나 계획대로 하면 V3 호환이 깨질 것 같으면 **멈추고** '막힌 것'에 적고 묻는다. 짐작으로 바꾸지 않는다.

## 결정 (2026-10-06)

사용자 요청 그대로 하는 것은 따로 적지 않는다. 아래는 **요청을 바꾸거나 Claude가 고른 것**이다(사용자가 '권장대로'라고 함).

| 주제 | 결정 | 까닭 |
|---|---|---|
| 수업 칸의 단원·차시·내용·교과서 | **수업 문서에 칸을 더하지 않는다.** 진도표(차시 목록)에 `교과서(쪽)` 칸을 더하고, 하루 칸은 진도 줄로 보인다. 날마다 손으로 적는 칸은 과목·준비물·메모 그대로 | 진도가 이미 날짜별 차시를 셈한다(밀기 한 번에 뒤가 따라온다). 수업 문서는 V3와 같이 쓴다. 칸이 길어진다(10-01에 줄인 까닭) |
| 준비물·메모 | **두 칸 그대로** | 알림장 '다음 수업일 불러오기'·주간학습안내가 준비물 칸을 따로 읽는다 |
| 전담의 반 목록 | **시간표·수업 칸에 적힌 반 + 명렬표의 반 + 환경설정 '가르치는 반'** 을 합친다 | 반을 따로 등록하지 않아도 시간표에 적은 반이 나온다. 학년 초 시간표가 없을 때를 위해 설정에도 둔다(과목 옆, 한 곳) |
| 전담의 진도 만들기 | '진도'와 '과정(여러 반)'을 **하나로**: 과목 + 반 고르기(하나든 여럿이든) | 둘 중 무엇을 골라야 하는지 고민이 사라진다 |
| 빈 라벨 | **자동 삭제하지 않는다.** 라벨 관리에 항목 수와 **'빈 라벨 정리(N개)'** 단추 | 기록 라벨은 id로 저장 - 지우면 휴지통에서 되살린 기록이 라벨을 잃는다. V3·그룹이 같은 목록을 쓴다. 미리 만든 라벨·상위 라벨이 사라진다. 기록은 날짜마다 문서라 비었는지 알려면 모든 날을 읽어야 한다 |
| 메모 거르개 규칙 | 상위를 고르면 하위도 + 가상 칩 '기타' + '하위 포함' 체크 삭제 + 하위 처음 접힘. **기록 거르개도 같게** | 메모·기록을 한 항목으로 합치므로 거르개도 하나 |
| 명령 창 | 지운다 (Ctrl+K·⋮ 메뉴·설명서·점검 스크립트에서도) | 날짜 고르기·통합 검색·⋮ 메뉴가 같은 일을 한다 |
| '#라벨' | 마지막 행이 `#…`로만 되어 있으면 라벨로, 저장할 때 **그 행은 본문에서 지운다**. `#26040305`(숫자 8자리, 학생 태그)는 라벨로 보지 않고 글에 남긴다 | 행을 남기면 칩으로 뗀 라벨이 다시 저장할 때 또 붙는다 |
| 구글 캘린더 | 일정 라벨 속성 **'구글 캘린더'**(이미 있는 '달력' 속성과 이름을 가른다). V4에서 저장·완료·삭제할 때 로그인이 살아 있으면 곧바로, 아니면 **'📅 못 보낸 일정 N'** 단추 한 번으로 보낸다 | 브라우저가 누르지 않은 때의 로그인 창을 막는다. 서버에서 보내기는 유료 서버·구글 심사가 필요 |
| **메모·기록 통합** | **보이는 것은 한 항목, 저장 자리는 그대로**: 날짜가 있으면 `{sp}/journals/{date}`, 없으면 `{sp}/tasks/{id}`. 쓰는 칸에 '📅 날짜' 칸 하나 - 날짜를 넣거나 빼면 자리를 옮긴다 | 한 컬렉션으로 옮기면 V3가 못 읽고, 큰 데이터 옮기기는 지난 사고(4장)처럼 위험하다. V3에는 지금처럼 메모·기록으로 보인다 |
| **라벨 통일** | **통일한다** (V4에 한 목록, V3 문서의 `memoLabels`·`journalLabels` 두 배열에 같이 쓴다) | 한 항목이면 라벨도 하나여야 날짜를 넣고 뺄 때 라벨 고르기 단계가 없어진다(지금 MoveEntryModal의 빼기/새로 만들기/다른 라벨). '#라벨'·거르개·빈 라벨 정리가 한 목록만 본다. 일정 라벨은 속성(이월 등) 때문에 **따로 둔다** |
| 체크리스트 | **글자 방식** `☐ `/`☑ ` (이미 Keep 가져오기·메모 카드에 있는 것을 넓힌다) | V3·검색·백업에 글로 그대로 보인다. 칸 구조를 새로 만들면 V3가 모른다 |
| 날짜를 바꿀 때 원본 | 지금처럼 **휴지통에 사본**('(날짜를 바꿈)') + 안내의 되돌리기 | 4장의 규칙(새 항목을 만든 뒤에만 원본을 지운다, 휴지통을 거친다)을 지킨다. 휴지통이 지저분하면 나중에 숨김 표시를 더한다 |
| 날짜를 뺄 때 첫 줄 | `[2026-10-06 (화) 기록]` 첫 줄을 **더하지 않는다.** 메모에 `fromDate`(V4 전용 칸)를 두고 카드에 작게 '📅 10/6에서' | 같은 항목의 자리만 바뀌는 것이므로 글을 바꾸지 않는다(4-5 본문을 바꾸지 않는다) |

## 공통 규칙 (모든 세션)

- **V3와 같이 쓰는 문서에 칸을 더하지 않는다**: 수업 `schedules`, 명렬표, 시간표 `timetable_v5`, 출석부, **라벨 `settings/labels`의 라벨 객체**
  (V3가 라벨을 저장할 때 모르는 칸을 지운다 - 그래서 트리도 `v4_labelTree`에 있다). 새 자료는 V4 전용 문서(`v4_` 이름).
- 기록 항목(`journals/{date}.entries[]`)·메모 문서(`tasks/{id}`)에 V4 전용 칸(`completed`·`favorite`·`fromDate` 등)을 더하는 것은 된다 -
  V3는 기록을 항목째 들고 다니고(ARCHITECTURE 5장 표 단락), 메모는 updateDoc이다. **U6에서 PC의 V3 코드로 한 번 더 확인한다**
  (`School_Planner_V3/js` 에서 journal 저장 부분 - 클라우드 컨테이너에는 V3가 없다).
- **기록을 읽는 곳은 칸을 이름으로 골라 읽는다**(`useDayData.applyJournalData`, `JournalPeekModal`) - 기록에 칸을 더하면 읽는 곳에도 더한다.
- 기록은 하루치 한 배열 - 쓰기는 `mutateJournals`(서버에서 읽은 배열에서 항목 하나만). 메모는 문서 하나.
- 지우기는 휴지통 먼저, 안내는 `showDeletedToast`. 저장 실패는 `failWithToast`로 던진다.
- 초등 담임(`teacher`)과 교과 전담(`teacher3`, `?as=3`) 두 계정으로 본다. 점검이 바꾼 자료는 끝에 되돌린다.
- 화면 글자·title을 바꾸면 `grep -rn '<옛 글자>' tools/`로 점검 스크립트도 고친다. 새 단추에는 `data-…`.
- 이 파일의 체크는 그 세션 커밋에 함께 넣는다. CLAUDE.md '지금 상태'에는 세션마다 두 줄 이하만.

## 세션 표

| 세션 | 내용 | 크기 | 권장 노력 | 상태 |
|---|---|---|---|---|
| U1 | 버그 셋: 월간 아래 목록 칩 완료 · 전담 반 목록 · ▼ 드롭다운 | 중간 | 중간 | 끝 (2026-10-07) |
| U2 | 진도 관리: 용어 · 전담 한 화면 · '+ 행 추가' · 교과서(쪽) 칸 · 예시 CSV | 큼 | **높음** | |
| U3 | 하루 수업 칸: '학년-반 과목' · 진도 줄에 교과서 · '진도 만들기' | 중간 | 중간 | |
| U4 | 명령 창 지우기 | 작음 | 낮음 | |
| U5 | 메모·기록 라벨 한 목록으로 | 큼 | **높음** | |
| U6 | 한 카드·한 쓰는 칸: 라벨 칩 위, ★·완료를 쓰는 칸 머리줄, 기록에도 완료·즐겨찾기 | 큼 | **높음** | |
| U7 | 날짜 칸 = 자리: 날짜를 넣고 빼면 메모 ↔ 기록 | 큼 | **높음** | |
| U8 | 거르개: 상위 → 하위 · '기타' · 처음 접힘 (메모·기록) | 중간 | 중간 | |
| U9 | 체크리스트 | 중간 | 중간 | |
| U10 | '#라벨' 마지막 행 + 빈 라벨 정리 | 중간 | 중간 | |
| U11 | 일정 '구글 캘린더' 속성 | 큼 | **높음** | |
| U12 | 직관성 점검 문서(용어표·클릭 수표) → 사용자가 고른다 | 중간 | 중간 | |
| U13 | 마무리: 설명서 전체 점검 · 회귀 | 중간 | 중간 | |

차례의 까닭: U1~U4는 서로 얽히지 않은 작은 것(빨리 쓸모가 생긴다). U5(라벨)가 U6~U10의 바탕이다 - 라벨이 하나여야 날짜 옮기기·거르개·#라벨이 단순해진다.
U6을 U8·U9보다 먼저 하는 까닭: 카드를 하나로 만든 뒤에 칩·체크 줄을 고쳐야 두 번 고치지 않는다.

## 막힌 것 · 결정 메모

(세션이 계획과 다른 것을 만나면 여기에 적고 사용자에게 묻는다.)

---

### U1. 버그 셋

**목표**
1. 월간에서 날짜를 눌러 아래에 뜨는 목록(`MonthDaySheet`)의 라벨 칩을 누르면 **주간처럼 완료**(이월 라벨이면 title도 같게).
2. 전담의 반 목록 = 시간표 템플릿에 적힌 반 + 그 학년도 수업 문서에 적힌 반 + 명렬표의 반 + 환경설정 '가르치는 반'.
3. 수업 칸의 ▼가 **칸에 적힌 글자와 상관없이 모든 '반 과목'**을 보인다(적을 때만 거른다).

**먼저 읽을 것**: `features/week/WeekGrid.tsx`의 칩 `onToggleEvent`(약 396줄), `features/month/MonthDaySheet.tsx`·`MonthScreen.tsx`(시트에 무엇을 넘기나),
`components/SlotOptionsList.tsx`, `lib/teachingSlot.ts`(`classesForYear`·`slotSuggestions`), `components/TeachingModePanel.tsx`, `lib/teachingMode.ts`,
`components/ProgressModal.tsx`의 `classOptions`(약 145줄).

**할 것**
- 월간 칩: 시트 칩을 `<span role="button">`으로 바꿔 `e.stopPropagation()` 뒤 완료 토글(시트가 감싼 `<button>` 안이라 button을 넣을 수 없다).
  다중 선택 모드에서는 주간처럼 끈다. `MonthScreen`이 주간과 같은 완료 함수를 넘긴다.
- `lib/teachingSlot.ts`에 `teachingClasses({ rosters, templates, subjectsByDate?, settingClasses, schoolYear }) => string[]`(순수 함수, 학년·반 숫자 차례, 중복 없음)
  와 단위 테스트. 시간표·수업 칸 글자는 `parseSlot(...).cls`.
- `TeachingMode`에 `classes: string[]`(가르치는 반, `5-2` 꼴만 - `sanitizeTeachingMode`에서 거른다). 저장은 `arrayUnion/Remove`(과목과 같게).
  환경설정 교사 유형의 '가르치는 과목' 아래 '가르치는 반' 칩 입력(`data-teaching-class-input`). 쉼표·띄어쓰기로 여럿, `5-1~5-6` 범위도 받는다.
- 제안·드롭다운: `SlotOptionsList`(datalist)를 **`SlotCombobox`**(새 컴포넌트, 입력 칸 + ▼ 단추 + 목록)로 바꾼다.
  ▼·칸에 들어갈 때 **전체** 목록, 글자를 치면 그 글자를 담은 것만(초성 거르기는 `lib/hangul` 있으면 쓴다), ↑↓·Enter·ESC, 바깥 누르면 닫힘.
  쓰는 곳 셋: `DaySchedule`(수업 칸), `DetailEditModal`, `TimetableTemplateModal`. 목록은 `teachingClasses × mode.subjects`(과목이 없으면 반만).
  교과 모드(`isClassUnit`)에서만 - 초등 담임 칸은 그대로 `<input>`.
- 진도 관리의 과정 반 칩(`classOptions`)도 `teachingClasses`로.

**함정**: 콤보 목록은 `ModalShell` 안에서도 잘리지 않게(absolute + 부모 overflow 확인). ESC가 목록만 닫고 칸·오른쪽 줄을 닫지 않게 `stopPropagation`.
datalist의 '맞는 것만 보임'은 크롬 동작이다 - 테스트로는 재현되지 않으니 크롬 점검으로 본다.

**확인**: 단위(teachingClasses, sanitize의 classes) / 크롬: teacher3 - 명렬표 없는 반을 시간표에만 적고 ▼에 나오는지, '5-1 과학'이 적힌 칸에서 ▼에 다른 반도 나오는지,
진도 과정 반 칩, 월간 시트 칩 완료·다시 눌러 풀기. teacher - 수업 칸이 예전 그대로.

- [x] U1

### U2. 진도 관리 (권장 노력: 높음)

**목표**
1. '칸 글자' → 초등 담임 **'과목'**, 교과 모드 **'학년-반 과목'**(라벨·placeholder·aria·안내 글·설명서).
2. 교과 모드: '+ 진도'와 '+ 과정 (여러 반)'을 **하나**로 - 과목 + 반 칩(하나든 여럿이든). 새로 만든 것은 늘 과정 모양(`subject`·`classes`)으로 저장.
3. '+ 줄 더하기' → **'+ 행 추가'**, **마지막으로 커서가 있던 행 바로 아래**에 넣고 그 행의 같은 칸에 커서(커서가 없었으면 맨 아래).
   창 안의 '줄'을 모두 '행'으로('한 줄 = 한 교시' → '한 행 = 한 차시', '이 줄 빼기' → '행 삭제').
4. 차시 표에 **교과서(쪽)** 칸: `ProgressLesson.page`(글자, '12~15'처럼). 표·붙여넣기·CSV·예시 CSV·진도 줄(U3)에.

**먼저 읽을 것**: `components/ProgressModal.tsx` 전체(969줄 - FIELDS, ROW_GRID, addRow, handleCellKeyDown, toDraft, 과정 갈래), `lib/progress.ts`의
차시 표 읽기(`parseLessonTable`·`parseLessonCsv`와 머리줄 맞추기), `cleanLessons`, `lib/progressSample.ts`, ARCHITECTURE 8장 '진도 관리'.

**할 것**
- `lastFocusRow` ref: 칸 `onFocus`에서 행 번호를 적는다. `addRow`는 `lastFocusRow + 1` 자리에 `splice`. 마지막 행 Enter는 지금처럼.
  **Ctrl+Enter**(어느 행에서나) = 그 아래에 행 추가 - 단추 title에 적는다.
- `FIELDS`에 `{ key: 'page', label: '교과서' }`(단원 | 차시 | 내용 | 교과서 | 준비물). ROW_GRID 칸 하나 더(오른쪽 칸 340px에서도 내용 칸이 가장 넓게).
- 머리줄 맞추기에 '교과서'·'쪽'·'쪽수'·'교과서(쪽)' → page. 머리줄 없는 붙여넣기의 칸 차례는 단원·차시·내용·**교과서**·준비물 -
  **옛 4칸 표(단원·차시·내용·준비물)는 4번째를 준비물로** 읽어야 한다(칸 수로 가른다: 4칸이면 옛 차례, 5칸이면 새 차례). 테스트로 못 박는다.
- 예시 CSV 머리줄·예시 행에 교과서 쪽('12~13' 등). 파일 이름 그대로.
- 진도 문서 `lessons[].page` - V4 전용 문서라 그냥 더한다. 옛 문서는 page가 없다(빈 글자로 읽기).
- 교과 모드 한 화면: 이미 있는 **옛 '칸 글자 하나' 진도(`key: '5-2 과학'`, classes 없음)는 그 모양 그대로 고치고 저장**한다(과정으로 바꾸면
  셈이 `progressKey` → `normalizeSlotText`로 바뀌어 옛 결과가 달라질 수 있다). 화면에서는 '과목 + 반 하나'로 보이게만.
  반이 없는 옛 진도(교과 모드에서 '창체')는 과목만.
- 초등 담임은 지금 그대로(칸 이름만 '과목').

**함정**: 행을 가운데 넣으면 `data-cell="행-칸"`이 밀린다 - 붙여넣기(`handleCellPaste`)·키 이동이 새 번호로 동작하는지. React key가 행 번호라
가운데 넣으면 입력 중인 IME가 엉킬 수 있다 - 행마다 임시 id(`_k`)를 두고 저장할 때 뺀다(`cleanLessons`). 진도 셈(`computeProgress`)은 건드리지 않는다.

**확인**: 단위(4칸/5칸 붙여넣기·CSV, page 저장·읽기, 가운데 삽입) / 크롬: 3행에 커서 → '+ 행 추가' → 4행이 새 빈 행, Ctrl+Enter, 교과서 칸 붙여넣기,
teacher3 - 과목+반 하나로 만들기·저장·하루 칸에 진도, 옛 진도 열고 저장해도 하루 칸 차시가 같은지. 기존 `inspect-progress*` 스크립트 글자 고치기.

- [ ] U2

### U3. 하루 수업 칸

**목표**
1. 교과 모드 수업 칸 입력의 placeholder·aria를 **'학년-반 과목'**(예: 5-2 과학), 초등 담임은 '과목'.
2. 카드 차례: **과목(반 과목) / 진도 줄 / 준비물 / 메모**. 진도 줄에 교과서 쪽: `📘 단원 · 5/12차시 · 내용 · 📖 12~13쪽 · 🎒 준비물`.
3. 그 교시에 진도가 없으면(개인 공간, 과목이 있을 때) 수업 칸 수정 중에 **'📘 진도 만들기'** - 진도 관리를 그 과목(교과 모드면 그 반 과목)으로 채운 새 진도로 연다.

**먼저 읽을 것**: `features/day/DaySchedule.tsx`(수정 갈래 약 280~340줄, 보기 갈래), `components/ProgressMarkLine.tsx`, `store/useAppStore.ts`의
`setProgressModalOpen`, `ProgressModal`의 처음 draft 정하기(`NEW_COURSE_PLAN_ID`).

**할 것**
- `ProgressMarkLine`: `lesson.page`가 있으면 `📖 {page}쪽`(이미 '쪽'이 있으면 붙이지 않는다). title에도.
- store `setProgressModalOpen(true, planId, cls, preset?)`에 `preset: { key?: string; subject?: string; classes?: string[] }` - ProgressModal이 새 draft를 그 값으로.
- `DetailEditModal`(N교시 수정)에도 같은 단추.

**확인**: 단위(진도 줄 글자) / 크롬: teacher - 진도 없는 '국어' 교시 수정 → 진도 만들기 → 창에 과목 '국어', teacher3 - '5-2 과학' → 과목 과학·반 5-2.
진도 줄의 📖. 초등 담임 카드 높이가 늘지 않는지(빈 칸은 그리지 않는다).

- [ ] U3

### U4. 명령 창 지우기

**할 것**: `components/CommandPaletteModal.tsx`(+test), `lib/commandPalette.ts`(+test) 지우기. `Layout.tsx`(상태·⋮ 메뉴 항목·`commandPalette` case·ESC 닫기),
`lib/shortcuts.ts`의 `commandPalette`(저장된 사용자 단축키에 남은 값은 읽을 때 버린다 - `sanitize`가 모르는 id를 버리는지 본다),
명령 창이 넘기던 값(Layout의 '통합 검색에 넣어 둘 검색어'·'환경설정을 열 때 먼저 보일 구역' - `grep -n "명령 창" src/components/Layout.tsx`)은 명령 창만 쓰면 지우고 다른 데서도 쓰면 둔다,
`helpTopics.ts`의 '명령 창' 주제와 다른 주제의 언급(`grep -n "명령 창\|Ctrl + K" src/lib/helpTopics.ts`), 단축키 목록, `tools/`의 점검 항목,
ARCHITECTURE·CLAUDE.md 6장 목차의 '명령 창'. 레이아웃 주석의 "명령 창과 단축키 목록에도 같은 기능이 있어야 한다"를 고친다.

**확인**: tsc·lint·vitest / 크롬: Ctrl+K가 아무것도 열지 않는다, ⋮ 메뉴에 없다, 설명서 목차에 없다.

- [ ] U4

### U5. 메모·기록 라벨 한 목록으로 (권장 노력: 높음)

**목표**: 사용자에게는 **'메모·기록 라벨' 하나**. 라벨 관리 창의 메모 탭·기록 탭을 하나로, 쓰는 칸·거르개가 같은 목록을 본다.
일정 라벨은 그대로 따로.

**먼저 읽을 것**: `hooks/useLabels.ts`, `components/LabelModal.tsx`(메모·기록 라벨 더하기·지우기·색·트리 저장 - `saveLabelsToCloud`, `saveTree`),
`lib/labelTree.ts`, `utils/labelRename.ts`, `components/MoveEntryModal.tsx`, ARCHITECTURE 5장, CLAUDE.md 3장(V3 라벨).

**데이터 (V3 문서 모양은 그대로)**
- `settings/labels`의 `memoLabels`(이름 또는 `{name,color,id?}`)와 `journalLabels`(`{id,name,color}`)를 **둘 다 그대로 둔다**.
- V4의 한 목록 = 이름(trim)으로 합친 것: `lib/entryLabels.ts`(새, 순수 함수)
  ```ts
  export interface EntryLabel { name: string; color: string; journalId?: string }
  export function mergeEntryLabels(memoRaw: unknown[], journalRaw: JournalLabel[]): EntryLabel[]; // 차례: 기록 라벨 차례 → 메모에만 있는 것
  export function toMemoLabels(list: EntryLabel[], memoRaw: unknown[]): unknown[];  // 원래 모양(문자열/객체)을 지킨다
  export function toJournalLabels(list: EntryLabel[], journalRaw: JournalLabel[]): JournalLabel[]; // 있던 id를 지키고 새 이름만 새 id
  ```
  같은 이름 색이 다르면 **기록 쪽 색**. 이름만 다른 대소문자·띄어쓰기는 다른 라벨(지금과 같게).
- 라벨을 더하기·지우기·이름 바꾸기·색 바꾸기·차례 바꾸기를 하면 **두 배열을 한 번에**(`setDoc merge`로 두 칸만). 이름 바꾸기는 `labelRename`을
  메모·기록 둘 다 부른다(기록은 id라 항목은 그대로지만 `[이름]` 옛 글 형식 확인).
- 처음 열 때 한쪽에만 있는 라벨은 **화면에서는 합쳐 보이고**, 저장할 일이 생길 때 다른 배열에도 채운다(V3가 그사이 더한 라벨도 같게).
  읽기만으로는 쓰지 않는다(`labelsLoaded` 전에는 아무것도 쓰지 않는다 - 기본값으로 덮는 사고).
- 트리 `v4_labelTree`: 새 칸 `entry`(하위 이름 → 상위 이름) = memo와 journal을 합친 것(같은 하위의 상위가 다르면 journal 쪽, 라벨 관리 창에
  한 번 '상위가 달랐던 라벨: …' 안내). 저장할 때 `entry`·`memo`·`journal` 셋에 같은 것을 쓴다(아직 안 바뀐 다른 기기의 V4가 읽게). `useLabelTree`는 `entry`가 있으면 그것.
- 쓰는 칸: 메모는 이름 배열, 기록은 id(`labelIds`/`label`)로 저장하는 **저장 모양은 그대로**. 기록에 붙일 라벨의 id가 없으면(메모에만 있던 라벨)
  저장 전에 `journalLabels`에 채우고 그 id로.
- `MoveEntryModal`의 라벨 고르기 단계를 뺀다(같은 이름이 늘 있다). 옮기기 자체는 U7에서 날짜 칸으로 바뀐다.

**함정**: 기본 라벨 목록(`DEFAULT_MEMO_LABELS`의 '기타' 등)은 문서가 없을 때만. 라벨 관리 창이 V3의 모르는 칸을 지우지 않게 원래 객체를 펼쳐(`...orig`) 고친다.
기록 라벨 id는 절대 새로 만들지 않는다(있는 것). 휴지통의 기록이 id로 라벨을 찾으므로 지운 라벨도 id 짝을 바로 버리지 않는다(지금과 같게).

**확인**: 단위(mergeEntryLabels·toMemo·toJournal - 문자열 모양, 색 충돌, 한쪽에만, 차례) / 크롬: 라벨 관리에 탭 하나, 새 라벨 → 서버 두 배열에 같은 이름,
기록 쓰는 칸·메모 쓰는 칸이 같은 칩, 이름 바꾸기 뒤 메모·기록 카드 칩. seed 라벨이 깨지지 않게 끝에 되돌린다.

- [ ] U5

### U6. 한 카드·한 쓰는 칸 (권장 노력: 높음)

**목표**
1. 메모 카드와 기록 카드를 **한 컴포넌트 `EntryCard`**로(메모 화면 masonry, 하루 화면 기록 칸). 머리줄: `▶ ☐완료 ★ 라벨칩… 날짜 🔗` - **라벨 칩을 위**에,
   카드 아래의 `#라벨`은 없앤다. 
2. 쓰는 칸(`EntryDrawer`) 머리줄에 **☐ 완료 · ★ 즐겨찾기**(메모·기록 둘 다). 누르면 곧바로 저장(쓰던 글은 그대로 남는다).
3. 기록에도 완료·즐겨찾기: 기록 항목에 `completed`·`favorite`(V4 전용 칸). 완료는 줄 긋기, 즐겨찾기는 그날 기록의 맨 위.

**먼저 읽을 것**: `features/memo/MemoCard.tsx`, `features/day/DayJournal.tsx`(기록 카드 부분), `components/EntryDrawer.tsx` 머리줄,
`hooks/useDayData.ts`의 `applyJournalData`·`mutateJournals`·기록 고치기, `components/JournalPeekModal.tsx`, `lib/autoJournal.ts`(알림장·출석부 항목).

**할 것**
- `EntryCard` props: `{ item: { content, labels(이름), completed, favorite, attachments, tables, linkedItems, createdAt }, kind, onToggleComplete, onToggleFavorite, onToggleCheckLine, onOpen, onMoveUp/Down, … }`.
  메모·기록이 서로 다른 것(메모의 순서 단추, 기록의 학생 태그 링크)은 props로.
- `applyJournalData`·`JournalPeekModal`에 `completed`·`favorite` 칸을 더한다(**빠뜨리면 '저장은 되는데 안 보이는' 버그**).
- 기록 완료·즐겨찾기 저장: `mutateJournals`로 그 항목의 두 칸만.
- 자동 기록(알림장 `notice_…`·출석부 `attendance_…`)에는 ★·완료를 보인다(원본 동기화는 글만 본다 - `autoJournalSync`가 두 칸을 지우지 않는지 확인).
- 쓰는 칸 머리줄: 이미 저장된 항목이면 곧바로 저장, 새 항목이면 칸 값으로 들고 있다가 처음 저장 때.

**함정**: V3가 기록 항목의 모르는 칸을 지우지 않는지 **PC에서 V3 코드로 확인**(클라우드에는 V3가 없다 - 확인 전에는 '막힌 것'에 적고 사용자에게 PC 확인을 부탁).
메모 `completed`는 V3도 쓰는 칸이다(같은 뜻인지 확인). 카드가 하나가 되면서 `data-…` 이름이 바뀌면 점검 스크립트가 깨진다 - 옛 이름을 그대로 단다.

**확인**: 단위(EntryCard - 칩 위, #라벨 없음, 완료·별) / 크롬: 메모 카드·기록 카드 모양이 같고 칩이 위, 쓰는 칸 머리줄 ★·완료가 바로 저장, 기록 완료가 새로고침 뒤에도,
같은 날 다른 기록이 그대로(서버에서 읽어 배열 길이).

- [ ] U6

### U7. 날짜 칸 = 자리 (권장 노력: 높음)

**목표**: 쓰는 칸에 **'📅 날짜'** 칸 하나: `[날짜 없음(메모)] / [2026-10-06 (화)]` + 달력 고르기 + '날짜 빼기'.
날짜가 있는 항목은 그날 기록 칸에, 없는 항목은 메모 화면에. '↔ 기록으로 / ↔ 메모로' 단추는 없앤다. 새 메모 칸·새 기록 칸도 같은 칸(새 기록은 보던 날, 새 메모는 날짜 없음).

**먼저 읽을 것**: `lib/moveEntry.ts`, `components/MoveEntryModal.tsx`, `EntryDrawer`의 옮기기 단추·`EntryPanelTarget`, `components/panelRaise.ts`·`EntryPanelHost`
(열린 칸의 대상 바꾸기 - 일정의 `retargetEventPanels` 본보기), `lib/undoToast.ts`.

**할 것**
- `moveEntry`를 '자리 옮기기'로: 메모 ↔ 기록 ↔ **다른 날짜의 기록**(기록 날짜 바꾸기)도. 차례는 지금 그대로(새 항목 → 역링크 갈아끼우기 → 원본 휴지통 '(날짜를 바꿈)').
  칸은 모두 옮긴다: content·labels(U5로 이름이 같다)·attachments·tables·linkedItems·completed·favorite·createdAt(원래 값)·keepId.
  기록 → 메모는 첫 줄을 더하지 않고 `fromDate`(V4 전용). 메모 → 기록은 `fromDate`를 뺀다.
- 쓰는 칸은 저장 단추를 누를 때 날짜가 바뀌었으면 **먼저 글을 저장한 뒤 옮긴다**(한 번의 저장으로 끝나게). 옮긴 뒤 칸은 새 자리를 가리킨다(retarget).
- 되돌리기: `showMovedToast` 꼴로 새 항목 지우기 + 휴지통 사본 되살리기.
- 알림장·출석부 자동 기록은 날짜 칸을 잠근다(지금도 옮기지 않는다).
- 메모 화면 카드에 `fromDate`가 있으면 '📅 10/6에서' 작게.

**함정**: 기록은 하루 배열 - 옮길 때도 서버에서 읽고(`readJournalEntries`), 못 읽으면 옮기지 않는다. 같은 날로 '옮기기'는 아무것도 하지 않는다.
그룹 공간 항목은 같은 공간 안에서만. 옮기는 중 칸을 닫으면? - 저장 중 표시로 닫기를 막는다.

**확인**: 단위(moveEntry 칸 옮기기·fromDate) / 크롬: 메모에 날짜 넣기 → 그날 기록 칸에 같은 글·라벨·첨부·표, 메모 화면에서 사라짐, 휴지통 사본, 되돌리기.
기록 날짜 바꾸기(다른 날로), 기록 날짜 빼기 → 메모. 링크된 일정에서 링크가 새 자리로.

- [ ] U7

### U8. 거르개 (메모·기록)

**목표**: (1) 상위 칩을 누르면 **하위도 함께** 걸린다. (2) 하위가 있는 상위 아래에 가상 칩 **'기타'**(`data-filter-other="상위"`) - 그 상위가 붙었지만
그 하위는 하나도 안 붙은 항목. (3) '하위 포함' 체크와 +하위 꼬리표를 없앤다. (4) 화면을 열면 하위는 **접혀 있다**(펼친 것은 그 화면을 보는 동안만).
(5) 기록 거르개(`DayJournal`)도 같게.

**먼저 읽을 것**: `lib/labelTree.ts`(`LabelFilter`·`filterLabelSet`·`clickFilterLabel`·`toggleFilterChildren`·`pruneFilter`), `features/memo/MemoScreen.tsx`(거르개 그리기·
`foldedParents`·`memoFilter` 기억), `features/day/DayJournal.tsx`의 거르개, CLAUDE.md 5장 '라벨 상위/하위와 거르개'.

**할 것**
- `LabelFilter = { labels: string[] }` + 가상 칩은 `'기타\u0000상위'` 같은 열쇠 대신 **`others: string[]`(상위 이름)**. `withChildren`은 읽을 때 버린다(옛 기억값).
- 거르기: `matchEntry(itemLabels, filter, parents)` - 고른 라벨(상위면 그 하위 모두)이 하나라도 붙었거나, `others`의 상위가 붙고 그 하위가 하나도 없으면 참.
  순수 함수 + 단위 테스트(예: 학교 / A학교·B학교·C학교).
- 탐색기식 누르기(그냥·Ctrl·Shift·ESC)는 그대로. 가상 칩도 같은 규칙.
- 상위를 고르면 하위 칩들도 고른 것처럼 옅게 칠한다(걸리는 것이 보이게). 하위 하나만 고르면 그것만.
- '기타' 칩은 하위가 있는 상위에만, 항목 수가 0이면 흐리게. 진짜 라벨 '기타'(기본 라벨)와 헷갈리지 않게 회색 점선 테두리 + title '하위 라벨 없이 ○○만 붙은 항목'.
- `foldedParents` 처음 값 = 하위가 있는 모든 상위 접힘. 하위를 고른 채면 그 하위만 보인다(지금과 같게).
- 설명서·CLAUDE.md 5장의 9-30 규칙('상위를 골라도 하위는 들어가지 않는다')을 새 규칙으로 고친다(사용자가 10-06에 바꿈).

**확인**: 단위(matchEntry, 옛 기억값 읽기) / 크롬: 학교 → A·B·C학교 항목 모두, 학교 > 기타 → 학교만 붙은 항목, 새로고침 뒤 접혀 있음, 기록 거르개도.

- [ ] U8

### U9. 체크리스트

**목표**: 메모·기록에 **체크 목록**. 쓰는 칸에서 만들고, 카드에서 눌러 체크.

**먼저 읽을 것**: `lib/checkLines.ts`, `MemoCard`의 체크 줄 그리기(U6 뒤에는 `EntryCard`), `lib/keepImport.ts`의 `listLine`, `EntryDrawer`의 본문 칸(`AutoTextarea`).

**할 것**
- 쓰는 칸 도구 단추 **'☑ 체크리스트'**(`data-checklist-toggle`): 커서가 있는 행(골랐으면 고른 행들) 앞에 `☐ `를 붙이고, 모두 붙어 있으면 뗀다.
  단축키 `checklist`(기본 Ctrl+Shift+L, 단축키 바꾸기에 나온다).
- 쓰는 칸 키: `☐ ` 행에서 Enter → 다음 행도 `☐ `(들여쓰기 유지), 빈 `☐ ` 행에서 Enter → 표시만 지우고 목록 끝. 한글 조합 중(isComposing)은 건드리지 않는다.
  쓰는 칸에서 `☐`/`☑` 글자 위를 누르면(커서가 행 맨 앞 두 글자 안) 바꾸기 - 쓰는 칸 안에서도 체크.
- 카드: 체크 행 그리기와 누르기를 기록 카드에도(U6 `EntryCard` 하나라 같이 된다). 기록의 체크는 `mutateJournals`로 그 항목 글 하나만 - `toggleCheckLine(text, i, expectedLine)`이
  null이면(그새 고쳐졌다) 저장하지 않고 안내.
- 카드 머리줄에 `☑ 2/5` 셈(체크 행이 있을 때만).
- `lib/checkLines`에 `toggleLinesPrefix(text, selStart, selEnd)`·`continueOnEnter(text, caret)` 순수 함수와 테스트.

**확인**: 단위 / 크롬: 단추로 세 행 목록 → Enter로 이어 쓰기 → 빈 행 Enter로 끝 → 저장 → 카드에서 체크 → 새로고침 뒤 유지, 기록 카드에서도, 셈 표시.

- [ ] U9

### U10. '#라벨' 마지막 행 + 빈 라벨 정리

**목표**
1. 메모·기록을 저장할 때 **마지막 비지 않은 행**이 `#이름`들로만 되어 있으면(띄어쓰기로 여럿, 예 `#111 #555`) 그 라벨들을 붙이고(없으면 만든다 - U5 한 목록,
   상위 없음, 기본 색), 그 행을 본문에서 지운다. `#` 뒤 숫자 8자리(`#26040305`, 학생 태그)는 라벨로 보지 않고 그 행에 남긴다(남은 것이 있으면 행을 남긴다).
2. 라벨 관리에 **'항목 수 세기'** → 라벨마다 수(메모 n · 기록 n · 휴지통 n) + **'빈 라벨 정리 (N개)'** - 목록을 보여 주고(뺄 것 체크 해제) 한 번에 지운다.

**먼저 읽을 것**: `lib/quickInput.ts`(일정 칸의 `#라벨` - 이름 맞추기 규칙), `lib/studentTag.ts`, `EntryDrawer`의 저장, U5의 `lib/entryLabels`, `LabelModal`.

**할 것**
- `lib/hashLabels.ts`: `takeTrailingHashLabels(text) => { text, names }`(순수, 테스트: 여러 개·중복·학생 태그 섞임·행 중간의 #은 무시·빈 행 뒤·`#`만).
  이름 규칙: `#` 뒤 띄어쓰기 전까지, 끝의 문장 부호는 뗀다, 20자까지.
- 쓰는 칸 아래에 미리보기 칩 '저장하면 라벨 #111 #555 (새로 만듦)'(일정 빠른 입력 칩처럼) - 무엇이 일어날지 보이게.
- 빈 라벨 세기: 메모 `{sp}/tasks`(개인 + 내 그룹) 컬렉션, 기록 `{sp}/journals` 컬렉션 전체(서버에서 한 번, 진행 표시), 휴지통. 상위 라벨은 하위 수를 더한다.
  하위가 있는 상위·맨 위(기본) 라벨은 정리 목록에서 처음부터 체크를 뺀다. 지우기는 기존 라벨 지우기 길(두 배열 + 트리).

**확인**: 단위 / 크롬: 새 메모 마지막 행 `#새라벨 #업무` → 칩 둘, 본문에서 행 사라짐, 라벨 관리에 '새라벨'. 기록에서도. `#26040305` 행은 남고 학생 누가기록에 나온다.
빈 라벨 정리: 세기 → 정리 → 서버 두 배열에서 빠짐.

- [ ] U10

### U11. 일정 '구글 캘린더' 속성 (권장 노력: 높음)

**목표**: 일정 라벨 속성 **'구글 캘린더'**를 켠 라벨의 일정은 V4에서 만들기·고치기·완료·날짜 옮기기·지우기를 할 때 구글 캘린더에도 반영.

**먼저 읽을 것**: `lib/calendarSync.ts`(같은 캘린더·`composeSummary`·`extendedProperties.private.sp_id`·`isSameItem`), `lib/calendarSyncTask.ts`, `components/CalendarSyncModal.tsx`,
`lib/googleApi.ts`(`getGoogleTokenQuietly`·`getValidGoogleToken`·`GoogleLoginPrompt`), ARCHITECTURE 8장 '구글 토큰', 일정 저장 길(`useDayData`의 일정 저장, `lib/eventDocOps`, `useEventMove`, 다중 선택).

**데이터 (V4 전용 - 라벨 객체에 칸을 더하지 않는다)**
- `users/{uid}/settings/v4_gcal` `{ labels: { [eventLabelId]: true } }` - 라벨 관리 창·일정 칸 속성 줄에 '구글 캘린더' 토글(이미 있는 '달력' 옆, 이름이 다르게).
- 보낼 것: `users/{uid}/v4_gcalQueue/{eventId}` `{ date, op: 'upsert'|'delete', at }` - 같은 일정은 한 문서(마지막 것이 이긴다). 계정에 있어 다른 기기에서도 보낸다.

**할 것**
- 일정 저장 길이 끝난 뒤(성공했을 때만) `queueGcal(eventIds, op)` - 그 일정의 라벨이 켜져 있을 때만. 개인 공간 일정만(1차).
- `flushGcalQueue()`: 조용한 토큰이 있으면 큐를 읽어 그날 문서에서 일정을 읽고 `buildPayloads`와 같은 모양으로 `sp_id`로 찾아 넣기/고치기/지우기, 끝난 것은 큐에서 지운다.
  부르는 때: 큐에 넣은 직후, 앱을 열 때, 탭으로 돌아올 때. 토큰이 없으면 머리줄에 **'📅 못 보낸 일정 N'**(`data-gcal-pending`) - 누르면 `getValidGoogleToken`(누른 때라 로그인 창이 열린다) 뒤 flush.
- 수동 '구글 캘린더로 보내기'는 그대로(V3·다른 앱에서 고친 것을 맞출 때). 두 길이 같은 `sp_id`·같은 글 모양이라 겹치지 않는다.

**함정**: 이월로 id가 바뀌는 일정은 `sp_forwardChainId`로 옛 것을 찾아 지운다. 기간·반복 묶음은 날마다 따로 보낸다(지금 보내기와 같게). 실패는 큐에 남기고 다음에 다시
(같은 것을 세 번 실패하면 안내). 클라우드 컨테이너는 apis.google.com을 막는다 - 점검은 fetch를 흉내 낸다(드라이브 점검처럼), 실제는 사용자가 PC에서.

**확인**: 단위(큐 넣기 조건, payload) / 크롬(흉내): 켠 라벨 일정 저장 → 큐 → flush가 보낸 요청, 완료 → 글 앞 ✅, 지우기 → delete, 토큰 없음 → 단추 N, 누르면 보냄.
사용자 PC: 실제 구글 캘린더에 생기고 고쳐지는지.

- [ ] U11

### U12. 직관성 점검 문서

**목표**: 사용자의 기준('설명서 없이, 쉬운 말, 같은 말, 한두 번에')으로 V4 전체를 크롬으로 다니며 **`docs/UX-AUDIT.md`**를 만든다. 코드는 고치지 않는다.

**할 것**
- **용어표**: 화면에 보이는 모든 단추·제목·안내의 낱말을 모아(`grep`과 크롬) 같은 뜻 다른 말 / 프로그램 말 / 괄호 설명 이름을 표로 - `지금 → 제안 → 나오는 곳`.
  예: 줄/행, 달력(속성)/캘린더(구글), 조사표/평가, 쓰는 칸/배너/팝업, '시간표 적용 (주간 템플릿)', '학급 정보(명렬표)', '수업X'.
- **클릭 수표**: 자주 하는 일 20가지(일정 추가·완료·옮기기, 기록·메모 쓰기, 라벨 붙이기, 출석, 알림장, 진도 보기·밀기, 검색, 백업…)를
  Playwright로 따라 해 클릭·키 수를 센다(`tools/inspect-clicks.mjs`). 3번 이상인 것은 줄이는 안.
- **숨은 조작**: 알려 주지 않으면 모르는 것(칩 누르기 = 완료, Ctrl/Shift 칩, 경계선 두 번 누르기, 길게 누르기…)과 보이게 하는 안.
- ⋮ 메뉴 항목을 쓰는 횟수로 나눠 자주 쓰는 것을 화면에 꺼내는 안.
- 사용자가 표에서 고르면 그 다음 세션들(U12-a…)로 이 파일에 더한다.

- [ ] U12

### U13. 마무리

설명서 전체 점검(`SITE=http://localhost:4190/School_Planner_V4/ node tools/inspect-manual.mjs`), 설명서 '화면 구성 한눈에 보기'(⋮ 메뉴 목록)·'단축키 바꾸기'·
'휴대폰에서 쓰기' 목록, ARCHITECTURE 5·7·8장, CLAUDE.md 5장(메모·기록 옮기기 절 → 날짜 칸, 거르개 절), 지난 세션들이 남긴 '막힌 것'.
초등 담임·교과 전담 두 계정 회귀.

- [ ] U13
