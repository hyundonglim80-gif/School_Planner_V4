# School Planner V4 — 동작 원리와 기억할 것

V4를 고치기 전에 읽는 안내서. 커밋 기록(약 390개)과 코드를 훑어 **어떻게 움직이는지**와
**왜 그렇게 짜였는지(어떤 사고가 있었는지)**를 모았다. 작업 규칙·사용자 결정은 `CLAUDE.md`,
기능이 어떻게 보여야 하는지는 사용 설명서(`src/lib/helpTopics.ts`)에 있다. 셋이 어긋나면 코드를 보고
어느 쪽이 틀렸는지 가린 뒤 함께 고친다.

마지막 정리: 2026-09-29 (`dc8a3ad` 기준)

---

## 1. 한눈에

| 항목 | 내용 |
|---|---|
| 무엇 | 초·중등 교사용 플래너. 일정·수업(시간표)·기록·메모·학급 운영(명렬표·알림장·출석부·조사표) |
| 기술 | React 19 + TypeScript + Vite + Tailwind 4, 상태는 zustand, 서버는 Firebase(Auth·Firestore) |
| 배포 | `main`에 푸시 → GitHub Actions(`.github/workflows`)가 lint → test → build → GitHub Pages. **테스트가 실패하면 배포되지 않는다** |
| 형제 앱 | `School_Planner_V3`(바닐라 JS). **같은 Firebase 프로젝트 `schoolplannerv3`, 같은 Firestore 경로, 같은 출처(Pages 하위 경로)** 를 쓴다 |
| 라우팅 | 없다. `useAppStore.scope`('day'·'week'·'month'·'year'·'memo')로 화면을 바꾼다 (`App.tsx`) |

V4의 거의 모든 어려움은 **V3와 같은 데이터를 함께 쓴다**는 데서 온다. V3가 쓰는 필드 이름·모양을
바꾸거나 지우면 V3가 깨지고, V3가 쓴 값을 V4가 못 읽으면 "V4에서 사라졌다"는 신고가 온다.

---

## 2. 앱이 뜨는 순서

1. `main.tsx`
   - `watchForBrokenPersistence` / `watchForLeaseFailure` (Firestore 로컬 저장소 고장 감시, 지금은 거의 안전장치)
   - `autoSignIn` — 에뮬레이터 빌드(`VITE_USE_EMULATOR=1`)에서만 점검 계정으로 자동 로그인. 운영 빌드에서는 코드째 빠진다
   - `flushPendingToast` — 새로고침을 건너 맡겨 둔 안내를 띄운다
2. `lib/firebase.ts` — `initializeApp(config, 'SchoolPlannerV4')` (**앱 이름이 V3와 다르다** → 로그인 세션이 V3와 따로 논다),
   `initializeFirestore(..., { localCache: memoryLocalCache() })` (**오프라인 저장소를 쓰지 않는다**, 5장 참고)
3. `App.tsx` — `useAuth`로 로그인 확인 → 없으면 `LoginScreen`. 로그인되면
   - `usePreferenceSync(uid)`: 환경설정을 계정에서 받아 store에 넣고, 바뀌면 다시 올린다
   - `runAutoForwarding(selectedGroupId)`: 이월 (라벨을 다 읽은 뒤 한 번 더 돈다)
   - `useEventAlarms`: 20초마다 알림 시각을 보고 `EventAlarmPopup`
   - `Layout` 안에 scope에 맞는 화면 하나
4. `Layout.tsx` — 머리줄(D-Day·휴지통·검색·화면 탭·공간 선택·⋮ 메뉴·프로필), 둘째 줄(주말·일정·수업 토글, 날짜 이동),
   전역 단축키, 모든 팝업의 자리, 오른쪽 줄(쓰는 칸·팝업), 왼쪽 클립보드 칸

---

## 3. 데이터 모델 (Firestore)

`{sp}` = 공간. 개인이면 `users/{uid}`, 공유 그룹이면 `groups/{gid}`.
**일정·수업·기록·메모·조사표·알림장은 공간을 따른다. 명렬표·출석부·라벨·설정·휴지통은 늘 개인(`users/{uid}`)이다.**

