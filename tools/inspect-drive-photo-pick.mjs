// tools/inspect-drive-photo-pick.mjs
//
// '☁️ 드라이브에서' - 구글 드라이브에 이미 있는 학생 사진을 골라 붙이기를 실제 크롬으로 본다 (2026-10-02 사용자 요청).
//   - 선택창은 드라이브처럼 폴더를 열어 들어가는 탭(지난번 폴더·내 드라이브·공유 문서함·공유 드라이브·모든 사진)
//   - 학급 탭 사진 보기: 빈 칸의 '☁️ 드라이브에서' → 사진 하나 고르기 → 받아서 '학년도-학년-반-번호-이름' 이름으로 학급 폴더에 올라가고 칸에 보인다
//   - 크게 보기의 '☁️ 드라이브에서 고르기'로 바꾸기
//   - 명렬표 관리 '사진 여러 장 업로드'의 '☁️ 구글 드라이브' → 여러 장 고르기 → 파일 이름으로 짝지어 올리기, 짝 없는 파일은 결과 띠에
// 에뮬레이터에는 드라이브도 구글 선택창도 없어 둘 다 흉내 낸다(선택창은 window.__pickDocs를 고른 것으로 돌려준다).
// 실제 선택창이 뜨는지·실제 드라이브 사진이 받아지는지는 실제 사이트에서 본다.
// 올해 학급이 없으면 점검용 9-1을 심었다가 끝에 뺀다. 사진 보기 켬/끔도 끝에 끈다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-drive-photo-pick.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';

const fbApp = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-drive-photo-pick');
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const rosterRef = doc(db, 'users', user.uid, 'settings', 'rosters');

const t0 = new Date();
const AY = t0.getMonth() >= 2 ? t0.getFullYear() : t0.getFullYear() - 1;
const rosterData = (await getDocFromServer(rosterRef)).data() || {};
const before = rosterData.classList || rosterData.rosters || [];
let classes = before;
const hasClass = classes.some((c) => Number(c.year) === AY && (c.students || []).length > 2);
if (!hasClass) {
  classes = [...classes, {
    year: AY, grade: '9', classNum: '1',
    students: [1, 2, 3].map((num) => ({ num, name: `드라이브${num}`, gender: '', isActive: true, note: '' })),
  }];
  await setDoc(rosterRef, { classList: classes, rosters: classes, updatedAt: Date.now() }, { merge: true });
}
const CLS = classes.find((c) => Number(c.year) === AY && (c.students || []).length > 2);
const KEY = `${CLS.year}_${CLS.grade}_${CLS.classNum}`;
const FOLDER = `${CLS.year}-${CLS.grade}-${CLS.classNum}`;
const active = CLS.students.filter((s) => s.isActive !== false).sort((a, b) => a.num - b.num);
const [S1, S2, S3] = active;
const pad = (n) => String(n).padStart(2, '0');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  (${detail})` : ''}`);
};

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR42mP8z8DAwMDAxAAGAA0RAQOwXc+sAAAAAElFTkSuQmCC', 'base64');

