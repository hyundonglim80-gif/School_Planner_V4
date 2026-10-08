# School Planner V5 — 설계

2026-10-08 정함(사용자: "정해야 하는 것은 네가 권장하는 방식을 따를께"). V5를 만드는 동안 **자료 모양과 뼈대의 정본**이다.
만들면서 바뀌면 같은 커밋에서 이 파일을 고친다. 메뉴·화면 자리는 `MENU.md`, 작업 순서는 `PLAN.md`, V4 기능 대조는 `PARITY.md`.

> 지금은 V4 저장소 `docs/V5/`에 있다. P1-1에서 V5 저장소 `docs/`로 옮긴다.

---

## 1. 목표

- **화면·기능·사용자가 정한 규칙은 V4 그대로** (V4 `CLAUDE.md` 5장, V4 설명서 `src/lib/helpTopics.ts`). 자리를 옮긴 것은 `MENU.md`.
- **속은 V4의 기능에 맞춰 새로**. V3·V4와 자료를 함께 쓰지 않는다. V4 자료는 한 방향 **가져오기**(8장)로만 읽는다.
- V4의 순수 함수와 그 테스트, 화면 부품은 옮겨 와서 쓴다(처음부터 다시 짜지 않는다).

## 2. 원칙 일곱

V4에서 사고가 났거나 코드가 불어난 자리마다 원칙 하나씩 세운다.

| # | 원칙 | V4에서 무엇을 없애나 |
|---|---|---|
| 1 | **항목 하나 = 문서 하나** | 하루치 배열(`events/{date}`·`journals/{date}`)을 통째로 다시 쓰기, 하루가 지워진 사고(09-22), 저장마다 트랜잭션·서버 확인 읽기 |
| 2 | **id는 바뀌지 않는다** | 이월·메모↔기록 옮기기 때 새 id → 역링크 갈아끼우기, 휴지통 사본, 구글 캘린더 짝 맞추기 |
| 3 | **이름이 아니라 id로 가리킨다** (라벨·학급·학생·항목) | 라벨 이름 바꾸기가 모든 문서를 돎(`labelRename`), `jm_` id, 학생 번호가 바뀌면 기록이 떨어짐 |
| 4 | **계산할 수 있는 것은 저장하지 않는다** | 이월 러너(앱 열 때 옮겨 쓰기), 시간표 적용(수업일마다 덮어쓰기), 기간 일정 날마다 사본·'(1/5)', 알림장·출결 자동 기록 사본과 맞추기(`autoJournalSync`) |
| 5 | **지우기 = 지운 표시** (`deletedAt`) | 휴지통 사본·종류별 되살리기(`trashRestore`), '휴지통에 못 넣으면 안 지움' |
| 6 | **기기 사본 + 바뀐 것만 받기** | 열 때마다 다시 받기, 기간 전체를 내려받는 검색, 오프라인 보기 없음 |
| 7 | **화면은 자료 층만 부르고, 창은 창 목록 한 곳에** | Layout이 창 열림 상태·단축키를 모두 쥠, 화면이 Firestore를 직접 부름, 첫 화면 JS 약 1.4MB |

**V4에서 그대로 지키는 규칙**: 저장 실패는 던진다(칸은 닫지 않는다) · 본문을 읽기·저장 길에서 바꾸지 않는다 ·
칸을 연 순간의 공간·날짜에 저장한다 · 새 창은 `ModalShell`/`PopupFrame` · 설명서·툴팁에 키 조합을 글로 박지 않는다 ·
사용자가 시키지 않은 일에서 구글 로그인 창을 띄우지 않는다.

## 3. 서버와 주소

- **Firebase 프로젝트는 `schoolplannerv3` 그대로.** 로그인 uid, FCM, 함수(서울 `asia-northeast3`), 나이스 키 `sharedConfig/neis`,
  공휴일 `holidays/{year}`를 그대로 쓴다. 무엇보다 **드라이브 `drive.file` 권한이 구글 클라우드 프로젝트(번호)에 묶여 있어**,
  같은 프로젝트에 있어야 V4가 올린 첨부·학생 사진·백업 파일을 V5가 그대로 연다.
- **Firestore는 `(default)` 데이터베이스.** 이름 붙인 데이터베이스는 따로 떼기는 좋지만 무료 사용량이 없다.
  V5 컬렉션은 V3·V4가 쓰지 않는 이름: `spaces`, `spaceInvites`, `v5alarms`.
