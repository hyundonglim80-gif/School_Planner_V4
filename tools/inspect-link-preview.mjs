// tools/inspect-link-preview.mjs
//
// 사이트 주소·지도 링크 미리보기 (2026-10-07) - 실제 크롬으로 본다 (PC 1400px, teacher).
//   - 메모 카드(펼침)에 유튜브·지도·사이트 카드 셋, 구글 지도는 '지도 보기'로 작은 지도
//   - 카드를 눌러도 쓰는 칸이 열리지 않는다(새 탭으로 연다), 쓰는 칸에서도 글 아래에 미리보기
// 컨테이너는 바깥 그림(유튜브·아이콘)을 받지 못한다 - 카드 모양만 본다. 점검이 만든 메모는 지운다.
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, deleteDoc, doc, setDoc } from 'firebase/firestore';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-linkp');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const ref = doc(db, 'users', user.uid, 'tasks', 'memo_linkp');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.route(/youtube\.com|google\.com\/s2|maps\.google\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }));
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
try {
  await setDoc(ref, {
    content: '점검링크 견학\nhttps://www.youtube.com/watch?v=abc123\nhttps://www.google.com/maps/place/%EA%B2%BD%EB%B3%B5%EA%B6%81/@37.5796,126.977,17z\nhttps://www.neis.go.kr/main.do',
    labels: ['업무'], createdAt: Date.now(), completed: false, order: -Date.now() - 3e9,
  });
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click({ timeout: 40000 });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.getByRole('button', { name: '메모', exact: true }).first().click();
  await page.waitForTimeout(1200);
  const all = page.getByRole('button', { name: /전체 메모/ }).first();
  if (await all.count()) await all.click();
  const card = page.locator('[data-entry-card="memo"]', { hasText: '점검링크' }).first();
  await card.waitFor();
  if (await card.getByTitle('펼치기').count()) await card.getByTitle('펼치기').click();
  const kinds = await card.locator('[data-link-preview]').evaluateAll((els) => els.map((e) => e.getAttribute('data-link-preview')));
  check('메모 카드에 유튜브·지도·사이트 미리보기', kinds.join(',') === 'youtube,map,site', kinds.join(','));
  check("지도 카드 제목 '경복궁', 사이트 카드 'neis.go.kr'", /경복궁/.test(await card.locator('[data-link-preview="map"]').innerText()) && /neis\.go\.kr/.test(await card.locator('[data-link-preview="site"]').innerText()));
  await card.locator('[data-link-preview-map]').click();
  check("'지도 보기' → 작은 지도(iframe output=embed)", /output=embed/.test((await card.locator('[data-link-preview="map"] iframe').getAttribute('src')) || ''));
  const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null), card.locator('[data-link-preview="site"] a').click()]);
  await page.waitForTimeout(500);
  check('미리보기를 누르면 새 탭, 쓰는 칸은 열리지 않는다', !!popup && (await page.locator('aside[aria-label="메모 쓰기"]').count()) === 0);
  if (popup) await popup.close();
  await page.getByRole('button', { name: /새 메모/ }).first().click();
  const panel = page.locator('aside[aria-label="메모 쓰기"]').first();
  await panel.locator('textarea').first().fill('https://map.naver.com/p/search/%EB%82%A8%EC%82%B0%ED%83%80%EC%9B%8C');
  check('쓰는 칸 글 아래에도 미리보기 (네이버 지도 남산타워)', /남산타워/.test(await panel.locator('[data-link-preview="map"]').innerText()));
  await page.keyboard.press('Escape');
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await browser.close();
  await deleteDoc(ref);
}
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
