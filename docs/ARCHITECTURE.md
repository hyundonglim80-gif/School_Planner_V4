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
   - `useTeachingModeSync(uid)`: 교사 유형 문서(`v4_teaching`)를 store에 (`useTeachingMode()`로 읽는다)
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
| `{sp}/journals/{date}` | `{ entries: JournalEntry[] }` | 기록. **하루치가 배열 하나**. 항목의 `completed`·`favorite`는 V4 전용(19번 U6 - V3는 항목을 펼쳐 들고 다녀 지우지 않음을 V3 코드로 확인) |
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
| `users/{uid}/settings/v4_teaching` | `{ unit:'subject'\|'class', hasHomeroom, homeroomClass:'5-2', subjects:[], classes:['5-1'], classColors:{} }` | V4 전용. 교사 유형(`lib/teachingMode`) - 문서가 없으면 초등 담임(`unit:'subject', hasHomeroom:true`)이고 하루 화면에 처음 안내 띠. App이 한 번 구독해 store에 넣고 화면은 `useTeachingMode()`로만 읽는다. 과목·가르치는 반(`classes`, 19번 U1 - 시간표·명렬표에 없는 반을 미리 적어 두는 곳)은 `arrayUnion/Remove`. 수업마다의 반은 시간표·수업 칸 글자 `5-2 과학`에 담는다 - `lib/teachingSlot`(`parseSlot`·`normalizeSlotText`·`classesForYear`)로 읽고, 교과 모드에서만 시간표 창·하루 수업 칸·수업 수정 팝업이 저장 전에 정규화한다(`SlotCombobox` ▼ 목록 = `useSlotOptions`). 초등 담임은 적은 그대로 |
| `users/{uid}/v4_subjectAttendance/{classKey}_{date}` | `{ classKey, year, grade, classNum, date, periods: { '교시': { '번호': { num, name, kind: 'absent'(결과)·'late'·'early', reason, note? } } }, updatedAt }` | V4 전용. 교과 출결(`lib/subjectAttendance`·`subjectAttendanceStore`, 교과 모드 S6). 담임 출석부(`attendance`)와 따로 - 기록 칸을 만들지 않는다. 쓰기는 `saveSubjectRecord`가 학생 한 칸(`FieldPath('periods', 교시, 번호)`)만 mergeFields, 지우기는 deleteField |
| `users/{uid}/v4_progress/{id}` | `{ key(시간표 칸 글자), startDate, lessons: [{unit, no, content, page, supplies}], bumps: ['YYYY-MM-DD#교시'], subject?, classes?: ['5-1',…] }` (subject·classes가 있으면 과정 - key에는 첫 반 열쇠) | V4 전용. 진도 관리(`lib/progress`). 수업 문서에는 쓰지 않고 화면에서만 겹쳐 본다. 차시 목록은 `saveProgressPlan`(merge, bumps 빼고), 밀기는 `setProgressBump`(arrayUnion/Remove 한 칸) - 다른 기기에서 민 것을 덮지 않게 |
| `sharedConfig/neis` | `{ key, updatedAt, updatedBy }` | 나이스 인증키. **로그인하면 누구나 읽고** 개발자만 쓴다(`admin/config`는 개발자만 읽어 따로 둠). 없거나 못 읽으면 키 없이 5건씩 나눠 받는다 |
| `users/{uid}/settings/v4_autoBackup` | `{ enabled, intervalDays, keep, lastAt?, lastName?, lastSummary?, folderLink? }` | V4 전용. 드라이브 자동 백업(`lib/autoBackup`, `hooks/useAutoBackup`). PC에서 토큰이 이미 있을 때만 조용히 백업. '나중에'는 기기별 localStorage `sp4_autoBackupSnoozeUntil` |
| (메모·기록 항목의) `tables` | 붙인 표 `[{ id, rows: [{ h?, cells: [{ v, cs?, rs?, x?, s? }] }], cols?, styles?, createdAt }]` | V4 전용 칸. `lib/entryTable` |
| `users/{uid}/settings/v4_labelTree` | `{ entry, memo, journal }` 각각 "하위 이름 → 상위 이름" (19번 U5부터 셋이 같다 - entry가 정본) | V4 전용. 메모·기록 라벨 상위/하위 |
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
- **거르개** (메모·기록, 2026-09-30 → 19번 U8 2026-10-07): 라벨을 여러 개 고르고(`LabelFilter { labels, others }`), 하나라도 걸리는
  항목을 보인다(`matchEntry`): **상위를 고르면 하위도**, `others`(상위 이름)는 가상 칩 '기타' = 그 상위가 붙고 하위는 없는 항목.
  칩 열쇠는 라벨 이름 또는 `otherKey(상위)`(Shift 범위 `filterChipOrder` = 상위 → 하위 → 기타). 하위는 화면을 열면 접힘.
  메모 화면은 거르개를 `memoFilter`로 기억한다 - 옛 `{ labels, withChildren }`·글자 하나도 `readLabelFilter`가 읽는다(withChildren은 버림).
  기록 거르개는 기록에 붙은 라벨을 모두 본다(예전엔 첫 라벨만).
  칩 누르기는 윈도우 탐색기처럼(`clickFilterLabel`): 그냥 = 하나만, Ctrl = 더하기·빼기, Shift = 기준부터 범위(보이는 차례).
  ESC는 고른 라벨을 모두 뗀다(각 화면이 듣는다. 오른쪽 칸·팝업은 Layout의 ESC가 닫는다).
- **메모·기록 라벨 한 목록** (19번 U5, 2026-10-07): 사용자에게는 '메모·기록 라벨' 하나(라벨 관리 탭 둘 - 일정 / 메모·기록).
  저장 자리는 그대로 `settings/labels`의 `memoLabels`(문자열 또는 객체)·`journalLabels`({id,name,color}) 두 배열.
  `lib/entryLabels.mergeEntryLabels`가 이름(trim)으로 합친다(차례: 기록 → 메모에만 있는 것, 같은 이름은 기록 id·색).
  `useLabels`는 두 배열을 그대로 들고 `memoLabels`(이름)·`journalLabels`(id)·`entryLabels`를 **같은 한 목록**으로 준다.
  메모에만 있던 라벨의 기록 id는 `entryJournalId(이름)` = `jm_이름`(어느 기기에서나 같다). 읽기만으로는 쓰지 않고,
  **저장할 일이 생기면** 채운다: 쓰는 칸 저장·옮기기 전에 `lib/entryLabelSync.ensureEntryLabels`(트랜잭션, 클라우드에 배열이 없는
  쪽은 안 씀 - 기본값을 한 개로 덮지 않게), 라벨 관리 저장은 `toMemoLabels`(원래 모양·모르는 칸, `memoIndex`로 같은 항목)·
  `toJournalLabels`(있던 id·모르는 칸)로 두 배열에 같은 목록. 이름 바꾸기는 메모·기록 둘 다 `applyLabelRenames`. 지운 라벨은
  휴지통 `[메모·기록]`(기록 배열에 있던 것은 kind journal). 트리는 `readLabelTree`(entry, 없으면 memo·journal을 합침 - 상위가
  다르면 기록 쪽, `conflicts`를 라벨 관리 창에 안내) / `saveLabelTree({entry})`가 entry·memo·journal 셋에 같은 것을.
  옮기기 창(`MoveEntryModal`)은 라벨 고르기 단계가 없다(그대로 간다). 쓰는 칸 칩 `data-entry-label-chip`(aria-pressed).
  **함께 고친 것**: 라벨 관리 '💾 클라우드 저장'이 일정 라벨을 V4 이름으로만 써서 V3가 이월 등 속성을 못 읽던 것 - 이제 `toSharedEventLabel`.
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
- 기록을 읽는 곳(`applyJournalData`, `JournalPeekModal`)은 칸을 골라 읽으므로 `tables`를 따로 넣어 두었다. `completed`·`favorite`(19번 U6)도.
- **한 카드·한 쓰는 칸** (19번 U6, 2026-10-07): 메모 카드와 기록 카드는 `components/EntryCard` 하나(`MemoCard`는 메모 칸을 넘기는 껍데기,
  `DayJournal`이 기록 칸을 넘긴다). 머리줄 `▶ ▲▼ ☐ ★ 라벨칩 날짜 🔗 🖼️(접혔을 때) 📎 ▦ … ✏️ 삭제` - 칩은 위, 예전 메모 카드 아래 '#라벨'은 없앰.
  칩 색은 `useLabels.entryLabels`, 목록에 없는 라벨은 그리지 않는다. 삭제 title은 메모 '삭제'·기록 '기록 삭제'(점검 스크립트가 찾는다).
  `data-entry-card`(memo/journal)·`data-completed`·`data-favorite`·`data-entry-card-label`·`data-entry-card-complete`·`data-entry-card-favorite`.
  기록 완료·즐겨찾기는 `useDayData.setJournalFlags`(mutateJournals로 그 항목 두 칸만), 즐겨찾기 기록은 그날 맨 위(DayJournal 정렬).
  쓰는 칸(`EntryDrawer`) 머리줄 `data-entry-flags`의 ☐ 완료·★(`data-entry-flag`): 저장된 항목은 `onToggleFlag`로 곧바로 그 칸만 저장
  (글은 칸에 남는다, `EntryDraft`에 담지 않아 다른 곳에서 바꾼 표시를 덮지 않는다), 새 항목은 들고 있다가 처음 저장의 `draft.completed·favorite`로.
  자동 기록(알림장·출결)은 `autoJournal`이 항목을 `...prev`로 다시 써서 두 칸이 남는다.
