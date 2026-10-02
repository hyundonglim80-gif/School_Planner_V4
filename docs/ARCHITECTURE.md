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
**일정·수업·기록·메모·조사표·알림장은 공간을 따른다. 명렬표·출석부·자리표·라벨·설정·휴지통은 늘 개인(`users/{uid}`)이다.**

| 경로 | 모양 | 비고 |
|---|---|---|
| `{sp}/events/{YYYY-MM-DD}` | `{ eventList: EventItem[], eventText: string, updatedAt }` | **하루치가 배열 하나.** eventText는 V3용 사본 (4장) |
| `{sp}/schedules/{date}` | `{ periods: { "1": {subject, memo, content, supplies, linkedItems}, … } }` | 수업(교시). 옛 자료는 값이 문자열일 수 있다 |
| `{sp}/journals/{date}` | `{ entries: JournalEntry[] }` | 기록. **하루치가 배열 하나** |
| `{sp}/tasks/{id}` | `{ text, content, labels: string[](이름), completed, favorite, order, attachments, linkedItems, createdAt, keepId? }` | 메모. 문서 하나에 메모 하나 |
| `{sp}/evaluations/{date}` | `{ list, evalList }` | 조사표. V3는 `evalList`만 읽고 쓴다. V4는 둘 다 쓰고(`evalDocPayload`), 읽기는 `lib/evalList.readEvalList`(둘 다 있으면 `evalList`가 최신) |
| `{sp}/notices/{date}` | `{ date, lines: string[] }` | 알림장 |
| `users/{uid}/attendance/{학급키}_{date}` | `{ classKey, year, grade, classNum, date, records: {번호: {kind, reason, periods?, note?, name, num}} }` | 출석부. 출석한 학생은 없다(기본이 출석) |
| `users/{uid}/settings/labels` | `{ eventLabels, journalLabels, memoLabels, labels(=eventLabels, V3용) }` | 라벨. **V3와 한 문서를 같이 쓴다** |
| `users/{uid}/settings/preferences` | `{ dDayList, selectedDDayId }` | **V3의 문서.** D-Day만 여기. V4 설정은 쓰지 않는다 |
| `users/{uid}/settings/v4_preferences_pc` / `_mobile` | 단축키·화면 보기·글자 크기·시작 화면·이월 기간·팝업 모양 | V4 전용, PC와 휴대폰 따로 |
| `users/{uid}/settings/timetable_v5` | 시간표 템플릿·방학 기간 | |
| `users/{uid}/settings/v4_periodTimes` | `{ times: { "1": { start: "09:00", end: "09:40" }, … } }` | V4 전용. 교시 시각 - 하루 화면의 '지금 몇 교시'(`lib/periodTimes`). `timetable_v5`는 V3와 함께 쓰므로 거기에 칸을 더하지 않았다 |
| `users/{uid}/settings/rosters` | `{ classList, rosters }` (같은 값) | 명렬표 |
| `users/{uid}/v4_seating/{id}` | `{ classKey, name, rows, cols, groupCols, front, seats: {"줄-열": 번호}, off, locked, history: [{at, pairs}] }` | V4 전용. 자리표 한 장(`lib/seating`·`lib/seatingStore`). 학생은 번호로. 짝 쌍은 `"3-15"` 글자(배열 안 배열 불가). 자리는 한 장 통째로 쓴다 |
| `users/{uid}/v4_classHub/{학급키}` | `{ classKey, apart: ["3-15"] }` | V4 전용. 학급마다 하나 - 떨어뜨릴 학생(arrayUnion/Remove로 한 쌍씩). 뽑기·모둠도 여기에 더한다(ROADMAP 8-3·8-4) |
| `users/{uid}/settings/v4_trash` | 휴지통 자동 비우기 기간 | |
| `users/{uid}/settings/v4_school` | `{ officeCode, schoolCode, officeName, name, kind, grade }` (학교를 지우면 `{ updatedAt }`만) | V4 전용. 우리 학교 - 나이스 급식·학사일정(`lib/schoolSetting`, `lib/neis`) |
| `users/{uid}/v4_progress/{id}` | `{ key(시간표 칸 글자), startDate, lessons: [{unit, no, content, supplies}], bumps: ['YYYY-MM-DD#교시'] }` | V4 전용. 진도 관리(`lib/progress`). 수업 문서에는 쓰지 않고 화면에서만 겹쳐 본다. 차시 목록은 `saveProgressPlan`(merge, bumps 빼고), 밀기는 `setProgressBump`(arrayUnion/Remove 한 칸) - 다른 기기에서 민 것을 덮지 않게 |
| `sharedConfig/neis` | `{ key, updatedAt, updatedBy }` | 나이스 인증키. **로그인하면 누구나 읽고** 개발자만 쓴다(`admin/config`는 개발자만 읽어 따로 둠). 없거나 못 읽으면 키 없이 5건씩 나눠 받는다 |
| `users/{uid}/settings/v4_autoBackup` | `{ enabled, intervalDays, keep, lastAt?, lastName?, lastSummary?, folderLink? }` | V4 전용. 드라이브 자동 백업(`lib/autoBackup`, `hooks/useAutoBackup`). PC에서 토큰이 이미 있을 때만 조용히 백업. '나중에'는 기기별 localStorage `sp4_autoBackupSnoozeUntil` |
| (메모·기록 항목의) `tables` | 붙인 표 `[{ id, rows: [{ h?, cells: [{ v, cs?, rs?, x?, s? }] }], cols?, styles?, createdAt }]` | V4 전용 칸. `lib/entryTable` |
| `users/{uid}/settings/v4_labelTree` | `{ memo, journal }` 각각 "하위 이름 → 상위 이름" | V4 전용. 메모·기록 라벨 상위/하위 |
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
- `useDayData.saveEventItems(newList, fromList)`는 트랜잭션 안에서 서버 목록을 다시 읽고, "내가 본 목록(fromList)에 없던 id"
  (그 사이 남이 더한 것)를 살려 둔다. 그래서 두 탭·두 기기가 동시에 넣어도 둘 다 남는다. 내가 고친 항목은 **newList를 만든
  바로 그 목록(fromList)과 객체로 견주어** 가린다. 스냅숏이 오는 즉시 바뀌는 기준과 견주면, 화면이 새 목록을 그리기 전의 저장이
  고치지 않은 항목까지 '고친 것'으로 알고 옛 모습으로 되돌렸다(빠르게 연달아 완료하면 앞의 완료가 풀림, 2026-10-01).