- **규칙 파일은 하나다.** 기본 데이터베이스의 규칙은 한 벌이라 V5가 규칙을 배포하면 V3·V4 규칙도 그것으로 바뀐다.
  그래서 **V5 저장소 `firestore.rules` = V4 규칙 전부 + V5 블록**이고, P1-2부터 이것이 정본이다.
  V4 `firestore.rules`는 같은 내용의 복사본으로 두고 맨 위에 '정본은 V5 저장소'라고 적는다.
  규칙 검사 `tools/check-rules.mjs`는 V4의 35개 + V5 것을 함께 돌린다. 운영 배포는 사용자에게 묻고 한다.
- **함수는 codebase로 가른다.** V4 = `default`(V4 `functions/`), V5 = `v5`(V5 `functions/`, `firebase.json`에 `"codebase": "v5"`).
  배포는 반드시 `npx firebase deploy --only functions:v5` — codebase를 빼면 V4 함수를 지우려 한다.
- **주소는 Firebase Hosting 새 사이트**(이름은 P1-4, 권장 `schoolplanner-v5` → `https://schoolplanner-v5.web.app`).
  github.io 하위 경로는 V3·V4와 출처가 같아 localStorage를 함께 쓴다. `authDomain`도 그 주소로 두면 로그인 처리(`/__/auth/handler`)가
  같은 출처라 휴대폰 리디렉트 로그인이 안정적이다. 새 주소는 Auth 승인 도메인과 구글 OAuth 클라이언트의 승인된 JavaScript 원본에 더한다(👤).
- **에뮬레이터는 V4와 한 벌을 같이 쓴다**(같은 project id, 같은 포트 Firestore 8080·Auth 9099). 운영과 같게 V3·V4·V5 자료가 한 데이터베이스에
  있으므로 V4 seed 자료로 가져오기를 시험할 수 있다. P1-2부터는 V5 저장소에서 켠다(합친 규칙을 읽게).
- 기기에 두는 열쇠(localStorage·IndexedDB 이름)는 `sp5-`로 시작한다.

## 4. 자료 모양

### 4-1. 공간

`spaces/{sid}` = `{ kind: 'personal'|'group', name, ownerId, members: { [uid]: 'owner'|'member' }, inviteCode?, createdAt, updatedAt, v: 1 }`

- 개인 공간 id = `u_{uid}`(찾지 않고 바로 안다), 그룹 공간 = `g_{id}`.
- **공간마다**(개인·그룹 같다): `items`, `labels`, `series`, `lessonDays`, `timetables`, `evaluations`, `notices`.
- **개인 공간에만**(V4처럼 늘 개인): `classes`, `attendance`, `subjectAttendance`, `seating`, `classHub`, `quiz`, `progress`,
  `settings`, `pushTokens`, `gcalQueue`.
- V4와 다른 점: **라벨이 공간 것**이다. 항목이 라벨을 id로 가리키므로 그룹 구성원이 같은 라벨 목록을 봐야 한다(개인 공간은 V4처럼 내 라벨).

### 4-2. `items/{id}` — 일정·메모·기록

