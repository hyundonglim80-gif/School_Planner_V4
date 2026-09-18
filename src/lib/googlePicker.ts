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
  await loadPicker();
  const google = (window as any).google;
  if (!google?.picker) throw new Error('구글 파일 선택창을 쓸 수 없습니다.');

  return new Promise<PickedFolder | null>((resolve, reject) => {
    let settled = false;
    let watch: ReturnType<typeof setInterval> | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (watch) clearInterval(watch);
      fn();
    };

    try {
      const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes('application/vnd.google-apps.folder');

      const picker = new google.picker.PickerBuilder()
        .setOAuthToken(token)
        .setDeveloperKey(GOOGLE_API_KEY)
        .setAppId(GOOGLE_APP_ID)
        .setTitle(title)
        .addView(view)
        .setCallback((data: any) => {
          const action = data?.[google.picker.Response.ACTION];
          if (action === google.picker.Action.PICKED) {
            const doc = data[google.picker.Response.DOCUMENTS]?.[0];
            finish(() => resolve(doc ? { id: doc.id, name: doc.name } : null));
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
