// tools/inspect-share-target.mjs
//
// 다른 앱에서 공유받기(Web Share Target)를 실제 크롬으로 본다.
//   - manifest.json에 share_target(POST, 글·주소·파일)이 있다
//   - 서비스 워커가 './share-target' POST를 받아 '?share=<id>'로 넘기고, 앱이 새 메모 칸에 채운다
//   - 주소에서 공유 표시가 지워지고 캐시도 비워진다 (새로고침해도 다시 열리지 않는다)
//   - 같이 받은 파일은 '📥 공유받은 파일'로 뜨고 빼기로 뺀다 (드라이브 올리기는 에뮬레이터에 구글 토큰이 없어 못 본다)
//   - 서비스 워커 없이 GET(?text=…)으로 와도 채운다
//   - 저장을 눌러야 메모가 생긴다 (만든 메모는 끝에 지운다)
// 안드로이드 공유 창은 흉내 낼 수 없어, 같은 모양의 POST 양식을 앱 안에서 보낸다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-share-target.mjs
import { chromium } from 'playwright';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('dialog', (d) => d.accept());

const waitApp = () => page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
const memoPanel = () => page.getByRole('complementary', { name: '메모 쓰기' });

/** 안드로이드가 보내는 것과 같은 모양의 POST (multipart) 를 보낸다 */
const postShare = async ({ title = '', text = '', url = '', files = [] }) => {
  await Promise.all([
    page.waitForURL(/index\.html/, { timeout: 20000 }),
    page.evaluate(
      ({ title, text, url, files }) => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.enctype = 'multipart/form-data';
        form.action = './share-target';
        for (const [k, v] of Object.entries({ title, text, url })) {
          const i = document.createElement('input');
          i.type = 'hidden';
          i.name = k;
          i.value = v;
          form.appendChild(i);
        }
        const fi = document.createElement('input');
        fi.type = 'file';
        fi.name = 'files';
        fi.multiple = true;
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(new File([f.body], f.name, { type: f.type }));
        fi.files = dt.files;
        form.appendChild(fi);
        document.body.appendChild(form);
        form.submit();
      },
      { title, text, url, files }
    ),
  ]);
  await waitApp();
};

await page.goto(V4, { waitUntil: 'domcontentloaded' });
await waitApp();

// 1. 매니페스트
const manifest = await page.evaluate(async () => (await fetch('./manifest.json')).json());
const st = manifest.share_target || {};
check(
  '매니페스트 share_target (POST·multipart·글·주소·파일)',
  st.method === 'POST' && st.enctype === 'multipart/form-data' && st.params?.text === 'text' && st.params?.files?.[0]?.name === 'files',
  JSON.stringify(st).slice(0, 120)
);

// 서비스 워커가 이 페이지를 맡을 때까지 (처음 연 페이지는 새로고침해야 맡는다)
await page.evaluate(() => navigator.serviceWorker.ready);
if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitApp();
}
check('서비스 워커가 페이지를 맡는다', await page.evaluate(() => !!navigator.serviceWorker.controller));

// 2. 글·주소 공유
await postShare({ title: '공유 점검 기사', text: '공유 점검 본문 https://example.com/a', url: 'https://example.com/a' });
const box = memoPanel().locator('textarea').first();
await box.waitFor({ timeout: 10000 }).catch(() => {});
const val = await box.inputValue().catch(() => '');
check('새 메모 칸에 제목·글이 채워진다 (주소는 한 번만)', val === '공유 점검 기사\n공유 점검 본문 https://example.com/a', JSON.stringify(val));
check('주소에서 공유 표시가 지워진다', !page.url().includes('share='), page.url());
check('안내가 뜬다', await page.getByText('공유받은 내용을 새 메모에 담았습니다').first().waitFor({ timeout: 5000 }).then(() => true, () => false));
const leftKeys = await page.evaluate(async () => (await (await caches.open('sp4share-inbox')).keys()).length);
check('받은 것을 꺼낸 뒤 캐시가 빈다', leftKeys === 0, `남은 것 ${leftKeys}`);
check('새 메모라 삭제 단추가 없다 (아직 저장 전)', (await memoPanel().getByRole('button', { name: '삭제' }).count()) === 0);

// 3. 새로고침해도 다시 열리지 않는다
await page.reload({ waitUntil: 'domcontentloaded' });
await waitApp();
await page.waitForTimeout(1500);
check('새로고침하면 다시 열리지 않는다', (await memoPanel().count()) === 0);

// 4. 파일 함께 공유
await postShare({
  text: '사진 공유 점검',
  files: [
    { name: '칠판.png', type: 'image/png', body: 'png-bytes' },
    { name: '안내문.pdf', type: 'application/pdf', body: 'pdf-bytes' },
  ],
});
const bar = memoPanel().locator('[data-shared-files]');
await bar.waitFor({ timeout: 10000 }).catch(() => {});
const barText = (await bar.textContent().catch(() => '')) || '';
check('공유받은 파일 2개가 뜬다', barText.includes('공유받은 파일 2개') && barText.includes('칠판.png') && barText.includes('안내문.pdf'), barText.slice(0, 80));
check('파일과 함께 온 글도 채워진다', (await memoPanel().locator('textarea').first().inputValue()) === '사진 공유 점검');
await bar.getByRole('button', { name: '빼기' }).click();
check('빼기를 누르면 파일 목록이 사라진다', (await bar.count()) === 0);

// 5. 저장해야 메모가 생긴다 → 만든 메모는 지운다
await memoPanel().getByRole('button', { name: '저장', exact: true }).click();
await page.getByText('메모을(를) 저장했습니다').first().waitFor({ timeout: 10000 }).catch(() => {});
const del = memoPanel().getByRole('button', { name: '삭제' });
check('저장하면 메모가 되어 고치는 칸이 된다', (await del.count()) > 0);
if (await del.count()) {
  await del.first().click();
  await page.waitForTimeout(800);
  const confirm = page.getByRole('button', { name: /^(삭제|지우기|확인)$/ }).last();
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.getByText('메모를 삭제했습니다').first().waitFor({ timeout: 10000 }).catch(() => {});
}

// 6. 서비스 워커 없이 GET으로 와도
await page.goto(`${V4}index.html?title=${encodeURIComponent('GET 제목')}&text=${encodeURIComponent('GET 본문')}`, { waitUntil: 'domcontentloaded' });
await waitApp();
const getBox = memoPanel().locator('textarea').first();
await getBox.waitFor({ timeout: 10000 }).catch(() => {});
check('GET(?title=&text=)으로 와도 채운다', (await getBox.inputValue().catch(() => '')) === 'GET 제목\nGET 본문');
check('GET 표시도 주소에서 지워진다', !/[?&](title|text)=/.test(page.url()), page.url());
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
check('ESC는 저장 안 한 글이 있어 묻고 닫는다 (메모는 안 생긴다)', (await memoPanel().count()) === 0);

check('페이지 오류 없음', logs.length === 0, logs.join(' | '));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} 통과`);
process.exit(bad.length ? 1 : 0);