- **체크리스트** (19번 U9, 2026-10-07): 체크 줄은 글 안의 `☐ `/`☑ `(따로 칸이 없다 - V3에는 글로 보인다). `lib/checkLines`의 순수 함수:
  `toggleLinesPrefix`(쓰는 칸 '☑ 체크리스트' `data-checklist-toggle`·단축키 `checklist` - 커서 줄/고른 줄에 붙이고 모두 붙어 있으면 뗀다),
  `continueOnEnter`(체크 줄 Enter → 다음 줄도 ☐, 빈 ☐ 줄 Enter → 목록 끝, 한글 조합 중은 그대로), `toggleCheckAtCaret`(쓰는 칸에서 ☐/☑ 글자 누르기),
  `checkCount`(카드 머리줄 `data-entry-card-checks` '☑ n/m'). 단축키는 Layout이 `sp-checklist` 사건으로 알리고, 글 칸에 커서가 있는 쓰는 칸만 듣는다.
  쓰는 칸은 글을 바꾼 뒤 커서를 `useLayoutEffect`에서 둔다 - requestAnimationFrame으로 미루면 그새 친 글자 앞으로 커서가 돌아가 '달걀'이 '걀달'이 됐다.
  카드의 체크 줄(`data-check-line`) 누르기: 메모는 `updateMemo`, 기록은 `useDayData.toggleJournalCheckLine`(mutateJournals로 그 항목 글만,
  `toggleCheckLine(text, i, 보던 줄)`이 null이면 그새 고쳐진 것이라 저장하지 않고 안내).
- **링크 미리보기** (2026-10-07): `lib/linkPreview`(findUrls·previewOf - 유튜브 그림 / 구글·네이버·카카오 지도: 주소의 장소 이름, 구글은 `maps.google.com/maps?q=…&output=embed`
  / 그 밖: google s2 아이콘·도메인·길), `components/LinkPreviewCards`(`data-link-preview`=youtube|map|site, 지도는 '지도 보기'를 누를 때만 iframe). 서버가 없어 og: 제목은 못 읽는다.
  메모·기록 카드(EntryCard 본문 아래)와 쓰는 칸(글 아래). 점검 `tools/inspect-link-preview.mjs`.
- **수업 종** (2026-10-07): `lib/classBell`(설정 `settings/v4_classBell` - enabled·start/end{on, amount, unit 분/초, when 전/후}·weekdaysOnly, `bellTimes`·`bellsDue`(지난번 본 초~지금, 60초 넘게 지난 종은 버림)·`bellMessage`),
  `hooks/useClassBell`(Layout의 `useClassBellRunner` - 1초마다 보고 Web Audio로 '딩동댕동', `window.__spBellCount`·`__spBellLast`를 점검이 본다, 첫 누르기에 소리 장치를 깨운다),
  `components/ClassBellPanel`(시간표 창 교시 시각 아래, 누르는 즉시 저장 - 낙관적으로 먼저 보인다). '이 기기에서 울리기'는 localStorage `sp4-class-bell-muted`. 앱이 열려 있을 때만 울린다.
  점검 `tools/inspect-class-bell.mjs`(Playwright clock).
- **UX-AUDIT 적용** (2026-10-07, `docs/UX-AUDIT.md` U12-a~d): 화면 글자를 바꿨다 - 점검 스크립트도 같이(`grep -rn '<옛 글자>' tools/`). 바뀐 이름:
  창 위치(옛 팝업 모양)·가운데 창, ⏰ 시간표(옛 '시간표 적용 (주간 템플릿)'), 조사표 모아 보기, 💾 저장(옛 클라우드 저장), 백업 (내보내기 / 가져오기), 지난 일정 오늘로 가져오기,
  여러 개 고르기 / 여러 개 고르기 끝, 라벨 관리·검색(옛 '통합 …'), 학생 기록(누가기록) - 스크립트 정규식에서는 괄호를 `\(` 로. 메모 거르개 aria '메모 라벨로 보기'.
  ⋮ 메뉴 차례는 자주 쓰는 것이 위, 앱 설치·밝기는 환경설정(`data-install-pwa` → `INSTALL_PWA_EVENT`를 Layout이 받아 설치 창). 머리줄 `data-header-help`.
  하루 화면: `data-day-add-memo`(+ 메모), `data-day-progress`(📘 진도), 일정 카드 `data-event-complete`(☐), 교시 카드 `data-period-edit-hint`(✏️).
  쓰는 칸 '+ 새 라벨'(`data-entry-new-label`, 저장할 때 ensureEntryLabels가 만든다), 라벨로 보기 '?'(`data-filter-help`), 출석부 2.5초 뒤 저절로 저장(`AUTO_SAVE_MS`).
- **2026-10-07 요청 묶음**: '#라벨'은 **첫 줄도**(`hashLabels.takeHashLabels` - 첫·마지막 비지 않은 줄, 줄을 지운 뒤 글이 비면 그대로).
  메모에도 학생 태그(`EntryDrawer`의 '@이름'·`StudentTagPicker` 둘 다 메모에서, 피커 아래 `data-student-tag-manual` 학년도·학년·반·번호 직접 고르기),
  `StudentRecordModal`이 개인·그룹 `tasks`에서 태그 붙은 메모를 `kind: 'memo'`(날짜 = fromDate 또는 createdAt)로 모으고 누르면 메모 칸.
  일정마다 '구글 캘린더' `event.gcal`(true/false, null = 라벨을 따름 - 같으면 null로 저장) - `gcalPlan.isGcalEvent`가 먼저 보고, 켠 적이 있으면
  `v4_gcal.used`(markGcalUsed)라 켠 라벨이 없어도 큐에 넣는다. `gcalNote.setEventDoc`이 목록도 넘긴다(그 목록에 gcal:true가 있으면 큐).
  카드의 체크한 줄(☑)은 보이기만 아래 묶음(`data-check-done-section`, 줄긋기·회색 바탕), 저장 글 차례는 그대로. 카드 머리줄의 단추·칩은 한 줄(nowrap),
  마우스를 올렸을 때의 ✏️·삭제는 `absolute`라 자리를 차지하지 않는다. 오른쪽 칸(배너) 안의 목록은 따로 스크롤하지 않는다(라벨 관리·반복 미리보기·Keep·진도 차시·링크) -
  예외: 진도 미리보기(오늘로 내려 둔다)·조사표 표·평가 모아 보기 표(머리 고정·가로 스크롤). 사진 크게 보기 `ImageViewerModal frame="portrait"`(3:4 틀, 학급 화면·명렬표).
  전담 수업 칸 입력은 `components/SlotPairInput`(학년-반 + 과목 두 SlotCombobox, `data-slot-class-input`·`data-slot-subject-input`, 저장은 칸 글자 하나 `joinSlot`) -
  시간표 표(반 칸에 data-cell, 반 칸 Tab → 과목), 하루 수업 칸, 수업 수정 팝업. 목록은 `useSlotPairOptions`(반 = teachingClasses, 과목 = 설정 + 시간표의 과목).
  시간표 창 위 '교사 구분'(`data-teacher-preset`)은 환경설정 교사 유형과 같은 값(`TEACHER_PRESETS` 이름: (초등) 담임 / 전담 / (중등) 전담 + 담임). 점검 `tools/inspect-batch-1007.mjs`.
