// tools/inspect-batch-1007.mjs
//
// 2026-10-07 요청 묶음 - 바뀐 부분만 실제 크롬으로 본다 (PC 1400px).
//   teacher : 새 메모 첫 줄 '#라벨' → 라벨·줄 사라짐 / 메모 카드: 라벨 둘이 한 줄, 체크한 줄은 아래 묶음(줄긋기·바탕)
//             라벨 관리: 라벨 목록에 따로 스크롤이 없다(창 전체가 스크롤)
//   teacher3: 시간표 창 '교사 구분' 셋, 지금 '전담'이 골라져 있다
//             새 메모에 '학생 기록(누가기록)' → 학생 태그 → 저장 → ⋮ 학생 기록(누가기록)에 '📝 메모'로 모이고 누르면 메모 칸이 열린다
//             직접 고르기 줄(학년도·학년·반·번호)로 '#26050203' 넣기
// 점검이 만든 메모는 끝에 지운다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-batch-1007.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, setDoc } from 'firebase/firestore';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const MARK = '점검1007';

async function account(email) {
  const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, `inspect-1007-${email}`);
  const db = getFirestore(app);
  const auth = getAuth(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const { user } = await signInWithEmailAndPassword(auth, email, 'test1234');
  const memos = async () =>
    (await getDocsFromServer(collection(db, 'users', user.uid, 'tasks'))).docs.filter((d) => String(d.data().content || '').includes(MARK));
  const labelsRef = doc(db, 'users', user.uid, 'settings', 'labels');
  const readLabels = async () => {
    const s = await getDocFromServer(labelsRef);
    return s.exists() ? s.data() : null;
  };
  return { db, user, memos, labelsRef, readLabels };
}
const t1 = await account('teacher@example.com');
const t3 = await account('teacher3@example.com');
const labelsBefore = await t1.readLabels();