| 경로 | 모양 | 비고 |
|---|---|---|
| `{sp}/events/{YYYY-MM-DD}` | `{ eventList: EventItem[], eventText: string, updatedAt }` | **하루치가 배열 하나.** eventText는 V3용 사본 (4장) |
| `{sp}/schedules/{date}` | `{ periods: { "1": {subject, memo, content, supplies, linkedItems}, … } }` | 수업(교시). 옛 자료는 값이 문자열일 수 있다 |
| `{sp}/journals/{date}` | `{ entries: JournalEntry[] }` | 기록. **하루치가 배열 하나** |
| `{sp}/tasks/{id}` | `{ text, content, labels: string[](이름), completed, favorite, order, attachments, linkedItems, createdAt, keepId? }` | 메모. 문서 하나에 메모 하나 |
| `{sp}/evaluations/{date}` | `{ list, evalList }` | 조사표. V3는 `evalList`로 읽어서 둘 다 쓴다 |
| `{sp}/notices/{date}` | `{ date, lines: string[] }` | 알림장 |
| `users/{uid}/attendance/{학급키}_{date}` | `{ classKey, year, grade, classNum, date, records: {번호: {kind, reason, periods?, note?, name, num}} }` | 출석부. 출석한 학생은 없다(기본이 출석) |
| `users/{uid}/settings/labels` | `{ eventLabels, journalLabels, memoLabels, labels(=eventLabels, V3용) }` | 라벨. **V3와 한 문서를 같이 쓴다** |
| `users/{uid}/settings/preferences` | `{ dDayList, selectedDDayId }` | **V3의 문서.** D-Day만 여기. V4 설정은 쓰지 않는다 |
| `users/{uid}/settings/v4_preferences_pc` / `_mobile` | 단축키·화면 보기·글자 크기·시작 화면·이월 기간·팝업 모양 | V4 전용, PC와 휴대폰 따로 |
| `users/{uid}/settings/timetable_v5` | 시간표 템플릿·방학 기간 | |
| `users/{uid}/settings/rosters` | `{ classList, rosters }` (같은 값) | 명렬표 |
| `users/{uid}/settings/v4_trash` | 휴지통 자동 비우기 기간 | |
| `users/{uid}/trash/{id}` | `{ id, type, originalDateStr, fId, content, data, deletedAt }` | 휴지통. **V3와 같이 쓴다** |
| `groups/{gid}` | `{ name, ownerId, members: uid[], inviteCode }` | 공유 그룹. 내 그룹은 `members array-contains uid`로 찾는다 |
| `inviteCodes/{code}` | `{ groupId }` | 초대 코드 → 그룹. 그룹 목록을 열지 않으려고 따로 둔다 |
| `holidays/{year}` | 공휴일 공유본 | 개발자가 1년에 한 번 채운다. 사용자는 읽기만 |
| `admin/…` | 공공데이터 키 등 | 개발자 계정만 |

일정 항목(`EventItem`)의 주요 필드: `id, content, completed, label(콤마로 이은 이름), labelIds(라벨 id 배열),
calendar/forward/forwardOptOut/period/recur/skip(속성), time/alarmTriggered(알림), groupId(기간·반복 묶음),
forwardChainId/originalDate(이월 사슬), linkedItems, authorId/authorName`.
**모르는 필드도 지우지 않는다** — 저장할 때 `normalizeEventForWrite`가 `...item`으로 넘긴다(V3의 이월 사슬 필드 때문).

링크(`linkedItems`의 한 칸): `{ targetType: 'event'|'schedule'|'journal'|'memo', targetId, targetDate, targetFId('personal'|gid), targetPeriod?, title }`.
**양방향**이다 — 한쪽에 붙이면 상대 쪽에도 역링크를 넣는다(`utils/linkUtils`).

---

## 4. 읽기·쓰기의 원칙 (지난 사고에서 나온 것)

### 4-1. 하루치 배열은 서버에서 읽고, 섞어서 쓴다
일정·기록은 **하루치가 문서 하나의 배열**이다. 캐시로 읽은 목록 위에 새 항목을 얹어 통째로 쓰면,
캐시가 비어 있을 때("문서 없음") 그날 다른 항목이 **휴지통도 거치지 않고** 사라진다(2026-09-22 `5dee78e`).
- 배열을 다시 쓰는 코드는 **트랜잭션**이나 `getDocTrustingServer`/`getDocsFromServer`로 서버 값을 읽는다.
  서버가 답하지 않으면 **저장을 거부**한다.