- **일정 라벨 '구글 캘린더'** (19번 U11, 2026-10-07): 켠 라벨 id는 V4 전용 `settings/v4_gcal { labels: {id: true} }`(라벨 객체에 칸을 더하지 않는다, LabelModal 일정 탭
  `data-gcal-label`, 💾 저장 때 `saveGcalLabels` - 문서를 통째로). 일정 날짜 문서 쓰기는 모두 `lib/gcalNote.setEventDoc(tx, ref, list)`(= tx.set(eventDocPayload) + 날짜 알리기) -
  링크·알림·라벨 이름 바꾸기만 tx.set 그대로(구글 글이 바뀌지 않는다). gcalNote는 가볍게 둔다(useAppStore도 부른다 - 구글 모듈을 들이면 고리).
  `lib/gcalAuto`: 켠 라벨이 있을 때만 알린 날짜를 1.2초 모아 `users/{uid}/v4_gcalQueue/{날짜} {date, at, fails}`에 쓰고 `flushGcalQueue` - 조용한 토큰으로
  그날 일정을 **서버에서 다시 읽어** 구글의 그날 것(`privateExtendedProperty` app·dateStr)과 맞춘다(`lib/gcalPlan.planDateSync`: 짝 = isSameItem, 고칠 것만 PUT,
  같은 sp_id 중복은 지움, `sp_auto=true`인데 그날 V4에 없는 것만 DELETE - 라벨을 바꾸거나 끈 것은 남긴다). 무엇을 바꿨는지 들고 다니지 않아 이월(옛 날짜에서 빠지고 새 id로)·
  기간·다중 선택·끌어 옮기기가 따로 처리 없이 맞는다. 보낸 날은 at이 그대로일 때만 큐에서 지운다(그새 또 쌓였으면 남김), 실패는 fails+1(3번째에 안내), 401·403은
  토큰을 잊고 멈춘다. 부르는 때: 큐에 넣은 직후, 앱을 열 때(설정을 처음 받은 뒤), 탭으로 돌아올 때. 토큰이 없으면 머리줄 `data-gcal-pending`(Layout `useGcalAuto`) -
  누르면 토큰부터 받고(누른 직후라 창이 열린다) 보낸다. 일정 칸 `data-event-gcal`(`useGcalEnabled`). 개인 공간만(1차). 수동 보내기(calendarSync)와 같은 캘린더·글·sp_id.
- **마지막 줄 '#라벨'** (19번 U10, 2026-10-07): `lib/hashLabels.takeTrailingHashLabels` - 마지막 비지 않은 줄이 `#이름`들로만 되어 있으면 이름을 떼고
  그 줄을 지운다(`#\d{8}` 학생 태그는 줄에 남김, 글이 그 줄뿐이면 그대로, 20자, 끝 문장 부호 뗌). `EntryDrawer.handleSubmit`이 저장 직전에 적용하고
  칸에도 뗀 글·칩을 남긴다. 칸 아래 미리보기 `data-hash-preview`(`data-hash-label`, 새 이름은 `data-new`). 새 이름은 `ensureEntryLabels`가 두 배열에 채우고
  (클라우드 배열이 비었으면 보이던 목록 = V3 localStorage·기본값을 바탕으로 - `setEntryLabelCloud`의 shown), 기록 labelIds는 목록에 아직 없으면 `entryJournalId(이름)`.
- **빈 라벨 정리** (19번 U10): `lib/labelUsage` - `loadEntryLabelUsageInput`(개인 + 그룹의 tasks·journals, 휴지통을 `getDocsFromServer`로, 하나라도 못 읽으면 던진다 -
  덜 센 채로 '비었다'고 하면 쓰는 라벨을 지운다), `countEntryLabelUsage`(메모 labels, 기록 labelIds·label·옛 '[라벨]' 글, 휴지통 type memo/journal의 data, 상위는 하위 포함),
  `emptyEntryLabels`(하위가 있는 상위·맨 위 라벨은 체크 해제). LabelModal 메모·기록 탭 `data-label-count`·`data-label-usage`·`data-label-prune`·`data-label-prune-list`·
  `data-label-prune-item`·`data-label-prune-confirm`. 지우기는 `handleSaveAll(nextEntries, nextParents)` - 휴지통 먼저, 두 배열 + 트리. 저절로 지우지 않는다(결정 표).
- **날짜 칸 = 자리** (19번 U7, 2026-10-07): 쓰는 칸 머리 '📅 날짜'(`EntryDrawer` `placeDate`·`data-entry-date`·`data-entry-date-clear`,
  잠금 `placeLocked`)가 자리다. 바꾸고 저장하면 `EntryDraft.targetDate` → 패널이 글을 먼저 저장한 뒤 `useRelocate` →
  `lib/moveEntry.relocateEntry`(① 원본을 트랜잭션으로 서버에서 읽고 ② 새 자리에 만들고 ③ 역링크 갈아끼우고 ④ 원본을 휴지통
  '(날짜를 바꿈)'에 넣은 뒤 지운다 - 휴지통에 못 넣으면 지우지 않는다). 칸 모두(글·라벨·첨부·표·링크·완료·즐겨찾기·createdAt·keepId),
  기록 → 메모는 `fromDate`(V4 전용), 메모 → 기록은 뺀다. 새로 쓰며 날짜를 바꾸면 만든 뒤 옮기되 휴지통을 거치지 않는다(`justCreated`).
  칸은 store `retargetEntryPanel`로 새 자리를 가리키고(메모 ↔ 기록이면 칸 종류가 바뀌어 다시 그려진다), 안내의 되돌리기는
  `undoRelocate`(새 항목 지우기 → 휴지통 되살리기 → 링크 되돌리기 → 칸을 원래 자리로). 옛 `MoveEntryModal`·'↔ 기록으로/메모로'는 지웠다.
  **교훈**: 쓰는 칸의 Ctrl+S는 `handleSubmitRef`를 effect로 바꿔 끼운다 - 새 상태(날짜·새 항목의 완료/즐겨찾기)를 deps에 넣지 않으면 옛 값으로 저장한다.

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
목록의 라벨 칩(`data-sheet-event-chip`)은 주간 칩처럼 완료를 뒤집는다(19번 U1, `useCalendarData.toggleEventItem`). 줄 전체가 `<button>`이라
칩은 `span role=button` + `stopPropagation`, 다중 선택 모드에서는 `onToggleEvent`를 넘기지 않아 끈다.

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
  학생 명단은 '이름 / 📷 사진'(`data-class-view`, 켬/끔은 이 기기 localStorage `sp4-class-photos` - 명렬표 관리의 `sp4-roster-photos`와 따로).
  사진은 명렬표 관리와 같은 `useStudentPhotos`(켤 때만 드라이브, 켜는 단추에서 `authorize`)·`StudentPhoto` 카드·`ImageViewerModal`('📷 사진 바꾸기').
  카드의 사진은 크게, 이름은 누가기록. 토큰이 없으면 저절로 로그인 창을 띄우지 않고 '구글 연결하고 사진 불러오기' 띠(2026-10-02).
  도구 창의 열림 상태는 Layout이 쥐므로 화면은 `lib/appActions.runAppAction({ id: 단축키 이름, classKey, num })`으로 부탁한다.
  고른 학급은 `lib/classMemory.rememberHubClass`가 도구들(자리표·뽑기·출석부 등)의 '마지막 학급' 기억에도 넣는다 - 도구를 특정 학급으로
  열려면 먼저 이것을 부르고 `runAppAction`.
  화면 종류를 더하면: store `Scope`·`App`·Layout `scopes`·`scopeOrder`·`MobileTabBar`·`shortcuts`·`COMMAND_META`·`PaletteScope`·
  `useGlobalGestures`·시작 화면(`preferenceSync`·`SettingsModal`).
