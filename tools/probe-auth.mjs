import { chromium } from 'playwright';
const BASE = 'http://localhost:4190';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/School_Planner_V4/`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
const p3 = await ctx.newPage();
await p3.goto(`${BASE}/School_Planner_V3/`, { waitUntil: 'domcontentloaded' });
await p3.waitForTimeout(9000);
const dump = await page.evaluate(async () => {
  return await new Promise((resolve) => {
    const req = indexedDB.open('firebaseLocalStorageDb');
    req.onerror = () => resolve('open 실패');
    req.onsuccess = () => {
      const dbh = req.result;
      try {
        const tx = dbh.transaction('firebaseLocalStorage', 'readonly');
        const all = tx.objectStore('firebaseLocalStorage').getAll();
        all.onsuccess = () => resolve(all.result.map((r) => ({
          key: r.fbase_key,
          email: r.value?.email, uid: r.value?.uid,
        })));
        all.onerror = () => resolve('getAll 실패');
      } catch (e) { resolve('store 없음: ' + e.message); }
    };
  });
});
console.log(JSON.stringify(dump, null, 1));
await browser.close(); process.exit(0);
