// tools/inspect-refine-u2.mjs
//
// 19번 U2 '진도 관리' - 바뀐 부분만 실제 크롬으로 본다 (docs/ROADMAP-REFINE.md U2, PC 1400px).
//   - teacher: 칸 이름 '과목', '한 행 = 한 차시', 교과서 칸(머리줄 5칸 표·옛 4칸 표 붙여넣기), 칸 위 붙여넣기로 교과서·준비물
//   - teacher: 3행에 커서 → '+ 행 추가' → 4행이 새 빈 행·커서, Ctrl+Enter → 그 아래 행, 저장하면 서버 lessons[].page
//   - teacher3: 새 진도 단추 하나('+ 과정' 없음), 과목 + 반 하나(5-2)로 만들기 → 서버 subject·classes, 하루 칸 진도
//   - teacher3: 옛 칸 글자 진도('5-1 과학', classes 없음)는 과목 + 반 하나로 보이고, 고쳐 저장해도 옛 모양 그대로·하루 칸 차시 같음
// 점검이 만든 진도·휴지통 문서는 끝에 지운다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-refine-u2.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  setDoc,
} from 'firebase/firestore';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const MARK = '점검U2';

async function account(email) {
  const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, `inspect-u2-${email}`);
  const db = getFirestore(app);
  const auth = getAuth(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const { user } = await signInWithEmailAndPassword(auth, email, 'test1234');
  const col = (name) => collection(db, 'users', user.uid, name);
  const mine = async () =>
    (await getDocsFromServer(col('v4_progress'))).docs.filter((d) => String(d.data().lessons?.[0]?.content || '').startsWith(MARK));
  const cleanup = async () => {
    for (const d of await mine()) await deleteDoc(d.ref);
    for (const d of (await getDocsFromServer(col('trash'))).docs) {
      const data = d.data();
      if (data.type === 'progress' && String(data.data?.lessons?.[0]?.content || '').startsWith(MARK)) await deleteDoc(d.ref);
    }
  };
  return { db, uid: user.uid, col, mine, cleanup };
}
const t1 = await account('teacher@example.com');
const t3 = await account('teacher3@example.com');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
async function serverUntil(read, ok, timeout = 8000) {
  const t0 = Date.now();
  let v = await read();
  while (!ok(v) && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 250));
    v = await read();
  }
  return [v, Date.now() - t0];
}
const tsv = (rows) => rows.map((r) => r.join('\t')).join('\r\n');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function openApp(as) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await page.goto(`${V4}${as ? `?as=${as}` : ''}`, { waitUntil: 'domcontentloaded' });
  const day = page.getByRole('button', { name: '하루', exact: true }).first();
  await day.waitFor({ timeout: 40000 });
  await day.click();
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);
  return { ctx, page };
}
async function openProgress(page) {
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /진도 관리/ }).click();
  const dlg = page.getByRole('dialog').filter({ hasText: '차시 목록' }).first();
  await dlg.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  return dlg;
}
async function pasteTable(dlg, text) {
  await dlg.locator('[data-progress-paste]').evaluate((el, t) => {
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
  await dlg.page().waitForTimeout(300);
}
const cell = (dlg, r, c) => dlg.locator(`input[data-cell="${r}-${c}"]`);
const contents = (dlg) => dlg.locator('[data-progress-table] input[data-cell$="-2"]').evaluateAll((els) => els.map((e) => e.value));
const focused = (page) => page.evaluate(() => document.activeElement?.getAttribute('data-cell'));
async function goDate(page, date) {
  const direct = page.locator('label', { hasText: '직접 선택' }).locator('input[type=date]');
  await page.getByTitle(/달력에서 날짜 선택/).first().hover();
  await page.waitForTimeout(300);
  if (!(await direct.count())) {
    await page.getByTitle(/달력에서 날짜 선택/).first().click();
    await page.waitForTimeout(300);
  }
  await direct.fill(date);
  await page.mouse.move(5, 600);
  await page.locator(`[data-focus-key^="period:${date}:"]`).first().waitFor({ timeout: 15000 });
}
const markText = async (page, date, p) => {
  const m = page.locator(`[data-focus-key="period:${date}:${p}"]`).first().locator('[data-progress-mark]');
  await m.first().waitFor({ timeout: 8000 }).catch(() => {});
  return (await m.count()) ? (await m.first().innerText()).replace(/\s+/g, ' ') : '';
};

await t1.cleanup();
await t3.cleanup();

try {
  // ── teacher: 칸 이름 · 교과서 칸 · 행 추가 ─────────────────────────
  {
    const { ctx, page } = await openApp('');
    const dlg = await openProgress(page);
    const fresh = dlg.getByRole('button', { name: '+ 새 진도' });
    if (await fresh.count()) await fresh.click();
    check("teacher: 칸 이름이 '과목' (칸 글자 없음)", (await dlg.getByLabel('과목', { exact: true }).count()) === 1 && (await dlg.getByText('칸 글자').count()) === 0);
    check("teacher: '+ 과정' 단추 없음, '한 행 = 한 차시'", (await dlg.locator('[data-new-course]').count()) === 0 && (await dlg.getByText('한 행 = 한 차시').count()) === 1);

    // 머리줄 5칸 표 (교과서 칸)
    await pasteTable(
      dlg,
      tsv([
        ['단원', '차시', '내용', '교과서', '준비물'],
        ['1단원', '1', `${MARK} 1`, '8~9', '공책'],
        ['', '2', `${MARK} 2`, '10~11', ''],
        ['', '3', `${MARK} 3`, '12', ''],
        ['', '4', `${MARK} 4`, '', '자'],
      ])
    );
    const head = await dlg.locator('[data-progress-table] > div').first().innerText();
    check('표 머리: 단원 차시 내용 교과서 준비물', head.replace(/\s+/g, ' ').trim() === '단원 차시 내용 교과서 준비물', head.replace(/\s+/g, ' '));
    check('머리줄 5칸 표 → 교과서·준비물 칸', (await cell(dlg, 0, 3).inputValue()) === '8~9' && (await cell(dlg, 0, 4).inputValue()) === '공책');

    // 옛 4칸 표 (머리줄 없음) - 4번째는 준비물
    await pasteTable(dlg, tsv([['1단원', '1', `${MARK} 옛`, '돋보기']]));
    check('옛 4칸 표(머리줄 없음) → 4번째는 준비물, 교과서는 빈칸', (await cell(dlg, 0, 3).inputValue()) === '' && (await cell(dlg, 0, 4).inputValue()) === '돋보기');

    // 다시 5칸 (머리줄 없음) - 4행
    await pasteTable(
      dlg,
      tsv([1, 2, 3, 4].map((n) => ['1단원', String(n), `${MARK} ${n}`, String(n * 2 + 6), n === 1 ? '공책' : '']))
    );
    check('5칸 표(머리줄 없음) → 교과서 쪽', (await cell(dlg, 1, 3).inputValue()) === '10' && (await cell(dlg, 0, 4).inputValue()) === '공책');

    // 3행(번호 2)에 커서 → '+ 행 추가'
    await cell(dlg, 2, 1).click();
    await dlg.locator('[data-progress-add-row]').click();
    await page.waitForTimeout(300);
    const after = await contents(dlg);
    check(
      "3행에 커서 → '+ 행 추가' → 4행이 새 빈 행",
      after.length === 5 && after[2] === `${MARK} 3` && after[3] === '' && after[4] === `${MARK} 4`,
      after.join(' | ')
    );
    check('새 행의 같은 칸(차시)에 커서', (await focused(page)) === '3-1', await focused(page));
    check("'+ 행 추가' title에 Ctrl + Enter", /Ctrl \+ Enter/.test((await dlg.locator('[data-progress-add-row]').getAttribute('title')) || ''));
    await page.keyboard.type('3-1');
    await cell(dlg, 3, 2).fill(`${MARK} 새 행`);
    await cell(dlg, 3, 2).press('Control+Enter');
    await page.waitForTimeout(300);
    const after2 = await contents(dlg);
    check('Ctrl+Enter → 그 아래에 행, 커서는 새 행 같은 칸', after2.length === 6 && after2[4] === '' && (await focused(page)) === '4-2', `${after2.join(' | ')} / ${await focused(page)}`);
    check('넣은 행에 적은 글이 제자리 (key가 밀리지 않음)', (await cell(dlg, 3, 1).inputValue()) === '3-1' && after2[3] === `${MARK} 새 행`);
    // 빈 행 삭제 (title '행 삭제')
    await dlg.getByLabel('5번째 행 삭제').click();
    check("'행 삭제'로 빈 행을 뺀다", (await contents(dlg)).length === 5);

    // 칸 위 붙여넣기 - 교과서 칸부터 두 칸
    await cell(dlg, 4, 3).evaluate((el) => {
      el.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', '40~41\t색연필');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(200);
    check('교과서 칸 위에 두 칸 붙여넣기 → 교과서·준비물', (await cell(dlg, 4, 3).inputValue()) === '40~41' && (await cell(dlg, 4, 4).inputValue()) === '색연필');

    await dlg.getByLabel('과목', { exact: true }).fill(`${MARK}과목`);
    await dlg.getByLabel('시작일').fill('2026-09-01');
    await cell(dlg, 0, 2).click();
    await page.keyboard.press('Control+s');
    const [docs] = await serverUntil(t1.mine, (v) => v.length === 1);
    const saved = docs[0]?.data();
    check(
      '저장 → 서버 lessons[].page, 행 차례 그대로, _k 없음',
      saved?.key === `${MARK}과목` &&
        saved.lessons.length === 5 &&
        saved.lessons[1].page === '10' &&
        saved.lessons[3].content === `${MARK} 새 행` &&
        saved.lessons[4].page === '40~41' &&
        !('_k' in saved.lessons[0]),
      JSON.stringify(saved?.lessons?.map((l) => l.page))
    );
    await ctx.close();
  }

  // ── teacher3: 과목 + 반 하나 ───────────────────────────────────
  {
    // 옛 칸 글자 진도 (classes 없음) - 5-1
    const legacyRef = doc(t3.col('v4_progress'), 'pg_inspect_u2_legacy');
    const lessons = [1, 2, 3].map((n) => ({ unit: '', no: String(n), content: `${MARK} 옛 ${n}`, supplies: '' }));
    await setDoc(legacyRef, { key: '5-1 과학', startDate: '2026-11-02', lessons, bumps: [], updatedAt: Date.now() });

    const { ctx, page } = await openApp('3');
    await goDate(page, '2026-11-04'); // 수: 1교시 5-2, 2교시 5-1
    const legacyBefore = await markText(page, '2026-11-04', 2);
    check('옛 진도: 11-04 2교시(5-1)가 2/3차시', /2\/3차시/.test(legacyBefore), legacyBefore);

    let dlg = await openProgress(page);
    const newBtn = dlg.locator('[data-new-course]');
    check("teacher3: 새 진도 단추 하나 ('+ 과정 (여러 반)' 없음)", (await newBtn.count()) === 1 && (await dlg.getByText('과정 (여러 반)').count()) === 0);

    // 옛 진도 열기 → 과목 + 반 하나
    await dlg.locator('[data-progress-plan="pg_inspect_u2_legacy"]').click();
    await dlg.locator('[data-course-form]').waitFor({ timeout: 5000 });
    const subj = await dlg.getByLabel('과목', { exact: true }).inputValue();
    const pressed = await dlg.locator('[data-course-class-toggle][aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-course-class-toggle')));
    check("옛 '5-1 과학' 진도 → 과목 '과학' + 반 5-1", subj === '과학' && pressed.join(',') === '5-1', `${subj} / ${pressed.join(',')}`);
    check('손대지 않으면 저장 단추가 꺼져 있다', await dlg.getByRole('button', { name: '💾 저장' }).isDisabled());
    await cell(dlg, 1, 2).fill(`${MARK} 옛 2 (고침)`);
    await dlg.getByRole('button', { name: '💾 저장' }).click();
    const [legacy] = await serverUntil(
      async () => (await getDocFromServer(legacyRef)).data(),
      (v) => v?.lessons?.[1]?.content === `${MARK} 옛 2 (고침)`
    );
    check('옛 진도를 고쳐 저장 → 옛 모양 그대로 (key 5-1 과학, classes 없음)', legacy?.key === '5-1 과학' && !('classes' in legacy) && !('subject' in legacy), JSON.stringify({ key: legacy?.key, classes: legacy?.classes }));

    // 새 진도: 과학 + 5-2 하나
    await newBtn.click();
    await dlg.locator('[data-course-form]').waitFor({ timeout: 5000 });
    await dlg.locator('[data-course-subject="과학"]').click();
    await dlg.locator('[data-course-class-toggle="5-2"]').waitFor({ timeout: 10000 });
    await dlg.locator('[data-course-class-toggle="5-2"]').click();
    await dlg.getByLabel('시작일').fill('2026-11-02');
    await pasteTable(dlg, tsv([1, 2, 3].map((n) => ['1단원', String(n), `${MARK} 새 ${n}`, `${n}0`, ''])));
    const hint = await dlg.locator('[data-course-hint]').innerText();
    check("안내 글: 학년-반 과목 '5-2 과학'", /학년-반 과목 '5-2 과학'/.test(hint), hint);
    await dlg.getByRole('button', { name: '💾 저장' }).click();
    const [mine] = await serverUntil(t3.mine, (v) => v.length === 2);
    const created = mine.map((d) => d.data()).find((d) => String(d.lessons[0].content).includes('새'));
    check(
      '과목 + 반 하나 → 과정 모양 (subject 과학, classes [5-2], page)',
      created?.subject === '과학' && (created?.classes || []).join(',') === '5-2' && created?.lessons?.[0]?.page === '10',
      JSON.stringify({ subject: created?.subject, classes: created?.classes })
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await goDate(page, '2026-11-02'); // 월: 1교시 5-1, 3교시 5-2
    const m1 = await markText(page, '2026-11-02', 1);
    const m3 = await markText(page, '2026-11-02', 3);
    check('하루 칸: 11-02 3교시(5-2) 새 진도 1/3, 1교시(5-1) 옛 진도 1/3', /새 1/.test(m3) && /1\/3차시/.test(m3) && /옛 1/.test(m1), `${m3} | ${m1}`);
    await goDate(page, '2026-11-04');
    const legacyAfter = await markText(page, '2026-11-04', 2);
    check('옛 진도를 저장한 뒤에도 11-04 2교시(5-1) 차시가 같다', /2\/3차시/.test(legacyAfter) && /고침/.test(legacyAfter), legacyAfter);
    await ctx.close();
  }
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await t1.cleanup();
  await t3.cleanup();
  await browser.close();
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