async function until(fn, ok, timeout = 10000) {
  const t0 = Date.now();
  let v = await fn();
  while (!ok(v) && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 300));
    v = await fn();
  }
  return v;
}
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function open(as) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await page.goto(`${V4}${as ? `?as=${as}` : ''}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click({ timeout: 40000 });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1000);
  return { ctx, page };
}
async function newMemo(page) {
  await page.getByRole('button', { name: '메모', exact: true }).first().click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /새 메모/ }).first().click();
  const panel = page.locator('aside[aria-label="메모 쓰기"]').first();
  await panel.waitFor();
  return panel;
}

try {
  // ── teacher ──
  {
    const { ctx, page } = await open();
    const panel = await newMemo(page);
    await panel.locator('textarea').first().fill(`#첫줄라벨1007 #업무\n${MARK} 첫 줄 라벨`);
    check("첫 줄 '#라벨'도 미리보기 칩", (await panel.locator('[data-hash-label="첫줄라벨1007"]').count()) === 1);
    await panel.locator('textarea').first().press('Control+s');
    const m = (await until(t1.memos, (ds) => ds.length === 1))[0]?.data();
    check("저장 → 첫 줄이 라벨이 되고 글에서 사라진다", m?.content === `${MARK} 첫 줄 라벨` && (m?.labels || []).includes('첫줄라벨1007') && (m?.labels || []).includes('업무'), JSON.stringify({ c: m?.content, l: m?.labels }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // 카드: 라벨 한 줄 + 체크한 줄 아래
    const id = 'memo_1007_card';
    await setDoc(doc(t1.db, 'users', t1.user.uid, 'tasks', id), {
      content: `${MARK} 장보기\n☑ 우유\n☐ 빵`, labels: ['긴급', '업무'], createdAt: Date.now(), completed: false, order: -Date.now() - 2e9,
    });
    await page.waitForTimeout(1500);
    const all = page.getByRole('button', { name: /전체 메모/ }).first();
    if (await all.count()) await all.click();
    const card = page.locator('[data-entry-card="memo"]', { hasText: `${MARK} 장보기` }).first();
    await card.waitFor();
    const tops = await card.locator('[data-entry-card-label]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    check('메모 카드: 라벨 둘이 한 줄에', tops.length === 2 && tops[0] === tops[1], tops.join(','));
    const doneSec = card.locator('[data-check-done-section]');
    const order = await card.evaluate((el) => el.innerText.indexOf('빵') < el.innerText.indexOf('우유'));
    check('체크한 줄(우유)은 아래 묶음으로, 줄긋기·바탕', (await doneSec.count()) === 1 && order && /line-through/.test((await doneSec.locator('[data-check-line]').first().getAttribute('class')) || '') && /bg-slate-100/.test((await doneSec.locator('[data-check-line]').first().getAttribute('class')) || ''));

    // 라벨 관리: 목록에 따로 스크롤 없음
    await page.getByTitle('더보기 메뉴').click();
    await page.getByRole('button', { name: /라벨 관리/ }).click();
    const dlg = page.locator('[role=dialog]', { hasText: '라벨 관리' }).last();
    await dlg.locator('[data-label-row]').first().waitFor().catch(() => {});
    await dlg.locator('input[data-gcal-label]').first().waitFor();
    const inner = await dlg.locator('input[data-gcal-label]').first().evaluate((el) => {
      const out = [];
      for (let p = el.parentElement; p && p.getAttribute('role') !== 'dialog'; p = p.parentElement) {
        const st = getComputedStyle(p);
        if (/(auto|scroll)/.test(st.overflowY)) out.push(p.className.slice(0, 40));
      }
      return out;
    });
    check('라벨 관리: 라벨 목록 따로 스크롤 없이 창 내용 전체가 하나로 스크롤', inner.length === 1 && /overflow-y-auto/.test(inner[0]), inner.join(' | '));
    await page.keyboard.press('Escape');
    await ctx.close();
  }

  // ── teacher3 ──
  {
    const { ctx, page } = await open(3);
    await page.getByTitle('더보기 메뉴').click();
    await page.getByRole('button', { name: /^⏰\s*시간표/ }).click();
    const box = page.locator('[data-teacher-preset]');
    await box.waitFor();
    const labels = await box.locator('[data-teacher-preset-option]').allInnerTexts();
    check("시간표 창 '교사 구분' 셋: (초등) 담임 / 전담 / (중등) 전담 + 담임, 지금 '전담'", labels.join('|') === '(초등) 담임|전담|(중등) 전담 + 담임' && (await box.locator('[data-teacher-preset-option="subject"]').getAttribute('aria-pressed')) === 'true', labels.join('|'));
    check('시간표 칸은 학년-반·과목 두 칸', (await page.locator('[data-slot-pair]').count()) > 0 && (await page.locator('input[data-slot-subject-input]').count()) > 0);
    await page.getByTitle('닫기').first().click();
    await page.waitForTimeout(500);

    const panel = await newMemo(page);
    const ta = panel.locator('textarea').first();
    await ta.fill(`${MARK} 메모에 학생 태그`);
    await panel.getByRole('button', { name: /학생 기록\(누가기록\)/ }).click();
    await panel.locator('button[title^="#"]').first().waitFor();
    await panel.locator('button[title^="#"]').first().click();
    const tag = ((await ta.inputValue()).match(/#\d{8}/) || [])[0];
    check('메모 쓰는 칸에도 학생 태그 넣기 (명렬표에서)', !!tag, await ta.inputValue());
    const manual = panel.locator('[data-student-tag-manual]');
    check('직접 고르기 줄(학년도·학년·반·번호)이 있다', (await manual.count()) === 1);
    await manual.getByLabel('학년도').selectOption('2026');
    await manual.getByLabel('학년', { exact: true }).selectOption('5');
    await manual.getByLabel('반', { exact: true }).selectOption('2');
    await manual.getByLabel('번호').selectOption('3');
    await manual.locator('[data-student-tag-manual-add]').click();
    check("직접 고르기로 '#26050203' 넣기", (await ta.inputValue()).includes('#26050203'), await ta.inputValue());
    await ta.press('Control+s');
    await until(t3.memos, (ds) => ds.length === 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    await page.getByTitle('더보기 메뉴').click();
    await page.getByRole('button', { name: /학생 기록\(누가기록\)/ }).first().click();
    await page.getByLabel('학생 번호로 찾기').fill(tag);
    await page.getByRole('button', { name: '찾기', exact: true }).click();
    const item = page.locator('[data-scroll-lock] button', { hasText: `${MARK} 메모에 학생 태그` }).first();
    await item.waitFor({ timeout: 15000 }).catch(() => {});
    check("학생 기록(누가기록)에 메모가 '📝 메모'로 모인다", (await item.count()) === 1 && (await item.locator('[data-timeline-kind="memo"]').count()) === 1);
    if (await item.count()) {
      await item.click();
      check('누르면 메모 쓰는 칸이 열린다', await page.locator('aside[aria-label="메모 쓰기"]').first().waitFor({ timeout: 8000 }).then(() => true, () => false));
    }
    await ctx.close();
  }
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await browser.close();
  for (const d of await t1.memos()) await deleteDoc(d.ref);
  for (const d of await t3.memos()) await deleteDoc(d.ref);
  if (labelsBefore) await setDoc(t1.labelsRef, labelsBefore);
}
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