| 칸 | 모양 | 뜻 |
|---|---|---|
| `kind` | `'event'`·`'note'` | 일정 / 메모·기록 |
| `date` | `'YYYY-MM-DD'`·`null` | 일정은 늘 있다. 메모·기록은 날짜가 있으면 그날 **기록**, `null`이면 **메모**(V4 U7 '날짜 칸 = 자리') |
| `endDate` | `'YYYY-MM-DD'`? | 기간 일정의 끝 날(일정만) |
| `text` | string | 본문. 읽기·저장 길에서 바꾸지 않는다 |
| `labelIds` | string[] | 라벨 id |
| `done` / `doneAt` | boolean / number? | 완료 / 완료한 때(ms) |
| `doneDates` | string[]? | 기간 일정의 날마다 완료 |
| `favorite` | boolean? | ★ (메모·기록) |
| `order` | string | 같은 날·같은 목록 안 차례. 분수 인덱스 글자라 하나만 고쳐 끼운다 |
| `time` / `alarmDone` | `'HH:mm'`? / boolean? | 알림 시각(그 항목의 `date` 기준 - 날짜를 옮기면 알림도 따라간다) / 울려서 확인함 |
| `due` | `'YYYY-MM-DD'`? | 기한 |
| `props` | `{ forward?, calendar?, skip?, gcal? }`? | 이 항목만의 속성 값. 없으면 라벨 속성을 따른다(V4와 같다) |
| `carrying` / `carriedFrom` | boolean? / `'YYYY-MM-DD'`? | 이월로 따라오는 중(처음 따라올 때 한 번 쓴다) / 끝낼 때 그날로 옮겨 적으며 남기는 처음 날 |
| `seriesId` / `seriesIndex` | string? / number? | 반복 묶음 |
| `fromDate` | `'YYYY-MM-DD'`? | 기록에서 메모로 뺄 때 그 날('📅 10/6에서') |
| `tables` | EntryTable[]? | 붙인 표(V4 `lib/entryTable` 모양 그대로 - `rows[].cells[]`) |
| `studentIds` | string[]? | 학생 태그 `'{classId}/{sid}'` |
| `attachments` | Attachment[]? | 드라이브 파일(V4 모양: name·url·type·size·driveId) |
| `linkIds` | string[]? | 이은 항목 id. 수업은 `'lesson:{date}:{교시}'` |
| `authorId` | string | 만든 사람(그룹에서 보존) |
| `createdAt` | number | 만든 때(ms) |
| `updatedAt` | Timestamp | **서버 시각.** 기기 사본이 이것으로 바뀐 것만 받는다 |
| `deletedAt` / `deletedBy` | Timestamp·`null` / string? | 지운 표시. **만들 때 `null`을 꼭 넣는다**(없는 칸은 쿼리로 거를 수 없다) |
| `src` | `{ from: 'v4', path, id }`? | 가져온 항목의 V4 자리 - 다시 가져오기, V4가 보낸 구글 캘린더 일정과 짝 |
| `v` | 1 | 자료 판(나중에 모양을 바꿀 때 판으로 가린다) |

### 4-3. `labels/{id}`

`{ kind: 'event'|'note', name, color, parentId: string|null, order, props?, updatedAt, deletedAt, v }`

- `parentId`는 메모·기록 라벨만(2단계). 이름은 같은 종류 안에서 겹치지 않게 저장 때 본다.
- `props`는 일정 라벨만: `{ calendar?, forward?, skip?, gcal?, period?, recur? }` — 화면 이름은 V4 그대로 **달력·이월·수업X·구글 캘린더**
  (UX-AUDIT T2·T6 사용자 결정). `period`·`recur`는 V5에서 '새 일정 칸을 열 때 끝 날·반복 줄을 펴 둔다'는 기본값으로만 쓴다(4-4·5-3).
- 맨 위(order가 가장 앞) 라벨이 새 항목의 기본 라벨이다(V4와 같다).

### 4-4. `series/{id}` — 반복

`{ rule: { freq: 'daily'|'weekly'|'monthly', interval, weekdays?: number[], monthWeek?, monthDay? }, start, until?, count?,
template: { text, labelIds, time?, props? }, imported?: true, updatedAt, deletedAt, v }`

- 항목은 날마다 만들어 둔다(완료·이월·알림·구글 캘린더가 날마다 따로 돌게). 규칙은 '이 날부터 바꾸기·지우기'에 쓴다.
- V4에서 가져온 반복은 규칙을 모르므로 `imported: true`, `rule` 없음(묶음 지우기만 된다).

### 4-5. 수업

| 자리 | 모양 | 뜻 |
|---|---|---|
| `timetables/{id}` | `{ name, from, to, grid: { '1'~'5'(요일): { '<교시>': '국어' \| '5-2 과학' } }, updatedAt, deletedAt, v }` | **기간별 시간표**(1학기·2학기·'10/14부터 바뀐 시간표'). 기간이 겹치면 늦게 시작한 것이 이긴다 |
| `lessonDays/{date}` | `{ periods: { '<교시>': { subject?, memo?, supplies?, attachments?, linkIds? } }, updatedAt, v }` | **그날 바꾼 칸만.** `subject`가 있으면 그 과목(`''`이면 그 교시 수업 없음), 칸이 없으면 시간표를 따른다. 고칠 때는 `periods.3.memo`처럼 그 칸만 |
| `settings/common.periods` | `[{ n, name, start, end }]` | 교시 이름·시각(V4 '수업 시간 명칭' + `v4_periodTimes`를 하나로) |
| `settings/common.terms` | `{ '2026': { sem1: {from,to}, summer: {from,to}, sem2: {from,to}, winter?: {from,to} } }` | 학기·방학(학년도 = 3월~이듬해 2월, V4 `lib/semester` 규칙) |