- 기록(`useDayData.mutateJournals`)도 트랜잭션 안에서 서버의 `entries`를 읽어 **항목 하나만** 더하고·고치고·지운다.
  예전에는 화면이 든 목록으로 통째로 덮어써서, 화면이 아직 못 받은 기록과 V4가 모르는 필드(V3 것)가 지워질 수 있었다.
- 일정 지우기(`deleteEventItem`)도 트랜잭션에서 서버 목록의 **그 항목만** 뺀다. 휴지통에 넣지 못하면 지우지 않는다(기록도 같다).
- 하루 화면 밖(주간·월간·년간·미완료 일정 가져오기)에서 일정 하나를 고치거나 지울 때는 `lib/eventDocOps`
  (`updateEventInDoc` / `deleteEventFromDoc`)를 쓴다. 다중 선택(`useAppStore.bulk*`)·기간/반복 등록·묶인 일정 지우기도
  모두 트랜잭션으로 서버의 지금 목록을 읽고 쓴다(날짜가 많으면 나눠서).
- 일정 날짜 옮기기(`eventDocOps.moveEventToDate`)는 **두 날짜 문서를 한 트랜잭션**에서 서버로 읽고, 옛 날짜에서 그 항목만 빼고
  새 날짜 끝에 넣는다. id는 그대로(구글 캘린더 `sp_id`·링크가 id로 알아본다) - 새 날짜에 같은 id(V3의 `ev_0` 등)가 있을 때만 새 id.
  알림은 같은 날 수만큼, 이월 사슬은 그대로. 상대 쪽 역링크는 `applyReverseLink`의 `movedFrom`(옛 id·옛 날짜)으로 그 자리를 고친다.
- 다중 선택 라벨 바꾸기는 `label`과 함께 `labelIds`도 새로 쓴다. label만 바꾸면 옛 라벨이 id로 남아 칩이 둘이 된다.
- 조사표(`useEvaluation.upsertEvaluation/removeEvaluation`)도 트랜잭션으로 그 조사표 하나만 넣고·바꾸고·뺀다.
  예전엔 팝업을 열 때 읽은 목록으로 통째로 써서, 날짜를 바꿔 만든 조사표가 그 날 조사표를 덮었다(2026-10-01).
- 링크 역방향(`linkUtils.addReverseLink`)·휴지통 되살리기(`TrashModal.restoreItem`)도 트랜잭션으로 그 항목 하나만 고친다.
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
읽을 때도 **`data.eventList || []`로 읽지 말고 `readEventList(data)`**. `readEventList`는 id 없는 항목(V3 옛 버전·글만 있는 날의
완료 표시가 쓴 것)에 화면과 같은 `ev_차례` id를 붙인다. 이것 없이 id로 짝을 맞추면 저장 한 번에 일정이 두 벌이 된다(2026-10-01). V3 글만 있는 날에서 eventList만 보면 빈 목록 위에
고쳐 써서 그날 일정이 모두 사라졌다(다중 선택 완료·라벨·삭제, 휴지통 되살리기 - 2026-09-29 고침).

### 4-5. 본문을 읽기·저장 경로에서 바꾸지 않는다
일정 본문 앞 `[…]`를 라벨로 떼어 들고 있다가 그날 무엇이든 저장하면 `[v] 숙제`, `[참고] 공문`의 앞부분이 지워졌다.
새 일정을 V3 글 형식으로 읽어 **여러 줄이면 첫 줄만** 남았다(2026-09-29 `dc8a3ad`에서 고침).
옛 `[라벨] 본문`은 **화면에서만** 나눈다 — `eventDisplayContent(item, eventLabels)`는 등록된 라벨일 때만 뗀다.

### 4-5-1. 저장 함수는 실패를 삼키지 않는다
`useDayData`의 저장·지우기(`saveEventItems`·`addEventItem`·`updateEventItem`·`deleteEventItem`·`savePeriod`·
`add/update/deleteJournalEntry`)는 실패하면 안내(토스트)를 띄운 뒤 `ShownError`(`utils/toast`)를 **던진다**.
예전에는 안내만 하고 삼켜서, 쓰는 칸이 성공으로 알고 '✅ 저장했습니다'를 띄우고 적던 글을 저장된 것으로 여겨
ESC·배경 누르기에 묻지 않고 닫았다(새 일정은 없는 일정의 수정 칸이 되어 글이 화면에서 사라졌다, 2026-10-01 재현).
부르는 쪽은 실패하면 칸을 닫지 않고, 안내는 `showErrorToastOnce`로 한 번만 띄운다.

### 4-6. 공간을 붙들고 저장한다
오른쪽 쓰는 칸은 **칸을 연 순간의 날짜와 공간**(`EntryPanelTarget.dateStr/groupId`)에 저장한다. 칸을 연 채
다른 날짜·다른 공간으로 옮겨도 그렇다. 새로 만드는 저장 코드도 "지금 보는 공간(`selectedGroupId`)"이 아니라
**그 항목의 공간**을 받아 써야 한다(예: `PeriodModal`의 `groupId`).

---

## 5. 라벨

- 일정 라벨: `{ id, name, color, calendar, forward, period, recur, skip }`. V3는 같은 속성을
  `showInCalendar/isForward/isPeriod/isRecur/isSkip`로 쓴다 — 둘 다 읽는다(`normalizeEventLabel`).
  V4는 늘 두 이름을 같게 쓰고(`toSharedEventLabel`) V3는 제 이름만 고치므로, **둘이 다르면 V3 이름을 따른다**.
- 라벨 이름 바꾸기(`utils/labelRename`)는 문서마다 트랜잭션으로 나눠 쓴다(예전 한 번의 일괄 쓰기는 500건을 넘으면 통째로 실패).
- 항목이 라벨을 드는 자리가 셋이다: `label`(콤마로 이은 이름·id), `labelIds`, 본문 앞 `[이름]`.
  **해석은 `lib/eventLabels.resolveEventLabelNames` 한 곳에서만** 한다(화면마다 따로 풀어 칩이 갈리던 버그).
