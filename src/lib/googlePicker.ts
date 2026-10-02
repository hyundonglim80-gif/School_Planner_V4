// src/lib/googlePicker.ts
//
// 구글 파일 선택창(Picker)을 띄워 폴더 하나를 고르게 한다.
//
// ⚠️ 왜 이런 번거로운 것을 두는가.
//    이 앱이 받아 둔 드라이브 권한은 'drive.file' 하나뿐이다. 이 권한은
//    "이 앱이 만들었거나, 사용자가 이 앱에 직접 건네준 파일"만 보게 해 준다.
//    선생님이 드라이브에서 손수 만든 School_Planner_Students_Poto 폴더는
//    앱 눈에 아예 보이지 않는다(목록 조회가 빈 배열로 온다. 오류도 안 난다).
//
//    폴더를 통째로 보려면 'drive.readonly'를 받아야 하는데, 그것은 구글이
//    말하는 '제한된 범위'라 미검증 앱 경고 화면이 뜨고, 여러 선생님께
//    나눠 드리려면 심사를 받아야 한다.
//
//    Picker는 그 사이를 지나가는 길이다. 사용자가 선택창에서 폴더를 직접
//    고르면, 그 폴더와 그 안의 파일이 drive.file 권한 안으로 들어온다.
//    한 번만 고르면 폴더 id를 기억해 두므로 다시 물어보지 않는다.
import { GOOGLE_API_KEY, GOOGLE_APP_ID } from './firebase';

const GAPI_SRC = 'https://apis.google.com/js/api.js';

let loading: Promise<void> | null = null;

/** api.js와 picker 꾸러미를 받아 온다. 한 번 받으면 기억한다. */
function loadPicker(): Promise<void> {
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    const done = () => {
      const gapi = (window as any).gapi;
      if (!gapi) return reject(new Error('구글 스크립트를 불러오지 못했습니다.'));
      gapi.load('picker', {
        callback: () => resolve(),
        onerror: () => reject(new Error('구글 파일 선택창을 불러오지 못했습니다.')),
      });
    };

    if ((window as any).gapi) return done();

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GAPI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', done, { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('구글 스크립트를 불러오지 못했습니다.')),
        { once: true }
      );
      return;
    }

    const el = document.createElement('script');
    el.src = GAPI_SRC;
    el.async = true;
    el.defer = true;
    el.onload = done;
    el.onerror = () => reject(new Error('구글 스크립트를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'));
    document.head.appendChild(el);
  }).catch((e) => {
    // 한 번 실패한 것을 기억해 두면 다시는 못 열게 된다
    loading = null;
    throw e;
  });

  return loading;
}

export interface PickedFolder {
  id: string;
  name: string;
}

/**
 * 폴더 하나를 고르게 한다. 고르면 { id, name }, 취소하면 null.
 *
 * 처음 열리는 자리를 School_Planner_Students_Poto 쪽으로 잡아 주고 싶지만,
 * Picker에는 '이 이름부터 열어라'가 없다. 대신 폴더만 고를 수 있게 막고
 * (setSelectFolderEnabled + setMimeTypes), '내 드라이브'부터 보여준다.
 */
export async function pickDriveFolder(
  token: string,
  title = '학생 사진이 담긴 폴더를 골라 주세요'
): Promise<PickedFolder | null> {
  const docs = await showPicker(token, title, (google) =>
    new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder')
  );
  const doc = docs?.[0];
  return doc ? { id: doc.id, name: doc.name } : null;
}

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
}

/** 학생 사진으로 고를 수 있는 그림 (줄여 올릴 수 있는 것만 - 아이폰 HEIC는 브라우저가 못 읽는다) */
export const PICKABLE_IMAGE_TYPES = 'image/png,image/jpeg,image/webp';

/**
 * 드라이브의 그림을 고르게 한다(여러 장도). 취소하면 빈 배열.
 *
 * ⚠️ 폴더가 아니라 '파일'을 고르게 하는 까닭: drive.file 권한은 선택창에서 고른 것만 앱에 열어 준다.
 *    폴더를 고르면 그 안의 하위 폴더 속 사진(손자)은 끝내 안 열렸다(2026-09 시도 - 위 pickDriveFolder 참고).
 *    사진 파일을 직접 고르면 그 파일들이 열리므로 어느 폴더에 있든 받아 올 수 있다(2026-10-02 사용자 요청).
 */
export async function pickDriveImages(
  token: string,
  { title = '사진을 골라 주세요', multiple = false }: { title?: string; multiple?: boolean } = {}
): Promise<PickedFile[]> {
  const lastParent = readLastPhotoParent();
  const docs = await showPicker(token, title, (google) => photoViews(google, lastParent), multiple);
  const picked = (docs || []).map((d: any) => ({ id: d.id, name: d.name, mimeType: d.mimeType || '', parentId: d.parentId || '' }));
  // 다음에 고를 때 그 폴더부터 (반 학생 사진을 한 명씩 고를 때 매번 폴더를 찾아 들어가지 않게)
  if (picked[0]?.parentId) rememberLastPhotoParent(picked[0].parentId);
  return picked.map(({ id, name, mimeType }) => ({ id, name, mimeType }));
}

/** 사진 고르기에서 보이는 것: 폴더(열어 들어가기만, 고르지는 않는다) + 고를 수 있는 그림 */
const FOLDER_AND_IMAGES = `application/vnd.google-apps.folder,${PICKABLE_IMAGE_TYPES}`;