// ── 드라이브 흉내: 학급 폴더에 올라간 것만 들고 있다 ──
const uploaded = new Map(); // name -> id
const downloaded = []; // alt=media로 받은 id
let nextId = 1;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(() => {
  sessionStorage.setItem('google_api_token', 'fake-token');
  // 구글 선택창 흉내 - setVisible(true)이면 window.__pickDocs를 고른 것으로 돌려준다
  window.__pickerSeen = [];
  window.gapi = { load: (_n, o) => o.callback() };
  class DocsView {
    constructor(id) { this.o = { viewId: id }; }
    setIncludeFolders(v) { this.o.includeFolders = v; return this; }
    setSelectFolderEnabled() { return this; }
    setMimeTypes(m) { this.o.mimeTypes = m; return this; }
    setMode() { return this; }
    setParent(p) { this.o.parent = p; return this; }
    setLabel(l) { this.o.label = l; return this; }
    setOwnedByMe() { return this; }
    setEnableDrives() { return this; }
  }
  class PickerBuilder {
    constructor() { this.o = { multi: false, views: [] }; }
    setOAuthToken() { return this; }
    setDeveloperKey() { return this; }
    setAppId() { return this; }
    setTitle(t) { this.o.title = t; return this; }
    addView(v) { this.o.views.push(v.o); return this; }
    enableFeature(f) { if (f === 'multi') this.o.multi = true; return this; }
    setCallback(cb) { this.cb = cb; return this; }
    build() {
      const { cb, o } = this;
      return {
        setVisible(on) {
          if (!on) return;
          window.__pickerSeen.push(o);
          const docs = window.__pickDocs || [];
          setTimeout(() => cb(docs.length ? { action: 'picked', docs } : { action: 'cancel' }), 50);
        },
      };
    }
  }
  window.google = {
    picker: {
      DocsView, PickerBuilder,
      ViewId: { DOCS: 'docs', DOCS_IMAGES: 'images', FOLDERS: 'folders' },
      DocsViewMode: { GRID: 'grid', LIST: 'list' },
      Feature: { MULTISELECT_ENABLED: 'multi' },
      Response: { ACTION: 'action', DOCUMENTS: 'docs' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
    },
  };
});
await ctx.route('https://oauth2.googleapis.com/tokeninfo**', (r) => r.fulfill({ status: 200, json: { ok: 1 } }));
await ctx.route('https://www.googleapis.com/upload/drive/v3/files**', (r) => {
  const body = (r.request().postDataBuffer() || Buffer.alloc(0)).toString('utf8');
  const name = (body.match(/"name":"([^"]+)"/) || [])[1] || '?';
  const id = `up-${nextId++}`;
  uploaded.set(name, id);
  return r.fulfill({ status: 200, json: { id, name, modifiedTime: new Date().toISOString() } });
});
await ctx.route('https://www.googleapis.com/drive/v3/files**', (r) => {
  const req = r.request();
  const url = new URL(req.url());
  if (url.searchParams.get('alt') === 'media') {
    downloaded.push(url.pathname.split('/').pop());
    return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  }
  if (req.method() === 'PATCH' || req.method() === 'DELETE') return r.fulfill({ status: 200, json: {} });
  const q = url.searchParams.get('q') || '';
  const named = q.match(/name='([^']+)'/);
  if (q.includes('application/vnd.google-apps.folder') && named) {
    return r.fulfill({ status: 200, json: { files: [{ id: `fold-${named[1]}`, name: named[1] }] } });
  }
  if (q.includes(`'fold-${FOLDER}' in parents`) && !q.includes(' or ') && !named) {
    return r.fulfill({
      status: 200,
      json: { files: [...uploaded].map(([name, id]) => ({ id, name, mimeType: 'image/webp', modifiedTime: '2026-01-01T00:00:00Z' })) },
    });
  }
  return r.fulfill({ status: 200, json: { files: [] } });
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const screen = page.locator('[data-class-screen]');
const section = screen.locator('[data-class-students]');
const seen = () => page.evaluate(() => window.__pickerSeen);
const setPick = (docs) => page.evaluate((d) => { window.__pickDocs = d; }, docs);
const uploadedFor = (s) => [...uploaded.keys()].filter((n) => n.startsWith(`${FOLDER}-${pad(s.num)}-`));

try {
  await page.goto(V4);
  await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
  await page.getByRole('button', { name: '학급', exact: true }).first().click();
  await screen.waitFor({ timeout: 10000 });
  await screen.getByRole('combobox', { name: '학급 고르기' }).selectOption(KEY);
  if ((await section.locator('[data-class-view="photo"]').getAttribute('aria-pressed')) !== 'true') {
    await section.locator('[data-class-view="photo"]').click();
  }
  await section.locator('[data-class-photo-grid]').waitFor({ timeout: 10000 });
  const card1 = section.locator(`[data-class-photo-card="${S1.num}"]`);
  const driveBtn = card1.locator('[data-photo-drive-pick]');
  await driveBtn.waitFor({ timeout: 10000 }).catch(() => {});
  check('학급 탭 사진 보기: 빈 칸에 \'☁️ 드라이브에서\'', (await section.locator('[data-photo-drive-pick]').count()) === active.length);

  // 1) 한 장 고르기
  await page.evaluate(() => localStorage.removeItem('sp4-photo-pick-parent'));
  await setPick([{ id: 'drv-a', name: 'IMG_0001.jpg', mimeType: 'image/jpeg', parentId: 'fold-교실사진' }]);
  await driveBtn.click();
  const got1 = await card1.locator('img').waitFor({ timeout: 15000 }).then(() => true, () => false);
  const s1 = await seen();
  const labels = (o) => (o?.views || []).map((v) => v.label).join(',');
  check('  선택창은 한 장 고르기, 제목에 학생', s1[0]?.multi === false && s1[0]?.title.includes(S1.name), s1[0]?.title);
  check('  드라이브처럼 폴더를 여는 탭: 내 드라이브(맨 위·폴더 보임)부터', labels(s1[0]) === '내 드라이브,공유 문서함,공유 드라이브,모든 사진'
    && s1[0].views[0].parent === 'root' && s1[0].views[0].includeFolders === true && s1[0].views[0].mimeTypes.startsWith('application/vnd.google-apps.folder,'), labels(s1[0]));
  check('  고른 사진을 받아(alt=media) 학생 이름으로 학급 폴더에 올린다', downloaded.includes('drv-a') && uploadedFor(S1).length === 1, uploadedFor(S1).join(','));
  check('  칸에 사진이 보인다', got1);

  // 2) 크게 보기에서 드라이브로 바꾸기
  await card1.locator('img').click();
  const replaceBtn = page.locator('[data-photo-drive-replace]');
  await replaceBtn.waitFor({ timeout: 5000 }).catch(() => {});
  check('크게 보기에 \'☁️ 드라이브에서 고르기\'', (await replaceBtn.count()) === 1);
  const upBefore = uploaded.size;
  await setPick([{ id: 'drv-b', name: '새사진.png', mimeType: 'image/png' }]);
  await replaceBtn.click();
  await page.waitForTimeout(300);
  const s2 = (await seen()).at(-1);
  check('  다음 고르기는 \'지난번 폴더\'(방금 고른 사진의 폴더) 탭부터', s2?.views?.[0]?.label === '지난번 폴더' && s2.views[0].parent === 'fold-교실사진', labels(s2));
  const replaced = await page.waitForFunction(() => !document.querySelector('[data-photo-drive-replace]'), null, { timeout: 15000 }).then(() => true, () => false);
  check('  고르면 받아서 올리고 창이 닫힌다', replaced && downloaded.includes('drv-b') && uploaded.size > upBefore);

  // 3) 취소하면 아무 일도 없다
  const upCount = uploaded.size;
  await setPick([]);
  await section.locator(`[data-class-photo-card="${S3.num}"] [data-photo-drive-pick]`).click();
  await page.waitForTimeout(800);
  check('선택창을 취소하면 아무것도 올리지 않는다', uploaded.size === upCount && (await page.getByText(/가져오지 못했습니다/).count()) === 0);

  // 4) 명렬표 관리 - 여러 장
  await screen.locator('[data-class-tool="roster"]').click();
  const roster = page.getByRole('dialog').last();
  await roster.waitFor({ timeout: 10000 });
  const photoToggle = roster.getByTitle(/사진 칸을 내고|사진 칸을 감추고/);
  if ((await photoToggle.getAttribute('title')).includes('사진 칸을 내고')) await photoToggle.click();
  const many = roster.locator('[data-photo-drive-many]');
  await many.waitFor({ timeout: 10000 }).catch(() => {});
  const group = roster.locator('[data-photo-bulk-group]');
  check('명렬표 관리 \'사진 여러 장 업로드\' 묶음에 📁 기기 · ☁️ 구글 드라이브', (await many.count()) === 1
    && (await group.innerText()).replace(/\s+/g, ' ').includes('사진 여러 장 업로드 📁 기기 ☁️ 구글 드라이브'), (await group.innerText()).replace(/\s+/g, ' '));
  await setPick([
    { id: 'drv-2', name: `${FOLDER}-${pad(S2.num)}-${S2.name}.jpg`, mimeType: 'image/jpeg' },
    { id: 'drv-3', name: `${FOLDER}-${pad(S3.num)}-${S3.name}.jpg`, mimeType: 'image/jpeg' },
    { id: 'drv-x', name: 'IMG_9999.jpg', mimeType: 'image/jpeg' },
  ]);
  await many.click();
  const report = await roster.getByText(/고른 파일 3개 중 2장을 올렸습니다/).waitFor({ timeout: 20000 }).then(() => true, () => false);
  const sMany = (await seen()).at(-1);
  check('  선택창은 여러 장 고르기', sMany?.multi === true && labels(sMany).includes('내 드라이브'), labels(sMany));
  check('  셋 다 받고, 이름이 맞는 둘을 그 학생에게 올린다', ['drv-2', 'drv-3', 'drv-x'].every((id) => downloaded.includes(id)) && uploadedFor(S2).length === 1 && uploadedFor(S3).length === 1);
  check('  결과 띠: 3개 중 2장, 짝 없는 파일 이름', report && (await roster.getByText(/짝을 못 찾은 파일 1개: IMG_9999\.jpg/).count()) > 0);
  // 타일 보기 빈 칸에도 단추가 있다 (지금은 모두 사진이 있어 없다 - 목록/타일 전환만 본다)
  await roster.getByRole('button', { name: '타일', exact: true }).click().catch(() => {});
  await page.waitForTimeout(300);
  check('  타일 보기: 사진이 생긴 칸에는 드라이브 단추가 없다', (await roster.locator('[data-photo-drive-pick]').count()) === 0);

  check('페이지 오류 없음', errors.length === 0, errors.join(' | '));
} finally {
  // 사진 보기 켬/끔을 처음처럼 (다른 점검이 이름 보기를 기대한다)
  await page.evaluate(() => { localStorage.setItem('sp4-class-photos', '0'); localStorage.setItem('sp4-roster-photos', '0'); localStorage.removeItem('sp4-photo-pick-parent'); }).catch(() => {});
  if (!hasClass) await setDoc(rosterRef, { classList: before, rosters: before, updatedAt: Date.now() }, { merge: true });
  await browser.close();
}
console.log(`\n${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