- 기록 라벨은 **id로** 저장한다(V3가 id로만 찾는다). 메모 라벨은 **이름 배열**.
- 저장할 때 일정은 `label`(이름)과 `labelIds`(id)를 **함께** 고친다. label만 바꾸면 옛 labelIds로 뗀 라벨이 되살아난다.
- `useLabels`는 Firestore → 없으면 V3의 localStorage(`lib/legacyLabels`) 순으로 읽는다. `labelsLoaded` 전에는
  라벨을 모르는 것으로 보고 판단을 미룬다(이월이 특히 그렇다).
- 라벨 이름을 바꾸면 `utils/labelRename`이 저장된 항목의 이름까지 고친다.
- **맨 위 라벨**이 새 일정·기록·메모를 열 때 미리 골라지는 기본 라벨이다.
- **상위/하위** (메모·기록만, 2단계, `lib/labelTree`): `settings/labels`에 칸을 더하지 않고 V4 전용 문서
  `v4_labelTree`에 "하위 이름 → 상위 이름"만 둔다. V3가 라벨을 저장할 때 모르는 칸을 지우기 때문이다.
  라벨 관리 창은 id로 다루다 저장할 때 이름으로 바꾼다.
- **거르개** (메모·기록, 2026-09-30): 라벨을 여러 개 고르고(`LabelFilter { labels, withChildren }`), 하나라도 붙은 항목을
  보인다. 상위를 골라도 하위는 들어가지 않고, 상위 앞 '하위 포함' 체크를 켠 상위만 하위까지(`filterLabelSet`).
  메모 화면은 이 거르개를 `memoFilter`로 기억한다. 예전에 라벨 하나를 글자로 기억한 것도 읽는다.
  칩 누르기는 윈도우 탐색기처럼(`clickFilterLabel`): 그냥 = 하나만, Ctrl = 더하기·빼기, Shift = 기준부터 범위(보이는 차례).
  ESC는 고른 라벨을 모두 뗀다(각 화면이 듣는다. 오른쪽 칸·팝업은 Layout의 ESC가 닫는다).
- 라벨 관리 창에서 기록·메모 라벨을 **더할 때 상위도 고른다**. 라벨은 더하는 즉시 저장되므로 트리도 곧바로 저장한다.

---

### 메모·기록의 표 (`lib/entryTable`, 2026-09-30)

- 본문에 붙여넣은 HTML 표(엑셀·한셀·시트·웹)를 `parseClipboardTable`이 격자로 읽는다. 엑셀 서식은 `<style>`의 `.xl` 클래스,
  시트는 칸 style에 있다. 색은 믿을 수 있는 값만(`safeColor`). 칸 3,000개·JSON 200KB까지.
- **엑셀은 표와 함께 그림도 복사한다.** 쓰는 칸의 붙여넣기는 표를 먼저 보고, 표면 그림 올리기로 넘기지 않는다.
- 저장 모양: 배열 안의 배열을 Firestore가 받지 않아 `rows[].cells[]`. 병합된 나머지 자리는 `{ v: '', x: 1 }`.
  같은 서식은 `styles`에 한 번. 저장 전 `tableForSave`로 undefined를 뺀다.
- V3는 `tables`를 모르지만 메모는 updateDoc, 기록은 항목째 들고 다녀 지우지 않는다. 단 V3는 **글·라벨·첨부가 없는 기록을
  그날 저장할 때 뺀다**(viewDay.js 1662) - 그래서 표만 있는 기록은 글을 `[표]`(`TABLE_ONLY_CONTENT`)로 두고, V4는 이 글을 숨긴다.
- 기록을 읽는 곳(`applyJournalData`, `JournalPeekModal`)은 칸을 골라 읽으므로 `tables`를 따로 넣어 두었다.

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
지우기는 휴지통에 넣은 것만, 날짜마다 트랜잭션으로 서버의 지금 목록에서 뺀다(창을 연 채 고민하는 사이 더해진 일정을 지키려고).

### 기간 일정 막대 (`lib/periodBars`, ROADMAP 13)
기간 일정은 날마다 따로 저장된 조각이다. **groupId + 본문 끝 `(i/n)`**으로 알아본다(V3는 `period` 표시를 붙이지 않는다; 반복 일정은
`(i/n)`이 없어 빠진다). 저장된 것은 바꾸지 않고 화면에서만 잇는다. 월간 `MonthGrid`는 **한 주가 한 격자 줄**이고 날짜 칸은 줄 높이를
다 차지하는 subgrid다(1줄 = 날짜·학사일정·수업, 가운데 줄들 = 막대 `PeriodBar`, 마지막 줄 = 그날 일정). 막대는 칸 밖(주 격자)에 있어
칸을 건너 이어지고, 안은 날마다 한 조각이라 누르기·끌기는 그날 조각에 간다. 년간 `YearMonthCard`는 그 달에서 처음 나오는 날에 한 번만
묶어 보인다(`collapsePeriods`). 달력 요약(`useCalendarData.mapEvents`)은 정해진 칸만 옮기므로 `groupId`를 넣었다 - 빠져 있어
월간·년간에서 끌기·지우기가 묶음 범위를 묻지 못했다.

### 휴대폰 월간 (`MonthGrid` compact, `MonthDaySheet`, ROADMAP 15)
휴대폰(`useIsMobile`, 639px 이하) 월간 칸에는 과목 칩이 없다. 날짜·칸 안 일정·기간 막대를 누르면 `MonthScreen`이 `sheetDate`를 정하고
탭바 바로 위에 그날 목록을 띄운다(팝업이 아니라 화면의 일부). 같은 날을 한 번 더 누르면 하루 화면. PC는 그대로.

### 다크 모드 (`src/dark.css`, `lib/theme`, ROADMAP 17)
`html.dark`일 때 Tailwind 색 변수(`--color-*`)의 값만 바꾼다 - 컴포넌트는 그대로. **`src/dark.css`는 손으로 고치지 않고
`node tools/gen-dark-css.mjs`를 고쳐 다시 만든다.** 새 화면에 색을 줄 때는 Tailwind 색 클래스를 쓰고, 꼭 style에 적어야 하면 hex 대신
`var(--color-slate-100)`처럼 변수로 (hex는 어둡게 따라가지 않는다 - 라벨 색처럼 자료인 것은 예외). 흰 글자를 얹는 진한 바탕은 600~900을 쓴다.
설정은 이 기기(`sp4_theme`), 처음 그리기는 `index.html`의 작은 스크립트가 같은 규칙으로 먼저 붙인다.