- `useDayData.saveEventItems`는 트랜잭션 안에서 서버 목록을 다시 읽고, "내가 마지막으로 본 뒤 남이 더한 것"
  (`eventBaselineRef`에 없던 id)을 살려 둔다. 그래서 두 탭·두 기기가 동시에 넣어도 둘 다 남는다.
- 기록(`useDayData.mutateJournals`)도 트랜잭션 안에서 서버의 `entries`를 읽어 **항목 하나만** 더하고·고치고·지운다.
  예전에는 화면이 든 목록으로 통째로 덮어써서, 화면이 아직 못 받은 기록과 V4가 모르는 필드(V3 것)가 지워질 수 있었다.
- 다중 선택 라벨 바꾸기는 `label`과 함께 `labelIds`도 새로 쓴다. label만 바꾸면 옛 라벨이 id로 남아 칩이 둘이 된다.
- 출석부는 바뀐 학생만 `mergeFields`로 고쳐 쓴다(통째로 덮지 않는다). 자동 기록(`lib/autoJournal`)도 트랜잭션.

### 4-2. "없다"는 답을 의심한다
Firestore는 캐시에 없는 문서를 "없다"고 답한다. 그대로 믿으면 라벨이 기본값으로 돌아가고, 하루 일정이 통째로 안 보이고,
이월이 아무것도 옮기지 않는다. `lib/firestoreSubscribe.subscribeDocWithServerFallback`은 "없다"는 답을 받으면
서버에 한 번 직접 묻는다(문서당 한 번). 새 구독을 만들 때도 이것을 쓴다.

### 4-3. 오프라인 저장소를 쓰지 않는다
탭을 연 채 브라우저 기록을 지우면 IndexedDB가 반쯤 남아 Firestore가 조용히 멈췄다(`Failed to obtain primary lease`).
여섯 번 고쳐도 되살아나서 **`memoryLocalCache`로 바꾸고 오프라인 보기를 포기했다**(`89b1be3`).
- "V3엔 보이고 V4엔 없으면" 데이터는 안전하다(화면 문제).
- **에뮬레이터 빌드는 IndexedDB를 만들지 않아 이 종류는 재현되지 않는다.** 구조(IndexedDB가 생기나)로 본다.
- `firestoreRecovery.ts`는 짐작으로 고치지 않는다.

### 4-4. 일정은 두 필드에 같이 쓴다
`events/{date}`의 `eventList`(배열)와 `eventText`(V3 글)는 **반드시 `eventDocPayload()`로 함께** 쓴다.
한쪽만 쓰면 읽기 폴백(`readEventList`: eventList가 비면 eventText를 읽는다)이 지운 일정을 되살리고, 그것이 다시 이월되어 불어났다.

### 4-5. 본문을 읽기·저장 경로에서 바꾸지 않는다
일정 본문 앞 `[…]`를 라벨로 떼어 들고 있다가 그날 무엇이든 저장하면 `[v] 숙제`, `[참고] 공문`의 앞부분이 지워졌다.
새 일정을 V3 글 형식으로 읽어 **여러 줄이면 첫 줄만** 남았다(2026-09-29 `dc8a3ad`에서 고침).
옛 `[라벨] 본문`은 **화면에서만** 나눈다 — `eventDisplayContent(item, eventLabels)`는 등록된 라벨일 때만 뗀다.

### 4-6. 공간을 붙들고 저장한다
오른쪽 쓰는 칸은 **칸을 연 순간의 날짜와 공간**(`EntryPanelTarget.dateStr/groupId`)에 저장한다. 칸을 연 채
다른 날짜·다른 공간으로 옮겨도 그렇다. 새로 만드는 저장 코드도 "지금 보는 공간(`selectedGroupId`)"이 아니라
**그 항목의 공간**을 받아 써야 한다(예: `PeriodModal`의 `groupId`).

---

## 5. 라벨

- 일정 라벨: `{ id, name, color, calendar, forward, period, recur, skip }`. V3는 같은 속성을
  `showInCalendar/isForward/isPeriod/isRecur/isSkip`로 쓴다 — 둘 다 읽는다(`normalizeEventLabel`).
