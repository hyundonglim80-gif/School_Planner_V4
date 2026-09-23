// src/lib/keepImport.ts
//
// 구글 Keep 메모를 V4 메모로 옮긴다.
//
// ⚠️ 실시간 연동은 안 된다. Keep API(keep.googleapis.com)는 구글 워크스페이스
//    조직용이고, 관리자가 도메인 전체 위임을 걸어 서비스 계정으로만 부른다.
//    개인 지메일 계정에는 받을 수 있는 권한(scope) 자체가 없다. 그래서 브라우저에서
//    돌아가는 이 앱이 선생님 Keep을 직접 읽을 길은 없다.
//
// 대신 구글이 주는 내보내기(Takeout)를 읽는다. Takeout > Keep을 받으면
// 메모 하나에 .json 하나씩 들어 있다. 그 파일을 그대로 읽어 메모로 만든다.
//
// Takeout 메모 한 건의 생김새 (쓰는 것만 적는다)
//   {
//     "title": "제목",
//     "textContent": "본문",                       // 글 메모
//     "listContent": [{ "text": "항목", "isChecked": false }],  // 목록 메모
//     "labels": [{ "name": "업무" }],
//     "isArchived": false, "isTrashed": false, "isPinned": false,
//     "createdTimestampUsec": 1700000000000000,    // 마이크로초다 (밀리초 아님)
//     "attachments": [{ "filePath": "abc.jpg", "mimetype": "image/jpeg" }]
//   }

export interface KeepNote {
  /** 메모로 저장할 본문 (제목 + 내용) */
  content: string;
  labels: string[];
  /** 만든 때 (밀리초). 없으면 0 */
  createdAt: number;
  archived: boolean;
  trashed: boolean;
  pinned: boolean;
  /** 딸려 있던 파일 이름들. 파일 자체는 가져오지 않는다. */
  attachmentNames: string[];
  /** 어느 파일에서 왔는지 (화면에 보여 줄 때만 쓴다) */
  sourceName?: string;
}

/** 마이크로초 → 밀리초. Takeout은 마이크로초로 준다. */
function usecToMs(usec: unknown): number {
  const n = Number(usec);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // 16자리면 마이크로초, 13자리면 이미 밀리초다 (둘 다 받아 준다)
  return n > 1e14 ? Math.round(n / 1000) : Math.round(n);
}

/** 목록 메모 한 줄. 체크 표시를 글자로 남긴다 (V4 메모는 글 한 덩이다) */
function listLine(item: any): string {
  const text = String(item?.text ?? '').trim();
  if (!text) return '';
  return `${item?.isChecked ? '☑' : '☐'} ${text}`;
}

/**
 * Takeout 메모 한 건(JSON)을 읽는다. 메모가 아니면 null.
 *
 * 제목과 본문은 한 덩이로 붙인다. V4 메모에는 제목 칸이 따로 없어서, 제목을
 * 버리면 무슨 메모인지 알 수 없게 되는 것이 가장 나쁘다.
 */
export function parseKeepNote(raw: any, sourceName?: string): KeepNote | null {
  if (!raw || typeof raw !== 'object') return null;

  const title = String(raw.title ?? '').trim();
  const body = String(raw.textContent ?? '').trim();
  const list = Array.isArray(raw.listContent)
    ? raw.listContent.map(listLine).filter(Boolean).join('\n')
    : '';

  const attachmentNames = Array.isArray(raw.attachments)
    ? raw.attachments
        .map((a: any) => String(a?.filePath ?? '').trim())
        .filter(Boolean)
    : [];

  const parts = [title, body || list].filter(Boolean);
  const content = parts.join('\n');

  // 글도 목록도 제목도 없으면 메모라고 볼 것이 없다.
  // (다만 파일만 딸린 메모는 살린다 - 무엇이 있었는지는 남겨 줘야 한다)
  if (!content && attachmentNames.length === 0) return null;

  const labels = Array.isArray(raw.labels)
    ? raw.labels.map((l: any) => String(l?.name ?? '').trim()).filter(Boolean)
    : [];

  return {
    content,
    labels,
    createdAt: usecToMs(raw.createdTimestampUsec ?? raw.userEditedTimestampUsec),
    archived: !!raw.isArchived,
    trashed: !!raw.isTrashed,
    pinned: !!raw.isPinned,
    attachmentNames,
    sourceName,
  };
}

/**
 * 이 JSON이 Keep 메모인가 (V4 백업 파일과 가려낸다).
 *
 * 백업 파일은 events/schedules/tasks 처럼 갈래별 묶음을 담고, Keep 메모는 글 한 건의
 * 생김새(textContent/listContent/…)를 그대로 갖는다. 내보내기/가져오기 창에 Keep 파일을
 * 넣는 일이 잦아서, 어느 쪽인지 알아보고 맞는 길로 보내려고 쓴다.
 */
export function looksLikeKeepNote(raw: any): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const keepish =
    'textContent' in raw ||
    'listContent' in raw ||
    'isTrashed' in raw ||
    'isArchived' in raw ||
    'userEditedTimestampUsec' in raw;
  const backupish =
    'events' in raw || 'schedules' in raw || 'journals' in raw || 'tasks' in raw || 'rosters' in raw;
  return keepish && !backupish;
}

/** 파일 내용이 Keep 메모인가. 파일을 읽어 본 문자열을 그대로 받는다. */
export function fileLooksLikeKeep(text: string): boolean {
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data.some(looksLikeKeepNote) : looksLikeKeepNote(data);
  } catch {
    return false;
  }
}

/** 파일 하나를 읽는다. Takeout은 메모마다 파일 하나지만, 배열로 준 것도 받아 준다. */
export function parseKeepFile(text: string, sourceName?: string): KeepNote[] {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : [data];
  return list
    .map((item) => parseKeepNote(item, sourceName))
    .filter((n): n is KeepNote => n !== null);
}