### 년간 학사력 (`lib/yearSheet`, `features/year/YearSheet`, ROADMAP 14)
년간은 '📅 학사력'(처음)과 '📋 자세히'(예전 `YearMonthCard`) 두 모양이고 고른 것은 이 기기(`sp4_yearView`)에 남는다. 학사력은 읽기 전용에
가깝다: 날짜 칸은 점·막대만(공휴일·D-Day·학사일정·'달력' 일정), 달 아래 목록을 누르면 오른쪽 일정 칸. 수업·기록 표식·끌기·여러 개 고르기는
자세히에만 있다 - **년간에서 날마다의 것을 보는 점검은 `[data-year-view="detail"]`을 먼저 누른다.**

### 인쇄 (`lib/print.printNode`, ROADMAP 12)
찍을 부분을 복제해 `#sp4-print-root`에 넣고 `@media print`로 그것만 찍는다. 용지 방향은 그때만 `@page`(가로·세로)로 붙였다 뗀다.
찍지 않을 단추·줄에는 `data-print-hide`. 쓰는 곳: 주간 A4 가로, 주간학습안내(`lib/weeklyGuide`·`WeeklyGuideModal`, store `openWeeklyGuide`),
출석 누계, 평가 모아 보기, 조사표 한 장. 다크 모드여도 인쇄는 늘 밝다(dark.css가 `@media screen`).

### 일정 옮기기 (`hooks/useEventMove`, `lib/eventDocOps`)
쓰는 칸의 날짜 칸·끌어 놓기·다중 선택이 모두 `useEventMove().requestMove`를 부른다. 묶음(`groupId`)이면 `GroupMoveModal`이
"이 날만 / 이 날부터 / 전부"를 묻고 고른 것을 **같은 날 수만큼** 옮긴다(`moveGroupEvents`: 고치던 일정을 먼저, 나머지는 하나씩 -
한 건 = 두 날짜 문서 한 트랜잭션). 고친 내용(patch)은 고치던 일정에만. 옮겨도 `groupId`는 그대로라 묶인 일정 지우기에 함께 잡힌다.

### 미완료 일정 가져오기 (`ForwardingModal`)
자동 이월과 **같은 판단**(`isForwardTarget`, 라벨을 다 읽은 뒤)으로 지난 N일의 이월 대상을 보여 준다. 오늘로 옮기면
옛 id를 가리키던 역링크를 새 id로 갈아끼운다(자동 이월과 같다). 예전에는 라벨 id가 '전달' 같은 글자인지를 봐서 거의 비어 있었다.

---

## 7. 화면 구조

### 화면(scope)
- **하루** `DayScreen` = `DaySchedule`(수업) + `DayEvents`(일정) + `DayJournal`(기록). 데이터는 `useDayData(date, groupId)` 하나가 세 구독을 건다.
- **주간·월간·년간** = `useCalendarData(dateStrings, groupId)`로 여러 날짜를 한 번에 읽는다.
  주간은 폭이 넓으면(본문 1200px 이상) 다음 주도 그린다. **읽을 날짜는 폭과 무관하게 늘 두 주** —
  폭에 따라 바꾸면 팝업이 붙어 본문이 좁아지는 순간 다시 읽으며 화면이 '불러오는 중'으로 바뀌어 팝업이 닫혔다(`dc8a3ad`).
- **메모** `MemoScreen` = 왼쪽 라벨 거르개 + 메이슨리 카드. `useMemos(groupId)`.
- **학급** `ClassScreen`(ROADMAP 16) = 학급 고르기 + 오늘 출결 + 학급 도구 + 학생 명단. 날짜가 없다(날짜 이동 줄·위아래 밀어 날짜 넘기기 없음).
  도구 창의 열림 상태는 Layout이 쥐므로 화면은 `lib/appActions.runAppAction({ id: 단축키 이름, classKey, num })`으로 부탁한다.
  고른 학급은 `lib/classMemory.rememberHubClass`가 도구들(자리표·뽑기·출석부 등)의 '마지막 학급' 기억에도 넣는다 - 도구를 특정 학급으로
  열려면 먼저 이것을 부르고 `runAppAction`.
  화면 종류를 더하면: store `Scope`·`App`·Layout `scopes`·`scopeOrder`·`MobileTabBar`·`shortcuts`·`COMMAND_META`·`PaletteScope`·
  `useGlobalGestures`·시작 화면(`preferenceSync`·`SettingsModal`).
- 화면 폭 판단은 창이 아니라 **본문 폭**(`useMainWidth`, `@container`)으로 한다. 오른쪽 칸이 열리면 그만큼 좁아진다.

### 오른쪽 줄 (쓰는 칸과 팝업)
- **쓰는 칸**: 메모·기록·일정·알림장·출석부. `useAppStore.entryPanels`(쌓임)에 넣고 `EntryPanelHost`가 그린다.
  화면(페이지)이 아니라 Layout이 그려서 **다른 날짜·화면으로 옮겨도 남는다.** 여는 것은 반드시 `openEntryPanel(target)`.
  - 새 칸은 위에 쌓이고, 먼저 연 칸은 적던 글째 아래로 간다. 같은 항목을 다시 열면 그 칸을 맨 위로(`raisedAt`).
  - 새 항목을 저장하면 그 항목의 수정 칸이 된다(`onCreated`).
  - 일정 칸은 내용 칸이 맨 위(6-4), 그 아래 날짜 칸: 새 일정은 `setEntryPanelDate`로 칸의 날짜(=저장할 날짜)를 곧바로 바꾸고, 고치던 일정은
    저장할 때 옮긴 뒤(`moveEventToDate`) 같은 것으로 새 날짜의 수정 칸이 된다. 칸은 `openedAt`으로 살아 있어 다시 그리지 않는다.
  - 칸의 틀은 `SidePanelFrame`: 넓은 화면(768px~)은 화면 옆에 붙고, 좁으면 덮는 배너.
- **링크 배너**(`LinkViewerModal`): `useAppStore.linkViewers`(쌓임)에 넣고 Layout이 모두 그린다. 같은 항목을 다시 열면
  새로 만들지 않고 `raisedAt`으로 맨 위로(`PopupFrame`의 `raise` → `useSideSlot`·`useModalLayer`). 예전에는 한 개뿐이라 교체됐다.