### 4-6. 학급 (개인 공간)

| 자리 | 모양 |
|---|---|
| `classes/{classId}` | classId = `'{학년도}-{학년}-{반}'`(예 `'2026-5-2'`). `{ year, grade, num, name?, students: [{ sid, num, name, gender?, status: 'active'\|'out', outDate? }], updatedAt, v }` — **학생은 sid로 가리킨다**(번호가 바뀌어도 기록이 따라간다) |
| `attendance/{classId}_{date}` | `{ classId, date, records: { [sid]: { kind, reason, periods?, note? } }, updatedAt }` — 바뀐 학생 칸만 쓴다 |
| `subjectAttendance/{classId}_{date}` | `{ classId, date, periods: { '<교시>': { [sid]: { kind, reason, note? } } }, updatedAt }` |
| `seating/{id}` | V4 `v4_seating` 모양, 학생은 sid |
| `classHub/{classId}` | `{ apart: ['sidA\|sidB'], draw: { picked: [sid], round }, groupSets: {…} }` |
| `quiz/{key}` | 암기 성적(V4 `settings/photoQuiz`) |

### 4-7. 조사표·알림장·진도 (조사표·알림장은 공간마다, 진도는 개인)

- `evaluations/{evalId}`: **조사표 한 장 = 문서 하나** `{ date, period?, classId?, title, type, columns?, values: { [sid]: … }, groups?, subject?, courseId?, updatedAt, deletedAt, v }`
  (V4는 하루 문서의 배열 `list`/`evalList` - 두 이름을 함께 쓰던 것을 없앤다).
- `notices/{date}`: `{ date, lines: string[], updatedAt }`.
- `progress/{planId}`: V4 `v4_progress` 모양 그대로(`key, subject?, classes?, startDate, lessons[], bumps[]`) + `updatedAt, deletedAt`.

### 4-8. 설정 (개인 공간 `settings/`)

- `common`(계정에 하나): 교사 유형 `teaching` · 이월 기간 `forwardDays`(기본 14) · 휴지통 자동 비우기 `trashDays` · 자동 백업 `autoBackup` ·
  우리 학교 `school` · 수업 종 `classBell` · 교시 `periods` · 학기 `terms` · D-Day `ddays` · 관찰 문구 `phrases` · 가져오기 기록 `import`.
- `pc` / `mobile`: 글자 크기·창 위치·시작 화면·단축키·화면 보기(V4 `v4_preferences_pc/_mobile`). 1초 뒤 올린다(V4 `preferenceSync`).
- V4는 V3가 모르는 칸을 지울까 봐 설정을 문서 10여 개로 나눴다. V5는 세 문서다.

### 4-9. 그 밖

- `pushTokens/{id}`: V4 `v4_pushTokens` 모양. `gcalQueue/{itemId}`: `{ at, fails }`(V4는 날짜 큐 - V5는 항목 큐).
- `spaceInvites/{code}`: `{ sid, ownerId }` — 코드를 아는 사람만 하나 읽기(목록 막음).
- `v5alarms/{itemId}`: 함수만 읽고 쓴다(규칙에 없어 앱은 막힘). V4 `v4_alarms`를 항목 하나 단위로.
- 공유 자료 `holidays/{year}`, `sharedConfig/neis`는 V4와 같이 읽기만.

### 4-10. 서버에 묻는 쿼리

화면은 기기 사본에서 고르므로 서버 쿼리는 거의 `updatedAt > 커서` 하나뿐이다(복합 색인이 필요 없다). 함수의 `v5alarms`도 칸 하나(`pendingAt`).

## 5. 계산 규칙 (저장하지 않는 것)

### 5-1. 이월
- **대상**: 일정, 끝내지 않음, 지우지 않음, 이월 판단이 참(V4와 같다: 항목 `props.forward` → 없으면 라벨 `forward`, 끈 것은 안 함),
  `date < 오늘`, 그리고 (`date >= 오늘 - forwardDays` 또는 `carrying`).