- 항목이 라벨을 드는 자리가 셋이다: `label`(콤마로 이은 이름·id), `labelIds`, 본문 앞 `[이름]`.
  **해석은 `lib/eventLabels.resolveEventLabelNames` 한 곳에서만** 한다(화면마다 따로 풀어 칩이 갈리던 버그).
- 기록 라벨은 **id로** 저장한다(V3가 id로만 찾는다). 메모 라벨은 **이름 배열**.
- 저장할 때 일정은 `label`(이름)과 `labelIds`(id)를 **함께** 고친다. label만 바꾸면 옛 labelIds로 뗀 라벨이 되살아난다.
- `useLabels`는 Firestore → 없으면 V3의 localStorage(`lib/legacyLabels`) 순으로 읽는다. `labelsLoaded` 전에는
  라벨을 모르는 것으로 보고 판단을 미룬다(이월이 특히 그렇다).
- 라벨 이름을 바꾸면 `utils/labelRename`이 저장된 항목의 이름까지 고친다.
- **맨 위 라벨**이 새 일정·기록·메모를 열 때 미리 골라지는 기본 라벨이다.

---

## 6. 일정의 속성과 흐름

### 속성 5가지
| 속성 | 뜻 |
|---|---|
| calendar | 월간·년간 달력에 올린다(`isCalendarVisible`). 판단 차례: 항목 값 → 라벨 속성 → 라벨 없으면 보인다 |
| forward | 이월 대상. **끄는 것은 `forwardOptOut: true`로만** 남긴다(`forward: false`를 굳히면 라벨을 못 읽던 때 만든 일정이 영영 이월되지 않았다) |
| period | 기간 일정. 켜면 `PeriodModal`이 날짜마다 `"내용 (1/5)"`을 만들고 같은 `groupId`로 묶는다 |
| recur | 반복 표시. 만들기는 ⋮ → 반복 일정 등록(`RecurringModal`), 같은 `groupId` |
| skip | 수업X. 시간표를 기간에 덮어쓸 때 그날을 건너뛴다 |

### 이월 (`useDayData.runAutoForwarding`, `lib/forwarding`)
- 앱을 열 때·공간을 바꿀 때·라벨을 다 읽었을 때·지난 날짜 일정을 넣거나 고칠 때 돈다. 공간별로 한 번에 하나만 돈다(`forwardingInFlight`).
- 지난 N일(환경설정 이월 기간, 기본 14) 안에서 `isForwardTarget`이고 미완료인 일정을 **오늘로 옮긴다**(지난 날짜에서는 뺀다).
  사슬 표시(`forwardChainId`/`originalDate`)가 있으면 기간 밖이어도 따라온다.
- 판단은 V3와 같다: `forwardOptOut`이면 안 함 → `forward: true`면 함 → **라벨이 정답**.
- 라벨 문서를 서버에서 못 읽으면 **그 판은 건너뛴다**(기본값으로 판단하면 엉뚱한 일정을 옮긴다).
- "V3를 열면 V4에 나타난다" = V3가 시작할 때 이월해 서버에 써 준 것. **V4가 못 만든 신호**다.

### 묶인 일정 지우기 (`lib/eventGroups`, `useGroupDelete`)
`groupId`가 같은 일정은 날짜 문서를 훑어 찾는다. 지울 때 "이 날만 / 이 날부터 / 전부"를 묻는다.

---

## 7. 화면 구조

### 화면(scope)
- **하루** `DayScreen` = `DaySchedule`(수업) + `DayEvents`(일정) + `DayJournal`(기록). 데이터는 `useDayData(date, groupId)` 하나가 세 구독을 건다.
- **주간·월간·년간** = `useCalendarData(dateStrings, groupId)`로 여러 날짜를 한 번에 읽는다.
  주간은 폭이 넓으면(본문 1200px 이상) 다음 주도 그린다. **읽을 날짜는 폭과 무관하게 늘 두 주** —
  폭에 따라 바꾸면 팝업이 붙어 본문이 좁아지는 순간 다시 읽으며 화면이 '불러오는 중'으로 바뀌어 팝업이 닫혔다(`dc8a3ad`).