- **팝업**: 모든 팝업은 `ModalShell` 또는 `PopupFrame`(`modalConventions.test.ts`가 지킨다).
  환경설정 > 팝업 모양이 side(기본)면 넓은 화면에서 쓰는 칸과 **같은 오른쪽 줄**(`getSideColumn`, `useSideSlot`)에 선다.
  center면 예전처럼 가운데.
- **층과 닫기** (`hooks/useModalLayer`): 열린 순서대로 z-index. ESC는 오른쪽 줄 전체를 닫는다(쓰는 칸에 저장 안 한 글이
  있으면 먼저 묻는다). 휴대폰 뒤로가기는 맨 위 하나만 — 기록(history)에 표지판 하나를 세우고 `popstate`로 받는다.
  옆에 붙은 칸은 팝업은 아니지만 뒤로가기는 받는다(`useBackLayer`).
- **▶ 단추**(Layout): 오른쪽 줄이 서 있으면 그 왼쪽 가장자리에 붙는다(왼쪽 클립보드 📋와 짝). `closeAllModals()` + `closeAllEntryPanels()` -
  ESC와 같게 닫지만, 화면들이 따로 듣는 ESC(라벨 거르개 떼기 등)는 건드리지 않는다.
- **Ctrl+S**: 커서가 든 칸·팝업만 저장. 커서가 아무 데도 없으면 오른쪽 줄 맨 위 칸.
- **배경 누르기**(좁은 화면): 고친 것이 있으면 저장하고 닫는다. 닫기·✕·ESC는 저장하지 않는다.

### 왼쪽 클립보드 칸
`ClipboardPanel` + `lib/clipboardHistory`. 복사한 것을 **이 기기의 IndexedDB에만** 둔다(계정에 올리지 않는다).

### 전역 단축키
`lib/shortcuts.SHORTCUT_ACTIONS`가 한 곳이다. Layout의 키 처리, 툴팁, 환경설정, 사용 설명서가 모두 여기서 읽는다.
**설명서·툴팁에 키 조합을 글로 박지 않는다**(테스트가 잡는다). 글을 치는 중에는 Ctrl·Alt 없는 단축키가 동작하지 않는다.

**명령 창**(`CommandPaletteModal`, 기본 Ctrl+K, ROADMAP 6-2): 적은 글을 `lib/commandPalette.buildPaletteItems`가 날짜(`parseDateQuery` -
오늘 기준, 달·날만이면 이번 학년도) → 기능(`SHORTCUT_ACTIONS` + 찾을 말·첫소리) → 늘 맨 아래 통합 검색 차례로 늘어놓는다.
기능은 Layout의 `runShortcut`을 그대로 부르므로 단축키와 늘 같다. `COMMAND_META`가 `Record<ShortcutId, …>`라 **단축키에 기능을 더하면
찾을 말·그림을 채워야 빌드된다**. 검색은 `SearchModal`의 `initialKeyword`로 넘기고 열자마자 찾는다(다른 길로 열면 빈 칸).

---

## 8. 기능별 요점

- **알림장·출석부 ↔ 기록**: 저장하면 그날 기록에 `notice_{date}` / `attendance_{학급키}` 항목을 만들고 고쳐 쓴다(`lib/autoJournal`).
  거꾸로 **기록에서 그 항목을 고치거나 지우면 원본도 따라간다**(`lib/autoJournalSync`, `useDayData`·휴지통 복원이 부른다).
  출결 줄(`5번 김지우 결석(질병) 1·2교시 - 감기`)을 못 읽으면 출석부는 건드리지 않는다.
- **휴지통**: 지우는 것은 모두 `moveToTrash`를 거친다(휴지통 문서 id를 돌려준다). 복원은 `lib/trashRestore.restoreTrashItem`이
  종류별로 원래 자리에 되돌린다 - 휴지통 창과 안내의 '되돌리기'가 같은 길. 영구 삭제 때 첨부도 정리한다. 자동 비우기는 환경설정(기본 끄기).
- **되돌리기**(`lib/undoToast`, ROADMAP 6번): 안내(`showToast`의 action)에 '되돌리기' 단추. 지우기는 `showDeletedToast(글, 휴지통 id)` →
  `restoreTrashIds`(휴지통 문서를 서버에서 읽어 되살린다), 옮기기는 `showMovedToast(글, 그룹, trail)` → `eventDocOps.undoMoves`
  (나중에 옮긴 것부터, 고치던 칸도 `retargetEventPanels`), 다중 선택 완료·라벨은 `showFieldsChangedToast` → `restoreEventFields`
  (고치기 전 칸 값, 없던 칸은 지운다). 그래서 **지우기 함수는 휴지통 id를, 옮기기는 `trail`을 돌려준다** - 새 지우기 길을 만들면 같게.
  목록을 구독하지 않고 들고 있는 창(조사표)은 `afterRestore`로 다시 읽는다. 일정 한 건의 완료는 칩을 다시 누르면 되므로 안내가 없다.
- **링크**: `LinkerModal`로 고르고, `addReverseLink`/`syncReverseLinks`가 양쪽에 붙인다. 이월로 id가 바뀌면 옛 역링크를 갈아끼운다.
- **메모 ↔ 기록 옮기기**: `lib/moveEntry`. 새 항목 → 역링크 갈아끼우기 → 원본 휴지통. 일정은 옮기지 않는다.
- **첨부·캡처**: 구글 드라이브 `School_Planner` 폴더(`lib/driveApi`). 화면에 그림은 thumbnail 주소로 보인다.
  학생 사진은 공개하지 않고 `Students_Poto/{학년도-학년-반}`에(`lib/studentPhotos`).
- **공휴일**: `holidays/{year}` 공유본 + V3의 `settings/holidays`. 옛 방식으로 events에 들어 있던 공휴일 일정은 `isHolidayEvent`로 가려 목록에서 뺀다.
- **학기**: 방학 기간(시간표 설정)에서 계산한다(`lib/semester`). 학년도는 3월~이듬해 2월.
- **수업이 없는 날**: `lib/classDays.classOffReason` 하나로 정한다 - 방학, 공휴일(`holidays/{연도}`+V3 개인 공휴일, V3 시절 '공휴일'
  라벨 일정), 수업X 일정(일정의 skip이 먼저, 없으면 라벨 - V3 일정은 labelIds만 있다), 내용에 '휴업'. 시간표 적용과 진도 세기가 쓴다.
  주말은 부르는 쪽이 정한다. (2026-10-01 전에는 시간표 적용이 공휴일·V3 수업X 라벨을 안 봐서 그날에도 과목을 채웠다)