- **오늘 화면**: 오늘 것 + 이월 대상을 '↪ 10/5부터'와 함께. **지난 날 화면**: 흐리게 '→ 오늘로'(누르면 오늘).
- **쓰기는 두 번뿐**: 처음 따라올 때 `carrying: true` 한 번(기간이 지나도 계속 따라오게 - V4 '사슬'과 같은 뜻, 어느 기기가 써도 같은 값),
  끝낼 때 `date = 그날`, `carriedFrom = 처음 날`, `carrying` 지움. 앱을 열 때마다 옮겨 쓰는 일은 없다.
- 이월 중인 일정의 구글 캘린더 날짜는 '보이는 날(오늘)'로 보낸다(P8-1). 알림을 어떻게 할지는 P3-3에서 정해 5장 결정 메모에 적는다.

### 5-2. 수업 칸
`그날 n교시 = lessonDays[date].periods[n].subject` (있으면) → 없으면 `수업 없는 날`(V4 `lib/classDays.classOffReason`: 방학·공휴일·수업X 일정·'휴업')이면 없음 →
아니면 그 날짜가 든 시간표의 `grid[요일][n]`. 준비물·메모·첨부·링크는 `lessonDays`에만 있다. 진도(V4 `lib/progress`)는 이 결과를 입력으로 센다.
**'시간표 적용' 단추는 없다** — 시간표를 고치면 그 기간의 날이 저절로 따라간다(그날 바꾼 칸은 그대로).

### 5-3. 기간 일정
항목 하나(`date`~`endDate`). 날마다의 '(2/5)'는 화면에서 센다. 월간·년간 막대는 이 범위를 그대로 그린다.
'이 날만 지우기' = 두 항목으로 나누기, '이 날부터' = 끝 날 당기기, '전부' = 항목 지우기. 날마다 완료는 `doneDates`.

### 5-4. 기록 칸의 알림장·출결
그날 `notices/{date}`가 있으면 '📢 알림장' 카드, 그날 출석부 문서가 있으면 '📋 출결' 카드를 기록 칸에 **계산해서** 보인다.
누르면 원본 칸(알림장·출석부)이 열린다. 검색에도 나온다. V4의 자동 기록 사본(`notice_{date}`·`attendance_…`)과 거꾸로 맞추기는 없앤다.

### 5-5. 그 밖에 사본에서 바로 세는 것
빈 라벨 정리의 쓰임 수, 학생 기록(누가기록 - `studentIds`·`classId`로 모으기), 검색(치는 대로), 반별 진도 현황, 📝·📊 표식.

## 6. 자료 층 (`src/data`)

### 6-1. 쓰기
- 도우미만 쓴다: `create` · `patch` · `remove`(지운 표시) · `restore` · `purge`(영구 - 휴지통에서만) · `batch`. 화면·기능 코드는 `setDoc`을 직접 부르지 않는다.
- 도우미가 늘 넣는 것: `updatedAt: serverTimestamp()`, 만들 때 `deletedAt: null`·`v: 1`·`createdAt`·`authorId`.
- 실패는 `failWithToast`로 **던진다**(V4 규칙). 부르는 칸은 실패하면 닫지 않는다.
- 쓰기마다 **되돌릴 값**(고치기 전 칸 값)을 돌려준다 → 안내의 '되돌리기'와 Ctrl+Z(글 칸 밖)가 한 길이다.
- 문서 둘 이상을 함께 바꿀 때만 `writeBatch`(링크 양쪽, 반복 묶음, 공간 옮기기). 서버에서 읽어 고쳐 쓰는 트랜잭션은 거의 없다.