- **메모** `MemoScreen` = 왼쪽 라벨 거르개 + 메이슨리 카드. `useMemos(groupId)`.
- 화면 폭 판단은 창이 아니라 **본문 폭**(`useMainWidth`, `@container`)으로 한다. 오른쪽 칸이 열리면 그만큼 좁아진다.

### 오른쪽 줄 (쓰는 칸과 팝업)
- **쓰는 칸**: 메모·기록·일정·알림장·출석부. `useAppStore.entryPanels`(쌓임)에 넣고 `EntryPanelHost`가 그린다.
  화면(페이지)이 아니라 Layout이 그려서 **다른 날짜·화면으로 옮겨도 남는다.** 여는 것은 반드시 `openEntryPanel(target)`.
  - 새 칸은 위에 쌓이고, 먼저 연 칸은 적던 글째 아래로 간다. 같은 항목을 다시 열면 그 칸을 맨 위로(`raisedAt`).
  - 새 항목을 저장하면 그 항목의 수정 칸이 된다(`onCreated`).
  - 칸의 틀은 `SidePanelFrame`: 넓은 화면(768px~)은 화면 옆에 붙고, 좁으면 덮는 배너.
- **팝업**: 모든 팝업은 `ModalShell` 또는 `PopupFrame`(`modalConventions.test.ts`가 지킨다).
  환경설정 > 팝업 모양이 side(기본)면 넓은 화면에서 쓰는 칸과 **같은 오른쪽 줄**(`getSideColumn`, `useSideSlot`)에 선다.
  center면 예전처럼 가운데.
- **층과 닫기** (`hooks/useModalLayer`): 열린 순서대로 z-index. ESC는 오른쪽 줄 전체를 닫는다(쓰는 칸에 저장 안 한 글이
  있으면 먼저 묻는다). 휴대폰 뒤로가기는 맨 위 하나만 — 기록(history)에 표지판 하나를 세우고 `popstate`로 받는다.
  옆에 붙은 칸은 팝업은 아니지만 뒤로가기는 받는다(`useBackLayer`).
- **Ctrl+S**: 커서가 든 칸·팝업만 저장. 커서가 아무 데도 없으면 오른쪽 줄 맨 위 칸.
- **배경 누르기**(좁은 화면): 고친 것이 있으면 저장하고 닫는다. 닫기·✕·ESC는 저장하지 않는다.

### 왼쪽 클립보드 칸
`ClipboardPanel` + `lib/clipboardHistory`. 복사한 것을 **이 기기의 IndexedDB에만** 둔다(계정에 올리지 않는다).

### 전역 단축키
`lib/shortcuts.SHORTCUT_ACTIONS`가 한 곳이다. Layout의 키 처리, 툴팁, 환경설정, 사용 설명서가 모두 여기서 읽는다.
**설명서·툴팁에 키 조합을 글로 박지 않는다**(테스트가 잡는다). 글을 치는 중에는 Ctrl·Alt 없는 단축키가 동작하지 않는다.

---

## 8. 기능별 요점

- **알림장·출석부 ↔ 기록**: 저장하면 그날 기록에 `notice_{date}` / `attendance_{학급키}` 항목을 만들고 고쳐 쓴다(`lib/autoJournal`).
  거꾸로 **기록에서 그 항목을 고치거나 지우면 원본도 따라간다**(`lib/autoJournalSync`, `useDayData`·휴지통 복원이 부른다).
  출결 줄(`5번 김지우 결석(질병) 1·2교시 - 감기`)을 못 읽으면 출석부는 건드리지 않는다.
- **휴지통**: 지우는 것은 모두 `moveToTrash`를 거친다. 복원은 `TrashModal.restoreItem`이 종류별로 원래 자리에 되돌린다.
  영구 삭제 때 첨부도 정리한다. 자동 비우기는 환경설정(기본 끄기).
- **링크**: `LinkerModal`로 고르고, `addReverseLink`/`syncReverseLinks`가 양쪽에 붙인다. 이월로 id가 바뀌면 옛 역링크를 갈아끼운다.
- **메모 ↔ 기록 옮기기**: `lib/moveEntry`. 새 항목 → 역링크 갈아끼우기 → 원본 휴지통. 일정은 옮기지 않는다.
- **첨부·캡처**: 구글 드라이브 `School_Planner` 폴더(`lib/driveApi`). 화면에 그림은 thumbnail 주소로 보인다.
  학생 사진은 공개하지 않고 `Students_Poto/{학년도-학년-반}`에(`lib/studentPhotos`).