- **진도 관리**(`lib/progress`, ROADMAP 5번): 시간표 칸 글자마다 차시 목록. 시작일부터 수업 문서에 **실제로 적힌** 그 글자의 교시를
  날짜·교시 차례로 세어 k번째 = k번째 차시(`computeProgress`), 수업이 없는 날은 건너뛰고 민 교시(bumps)는 차시를 받지 않는다.
  수업·일정 문서는 범위 쿼리 두 개로 읽기만 한다(`subscribeProgressInputs`, 개인 공간만). 같은 칸 글자의 진도가 둘이면
  늦게 시작하는 쪽이 그날부터 이어받는다(`progressUntil`). 창은 `ProgressModal`(⋮ 메뉴·시간표 설정, store `isProgressModalOpen`),
  훅은 `hooks/useProgress`. 지우면 휴지통 type `progress`(V3는 'V4에서 복원'으로 둔다).
  수업 칸에 겹쳐 보기는 `useProgressMarks`(slotId → 진도) - 하루 교시 카드·'N교시 수정' 팝업은 `ProgressMarkLine`(밀기·되돌리기),
  주간 교시 칸은 '5/12' 표식만. **개인 공간에서만, 진도가 있을 때만** 수업·일정 문서를 읽고, 범위는 가장 이른 시작일 ~ 보는 날의
  학년도 끝으로 묶어 날짜를 넘길 때 다시 읽지 않는다. 알림장 '다음 수업일 불러오기'는 그 교시 줄에 차시 준비물을 합친다
  (`suppliesByPeriod` → `notices.draftLinesFrom`, 개인 공간 알림장만).
- **작년 이맘때**(ROADMAP 7): 주간 화면 '🕰️ 작년 이맘때'(store `showLastYear`, 이 기기에만). 같은 주는 **학년도 몇째 주**
  (`lib/lastYearWeek` - 개학 주 = 1주, 3월 2일이 주말이면 다음 월요일. 364일 빼기는 해에 따라 한 주 어긋난다). 작년 자료는
  `hooks/useLastYearWeek`가 켤 때만 서버에서 읽고(구독 안 함, 못 읽으면 빈 날로 보이지 않게 '못 읽었습니다'), 요일 카드 아래
  `features/week/LastYearDay`가 흐리게 그린다. 이번 주 줄에만. 골라서 '올해로 가져오기'(`lib/lastYearImport`)는 올해 같은 요일에
  **새 복사본**(새 id, 글·라벨·속성 - 알림·링크·첨부·groupId·이월 사슬은 빼고)을 날짜마다 트랜잭션으로 더한다. 그날 같은 글이 있으면
  건너뛰고, 되돌리기는 가져온 id만 뺀다. 첨부를 복사하지 않는 까닭: 두 항목이 같은 드라이브 파일을 가리키면 한쪽을 영구 삭제할 때
  다른 쪽 파일까지 지워진다.
- **자리표**(ROADMAP 8): `SeatingModal`(⋮ 학급 운영, 단축키 id `seating`). 셈은 `lib/seating`(순수 함수 - 짝 = 같은 줄·바로 옆·같은 분단,
  0줄이 교탁 쪽 앞줄, 교탁 아래면 180도 돌려 그린다), 저장은 `lib/seatingStore`. 섞기는 고정 칸을 두고 앞줄부터 채운 뒤 무작위로 여러 번 놓고
  두 자리씩 바꿔 보며 떨어뜨릴 학생 > 지난 짝 > 남녀 짝 차례로 덜 어기는 쪽을 고른다(`shuffleSeats`). 고칠 때마다 곧바로 저장하고
  화면은 구독으로 최신 자리표를 든다. 섞기·번호 차례는 안내의 되돌리기(섞기 전 seats·history), 지우기는 휴지통 type `seating`.
  **학생 칸**(8-2, `SeatStudentCard`): '자리 고치기'가 꺼진 채 학생 자리를 누르면 연다. 새 문서 없이 **있는 저장 길만** 쓴다 -
  출결은 `classHubStore.saveStudentAttendance`(서버에서 그날을 읽어 그 학생만 → `saveAttendanceDay` → `SOURCE_CHANGED_EVENT`),
  조사표는 지금 공간 오늘 문서를 트랜잭션으로 읽어 그 조사표의 그 학생 칸만(`saveStudentEval`, 두 이름 `evalDocPayload`),
  관찰 한 줄은 개인 공간 오늘 기록에 `글 #태그` 한 항목(`addJournalLine`). 자리의 오늘 출결은 출석부 문서 구독.
  저장은 칸 안에서 하나씩 차례로, 누른 값은 덧씌움으로 먼저 보인다(출결은 저장이 끝나면, 조사표는 구독이 같은 값을 받으면 걷는다).
  **발표자 뽑기**(8-3, `SeatDrawPanel`·`DrawBigView`, 훅 `useStudentDraw`, 셈 `lib/draw`): 학급 허브의 `draw{picked, round}`를 구독한 값으로
  셈해 뽑고 곧바로 저장(뽑은 번호 하나씩 arrayUnion, 새 판만 통째로 - `seatingStore.saveDrawPick`). 오늘 결석은 출석부 구독에서.
  자리표 없이도 돈다(뽑기 칸은 자리표 분기 밖). ⋮ 메뉴 '발표자 뽑기'는 Layout의 `seatingDrawRequest`를 늘려 뽑기 칸을 편다.
  **모둠**(8-4, `SeatGroupsPanel`, 셈 `lib/groups`): 학급 허브 `groupSets`(id → 한 벌, 한 벌씩 merge·deleteField, 지우면 휴지통 `groupSet`).
  모둠 칸이 열린 동안 `onShown`으로 받은 모둠을 자리에 칠한다. 조사표 만들기(`EvaluationModal`)의 '조 나누기'가 같은 허브를 구독해
  고른 모둠을 `evalGroupsFrom`으로 조사표 `groups`(V3와 같은 {name, members})에 넣는다.