### 6-2. 기기 사본 (IndexedDB, `idb`)
- DB `sp5-mirror-{uid}`, 공간·컬렉션마다 저장소, 커서 = 받은 `updatedAt`의 가장 큰 값.
- **처음**: 이번 학년도 것부터 쪽을 나눠 받고 나머지는 뒤에서. **그 뒤**: 컬렉션마다 `where('updatedAt', '>', 커서 - 1분)` 구독 하나(겹쳐 받아도 id로 덮으니 괜찮다).
- 받은 것은 사본과 화면 store에 함께 넣는다. 지운 표시도 그대로 받는다(그래서 지우기가 다른 기기에 퍼진다).
- 화면은 **store 고르기**(날짜로·기간으로·라벨로·종류로)만 쓴다. 구독을 화면에서 직접 걸지 않는다.
- **09-22 사고와 다른 점**: 그때는 Firestore SDK 안의 IndexedDB가 고장 나 서버 자료가 멈췄다. V5 사본은 앱이 따로 두는 '먼저 보여 줄 복사본'이고
  Firestore는 V4처럼 `memoryLocalCache`다. IndexedDB가 없거나·지워지거나·막혀도 서버 구독은 그대로 돌고(그때는 V4처럼 메모리로만), 다음에 다시 받는다.
  사본은 "있다/없다"를 판단해 쓰는 데 쓰지 않는다(쓰기는 문서 하나라 읽고 고칠 일이 없다). 점검은 증상이 아니라 구조로 한다(V4 교훈).

### 6-3. 쓰던 글
쓰는 칸의 글은 2초 뒤 IndexedDB `drafts`(이 기기만)에 남긴다. 칸을 다시 열면 '저장하지 않은 글이 있습니다 - 되살리기'. 저장하면 지운다.

## 7. 화면 뼈대 (`src/app`)

### 7-1. 폴더
```
src/
  app/        껍데기: 머리줄·둘째 줄·탭바, 주소, 창 목록, 오른쪽 칸, 단축키, 안내(toast), 다크 모드
  data/       firebase, 저장 도우미(repo), 기기 사본(mirror), store 고르기(select), 되돌리기(undo), id·차례
  domain/     순수 함수 - V4 lib에서 옮긴 것(테스트째): forward·lessons·classDays·semester·progress·seating·draw·groups·
              entryTable·checkLines·hashLabels·quickInput·labelTree·linkPreview·neis·csv·print·dateUtils …
  features/   기능마다 폴더 - 화면·창·훅·테스트. 설명서 장은 features/help/chapters/
  import/v4/  V4 가져오기. 옛 모양 읽기(readEventList 등)는 여기에만 둔다
  ui/         공통 부품: ModalShell·PopupFrame·SidePanelFrame·칩·카드·SlotCombobox·MiniCalendarPicker …
```

### 7-2. 창 목록
모든 창(오른쪽 칸 창·쓰는 칸·가운데 창)을 한 곳에 등록하고, ⋮ 메뉴·학급 화면 도구 카드·하루 수업 머리줄·단축키·설명서 링크가 여기서 읽는다.
```ts
registerWindow({
  id: 'seating',               // = 단축키 id (V4 SHORTCUT_ACTIONS의 id를 그대로)
  title: '자리표', icon: '🪑',
  menu?: '일정' | '수업' | '자료' | '설정',   // ⋮ 구역 (없으면 ⋮에 없다) - MENU.md 3-4
  classTool?: true,            // 학급 화면 도구 카드
  lessonHeader?: true,         // 하루 수업 머리줄 단추
  show?: (mode) => boolean,    // 담임/교과 전담 숨기기 (V4 homeroom·classUnit)
  kind: 'side' | 'panel',      // 오른쪽 칸 창 / 쓰는 칸
  load: () => import('./SeatingWindow'),   // 열 때 싣는다
  help: 'seating',             // 설명서 주제 id
})
openWindow('seating', { classId })        // Layout이 열림 상태를 들지 않는다
```
store의 `windows: [{ key, id, params, openedAt }]` 차례가 오른쪽 칸 탭 차례다. 같은 항목을 다시 열면 그 탭을 보인다.

### 7-3. 주소
`#/day/2026-10-08` · `#/week/2026-10-05` · `#/month/2026-10` · `#/year/2026` · `#/memo` · `#/class/2026-5-2`.
새로고침해도 그 자리, 휴대폰 뒤로가기는 앞 화면(창이 열려 있으면 V4처럼 맨 위 창 하나를 먼저 닫는다). 창은 주소에 넣지 않는다.

### 7-4. 오른쪽 칸·단축키
V4 규칙 그대로(V4 `CLAUDE.md` 5장): 탭, 폭 끌기·두 번 누르기, ESC = 줄 전체(저장 안 한 글은 먼저 묻기), Ctrl+S = 커서가 든 칸(없으면 보이는 탭),
휴대폰 뒤로가기 = 맨 위 하나, 환경설정 '창 위치'로 가운데 창. 단축키는 V4 `lib/shortcuts.SHORTCUT_ACTIONS`를 id째 옮기고 새 id를 더한다(MENU.md 3-8).

