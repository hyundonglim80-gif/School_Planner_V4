// tools/inspect-google-login.mjs
//
// 구글 토큰이 없을(만료됐을) 때 파일을 첨부하면 '구글 로그인이 필요합니다' 창이 뜨는지 실제 크롬으로 본다
// (2026-10-02 사용자 신고 - 예전엔 브라우저가 로그인 창을 막아 '파일 업로드에 실패했습니다'로만 끝났다).
//   - 📎 파일 첨부로 파일을 고르면(누른 지 오래된 때) 오류가 아니라 묻는 창
//   - 묻는 창의 '구글 로그인'은 로그인 창(팝업)을 실제로 연다 - 브라우저가 막지 않는다
//   - 취소하면 까닭이 붙은 안내('구글 로그인을 하지 않아…'), 기록 칸은 그대로 열려 있다
//   - 캡처 붙여넣기(Ctrl+V)도 같은 창
// 에뮬레이터 계정은 이메일 로그인이라 구글 토큰이 없다 - 토큰이 만료된 것과 같다.
// 실제 드라이브 올리기와 로그인 뒤 이어 올리기는 에뮬레이터 밖이다(단위 테스트 googleApi.test.ts가 본다).
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-google-login.mjs
import { chromium } from 'playwright';

const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();
// 파일 고르기 창에서 한참 고른 뒤처럼 '방금 누른 때가 아님'으로 보이게 한다(headless 크롬은 누른 상태가 오래 남는다).
// 앱은 이것만 보고 로그인 창을 바로 열지 묻는 창을 띄울지 정한다. 묻는 창의 단추는 이것을 보지 않는다.
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'userActivation', { configurable: true, get: () => ({ isActive: false, hasBeenActive: true }) });
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  (${detail})` : ''}`);
};

const prompt = page.locator('[role=dialog]', { has: page.locator('[data-google-login-prompt]') });
const panel = page.locator('#side-column aside').first();

await page.goto(V4);
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.getByRole('button', { name: '하루', exact: true }).first().click().catch(() => {});
await page.waitForTimeout(800);

// ── 1. 📎 파일 첨부 ──
await page.getByRole('button', { name: '기록 추가' }).first().click();
await panel.waitFor({ timeout: 10000 });
await panel.locator('input[type=file]').setInputFiles({ name: '가정통신문.txt', mimeType: 'text/plain', buffer: Buffer.from('점검') });
const shown = await prompt.waitFor({ timeout: 10000 }).then(() => true, () => false);
check('파일을 고르면 \'구글 로그인이 필요합니다\' 창이 뜬다', shown);
check('  그때 \'파일 업로드에 실패했습니다\'가 먼저 뜨지 않는다', (await page.getByText('파일 업로드에 실패했습니다').count()) === 0);
check('  첨부 단추는 \'업로드 중...\'으로 기다린다', (await panel.getByText('업로드 중...').count()) > 0);

// ── 2. '구글 로그인'은 로그인 창을 연다 ──
// Firebase는 로그인 창을 열기 전에 apis.google.com을 읽는다. 클라우드 컨테이너는 그 주소를 막아 창이 열리기 전에
// auth/internal-error로 끝난다 - 그때는 '확인할 수 없음'으로 적고, 묻는 창에 까닭이 뜨고 남는지만 본다.
let gapiBlocked = false;
ctx.on('requestfailed', (r) => { if (r.url().includes('apis.google.com')) gapiBlocked = true; });
ctx.on('response', (r) => { if (r.url().includes('apis.google.com') && r.status() >= 400) gapiBlocked = true; });
if (shown) {
  const popup = await Promise.all([
    ctx.waitForEvent('page', { timeout: 10000 }),
    prompt.getByRole('button', { name: '구글 로그인' }).click(),
  ]).then(([p]) => p, () => null);
  if (popup) {
    check('\'구글 로그인\'을 누르면 로그인 창(팝업)이 열린다 - 브라우저가 막지 않음', true, popup.url().slice(0, 80));
    await popup.close();
    const why = await prompt.getByRole('alert').waitFor({ timeout: 15000 }).then(() => prompt.getByRole('alert').innerText(), () => '');
    check('  로그인 창을 그냥 닫으면 묻는 창에 까닭이 뜨고 창은 남는다', /닫혀/.test(why) && (await prompt.count()) === 1, why);
  } else if (gapiBlocked) {
    console.log('➖ 로그인 창이 열리는지는 확인할 수 없음 - 이 환경이 apis.google.com을 막는다 (실제 사이트에서 본다)');
    const why = await prompt.getByRole('alert').waitFor({ timeout: 15000 }).then(() => prompt.getByRole('alert').innerText(), () => '');
    check('  로그인하지 못하면 묻는 창에 까닭이 뜨고 창은 남는다(다시 누를 수 있다)', !!why && (await prompt.count()) === 1, why);
  } else {
    check('\'구글 로그인\'을 누르면 로그인 창(팝업)이 열린다 - 브라우저가 막지 않음', false);
  }

  // ── 3. 취소 ──
  await prompt.getByRole('button', { name: '취소', exact: true }).click();
  const toast = await page.getByText(/구글 로그인을 하지 않아/).first().waitFor({ timeout: 5000 }).then(() => true, () => false);
  check('취소하면 까닭이 붙은 안내 (\'구글 로그인을 하지 않아…\')', toast);
  check('  묻는 창만 닫히고 기록 칸은 그대로', (await prompt.count()) === 0 && (await panel.isVisible()));
  check('  첨부 단추가 다시 \'파일 첨부\'', await panel.getByText('파일 첨부').first().isVisible());
}

// ── 4. 캡처 붙여넣기 ──
const ta = panel.getByPlaceholder(/오늘 있었던 일을 기록해보세요/);
await ta.focus();
await ta.evaluate((el) => {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([png], 'image.png', { type: 'image/png' }));
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
const pasted = await prompt.waitFor({ timeout: 10000 }).then(() => true, () => false);
check('그림을 붙여넣어도 같은 창이 뜬다', pasted);
if (pasted) {
  await prompt.getByRole('button', { name: '취소', exact: true }).click();
  check('  취소하면 \'이미지 업로드에 실패했습니다\' + 까닭', await page.getByText(/이미지 업로드에 실패했습니다[\s\S]*구글 로그인을 하지 않아/).first().waitFor({ timeout: 5000 }).then(() => true, () => false));
}

// 정리 - 아무것도 저장하지 않았다. 기록 칸을 닫는다.
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const discard = page.getByRole('button', { name: /저장하지 않고|닫기/ });
if (await page.getByText(/저장하지 않은/).count()) await discard.first().click().catch(() => {});

check('페이지 오류 없음', errors.length === 0, errors.join(' | '));
console.log(`\n${pass}/${pass + fail}`);
await b.close();
process.exit(fail ? 1 : 0);