- **학생 카드·평가 모아 보기**(ROADMAP 9): 조사표를 학년도 범위로 모아 읽기만 한다(`lib/evalArchive.loadClassEvals` - `rosterMeta`가
  그 학급인 것, 개인 + 지금 고른 그룹). 칸 값은 `lib/evalSummary.studentEvalCell`(구글 시트 내보내기와 같은 규칙). 학생 누가기록 위의
  카드와 '📊 평가' 갈래, `EvalOverviewModal`(학생 × 조사표 표, 교과·학기·유형 거르기, CSV·표 복사)이 이것을 쓰고,
  조사표를 누르면 `openEvaluationModal(…, evalId)`로 그 조사표를 바로 연다. 모아 보기는 조사표 창이 닫히면 다시 읽는다.
- **관찰 빨리 적기**(ROADMAP 10): 기록 쓰는 칸의 `@이름` → `#태그`(`lib/mention`, 목록 `StudentMentionList` - 키보드는 글 칸이 받는다).
  관찰 문구 단추(`ObservationPhrases`, 문구는 `settings/v4_observationPhrases`)는 자리표 학생 칸·학생 누가기록 카드에서 개인 공간 오늘 기록에
  `문구 #태그` 한 줄(`classHubStore.addJournalLine`, 되돌리기는 `removeJournalLine`).
- **빠른 입력·기한**(ROADMAP 11): 새 일정 칸이 적는 대로 `lib/quickInput`으로 날짜·시각·#라벨·매주·…까지를 알아보고 `QuickInputChips`로 보인다 -
  누를 때만 넣고 그 말을 글에서 뺀다. 기한은 일정 칸 `due`(V4 전용) + 이월 사슬마다 `settings/v4_eventDue`(`lib/eventDueStore`) - V3 이월은
  정해진 칸만 옮겨 due가 빠지므로 사슬 id로 찾는다(`lib/eventDue.dueOf`). **일정에 새 칸을 더하면** V4 이월 사본(`doAutoForwarding`)·
  `addEventItem`·주간 요약(`useCalendarData.mapEvents`)이 정해진 칸만 옮기는지 본다.
- **나이스 급식·학사일정**: 표시만 한다(`hooks/useNeis`, 일정 문서에 쓰지 않는다). 학사일정 이름을 누르면 `SchoolEventModal`
  (store `schoolEventPeek`, Layout이 그린다): 'D-Day로'는 `useDDay.addDDay`, '일정으로 담기'는 새 일정 칸을 `draftText`로 연다 -
  저장은 늘 일정 칸이 한다. 방학 기간 채우기는 `schoolSetting.findVacations`(방학식 다음 날 ~ 개학식 전날, 저장은 따로).
- **외부 연동**: 구글 캘린더 보내기(`lib/calendarSync`, V3와 같은 캘린더·표시), 구글 시트(`lib/sheetsSync`, V3와 같은 칸 모양),
  JSON·CSV 백업(`BackupModal`), Keep 가져오기(Takeout 파일만, `lib/keepImport`).
- **다른 앱에서 공유받기**(Web Share Target, 안드로이드 설치본만): `manifest.json`의 `share_target`(POST multipart, title·text·url·files) →
  `public/sw.js`의 `receiveShare`가 캐시 `sp4share-inbox`에 넣고 `index.html?share=<id>`로 넘긴다 → `Layout`의 `useShareReceiver`가
  `lib/shareTarget.takeSharedPayload`로 꺼내(주소·캐시에서 지운다) **개인 공간 새 메모 칸**을 `draftText`·`draftFiles`로 연다. 저장은 늘 칸이 한다.
  파일은 `EntryDrawer`의 '📥 공유받은 파일'에서 사용자가 눌러야 드라이브에 올린다(누르지 않은 때 구글 로그인 창이 막히므로). 캐시 이름·열쇠는 sw.js와 같아야 한다.
  **앱 아이콘은 PNG**(`public/icon-192·512·maskable-512.png`, `tools/gen-icons.mjs`가 favicon.svg로 만든다) - SVG뿐이면 안드로이드가
  진짜 앱(WebAPK)이 아닌 바로가기로 깔아 공유 목록에 안 나올 수 있다. 이미 깔린 앱은 크롬이 바뀐 매니페스트를 하루쯤 뒤에야 받아 오므로
  **매니페스트를 바꾼 기능은 '지우고 크롬에서 다시 설치'를 함께 안내한다**(2026-10-02 공유 목록에 안 나오다 다시 설치하니 보였다).
  매니페스트 점검은 크롬 CDP `Page.getAppManifest`(오류·share_target·아이콘을 그대로 보여 준다).
- **계정**: V3와 V4는 앱 이름이 달라 한 브라우저에서 다른 계정으로 들어가 있을 수 있다(`lib/peerAccount`).
  "자료가 통째로 없다"는 신고는 먼저 계정·공간을 의심한다.
- **설정 동기화**: `lib/preferenceSync`의 `SYNCED_PREFERENCE_KEYS`만 계정에 올린다. 지금 보는 화면·날짜는 올리지 않는다.

---

## 9. 점검 도구