## 8. V4 → V5 가져오기 (`src/import/v4`)

### 8-1. 원칙
- **한 방향**: V4를 읽기만 하고 V5에만 쓴다. V3·V4 자료와 코드는 손대지 않는다.
- **결정적 id**: V5 id = V4 자리에서 셈한다(8-2). 그래서 **여러 번 가져와도 겹치지 않고**, 링크도 상대를 찾지 않고 바로 셈한다.
- **다시 가져오기**: V5에서 고친 항목(`updatedAt` > 지난 가져오기)은 덮지 않고 결과 표에 적는다. V4에서 지운 것은 V5에서도 지운 표시.
- **옛 모양 읽기는 여기에만**: V4 `readEventList`·`parseV3EventText`·`normalizeEventLabel`·`readEvalList`·`mergeEntryLabels`·`resolveEventLabelNames`·
  `readLabelTree`를 `import/v4/legacy/`로 테스트째 옮긴다. V5 본체는 이것을 import하지 않는다(테스트로 지킨다).
- 가져온 항목에는 `src: { from: 'v4', path, id }`. 가져오기 기록(때·종류별 수·짝 표)은 `settings/common.import`.
- 드라이브 파일은 옮기지 않고 그대로 가리킨다(같은 프로젝트라 권한이 그대로다).

### 8-2. 결정적 id
`v4id(종류, 공간, 자리, V4 id)` = sha1을 base32로 20자. **주의**: V3가 id 없이 쓴 일정은 V4 `readEventList`가 `ev_차례`를 붙이므로
그날 목록이 바뀌면 차례가 밀린다 - id 없는 항목은 `날짜|글|라벨` 해시로 셈하고, 같은 날 같은 글이 둘이면 몇째인지를 붙인다.

### 8-3. 짝 표

| V4 | V5 | 주의 |
|---|---|---|
| `settings/labels`의 `eventLabels` | `labels`(event, props) | 속성은 V3 이름 먼저(`normalizeEventLabel`), `v4_gcal` → `props.gcal` |
| `memoLabels`·`journalLabels` + `v4_labelTree` | `labels`(note, parentId) | 이름으로 합친다(`mergeEntryLabels`). 짝 표: V4 이름·기록 id·`jm_` → V5 id |
| `{sp}/events/{date}`(`readEventList`) | `items`(event) | 라벨 셋 자리(`label`·`labelIds`·본문 앞 `[이름]` - 등록된 라벨만) → `labelIds`, 본문은 그대로. `time`('YYYY-MM-DDTHH:mm') → `time`, `alarmTriggered` → `alarmDone`, 공휴일 일정(`isHolidayEvent`) 빼기, 이월 사슬(`forwardChainId`·`originalDate`) → `carriedFrom`, 기한(`due` + `v4_eventDue` 사슬) → `due`, `gcal` → `props.gcal` |
| 기간 조각(`groupId` + 글 끝 `(i/n)`) | `items` 하나(`date`~`endDate`) | 글 끝 '(i/n)'를 뗀다, 날마다 완료 → `doneDates`, 조각마다 글이 다르면 합치지 않고 따로(결과 표에) |
| 반복 묶음(`groupId`, '(i/n)' 없음) | `series`(imported) + `items` | 규칙은 모른다 |
| `{sp}/journals/{date}.entries` | `items`(note, date) | 기록 라벨 id → V5 id, `tables`, `attachments`, `completed`·`favorite`, 글 `[표]` → 빈 글, **`notice_`·`attendance_` 자동 기록은 가져오지 않는다**(5-4) |
| `{sp}/tasks/{id}` | `items`(note, `null`) | 라벨 이름 → id, `fromDate`, `keepId`, `order` |
| 항목의 `linkedItems` | `linkIds` | 결정적 id로 바로 셈, 수업 → `'lesson:{date}:{n}'` |
| `{sp}/schedules/{date}` | `lessonDays` | **그 기간 시간표와 같은 칸은 뺀다**(과목이 같고 메모·준비물·첨부·링크가 없으면) - 그래야 시간표를 고치면 따라간다. 옛 문자열 값 읽기 |
| `settings/timetable_v5` | `timetables`·`settings/common.terms` | 템플릿 → 기간(방학 설정으로 학기) |
| `v4_periodTimes` + 설정의 수업 시간 명칭 | `settings/common.periods` | |
| `settings/rosters` | `classes` | 학생마다 새 sid. **번호 → sid 짝 표를 가져오기 기록에** 둔다(다시 해도 같은 sid) |
| `attendance`, `v4_subjectAttendance` | `attendance`, `subjectAttendance` | 번호 → sid |
| `{sp}/evaluations/{date}`(`readEvalList`) | `evaluations` 한 장씩 | `evalList`가 최신, 학생 칸 번호 → sid |
| `{sp}/notices/{date}` | `notices` | |
| `v4_seating`, `v4_classHub`, `settings/photoQuiz` | `seating`, `classHub`, `quiz` | 번호 → sid |
| `v4_progress` | `progress` | 모양 그대로 |
| 기록·메모 글의 학생 태그 `#26040305` | `studentIds` | 글의 태그는 그대로 둔다(본문을 바꾸지 않는다) |
| `settings/preferences.dDayList` | `settings/common.ddays` | |
| `v4_preferences_pc/_mobile`, `v4_teaching`·`v4_classBell`·`v4_school`·`v4_trash`·`v4_autoBackup`·`v4_observationPhrases` | `settings/pc`·`mobile`·`common` | 단축키 id는 그대로라 사용자가 바꾼 키가 이어진다 |
| `groups/{gid}` + 그룹 자료 | `spaces/g_{gid}` + 그 아래 | `members` 배열 → 맵, 구성원 누구나 가져올 수 있다(결정적 id라 겹치지 않음) |
| `trash`, `v4_pushTokens`, `v4_gcalQueue`, `v4_alarms` | 가져오지 않는다 | 휴지통의 것은 V4에서 되살린 뒤 다시 가져오면 된다. 알림·보내기는 기기에서 다시 켠다 |