- 화면 폭 판단은 창이 아니라 **본문 폭**(`useMainWidth`, `@container`)으로 한다. 오른쪽 칸이 열리면 그만큼 좁아진다.
- **오늘로**(상단 2행 가운데 날짜·'오늘 날짜로' 단축키, `lib/todayScroll.scrollToToday`): 오늘 칸 `data-today="true"` → 없으면 오늘이 든 구역
  `data-today-area="true"`(주간의 이번 주·월간의 이번 주 줄·년간의 이번 달 - 주말을 감춘 토·일, 자세히에서 일정 없는 오늘·접은 달) → 맨 위.
  하루 화면은 곧바로 맨 위. 새 화면이 늦게 그려지므로(다른 달·학년도, 년간은 달을 프레임마다 나눠 그린다) 2.5초까지 찾고, 찾은 뒤에도 자리가
  0.7초 그대로일 때까지 지켜보며 늦게 들어온 자료에 밀리면 다시 맞춘다(사용자가 휠·터치·키를 쓰면 그만). 예전에는 6프레임만 찾고 맨 위로 가서,
  표시가 없던 학사력과 휴대폰 년간에서 오늘로 가지 않았다(2026-10-04). **날짜 칸이 있는 화면을 새로 만들면 오늘 칸과 그 구역에 이 표시를 단다.**

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

### 사용 설명서 (`HelpModal`)
내용은 `lib/helpTopics`(분류 → 기능 → 설명·사용 예), 창은 그리기만 한다. 왼쪽 **목차 트리**(2026-10-02): 창 칸의 폭을 재서(`ResizeObserver`,
480px 이상이면 옆에) 분류 › 기능을 세운다. 지금 분류는 `go()`가 펼치고 지금 기능은 `aria-current`로 짚는다. 목차는 본문 높이만큼(`maxHeight`)
따로 스크롤되고, 넓은 칸에서 접은 것은 이 기기 `sp4-help-tree-hidden`. 좁으면 머리말 📚 목차로 내용 위에 펼치고 고르면 접는다.
**목차 단추는 `data-help-tree-*`** - 내용 칸의 `data-help-category`·`data-help-topic`과 따로라 점검 스크립트가 겹치지 않는다. 이름으로 찾을 때는
`region '설명서 내용'` 안에서 찾는다(목차에도 같은 이름이 있다). 가운데 팝업은 목차가 서 있을 때 그만큼 넓다(`4xl`, 접으면 `2xl`).

### 왼쪽 클립보드 칸
`ClipboardPanel` + `lib/clipboardHistory`. 복사한 것을 **이 기기의 IndexedDB에만** 둔다(계정에 올리지 않는다).

### 전역 단축키
`lib/shortcuts.SHORTCUT_ACTIONS`가 한 곳이다. Layout의 키 처리, 툴팁, 환경설정, 사용 설명서가 모두 여기서 읽는다.
**설명서·툴팁에 키 조합을 글로 박지 않는다**(테스트가 잡는다). 글을 치는 중에는 Ctrl·Alt 없는 단축키가 동작하지 않는다.

**명령 창은 없다** (19번 U4, 2026-10-07): 예전의 Ctrl+K 명령 창(`CommandPaletteModal`·`lib/commandPalette`, ROADMAP 6-2)은 지웠다 -
날짜 고르기(📅 달력)·통합 검색·⋮ 메뉴가 같은 일을 한다. 계정에 남은 `commandPalette` 키는 `resolveBindings`가 `SHORTCUT_ACTIONS`만
돌므로 읽을 때 버려진다. `SearchModal`의 `initialKeyword`도 명령 창만 써서 함께 지웠다.

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
  링크 배너의 ✏️ 수정은 일정·기록·메모를 하루 화면과 같은 쓰는 칸(`openEntryPanel`)으로, 수업만 `DetailEditModal`(N교시 수정)로 연다.
  일정도 옛 '일정 수정' 팝업으로 열려 날짜 옮기기·기한이 없던 것을 2026-10-02 고쳤다(`DetailEditModal`의 일정 갈래는 이제 여는 곳이 없다).
- **알림**: 일정 칸 안의 알림 창(`EventAlarmModal`)은 칸에만 담고 일정을 저장할 때 걸린다 - 그래서 `savedMessage`로 '일정을 저장하면 걸립니다'를 띄운다
  (예전엔 '알림이 설정되었습니다'가 떠서 칸을 저장하지 않고 닫았다). 하루 화면의 ⏰ 표시에서 여는 창은 곧바로 저장한다.
- **수업 수정 팝업**(`DetailEditModal`, 일정 갈래는 이제 여는 곳이 없다): 칸은 열 때 받은 값이 아니라 그 날짜 구독(`useDayData`)의 지금 값을
  따라간다(고치는 중이면 덮지 않는다). 저장하면 교과 모드가 다듬은 글자(`normalizeSlotText`)를 칸에도 넣고, 저장은 지금 값 위에 한다.
  교과 출결 칸 머리줄의 과목도 그 교시 수업 칸의 지금 글자(같은 반일 때)로. 예전에는 과목을 고쳐도 배너에 옛 글자가 남았다(2026-10-04).
- **반복 일정 등록**(`RecurringModal`): 만들면 `onRegistered`로 창을 닫는다(⋮ 메뉴에서 연 창이 그대로 남아 한 번 더 누르면 두 벌이 생겼다, 2026-10-02).
- **메모 ↔ 기록 옮기기**: `lib/moveEntry`. 새 항목 → 역링크 갈아끼우기 → 원본 휴지통. 일정은 옮기지 않는다.
- **첨부·캡처**: 구글 드라이브 `School_Planner` 폴더(`lib/driveApi`). 화면에 그림은 thumbnail 주소로 보인다.
  학생 사진은 공개하지 않고 `Students_Poto/{학년도-학년-반}`에(`lib/studentPhotos`).
  **드라이브에 있는 사진 고르기**(2026-10-02): `googlePicker.pickDriveImages`(png·jpeg·webp, 여러 장은 MULTISELECT)로
  **사진 파일**을 고르게 한다. 탭은 드라이브처럼 폴더를 열어 들어가는 DocsView(DOCS, 종류에 폴더+그림, `setParent('root')`, LIST) -
  지난번 폴더(고른 사진의 parentId, localStorage `sp4-photo-pick-parent`)·내 드라이브·공유 문서함(`setOwnedByMe`는 `setIncludeFolders`와 같이 쓰면
  무시된다)·공유 드라이브·모든 사진(DOCS_IMAGES). 그림 종류만 걸면 폴더가 걸러져 사진이 한 줄로 늘어선다.
  **왼쪽 폴더 나무(탐색기 모양)는 만들지 않았다**(2026-10-02 사용자와 정함): 선택창에는 나무가 없고, 앱이 직접 그리려면 폴더 목록을 읽는
  `drive.readonly`(제한된 범위 - 미확인 앱 경고·사용자 100명·해마다 심사)가 필요하다. 지금은 폴더 열기 + '지난번 폴더' 탭으로 둔다. drive.file은 선택창에서 고른 파일만 열어 주므로(폴더를 고르면 손자 파일은 안 열렸다) 어느 폴더에 있든 받는다.
  `studentPhotos.pickPhotosFromDrive`가 alt=media로 받아 File로 만들고, 기기에서 고른 것과 같은 `upload`/`uploadMany`로 넘긴다(줄이기·이름 맞추기·학급 폴더,
  원본은 그대로). UI는 `roster/drivePhotoPick`: 빈 카드 `StudentPhoto.onPickDrive`(`data-photo-drive-pick`), 크게 보기 `data-photo-drive-replace`,
  명렬표 관리 `data-photo-drive-many`. 클라우드 컨테이너는 apis.google.com을 막아 선택창이 안 뜬다 - 점검은 선택창·드라이브를 흉내 낸다.