/**
 * 사진 고르기 선택창의 탭들. 드라이브 화면처럼 폴더를 열어 들어가며 고른다 (2026-10-02 사용자 요청).
 *
 * ⚠️ 예전에는 DOCS_IMAGES(모든 사진) 하나에 그림 종류만 걸어서 폴더가 걸러지고, 드라이브의 사진이 폴더 구분 없이
 *    한 줄로 늘어섰다. 폴더 종류도 함께 걸고(setMimeTypes) 내 드라이브 맨 위(setParent('root'))에서 시작하면
 *    폴더를 두 번 눌러 들어가고 위쪽 경로로 되돌아오는 드라이브와 같은 모양이 된다.
 *    구글 선택창에는 왼쪽 폴더 나무가 없다 - 경로(브레드크럼)로 오간다.
 */
function photoViews(google: any, lastParent: string): any[] {
  const P = google.picker;
  const folderView = () =>
    new P.DocsView(P.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMimeTypes(FOLDER_AND_IMAGES)
      .setMode(P.DocsViewMode.LIST);
  const views: any[] = [];
  if (lastParent) views.push(folderView().setParent(lastParent).setLabel('지난번 폴더'));
  views.push(folderView().setParent('root').setLabel('내 드라이브'));
  // setOwnedByMe는 setIncludeFolders와 함께 쓰면 무시된다(구글 설명서) - 폴더는 종류(setMimeTypes)로만 보이게 한다
  views.push(
    new P.DocsView(P.ViewId.DOCS)
      .setOwnedByMe(false)
      .setSelectFolderEnabled(false)
      .setMimeTypes(FOLDER_AND_IMAGES)
      .setMode(P.DocsViewMode.LIST)
      .setLabel('공유 문서함')
  );
  views.push(folderView().setEnableDrives(true).setLabel('공유 드라이브'));
  views.push(
    new P.DocsView(P.ViewId.DOCS_IMAGES).setMimeTypes(PICKABLE_IMAGE_TYPES).setMode(P.DocsViewMode.GRID).setLabel('모든 사진')
  );
  return views;
}

const LAST_PARENT_KEY = 'sp4-photo-pick-parent';
function readLastPhotoParent(): string {
  try {
    return localStorage.getItem(LAST_PARENT_KEY) || '';
  } catch {
    return '';
  }
}
function rememberLastPhotoParent(id: string) {
  try {
    localStorage.setItem(LAST_PARENT_KEY, id);
  } catch {
    /* 시크릿 모드 등 */
  }
}

/** 선택창을 띄우고 고른 문서 목록을 돌려준다. 취소하면 null. */
async function showPicker(
  token: string,
  title: string,
  makeView: (google: any) => any | any[],
  multiple = false
): Promise<any[] | null> {
  await loadPicker();
  const google = (window as any).google;
  if (!google?.picker) throw new Error('구글 파일 선택창을 쓸 수 없습니다.');

  return new Promise<any[] | null>((resolve, reject) => {
    let settled = false;
    let watch: ReturnType<typeof setInterval> | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (watch) clearInterval(watch);
      fn();
    };

    try {
      let builder = new google.picker.PickerBuilder()
        .setOAuthToken(token)
        .setDeveloperKey(GOOGLE_API_KEY)
        .setAppId(GOOGLE_APP_ID)
        .setTitle(title);
      const made = makeView(google);
      for (const v of Array.isArray(made) ? made : [made]) builder = builder.addView(v);
      if (multiple) builder = builder.enableFeature(google.picker.Feature.MULTISELECT_ENABLED);

      const picker = builder
        .setCallback((data: any) => {
          const action = data?.[google.picker.Response.ACTION];
          if (action === google.picker.Action.PICKED) {
            const docs = data[google.picker.Response.DOCUMENTS] || [];
            finish(() => resolve(docs));
          } else if (action === google.picker.Action.CANCEL) {
            finish(() => resolve(null));
          }
        })
        .build();

      picker.setVisible(true);
      /**
       * 선택창을 곁에서 지켜본다.
       *
       * Picker는 제가 잘 열렸을 때만 콜백을 부른다. 키를 거절당하면 창 안에
       * 영문 오류만 띄우고 콜백은 오지 않는다. 그러면 부른 쪽은 약속이 끝나기를
       * 영영 기다리고, 화면의 단추는 '선택창을 여는 중...'에 멈춰 선다.
       * 실제로 그랬다. 그래서 창을 직접 들여다본다.
       *
       * 창 안의 글을 읽어 무엇이 잘못됐는지 가리는 것은 구글이 문구를 바꾸면
       * 못 알아본다. 그때는 '그냥 닫힌 것'으로 떨어지므로 멈추지는 않는다.
       */
      let appeared = false;
      let ticks = 0;
      watch = setInterval(() => {
        const el = document.querySelector<HTMLElement>('.picker-dialog');
        // 닫을 때 요소를 지우지 않고 감추기만 하는 경우가 있어 보이는지까지 본다
        const dialog = el && el.offsetParent !== null ? el : null;

        if (dialog) {
          appeared = true;
          const text = dialog.textContent || '';
          if (/developer key/i.test(text)) {
            try {
              picker.setVisible(false);
            } catch {
              /* 이미 닫혔을 수 있다 */
            }
            finish(() =>
              reject(
                new Error(
                  '구글이 이 앱의 API 키를 받아 주지 않았습니다. 구글 클라우드 콘솔에서 ' +
                    'Picker API를 켜고, 그 키의 [API 제한]에 Google Picker API를 넣어 주세요.'
                )
              )
            );
          }
          return;
        }

        // 떴다가 사라졌으면 사용자가 닫은 것이다
        if (appeared) finish(() => resolve(null));

        // 끝내 뜨지 않으면 지켜보기를 그만둔다 (4분)
        if (++ticks > 600) finish(() => resolve(null));
      }, 400);
    } catch (e) {
      finish(() => reject(e));
    }
  });
}
