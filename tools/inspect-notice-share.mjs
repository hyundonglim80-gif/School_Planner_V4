// tools/inspect-notice-share.mjs
//
// 알림장 공유 단추(docs/ROADMAP.md 6-7)를 실제 크롬으로 본다.
//   - 공유 창(navigator.share)이 있으면 미리 보기에 📤 공유, 누르면 제목·번호 붙은 글을 넘긴다
//   - 공유 창을 닫아도(AbortError) 아무 안내 없이 그만, 막히면 복사로 대신한다
//   - 공유 창이 없는 브라우저에는 단추가 없다 (📋 복사만)
//   - 모아 보기의 날마다에도 📤 공유
// 공유 창은 흉내 낸다(addInitScript). 알림장은 저장하지 않는다(글을 지우고 닫는다).
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-notice-share.mjs
import { chromium } from 'playwright';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

/** mode: 'ok' = 보낸다, 'abort' = 사용자가 닫는다, 'deny' = 막힌다, 'none' = 공유 창이 없다 */
const openNotice = async (browser, mode) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript((m) => {
    window.__shared = [];
    if (m === 'none') {
      try { delete Navigator.prototype.share; } catch {}
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      return;
    }
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data) => {
        window.__shared.push(data);
        if (m === 'abort') throw new DOMException('닫음', 'AbortError');
        if (m === 'deny') throw new DOMException('막힘', 'NotAllowedError');
      },
    });
  }, mode);
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.getByRole('button', { name: '📢 알림장' }).first().click();
  const panel = page.getByRole('complementary', { name: '알림장 쓰기' });
  const box = panel.getByLabel('알림장 내용');
  await box.waitFor({ timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('[aria-label="알림장 내용"]')?.disabled, null, { timeout: 10000 });
  return { ctx, page, panel, box, logs };
};

/** 적은 글을 지우고 닫는다 (저장하지 않는다) */
const discard = async ({ ctx, box, page }, original) => {
  await box.fill(original);
  await page.keyboard.press('Escape');
  await ctx.close();
};

const run = async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const allLogs = [];

  // ── 1. 공유 창이 있으면: 📤 공유 → 제목·글을 넘긴다 ──
  {
    const s = await openNotice(browser, 'ok');
    const original = await s.box.inputValue();
    await s.box.fill('공유 점검 색연필\n공유 점검 동의서');
    const share = s.panel.getByRole('button', { name: '📤 공유' }).first();
    check('미리 보기에 📤 공유가 보인다', await share.isVisible());
    check('📋 복사도 그대로 있다', await s.panel.getByRole('button', { name: '📋 복사' }).first().isVisible());
    await share.click();
    await s.page.waitForTimeout(400);
    const sent = await s.page.evaluate(() => window.__shared);
    const data = sent[0] || {};
    check('공유 창에 한 번 넘겼다', sent.length === 1, JSON.stringify(sent));
    check('제목은 "날짜 알림장"', /^\d+\/\d+\(.\) 알림장$/.test(data.title || ''), data.title);
    check('글은 날짜 머리 + 번호 붙인 줄', /^\[\d+\/\d+\(.\) 알림장\]\n1\. 공유 점검 색연필\n2\. 공유 점검 동의서/.test(data.text || ''), JSON.stringify(data.text));
    await s.page.screenshot({ path: 'tools/report/notice-share.png' });

    // 모아 보기에도 (적어 둔 알림장이 있을 때)
    await s.panel.getByRole('button', { name: '📚 모아 보기' }).click();
    await s.panel.getByLabel('알림장 모아 보기 기간').selectOption('year');
    await s.page.waitForTimeout(1500);
    const days = await s.panel.getByRole('button', { name: '📋 복사' }).count();
    const shares = await s.panel.getByRole('button', { name: '📤 공유' }).count();
    check('모아 보기의 날마다 📤 공유', days === 0 || shares === days, `복사 ${days} · 공유 ${shares}`);
    await s.panel.getByRole('button', { name: '✏️ 쓰기' }).click();
    await discard(s, original);
    allLogs.push(...s.logs);
  }

  // ── 2. 공유 창을 닫으면 그만, 막히면 복사 ──
  {
    const s = await openNotice(browser, 'abort');
    const original = await s.box.inputValue();
    await s.box.fill('공유 점검 닫기');
    await s.panel.getByRole('button', { name: '📤 공유' }).first().click();
    await s.page.waitForTimeout(600);
    check('공유 창을 닫으면 복사 안내가 뜨지 않는다', (await s.page.getByText(/복사했습니다/).count()) === 0);
    await discard(s, original);
    allLogs.push(...s.logs);
  }
  {
    const s = await openNotice(browser, 'deny');
    const original = await s.box.inputValue();
    await s.box.fill('공유 점검 막힘');
    await s.panel.getByRole('button', { name: '📤 공유' }).first().click();
    await s.page.getByText(/복사했습니다/).first().waitFor({ timeout: 5000 }).catch(() => {});
    const clip = await s.page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check('공유가 막히면 대신 복사한다', clip.includes('1. 공유 점검 막힘'), JSON.stringify(clip));
    await discard(s, original);
    allLogs.push(...s.logs);
  }

  // ── 3. 공유 창이 없는 브라우저 ──
  {
    const s = await openNotice(browser, 'none');
    const original = await s.box.inputValue();
    await s.box.fill('공유 점검 없음');
    await s.panel.getByRole('button', { name: '📋 복사' }).first().waitFor({ timeout: 5000 });
    check('공유 창이 없으면 📤 공유가 없다', (await s.panel.getByRole('button', { name: '📤 공유' }).count()) === 0);
    await discard(s, original);
    allLogs.push(...s.logs);
  }

  check('페이지 오류 없음', allLogs.length === 0, allLogs.join(' / '));
  await browser.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