| 무엇 | 언제 |
|---|---|
| `npx vitest run` | 매 작업. 1000개 남짓. 설명서 연결·단축키 글자·팝업 규칙까지 지킨다 |
| `tools/inspect-scenarios.mjs` | 같은 기능을 여러 조건(공간·날짜·여는 길·자료 모양·칸 상태·두 탭·PC/휴대폰)에서. 점검 자료를 에뮬레이터에 직접 심는다 |
| `tools/inspect-event-move.mjs` | 일정 날짜 옮기기 - 쓰는 칸·묶음 범위 창·주간/월간 끌기·다중 선택을 크롬으로 누르고 서버를 확인(26항목) |
| `tools/inspect-undo.mjs` | 안내의 되돌리기 - 일정·기록·메모 지우기, 칸에서 옮기기, 다중 선택 완료·삭제, 메모 완료, 마우스 올려 두기(19항목) |
| `tools/inspect-command-palette.mjs` | 명령 창 - 날짜로 가기(하루·주간에 남기)·기능 열기(첫소리)·통합 검색 넘기기·⋮ 메뉴·ESC(19항목). 자료를 심지 않는다 |
| `tools/inspect-more-menu.mjs` | ⋮ 메뉴 구역(`Layout.moreMenuSections`) - 구역 차례·제목·항목, 항목마다 창이 열리는지(29항목). 자료를 심지 않는다 |
| `tools/inspect-event-panel-order.mjs` | 일정 칸 차례 - 새 일정·수정 칸 모두 내용 칸이 맨 위, 열자마자 커서(7항목). 만든 일정은 지운다 |
| `tools/inspect-check-lines.mjs` | 메모 카드의 ☐/☑ 줄 - 누르면 서버 글에서 그 줄 글자만 바뀌는지, 쓰는 칸이 안 열리는지(10항목). 메모를 심고 지운다 |
| `tools/inspect-notice-share.mjs` | 알림장 📤 공유 - 넘기는 제목·글, 창을 닫을 때·막힐 때(복사)·공유 창이 없을 때(10항목). 공유 창은 흉내, 저장하지 않는다 |
| `tools/inspect-memo-open.mjs` | 메모 화면을 열 때 - 즐겨찾기가 없으면 전체로, ☆가 생기면 다시 즐겨찾기로(8항목). 계정 즐겨찾기를 잠시 떼고 되돌린다 |
| `tools/inspect-last-year.mjs` | 작년 이맘때 - 토글·학년도 같은 주(2029 1주 ↔ 2028 1주)·V3 글만 있는 날·올해로 가져오기(서버 복사본·올해 있음·되돌리기·두 번 가져오기)·주 넘기기·명령 창(33항목). 자료는 2028-02-28 주·2029-02-26 주에 심고 지운다 |
| `tools/inspect-seating.mjs` | 자리표 - 만들기(전출 빠짐)·끌어 바꾸기·눌러 바꾸기·고정·책상 없음·떨어뜨릴 학생·섞기(서버 조건)·되돌리기·모양·지우기·명령 창(42항목). 점검용 학급(2030-9-9)을 더하고 끝에 뺀다 |
| `tools/inspect-seat-student.mjs` · `inspect-draw.mjs` · `inspect-groups.mjs` | 자리표 학생 칸(36)·발표자 뽑기(33)·모둠(32) |
| `tools/inspect-student-card.mjs` · `inspect-eval-overview.mjs` | 학생 카드(15)·평가 모아 보기(24) |
| `tools/inspect-observe.mjs` | 기록 칸 `@이름` 태그·관찰 문구 단추(22) |
| `tools/inspect-quick-input.mjs` · `inspect-due.mjs` | 빠른 입력 칩(20)·기한(17) |
| `tools/inspect-print.mjs` | 인쇄 틀·주간 A4·주간학습안내·출석 누계·평가 모아 보기·조사표 한 장(30) |
| `tools/inspect-period-bars.mjs` | 기간 일정 막대 - 월간 한 막대·년간 한 번(15) |
| `tools/inspect-year-sheet.mjs` | 년간 학사력(19). 날마다의 표식을 보는 다른 점검은 `[data-year-view="detail"]`을 먼저 누른다 |
| `tools/inspect-mobile-month.mjs` | 휴대폰 월간(12, 390px - 휴대폰 항목이라 이 폭만) |
| `tools/inspect-class-screen.mjs` | 학급 탭(13) |
| `tools/inspect-dark.mjs` | 다크 모드(11) |
| `tools/inspect-share-target.mjs` | 다른 앱에서 공유받기 - 서비스 워커 POST·새 메모 칸·파일 목록·GET·새로고침(16). 안드로이드 공유 창 대신 같은 모양의 양식을 보낸다 |
| `tools/inspect-progress.mjs` | 진도 관리 - 시간표 적용 건너뛰기·진도 관리 창·수업 칸 겹쳐 보기·밀기·알림장 준비물·V3 옛 문서·그룹 공간(39항목). 자료는 2027-03에 심고 지운다 |
| `tools/inspect-manual.mjs` | 사용 설명서대로 동작하는지 89항목. 여러 작업을 모아 마지막에 한 번 |
| `tools/inspect-*.mjs` 나머지 | 지난 신고를 재현하던 것들(이월·뒤로가기·기록 삭제 뒤 빈 화면·V3/V4 한 출처 등) |
| `tools/seed.mjs` | 에뮬레이터에 한 학년도치 자료 |
| `tools/check-rules.mjs` | 보안 규칙 |

- 환경은 `CLAUDE.md` 2장(에뮬레이터·JDK·사이트 주소). 크롬, PC 1400px / 휴대폰 390px만 본다.
- 두 점검 스크립트 모두 `MATCH=<정규식>`으로 골라 돌린다.
- seed는 날짜마다 자료가 무작위라 **오늘 기록·일정이 없을 수 있다.** 기록 칸 거르개 줄처럼 항목이 있어야 보이는 것은
  점검 스크립트가 항목을 먼저 만든 뒤에 본다(2026-09-30 `inspect-label-tree`가 그래서 멈췄다).
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
9. **저장이 실패하면?** 저장 함수는 삼키지 말고 던진다(`failWithToast`). 칸은 실패하면 닫지 않는다.
10. **확인**: 단위 테스트 → 빌드 → 바뀐 부분만 크롬으로(1~2분) → 커밋·푸시.
11. **일정에 새 칸을 더하나?** V4 이월 사본(`doAutoForwarding`)·`addEventItem`·주간 요약(`useCalendarData.mapEvents`)이 정해진 칸만 옮긴다 -
    셋에 더한다. V3 이월(`forwarding.js`)도 정해진 칸만 옮기니, V3가 빼먹는 칸은 `forwardChainId`로 찾게 한다(기한 `v4_eventDue`처럼).
12. **새 지우기·옮기기 길인가?** 지우기 함수는 휴지통 id, 옮기기는 `trail`을 돌려주고 안내는 `showDeletedToast`/`showMovedToast`(되돌리기).
13. **새 기능(창)을 더하나?** ⋮ 메뉴 `Layout.moreMenuSections`의 알맞은 구역에 한 줄, 단축키(`SHORTCUT_ACTIONS`), 명령 창 `COMMAND_META`
    (빠지면 빌드가 안 된다). 화면 종류를 더하면 7장 '화면 종류를 더하면' 목록을 모두.
14. **색을 주나?** Tailwind 색 클래스, style이면 `var(--color-…)`(hex는 다크 모드에서 안 바뀐다). `src/dark.css`는 `tools/gen-dark-css.mjs`로만.
15. **인쇄할 화면인가?** `lib/print.printNode`, 찍지 않을 것에 `data-print-hide`.
16. **매니페스트·서비스 워커를 바꾸나?** 설치된 앱은 늦게 받는다 - 사용자에게 '다시 설치'를 함께 알린다(8장 공유받기).