- **공휴일**: `holidays/{year}` 공유본 + V3의 `settings/holidays`. 옛 방식으로 events에 들어 있던 공휴일 일정은 `isHolidayEvent`로 가려 목록에서 뺀다.
- **학기**: 방학 기간(시간표 설정)에서 계산한다(`lib/semester`). 학년도는 3월~이듬해 2월.
- **외부 연동**: 구글 캘린더 보내기(`lib/calendarSync`, V3와 같은 캘린더·표시), 구글 시트(`lib/sheetsSync`, V3와 같은 칸 모양),
  JSON·CSV 백업(`BackupModal`), Keep 가져오기(Takeout 파일만, `lib/keepImport`).
- **계정**: V3와 V4는 앱 이름이 달라 한 브라우저에서 다른 계정으로 들어가 있을 수 있다(`lib/peerAccount`).
  "자료가 통째로 없다"는 신고는 먼저 계정·공간을 의심한다.
- **설정 동기화**: `lib/preferenceSync`의 `SYNCED_PREFERENCE_KEYS`만 계정에 올린다. 지금 보는 화면·날짜는 올리지 않는다.

---

## 9. 점검 도구

| 무엇 | 언제 |
|---|---|
| `npx vitest run` | 매 작업. 1000개 남짓. 설명서 연결·단축키 글자·팝업 규칙까지 지킨다 |
| `tools/inspect-scenarios.mjs` | 같은 기능을 여러 조건(공간·날짜·여는 길·자료 모양·칸 상태·두 탭·PC/휴대폰)에서. 점검 자료를 에뮬레이터에 직접 심는다 |
| `tools/inspect-manual.mjs` | 사용 설명서대로 동작하는지 89항목. 여러 작업을 모아 마지막에 한 번 |
| `tools/inspect-*.mjs` 나머지 | 지난 신고를 재현하던 것들(이월·뒤로가기·기록 삭제 뒤 빈 화면·V3/V4 한 출처 등) |
| `tools/seed.mjs` | 에뮬레이터에 한 학년도치 자료 |
| `tools/check-rules.mjs` | 보안 규칙 |

- 환경은 `CLAUDE.md` 2장(에뮬레이터·JDK·사이트 주소). 크롬, PC 1400px / 휴대폰 390px만 본다.
- 두 점검 스크립트 모두 `MATCH=<정규식>`으로 골라 돌린다.
- 에뮬레이터에서 **한 문서만 저장이 6~7초씩** 걸리면 앱 버그가 아니라 남은 잠금이다(점검 브라우저를 저장 중에 끈 탓). 에뮬레이터를 다시 켠다.

---

## 10. 고치기 전에 확인할 것 (체크리스트)

1. **V3가 같은 것을 어떻게 읽고 쓰나?** `../School_Planner_V3/js`에서 같은 필드를 찾아본다. 필드 이름을 바꾸거나 지우지 않는다.
2. **하루치 배열을 다시 쓰나?** 서버에서 읽는가(트랜잭션/`getDocTrustingServer`), 서버가 답하지 않으면 거부하는가.
3. **"없다"를 믿고 있나?** 구독이면 `subscribeDocWithServerFallback`.
4. **본문을 바꾸나?** 읽기·저장 경로에서는 바꾸지 않는다. 보여 주는 것만 바꾼다.
5. **어느 공간·날짜에 저장하나?** 지금 보는 것이 아니라 그 항목의 것.
6. **라벨을 풀어야 하나?** `resolveEventLabelNames` / `eventDisplayContent(item, eventLabels)`만 쓴다.
7. **팝업을 새로 만드나?** `ModalShell`·`PopupFrame`, 쓰는 칸이면 `openEntryPanel`.
8. **단축키나 동작을 바꿨나?** 사용 설명서(`helpTopics.ts`)를 같은 커밋에서 고친다. 키 조합은 글로 적지 않는다.
9. **확인**: 단위 테스트 → 빌드 → 바뀐 부분만 크롬으로(1~2분) → 커밋·푸시.
