// tools/measure-range-row.mjs
//
// 조회 범위 드롭다운과 날짜 칸이 한 줄에 서는지 실제로 잰다.
//
// jsdom에는 배치(layout)가 없어서 단위 테스트로는 '한 줄인지'를 잴 수 없다.
// offsetTop이 늘 0이라 무엇을 재도 통과해 버린다. 진짜 브라우저에서 재야 한다.
//
//   VITE_USE_EMULATOR=1 npm run build && node tools/serve-both.mjs
//   node tools/measure-range-row.mjs
import { chromium } from 'playwright';

const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

/** 두 요소가 같은 줄에 섰는가 — 세로 중심이 4px 안쪽이면 한 줄로 본다 */
const sameRow = (aSel, bSel) =>
  page.evaluate(
    ([a, b]) => {
      const ea = document.querySelector(a);
      const eb = document.querySelector(b);
      if (!ea || !eb) return { ok: false, missing: true };
      const ra = ea.getBoundingClientRect();
      const rb = eb.getBoundingClientRect();
      const gap = Math.abs(ra.top + ra.height / 2 - (rb.top + rb.height / 2));
      return { ok: gap <= 4, gap: Math.round(gap) };
    },
    [aSel, bSel]
  );

async function report(what) {
  for (const [label, sel] of [
    ['시작일', 'input[aria-label="시작일"]'],
    ['종료일', 'input[aria-label="종료일"]'],
  ]) {
    const r = await sameRow('select', sel);
    const verdict = r.missing ? '칸을 못 찾음' : r.ok ? '✔ 한 줄' : `✘ 줄이 갈림 (${r.gap}px 차이)`;
    console.log(`    드롭다운 ↔ ${label}: ${verdict}`);
  }
}

await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(3000);

// ── 검색 팝업 ──
console.log('\n[검색 팝업]');
await page.getByRole('button', { name: /검색/ }).first().click();
await page.getByRole('heading', { name: /검색/ }).waitFor({ timeout: 10000 });
await page.getByRole('combobox').selectOption('sem1'); // 학년도 전체는 날짜 칸이 없다
await page.waitForTimeout(400);
for (const w of [1440, 900, 768, 640, 520, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(300);
  console.log(`  ${w}px`);
  await report();
  await page.screenshot({ path: `tools/report/range-search-${w}.png` });
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

// ── 링크 추가 팝업 (하루 화면의 '+ 새 일정' 안에 있다) ──
console.log('\n[링크 추가 팝업]');
await page.getByRole('button', { name: /새 일정/ }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /링크 추가/ }).first().click();
await page.waitForTimeout(2000);
for (const w of [1440, 900, 768, 640, 520, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(300);
  console.log(`  ${w}px`);
  await report();
  await page.screenshot({ path: `tools/report/range-linker-${w}.png` });
}

await browser.close();
process.exit(0);