export interface KeepImportOptions {
  /** 보관(Archive)한 메모도 가져오는가 */
  includeArchived: boolean;
  /** Keep의 라벨을 메모 라벨로 함께 가져오는가 */
  keepLabels: boolean;
}

/** 실제로 가져올 것만 고른다. 휴지통에 있던 것은 언제나 뺀다. */
export function selectNotesToImport(notes: KeepNote[], opts: KeepImportOptions): KeepNote[] {
  return notes.filter((n) => !n.trashed && (opts.includeArchived || !n.archived));
}

/**
 * 메모로 저장할 모양으로 바꾼다.
 *
 * 딸려 있던 파일은 가져오지 않는다 - Takeout의 이미지는 따로 떨어진 파일이고,
 * 그것까지 옮기려면 드라이브에 하나씩 올려야 한다. 대신 무엇이 붙어 있었는지는
 * 본문 끝에 남겨, 나중에 Takeout 폴더에서 찾을 수 있게 한다.
 */
export function toMemoDraft(
  note: KeepNote,
  opts: KeepImportOptions,
  /** 끝내 못 붙인 파일들. 기본값은 '전부 못 붙였다'. */
  missing: string[] = note.attachmentNames
) {
  const lines = [note.content];
  if (missing.length > 0) {
    lines.push(`📎 Keep에 붙어 있던 파일: ${missing.join(', ')}`);
  }
  return {
    content: lines.filter(Boolean).join('\n'),
    labels: opts.keepLabels ? note.labels : [],
  };
}

/**
 * 같은 Keep 메모인지 알아보는 열쇠.
 *
 * Takeout에는 Keep이 쓰는 메모 id가 들어 있지 않다. 대신 '만든 때'는 마이크로초까지
 * 적혀 있고 메모를 고쳐도 바뀌지 않으므로, 그것을 열쇠로 쓴다. 이 값을 메모에 적어
 * 두면 다음에 또 가져올 때 이미 들어온 것을 알아볼 수 있다.
 */
export function keepIdOf(note: KeepNote): string {
  if (note.createdAt > 0) return `keep_${note.createdAt}`;
  // 만든 때를 모르는 옛 메모는 내용으로 열쇠를 만든다
  let h = 0;
  for (let i = 0; i < note.content.length; i++) {
    h = ((h << 5) - h + note.content.charCodeAt(i)) | 0;
  }
  return `keep_c${Math.abs(h).toString(36)}`;
}

export interface ExistingMemo {
  firestoreId: string;
  content?: string;
  text?: string;
  labels?: string[];
  attachments?: { name?: string }[];
  keepId?: string;
}

/** 이미 들어와 있는 메모를 찾는다. 열쇠가 먼저, 없으면 내용이 똑같은 것. */
export function findExistingMemo(
  note: KeepNote,
  memos: ExistingMemo[],
  draftContent: string
): ExistingMemo | undefined {
  const id = keepIdOf(note);
  const byKey = memos.find((m) => m.keepId === id);
  if (byKey) return byKey;
  // 이 열쇠를 붙이기 전에 가져온 메모도 두 번 들어가면 안 된다
  const body = draftContent.trim();
  return memos.find((m) => !m.keepId && String(m.content ?? m.text ?? '').trim() === body);
}

const sameList = (a: string[], b: string[]) => {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * 이미 있는 메모를 고쳐 써야 하는가.
 * 글·라벨·붙은 파일 가운데 하나라도 달라졌으면 고쳐 쓴다.
 */
export function memoNeedsUpdate(
  draft: { content: string; labels: string[]; attachmentNames: string[] },
  memo: ExistingMemo
): boolean {
  if (String(memo.content ?? memo.text ?? '').trim() !== draft.content.trim()) return true;
  if (!sameList(memo.labels || [], draft.labels)) return true;
  const had = (memo.attachments || []).map((a) => assetKey(String(a?.name ?? ''))).filter(Boolean);
  return !sameList(had, draft.attachmentNames.map(assetKey));
}

/**
 * Keep 라벨을 메모 라벨 목록에 더한다.
 *
 * 메모에 라벨 이름만 붙여 두면 목록에 없는 라벨이 되어, 메모 화면 위의 라벨 단추에
 * 나오지 않고 색도 못 받는다. 그래서 목록에도 넣어 준다.
 * 저장된 모양이 두 가지다(글자만인 것과 {id,name,color}인 것). 있던 모양을 따른다.
 */
export function mergeMemoLabels(existing: any[], names: string[]): any[] {
  const list = Array.isArray(existing) ? [...existing] : [];
  const nameOf = (l: any) => (typeof l === 'string' ? l : String(l?.name ?? ''));
  const has = new Set(list.map(nameOf));
  const asObject = list.length > 0 && typeof list[0] !== 'string';

  for (const name of names) {
    const clean = name.trim();
    if (!clean || has.has(clean)) continue;
    has.add(clean);
    list.push(
      asObject
        ? { id: `memo_keep_${Math.random().toString(36).slice(2, 8)}`, name: clean, color: 'gray' }
        : clean
    );
  }
  return list;
}

/**
 * 파일 이름만 남기고 소문자로. 딸린 파일을 찾을 때 쓰는 열쇠다.
 *
 * Takeout의 filePath는 대개 이름뿐이지만 가끔 폴더가 앞에 붙는다. 그리고 파일
 * 고르기 창에서 받은 이름과 대소문자가 다를 수 있어 맞춰 둔다.
 */
export function assetKey(path: string): string {
  return String(path ?? '')
    .split(/[\\/]/)
    .pop()!
    .trim()
    .toLowerCase();
}
