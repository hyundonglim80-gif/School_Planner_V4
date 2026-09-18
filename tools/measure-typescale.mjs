// 년간 글자 크기가 다른 화면과 맞는지 실제 픽셀로 잰다.
import { chromium } from 'playwright';
const V4 = 'http://localhost:4190/School_Planner_V4/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();
await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(3500);

// 한 화면에서 '날짜 숫자'와 '일정 본문'과 '수업 칩'의 글자 크기를 모은다
async function sizes(tab) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(5000);
  return await page.evaluate(() => {
    const px = (el) => el ? Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10 : null;
    // 요소가 '직접' 가진 글자만 본다(자식 것까지 합치면 엉뚱한 상위 상자가 잡힌다)
    const ownText = (el) =>
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join('')
        .trim();
    const all = Array.from(document.querySelectorAll('*'));
    // 날짜 숫자: 년간은 '12일 (수)', 월간/주간은 숫자만
    const day =
      all.find((e) => /^\d{1,2}일 \(.\)$/.test(ownText(e))) ||
      all.find((e) => /^\d{1,2}$/.test(ownText(e)) && e.className.toString().includes('font-black'));
    const chipBox = all.find((e) => e.className.toString().includes('emerald-300'));
    const chipText = chipBox ? (chipBox.querySelector('span') || chipBox) : null;
    return {
      day: px(day),
      dayClass: day ? (day.className.toString().match(/text-\S+/) || ['?'])[0] : '?',
      chip: px(chipText),
    };
  });
}

const month = await sizes('월간');
const year = await sizes('년간');
const week = await sizes('주간');
console.log('\n화면별 글자 크기(px)');
console.log(`  주간  날짜 ${week.day}px (${week.dayClass})  수업칩 ${week.chip}px`);
console.log(`  월간  날짜 ${month.day}px (${month.dayClass})  수업칩 ${month.chip}px`);
console.log(`  년간  날짜 ${year.day}px (${year.dayClass})  수업칩 ${year.chip}px`);
const ok = year.day !== null && month.day !== null && Math.abs(year.day - month.day) < 0.6;
console.log(`\n  년간 날짜가 월간과 같은가: ${ok ? '✔ 같다' : '✘ 다르다'}`);
await page.screenshot({ path: 'tools/report/year-typescale.png', fullPage: false });
await browser.close(); process.exit(0);