## 9. 점검

| 무엇 | 언제 |
|---|---|
| `npx vitest run` (단위) | 조각마다. domain 순수 함수는 V4 테스트째 옮긴다. CI도 돈다 |
| 자료 층 테스트(에뮬레이터) | 자료 층을 고칠 때. 규칙·저장 도우미·기기 사본·가져오기. PC에서(CI는 단위만) |
| `tools/check-rules.mjs` | 규칙을 고칠 때마다. V4 35개 + V5 |
| 크롬 점검 `tools/inspect-*.mjs` | 세션마다 바뀐 부분만. **`data-*`로만 찾는다**(화면 글자가 아니라). 심은 자료는 끝에 되돌린다. PC 1400px 크롬 하나 |
| 가져오기 점검 | 가져오기 세션마다: V4 seed → 가져오기 → 종류·수 대조 → 두 번째 가져오기는 '바뀐 것 0' |
| 설명서 점검 | P9-1부터. 여러 세션을 모아 마지막에 한 번 |
| `PARITY.md` | 세션 끝마다 그 세션이 끝낸 기능을 체크 |

## 10. 고치기 전에 확인할 것

1. **문서 하나만 쓰나?** 둘 이상이면 `writeBatch`. 서버에서 읽어 고쳐 쓰기는 피한다.
2. **저장 도우미를 거치나?** (`updatedAt` 서버 시각·`deletedAt: null`·`v` - `setDoc` 직접 금지)
3. **id로 가리키나?** 라벨·학생·학급·항목을 이름이나 번호로 저장하지 않는다.
4. **계산할 수 있는 것을 저장하고 있지 않나?** (5장)
5. **화면이 Firestore를 직접 부르지 않나?** 화면은 store 고르기와 `src/data` 도우미만.
6. **새 창이면 창 목록에 등록했나?** (⋮ 구역·학급 도구·수업 머리줄·단축키 id·설명서 id - `MENU.md`대로)
7. **저장 실패를 던지나? 칸은 실패하면 닫지 않나?** 되돌릴 값을 돌려주나?
8. **본문을 바꾸나?** 읽기·저장 길에서는 바꾸지 않는다.
9. **같은 커밋에서** `DESIGN.md`·`MENU.md`·`PARITY.md`(그리고 P9-1부터는 설명서)를 고쳤나?
10. **점검 스크립트는 `data-*`로 찾나?** 새 단추에 `data-…`를 달았나?