- **구글 토큰**(드라이브·캘린더·시트, `lib/googleApi`): 토큰은 한 시간쯤에 만료되고 탭(sessionStorage)마다 따로다. 사용자가 시킨 일은
  `getValidGoogleToken`, 화면을 그리려는 일은 `getGoogleTokenQuietly`(창을 띄우지 않는다). **브라우저는 방금 누른 때가 아니면
  로그인 창을 막는다** - 파일 고르기 창에서 고른 뒤·드라이브에 물은 뒤에는 막혀, 첨부가 '파일 업로드에 실패했습니다'로만 끝났다(2026-10-02).
  그래서 `getValidGoogleToken`은 `navigator.userActivation.isActive`일 때만 로그인 창을 바로 열고, 아니면(또는 사용자가 닫은 것 말고
  다른 까닭으로 못 열면) **'구글 로그인이 필요합니다' 창**(`GoogleLoginPrompt`, 상태 `lib/googleLoginPrompt`, Layout에 하나)을 띄워
  그 단추에서 연다(단추 onClick에서 곧바로 `renewGoogleToken` - 앞에 await를 두면 다시 막힌다). 여러 파일이 함께 물어도 창은 하나,
  닫으면 `GoogleAuthError`(사용자에게 그대로 보여 줄 문구). 드라이브가 401(또는 권한 모자람 403)로 거절하면 `uploadToDrive`가
  `forgetGoogleToken` 뒤 한 번 더 한다. 실패 안내에는 `uploadFailReason`으로 까닭을 붙인다. 여러 파일을 차례로 올리는 곳(Keep 가져오기)은
  로그인을 거절하면 남은 파일마다 다시 묻지 않는다. 클라우드 컨테이너는 apis.google.com을 막아 로그인 창 자체는 열리지 않는다(실제 사이트에서 본다).
- **공휴일**: `holidays/{year}` 공유본 + V3의 `settings/holidays`. 옛 방식으로 events에 들어 있던 공휴일 일정은 `isHolidayEvent`로 가려 목록에서 뺀다.
- **학기**: 방학 기간(시간표 설정)에서 계산한다(`lib/semester`). 학년도는 3월~이듬해 2월.
  **기간으로 고르는 곳(검색·링크 연결·내보내기·구글 캘린더·출석부 누계)은 `semester.schoolYearSpan`(2월 말일 - 윤년 29일)·`semesterSpan`(학년도, 1|2, 설정)
  한 곳에서 셈한다**(2026-10-02). 규칙은 `evalSummary.semesterOf`와 같다: 그 학년도의 방학 설정이 있으면 2학기 = 여름 방학 끝난 다음 날 ~ 2월 말,
  1학기 = 3월 1일 ~ 그 전날(방학도 앞뒤 학기에 넣어 빈틈없이), 설정이 없거나 다른 학년도 것이면 3~8월 / 9~2월. 학년도는 보고 있는 날(`getAcademicYear`)로.
  예전에는 화면마다 '8/15까지'·'8/31까지'로 따로 정했고, 1~2월에 열면 달력의 해로 셈해 다음 학년도를 찾았고, 2월 28일로 끝내 윤년 2월 29일이 빠졌다.
  출석부 누계는 방학 설정의 해를 그대로 써 다른 학년도 학급이 빈 표였고 2학기가 겨울 방학 전날에 끝났다. 통합 검색의 처음 값은 '전체 기간'(날짜 제한 없음 -
  예전에 '학년도 전체'라 부르던 것)이고 '학년도 전체'는 진짜 그 학년도다. 년간 화면의 학기 칩만 달 단위(3~8 / 9~2, `getAcademicMonths`).
  시간표 적용의 '1·2학기 기간 채우기'와 진도의 '2학기 시작'은 수업하는 날만 보므로 그대로 `getSemesterRanges`(방학 뺀 기간).
