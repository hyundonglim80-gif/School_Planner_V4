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
export function toMemoDraft(note: KeepNote, opts: KeepImportOptions) {
  const lines = [note.content];
  if (note.attachmentNames.length > 0) {
    lines.push(`📎 Keep에 붙어 있던 파일: ${note.attachmentNames.join(', ')}`);
  }
  return {
    content: lines.filter(Boolean).join('\n'),
    labels: opts.keepLabels ? note.labels : [],
  };
}
