// tools/inspect-panel-stack.mjs
//
// 쓰는 칸(메모·기록·일정 …)이 바뀌지 않고 쌓이는지 실제 크롬에서 본다.
//   새 일정 칸을 연 채 새 기록을 열면 일정 칸이 기록 칸으로 바뀌던 것.
//   VITE_USE_EMULATOR=1 npm run build && node tools/serve-both.mjs
//   node tools/inspect-panel-stack.mjs
import { chromium } from 'playwright';
const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ok = (y) => (y ? '✔' : '✘');
const EV = '새로운 일정을 입력하세요...';

async function open(w, h) {
  const page = await (await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 768, hasTouch: w < 768 })).newPage();
  await page.goto(V4);
  await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);
  return page;
}

// ── PC ──
{
  const page = await open(1280, 900);
  console.log('[PC 1280]');
  await page.getByRole('button', { name: '일정 추가' }).click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder(EV).fill('쌓기 점검 일정');
  await page.getByRole('button', { name: '기록 추가' }).click();
  await page.waitForTimeout(700);
  const stack = await page.$$eval('#side-column > *', (els) =>
    els.map((e) => ({ label: e.getAttribute('aria-label'), top: Math.round(e.getBoundingClientRect().top) })).sort((a, b) => a.top - b.top)
  );
  console.log(`  새 일정 연 채 새 기록 -> 둘이 쌓이고 기록이 위: ${ok(stack.length === 2 && /기록/.test(stack[0].label) && /일정/.test(stack[1].label))}  ${JSON.stringify(stack)}`);
  console.log(`  아래 일정 칸에 적던 것이 남아 있다: ${ok((await page.getByPlaceholder(EV).inputValue()) === '쌓기 점검 일정')}`);
  // 기록 칸에서 Ctrl+S는 기록만 저장
  const recBox = page.locator('aside[aria-label="기록 쓰기"], aside[aria-label*="기록"]').getByRole('textbox').first();
  await recBox.fill('쌓기 점검 기록');
  await recBox.press('Control+s');
  await page.waitForTimeout(1500);
  const recSaved = (await page.locator('[data-focus-key^="journal"]', { hasText: '쌓기 점검 기록' }).count()) > 0;
  const evSaved = (await page.locator('[data-focus-key^="event"]', { hasText: '쌓기 점검 일정' }).count()) > 0;
  console.log(`  기록 칸의 Ctrl+S는 기록만 저장 (기록 ${recSaved}, 일정 ${evSaved}): ${ok(recSaved && !evSaved)}`);
  // 목록의 일정을 누르면 그 위에 또 쌓인다, 같은 것을 다시 누르면 올라오기만
  await page.locator('[data-focus-key^="event"]').first().click();
  await page.waitForTimeout(700);
  const n3 = await page.locator('#side-column > *').count();
  await page.locator('[data-focus-key^="event"]').first().click();
  await page.waitForTimeout(700);
  const n3b = await page.locator('#side-column > *').count();
  console.log(`  목록 일정을 누르면 셋째 칸, 같은 것을 또 누르면 늘지 않음: ${ok(n3 === 3 && n3b === 3)} (${n3}, ${n3b})`);
  await page.screenshot({ path: 'tools/report/panel-stack-pc.png' });
  // 맨 위 칸만 닫기
  await page.locator('#side-column > *').filter({ has: page.getByRole('heading', { name: '일정 수정' }) }).getByTitle('닫기').first().click();
  await page.waitForTimeout(500);
  console.log(`  맨 위 칸 닫기 -> 그 칸만: ${ok((await page.locator('#side-column > *').count()) === 2)}`);
  await page.goBack();
  await page.waitForTimeout(700);
  console.log(`  뒤로가기 -> 하나 더 닫힘, 앱에 그대로: ${ok((await page.locator('#side-column > *').count()) === 1 && page.url().startsWith(V4))}`);
}

// ── 휴대폰 ──
{
  const page = await open(390, 844);
  console.log('[휴대폰 390]');
  await page.getByRole('button', { name: '일정 추가' }).click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder(EV).fill('휴대폰 쌓기 일정');
  // 덮는 배너 아래의 '기록 추가'는 가려져 있다 - 단축키 대신 store 경로와 같은 화면 흐름: 뒤 화면 단추를 직접 부른다
  await page.getByRole('button', { name: '기록 추가' }).dispatchEvent('click');
  await page.waitForTimeout(800);
  const banners = await page.$$eval('[data-popup-frame], .fixed.inset-0.flex.justify-end', (els) => els.length);
  const recHeading = await page.getByRole('heading', { name: '새 기록' }).isVisible();
  console.log(`  일정 배너 위에 기록 배너가 쌓임: ${ok(recHeading)} (배너 틀 ${banners})`);
  await page.goBack();
  await page.waitForTimeout(800);
  const evBack = await page.getByPlaceholder(EV).isVisible().catch(() => false);
  const evText = evBack ? await page.getByPlaceholder(EV).inputValue() : '';
  console.log(`  뒤로가기 -> 기록 배너만 닫히고 일정 배너가 적던 것째 보임: ${ok(evBack && evText === '휴대폰 쌓기 일정' && !(await page.getByRole('heading', { name: '새 기록' }).isVisible().catch(() => false)))}`);
  await page.goBack();
  await page.waitForTimeout(800);
  console.log(`  뒤로가기 -> 일정 배너도 닫히고 앱에 그대로: ${ok(!(await page.getByPlaceholder(EV).isVisible().catch(() => false)) && page.url().startsWith(V4))}`);
  await page.screenshot({ path: 'tools/report/panel-stack-phone.png' });
}
await b.close();