- **날짜 이동**(`useAppStore.navigatePrev/NextDate`): 월간·년간은 `dateUtils.addMonthsClamped`로 그 달에 없는 날은 말일로 (1/31 + 1달 = 2/28).
  `Date.setMonth`만 쓰면 31일에 ▶가 3월로 건너뛰었다(2026-10-02). 하루 화면은 주말을 감추면 토·일을 건너뛴다.
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
  **차시 목록 넣기 세 길**(2026-10-04): 붙여넣기 `parseLessonTable`(탭 표), CSV 파일 `parseLessonCsv`(`lib/csv.parseCsv`) - 둘 다
  `parseLessonRows` 하나로 읽는다(머리줄 이름으로 칸 맞추기·빈 단원 잇기·단원만 줄은 제목). 파일 글자는 `csv.decodeTextBytes`(UTF-8 fatal →
  안 되면 EUC-KR, 한국어 엑셀의 기본 CSV). 창의 '⬇️ 예시 CSV 받기'(`data-progress-sample`)는 `lib/progressSample`(4학년 과학 15행·17차시,
  `진도표_예시.csv`), '📂 CSV 불러오기'(`data-progress-csv-open`, 숨은 input `data-progress-csv-input`). 넣은 뒤에는 저장하지 않는다(💾 저장으로).
  **과정(여러 반, 교과 모드 S4)**: `classes`가 있으면 `planKeys`가 반마다 열쇠 '5-1 과학'을 내고, `progressMarks`가 열쇠마다
  `computeProgress(…, keyOverride)`로 **따로** 센다(목록 끝 `break`도 반마다, 표식에 `cls`). 과정의 칸 견주기는 `normalizeSlotText`,
  옛 진도는 그대로 `progressKey` - 옛 진도끼리의 결과는 바뀌지 않는다. `progressUntil(plan, plans, key)`는 과정이 끼면 반 열쇠를
  정규화해 견준다. bumps는 과정에 한 배열(같은 날·교시에 두 반은 없다).
  반 탭(`data-course-preview`)으로 미리 보고, 진도 줄을 누르면 store `progressModalClass`로 그 반 탭. 이름은 `courseTitle`·`planLabel`.
  **19번 U2 (2026-10-07)**: 창의 '칸 글자' → **과목**(aria '과목'), '줄' → **행**. 교과 모드는 '+ 진도'·'+ 과정'을 **'+ 새 진도' 하나**로
  (`data-new-course`는 교과 모드에서 그 단추에) - 늘 과목 + 반 칩. 고치는 모양·저장 모양은 `lib/progressDraft`(순수 함수, 테스트):
  `toDraft(plan, isClassUnit)`는 교과 모드에서 옛 칸 글자 진도도 `parseSlot`으로 과목 + 반 하나(`legacyKey`에 원래 글자),
  `draftTarget`이 저장 모양을 정한다 - 반 둘 이상 = 과정, **옛 진도에 반 하나 이하 = 옛 모양**(과목·반이 그대로면 글자도 그대로 - 과정으로
  바꾸면 견주기가 `normalizeSlotText`로 바뀌어 옛 결과가 달라질 수 있다), 새 진도에 반 하나 = 과정, 반 없음 = 과목만('창체').
  과정을 반 없는 진도로는 저장하지 않는다(저장이 merge라 classes가 남는다). 행마다 임시 key `_k`(가운데 넣어도 IME가 엉키지 않게,
  `cleanLessons`가 뺀다). '+ 행 추가'(`data-progress-add-row`)는 마지막으로 커서가 있던 행 아래(`insertRowAfter`), 칸에서 Ctrl+Enter도.
  **교과서(쪽) 칸** `lessons[].page`(글자): 머리줄 '교과서'·'쪽'·'쪽수'·'교과서(쪽)', 머리줄 없는 표는 **칸 수로 가른다**(차시 뒤 칸이
  셋 이상 = 내용·교과서·준비물, 둘 = 옛 4칸 표의 내용·준비물). 쪽 '12~13'도 차시 숫자처럼 보여서 차시 칸 고르기는 같은 만큼 채워졌으면
  바로 뒤가 글자 칸인 쪽, 그다음 왼쪽. 예시 CSV도 5칸.
  **차시 칸 = 그 내용의 차시 수** (2026-10-07 사용자가 정함): `parseLessonRows`가 차시 칸 숫자 n(1~10, '2차시'도)만큼 같은 내용을
  잇달아 넣는다(`lessonRepeat`, 뒤 행의 차시 칸은 비움 - 바로 뒤에 차시 칸이 빈 같은 내용 행이 있으면 이미 늘린 것으로 세어 다시
  붙여 넣어도 또 늘지 않는다). 범위 '5~6'·글자는 한 행. 옛 표처럼 단원마다 1, 2, 3 … 차례 번호면(`looksNumbered` - 셋 이상 이어지고
  어긋나는 단원이 없을 때) 늘리지 않는다. 창 안내는 `parseLessonTableInfo`·`parseLessonCsvInfo`의 `repeated`·`numbered`. 저장한 진도는 그대로.
  **19번 U3**: 진도 줄(`ProgressMarkLine`)은 `📘 단원 · 5/12차시 · 내용 · 📖 12~13쪽`(`lessonPageLabel` - '쪽'·'p'가 있으면 그대로,
  `data-progress-page`) + 🎒. 하루 카드 차례는 과목 → 진도 줄 → 준비물(`data-period-supplies`) → 메모(`data-period-memo`).
  진도가 없는 교시를 고치는 중이면(개인 공간, 과목이 있을 때) **'📘 진도 만들기'**(`ProgressCreateButton`, `data-progress-create`) -
  하루 카드 수정 칸과 `DetailEditModal`. store `setProgressModalOpen(true, NEW_PLAN_ID, undefined, 칸 글자)` → `progressModalPreset` →
  `progressDraft.draftForSlot`(담임은 과목 글자, 교과 모드는 '5-2 과학' → 과목 + 반). 수업 칸 입력 aria: 담임 '과목', 교과 모드 '학년-반 과목'.
  **S5**: `ProgressInputs.notesByDate`(같은 수업 스냅숏에서 `scheduleNotes` - memo, 없으면 content의 첫 줄)와
  `teachingSlot.previousSlotOf`(정규화한 같은 칸 글자의 바로 앞 교시, 수업 없는 날 건너뜀)로 하루 카드의 '지난 시간' 줄(`data-prev-note`).
  그래서 `useProgressMarks`는 **교과 모드면 진도가 없어도** 그 학년도 3월 1일부터 읽는다(초등 담임은 그대로 진도가 있을 때만).
  진도 창의 반별 현황표(`data-course-status`)는 `courseStatus(plan, timelinesByKey, today)` - 오늘 수업은 한 것으로, behind ≥ 2면 '늦음'.
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
- **교과 전담 모드**(ROADMAP 18, 계획 `docs/ROADMAP-SUBJECT.md`): 모드는 `useTeachingMode()` 하나로만 읽는다 - 새 동작은
  `isClassUnit`(unit 'class')일 때만, 담임 도구 숨기기는 `showHomeroomTools`(교과 전담만 false). 반은 칸 글자 `5-2 과학`에서
  `parseSlot`으로 읽는다(`5-2`·`5학년 2반`·붙인 숫자 `502`/`1203` - 붙인 숫자는 학년 1~12·반 1~30, 뒤에 단위·줄표가 붙으면 반이 아니다, 2026-10-04). **S3 반 중심 칸**: 하루 카드(`DaySchedule`)는 반이 있는 칸만 `data-slot-class`(크게)·`data-slot-subject`(작게)와
  반 색 막대(`data-slot-color`), 반이 없는 칸·초등 담임은 예전 `data-subject` 한 칸. 주간(`WeekGrid`)은 반 색 칩. 색은
  `teachingSlot.classColor`(정한 색 `classColors` → 그 학년도 반 차례 8색 → 반 이름 해시) - Tailwind 클래스를 `CLASS_COLORS`에 통째로 적어 둔다.
  `hooks/useClassColor`가 명렬표를 **교과 모드일 때만** 구독한다(`useRoster(enabled)`). 숨기는 담임 도구: 하루 수업 머리줄 알림장·출석부,
  ⋮ 메뉴 항목의 `homeroom: true`(주간학습안내·출석부·알림장 모아 보기), 학급 탭 `TOOLS`의 `homeroom`·오늘 출결 줄. 단축키는 그대로.
  교과 + 담임의 출석부는 `AttendanceDrawer`가 넘겨받은 학급이 없을 때 담임반(`rosterForSlot(homeroomClass)`)을 먼저 고른다.
  반 색 고르기는 환경설정 `TeachingModePanel`(`classColors: {반: 색}` merge).
  **가르치는 반 (19번 U1)**: `teachingSlot.teachingClasses` = 시간표 템플릿 칸 + 그 학년도 수업 칸(있으면 `subjectsByDate`) + 명렬표 + 설정 `classes`.
  화면은 `hooks/useTeachingClasses`(`useTeachingClasses`·`useSlotOptions` = 반 × 가르치는 과목)로 읽고, 진도 관리 과정 반 칩도 같다.
  수업 칸 입력은 `components/SlotCombobox`(예전 datalist는 크롬이 칸 글자와 맞는 것만 보여 줘 다른 반이 안 나왔다): 목록은 body에 붙인 fixed라
  `useClickOutside`가 `[data-combobox-list]`를 바깥으로 세지 않는다. ESC는 목록이 열려 있을 때만 `stopPropagation`(목록만 닫음).
  시간표 표는 `openOnFocus={false}`(화살표로 칸을 옮겨 다니므로 ▼·Alt+↓·글자 치기로 연다). 점검 `tools/inspect-refine-u1.mjs`.
  **S4 과정**: 진도 관리의 차시 목록 하나를 여러 반에 - 위 '진도 관리'의 과정 단락.
  **S6 교과 출결**: 하루 카드의 '🙋 출결'(`data-subject-attendance`, 개인 공간·반의 명렬표가 있을 때) → 오른쪽 칸
  `SubjectAttendancePanel`(EntryPanelTarget kind `subjectAttendance` + `classKey`·`period`·`slotSubject`, entryId `sa:…`로 같은 칸은 올리기만).
  칸은 문서를 구독하고 누를 때마다 한 칸 저장(저장 단추·unsaved 없음). 카드 요약은 `useSubjectAttendanceDate`(그날 `where date ==` 쿼리, 교과 모드만).
  교과 + 담임의 담임반이면 그날 담임 출석부 결석을 읽기만 해 흐리게 보인다.
  **S7 누계·학급 탭**: `SubjectAttendanceSummaryModal`(Layout 상태 `subjectAttSummaryClass` - null 닫힘·'' 첫 반·classKey) - 단축키 id
  `subjectAttendance`, appAction에 classKey를 실으면 그 반, ⋮ 메뉴 항목은 `classUnit: true`(초등 담임 숨김). 셈은 `studentTotals`(기간)·
  `summaryCsvRows`, 학기는 `evalSummary.semesterOf`. 학급 탭(`ClassScreen`)은 교과 모드에서 `classesForYear`를 학년별 줄 칩
  (`data-class-chip`)으로, TOOLS의 `classUnit` 도구, 교과 + 담임은 담임반이 아닌 반에서 담임 도구·오늘 출결을 숨긴다.
  학생 누가기록은 교과 모드면 `subjectHistoryOf`로 `kind: 'subjectAttendance'` 줄을 섞는다.
  **S8 반 도구·조사표**: 하루 카드의 `data-class-tools`(자리표·뽑기는 `rememberHubClass(classKey)` 뒤 `runAppAction`, 조사표는 칸 글자를 넘긴다).
  `EvaluationModal`은 교과 모드에서 새로 만들 때 한 번 `teachingSlot.evalDefaultsForSlot`(학년도 명렬표 자리·과목). 그 교시가 과정 표식이면
  `progress.courseTimelines`→`planCourseEvals`(같은 차시 `slotOfLesson`)로 다른 반 교시를 보이고, 체크하면 반마다 **기존 `upsertEvaluation`
  트랜잭션**(evalDocPayload 두 이름)으로 하나씩 - id는 `원본_n`, 명단·rosterMeta는 그 반, 조별이면 번호 차례로 다시 나눈다. 실패해도 되돌리지 않고 알린다.
  **S9 과정별 평가 모아 보기**: `EvalOverviewModal`의 '학급별/과정별' 탭(교과 모드만) → `CourseEvalOverview` - 과정의 반마다 `loadClassEvals`(학급별과
  같은 읽기)를 `lib/courseEvals.groupCourseEvals`(종류|제목으로 묶고 과정 과목만, 반마다 이른 것)로 묶어 `courseEvalCompletion`('완료 n/m')을 그린다.
  **S10**: 단축키 `teachingMode`(환경설정을 `focusSection: 'teaching'`으로 열어 그 구역까지 내림)·`newCourse`(진도 창을
  `NEW_COURSE_PLAN_ID`로 열면 새 과정 칸). 교과 모드의 새 자료는 모두 V4 전용(`v4_progress`의 subject·classes, `v4_subjectAttendance`) -
  V3와 같이 쓰는 문서(수업·명렬표·시간표·출석부)에는 칸을 더하지 않았다. 반·과목은 칸 글자 `5-2 과학`에만 있다.
  **회귀를 볼 때**: 초등 담임(teacher)은 `unit:'subject'`라 S1~S9의 새 동작이 모두 꺼져 있어야 한다 - 각 `inspect-*`의 끝 항목이 teacher로 그것을 본다.
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
| `tools/inspect-class-screen.mjs` | 학급 탭(13). 올해 학급이 없으면(seed 직후) 점검용 9-1·9-2를 심고 끝에 뺀다 |
| `tools/inspect-drive-photo-pick.mjs` | '☁️ 드라이브에서' 학생 사진(13) - 선택창·드라이브를 흉내 내 한 장(빈 칸)·바꾸기(크게 보기)·취소·여러 장(이름 짝짓기·결과 띠) |
| `tools/inspect-class-photos.mjs` | 학급 탭 명단 사진 보기(13) - googleapis를 흉내 내 사진 카드·n/n명·크게 보기·이름 → 누가기록·다시 열어도 남음·토큰 없을 때 띠 |
| `tools/inspect-teaching-mode.mjs` | 교사 유형(12) - teacher3 환경설정·서버 값, teacher2 처음 안내 띠·'나중에', teacher 그대로. 끝에 seed 값으로 되돌린다 |
| `tools/inspect-subject-timetable.mjs` | 교과 모드 칸 입력(13) - teacher3 시간표 창 제안·정규화·붙여 넣기·저장 안 하고 닫기, 하루 2026-11-03 저장 → 서버 '5-1 과학', 주간 팝업 제안, teacher '3 - 2 국어' 그대로. 시간표·수업 문서를 끝에 되돌린다 |
| `tools/inspect-dark.mjs` | 다크 모드(11) |
| `tools/inspect-google-login.mjs` | 구글 토큰이 없을 때 첨부·붙여넣기 → '구글 로그인이 필요합니다' 창·취소 안내·기록 칸 그대로(10). 로그인 창이 열리는지는 컨테이너가 apis.google.com을 막아 실제 사이트에서 |
| `tools/inspect-share-target.mjs` | 다른 앱에서 공유받기 - 서비스 워커 POST·새 메모 칸·파일 목록·GET·새로고침(16). 안드로이드 공유 창 대신 같은 모양의 양식을 보낸다 |
| `tools/inspect-course.mjs` | 과정(여러 반, 17) - teacher3 '과정 (여러 반)' 만들기·반 탭 미리보기·서버 subject·classes, 11-02·11-04 반마다 차시, 5-2만 밀기·진도 줄 → 5-2 탭·되돌리기, 반 빼기, 지우기·복원, teacher에는 단추 없음. 만든 진도·휴지통을 끝에 지운다 |
| `tools/inspect-course-status.mjs` | 지난 시간 줄·반별 현황표(9) - teacher3 11-02 메모 → 11-04 5-2 카드 줄·누르면 그날로, 과정을 2026-09-07~18 수업에 심고 현황표 4줄·5-3 두 번 밀면 '2차시 늦음'·다음 수업 밀기, teacher 줄 없음. 오늘이 9/19~11/1일 때 맞게 짰다 |
| `tools/inspect-subject-attendance.mjs` | 교과 출결(13) - teacher3 11-02 1교시(5-1) 칸 머리·2번 결과 → periods.1.2, 같은 문서 다른 교시 그대로, 3교시(5-2) 칸 함께 열기, 사유, 새로고침, 출석으로 되돌리기, teacher 단추 없음. 문서를 끝에 지운다 |
| `tools/inspect-subject-attendance-summary.mjs` | 교과 출결 누계·학급 탭(16) - teacher3 5-2에 출결을 심고 학급 탭 학년 줄 칩·교과 출결 도구, 누계 학기별 수·내역·CSV, 누가기록 줄, 칸의 📊 누계, teacher ⋮ 메뉴 없음. CSV 이름은 이 컨테이너 Chromium이 'download'로 줘서 그때는 보지 않는다 |
| `tools/inspect-course-evals.mjs` | 반 도구·조사표(11) - teacher3 과정을 심고 11-02 1교시 반 도구 줄, 조사표 5-1·과학 자동, 다른 반 교시 안내, 만들기 → 서버 11-02·11-03 네 반(명단·두 이름), 자리표 5-1, teacher 줄 없음. 조사표 문서를 끝에 되돌린다 |
| `tools/inspect-course-overview.mjs` | 과정별 평가 모아 보기(8) - teacher3 과정·조사표를 심고 과정별 탭 줄·칸·'-'·완료 수, 점수를 넣고 다시 열면 바뀜, 칸 → 그 반 조사표, teacher 탭 없음. 조사표 문서를 끝에 되돌린다 |
| `tools/inspect-subject-finish.mjs` | 교과 모드 마무리(6) - Ctrl+K가 아무것도 열지 않음·⋮ 진도 관리의 과목 + 반 칸, 휴대폰 390px 하루 카드·교과 출결 칸 넘침 없음(폭 점검은 S10에서 한 번만 - CLAUDE.md 2장) |
| `tools/inspect-progress.mjs` | 진도 관리 - 시간표 적용 건너뛰기·진도 관리 창·수업 칸 겹쳐 보기·밀기·알림장 준비물·V3 옛 문서·그룹 공간(39항목). 자료는 2027-03에 심고 지운다 |
| `tools/inspect-manual.mjs` | 사용 설명서대로 동작하는지 89항목. 여러 작업을 모아 마지막에 한 번. `SITE=http://localhost:4190/School_Planner_V4/`(기본값 4173은 vite preview) |
| `tools/inspect-refine-u2.mjs` | 19번 U2 진도 관리(24) - teacher 과목 칸·교과서 칸(5칸·옛 4칸 붙여넣기)·'+ 행 추가'·Ctrl+Enter·page 저장, teacher3 새 진도 하나·과목 + 반 하나·옛 칸 글자 진도 그대로 저장·하루 칸 차시. 만든 진도는 지운다 |
| `tools/inspect-refine-u3.mjs` | 19번 U3 하루 수업 칸(12) - '📘 진도 만들기'(하루 카드·N교시 수정 팝업, teacher 과목·teacher3 과목 + 반), 칸 aria, 진도 줄 단원·📖 쪽, 카드 차례. 고친 수업·진도는 되돌린다 |
| `tools/inspect-refine-u5.mjs` | 19번 U5 메모·기록 라벨 한 목록(11) - 라벨 관리 탭 둘·한 목록, 새 라벨이 두 배열에(문자열 모양·기록 id 그대로), 일정 라벨 V3 이름, 쓰는 칸 칩 같음, 메모에만 있던 라벨로 기록 저장 → jm_ id 채움, 이름 바꾸기. 라벨 문서·트리·자료를 되돌린다 |
| `tools/inspect-refine-u6.mjs` | 19번 U6 한 카드·쓰는 칸(11) - 기록·메모 카드 칩 위·#라벨 없음, 기록 완료(서버 그 항목만·기록 수 그대로·새로고침 뒤), ★ 맨 위, 쓰는 칸 머리줄 ★(글은 칸에), 새 메모 완료 저장. 기록 문서·메모를 되돌린다 |
| `tools/inspect-refine-u7.mjs` | 19번 U7 날짜 칸 = 자리(12) - 메모에 날짜 → 그날 기록(글·라벨·첨부·표·처음 쓴 때), 메모 사라짐·휴지통 '(날짜를 바꿈)'·링크된 일정이 새 기록을, 칸이 따라감, 되돌리기, 기록 날짜 바꾸기·빼기(fromDate·카드 '📅 m/d에서'). 자료를 지운다 |
| `tools/inspect-link-preview.mjs` | 링크 미리보기(6) - 메모 카드의 유튜브·지도·사이트 카드, 지도 보기, 새 탭·쓰는 칸 안 열림, 쓰는 칸 글 아래 |
| `tools/inspect-class-bell.mjs` | 수업 종(5) - 시간표 창에서 켜기·1분 전, 시계를 돌려 08:59 시작 종·09:40 끝 종, 이 기기에서 끄기. 교시 시각·종 설정을 되돌린다 |
| `tools/inspect-ux-audit.mjs` | UX-AUDIT 적용(12) - 머리줄 ?, ⋮ 차례·환경설정의 설치·밝기, 일정 ☐ 완료, 📘 진도, ✏️, + 메모, + 새 라벨, 라벨로 보기 ?, 구글 캘린더 안내 |
| `tools/inspect-batch-1007.mjs` | 10-07 요청 묶음(13) - 첫 줄 #라벨, 카드 라벨 한 줄·체크한 줄 아래, 라벨 관리 한 스크롤, teacher3 시간표 교사 구분·두 칸, 메모 학생 태그(명렬표·직접)·누가기록 '📝 메모'. 메모·라벨을 되돌린다 |
| `tools/inspect-clicks.mjs` | 19번 U12 클릭 수표 - 자주 하는 일 20가지를 하루 화면에서 따라 하며 누르기·키를 센다(마지막 되돌리기 어려운 단추는 +1로). 결과는 `docs/UX-AUDIT.md`. 일정·기록·메모·출석·알림장·라벨·휴지통을 되돌린다 (8분쯤) |
| `tools/inspect-refine-u11.mjs` | 19번 U11 일정 라벨 '구글 캘린더'(9) - 구글 캘린더 API를 page.route로 흉내 낸다: 라벨 관리 체크, 일정 칸 표시, 저장 → POST(sp_auto)·큐 비움, 켜지 않은 라벨은 안 감, 완료 → ✅ PUT, 토큰 없음 → '못 보낸 날 1' → 누르면 DELETE. 설정·일정·큐·휴지통을 되돌린다 |
| `tools/inspect-refine-u10.mjs` | 19번 U10 '#라벨'·빈 라벨 정리(11) - 새 메모 마지막 줄 #새라벨 #업무(미리보기·저장·두 배열), 새 기록 #라벨 #학생태그(jm_ id, 태그 줄 남음), 라벨 관리 세기 → 정리 → 두 배열에서 빠짐·휴지통. 라벨·트리·자료·휴지통을 되돌린다 |
| `tools/inspect-refine-u9.mjs` | 19번 U9 체크리스트(13) - 새 메모: 고른 줄 ☐ 붙이기·떼기, Enter 이어 쓰기·빈 줄 끝, 단축키, 저장, 카드 '☑ 0/3'·줄 누르기, 기록 카드 줄 누르기(그 기록만)·새로고침. 메모·기록 문서를 되돌린다 |
| `tools/inspect-refine-u8.mjs` | 19번 U8 거르개(8) - 학교 › A·B학교를 심고 메모·기록: 처음 접힘, 학교 → 셋, 기타 → 학교만, 새로고침 뒤 접힘. 라벨·트리·자료를 되돌린다 (옛 inspect-label-tree.mjs는 '하위 포함' 규칙이라 지움) |
| `tools/inspect-progress-csv.mjs` | 진도 관리 예시 CSV(6) - 받기(머리줄·예시 내용)·불러오기 17차시·CP949 CSV 한글. 저장하지 않아 자료는 그대로 |
| `tools/inspect-slot-live.mjs` | 과목을 고치면 배너도 따라감·학년반 숫자 403(8) - teacher3 주간 1교시 수정 배너에 '403과학' → 서버·배너 '4-3 과학', 연 채로 다른 곳에서 고친 과목, 고치는 중이면 그대로, 하루 출결 배너 머리줄. 2026-11-02 수업 문서를 끝에 되돌린다 |
| `tools/inspect-today-scroll.mjs` | 상단 날짜 → 오늘로(17) - 휴대폰 390px·PC에서 하루(맨 위)·주간·월간(다음 달에서)·년간 학사력·자세히(지난 학년도에서). 자료를 바꾸지 않는다 |
| `tools/inspect-help-tree.mjs` | 설명서 왼쪽 목차(20) - 오른쪽 칸·가운데 팝업·휴대폰, 펴기·짚기·따로 스크롤·접기 기억, 월간 31일 ▶, 검색 기간 처음 값, 반복 일정 창 닫힘(2031-03 일정을 만들고 지운다). 팝업 모양을 바꾸면 끝에 되돌린다 |
| `tools/inspect-*.mjs` 나머지 | 지난 신고를 재현하던 것들(이월·뒤로가기·기록 삭제 뒤 빈 화면·V3/V4 한 출처 등) |
| `tools/inspect-subject-view.mjs` | 반 중심 수업 칸(14) - teacher3 하루 2026-11-02 큰 반·작은 과목·반 색 막대, 알림장·출석부·⋮·학급 탭 숨김, 주간 반 칩, 환경설정 반 색 → 서버·카드, 교과 + 담임(5-3)이면 다시 보이고 출석부가 담임반으로. 교사 유형 문서를 끝에 되돌린다 |
| `tools/seed.mjs` | 에뮬레이터에 한 학년도치 자료. 교과 전담 계정 `teacher3`(`?as=3`): 5-1~5-4 명렬표, 2026-11-02~27 `5-2 과학` 수업. 모든 계정에 `v4_teaching` |
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
13. **새 기능(창)을 더하나?** ⋮ 메뉴 `Layout.moreMenuSections`의 알맞은 구역에 한 줄, 단축키(`SHORTCUT_ACTIONS`).
    (명령 창 `COMMAND_META`는 19번 U4에서 지웠다.) 화면 종류를 더하면 7장 '화면 종류를 더하면' 목록을 모두.
14. **색을 주나?** Tailwind 색 클래스, style이면 `var(--color-…)`(hex는 다크 모드에서 안 바뀐다). `src/dark.css`는 `tools/gen-dark-css.mjs`로만.
15. **인쇄할 화면인가?** `lib/print.printNode`, 찍지 않을 것에 `data-print-hide`.
16. **매니페스트·서비스 워커를 바꾸나?** 설치된 앱은 늦게 받는다 - 사용자에게 '다시 설치'를 함께 알린다(8장 공유받기).
17. **일정 날짜 문서를 새로 쓰나?** `tx.set(ref, eventDocPayload(list))` 대신 `lib/gcalNote.setEventDoc(tx, ref, list)` - 그래야 구글 캘린더 자동 보내기(U11)가 그날을 맞춘다
    (링크·알림처럼 구글 글이 바뀌지 않는 쓰기만 예외).
18. **메모·기록에 칸을 더하나?** 기록은 읽는 곳(`applyJournalData`·`JournalPeekModal`)에도, 날짜 칸 옮기기(`moveEntry.toJournalEntry`·`toMemoDoc`)에도 - 어느 칸을 넘길지 정한다.
