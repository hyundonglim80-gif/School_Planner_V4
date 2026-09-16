// tools/inspect-deep.mjs
//
// 앞선 두 하네스가 손대지 못한 것들.
//   1) 공유 그룹을 둘이서 — A가 만들고 B가 초대 코드로 들어가 같은 일정을 본다
//   2) 규칙 구멍 — 남의 그룹을 아무나 읽고 쓸 수 있는가
//   3) 가져오기 왕복 — 내보낸 것을 되넣으면 원래대로 돌아오는가
//   4) 휴지통 복원
//   5) 날짜를 넘겨 가며 이월 — 시계를 바꿔치기해 하루씩 흘려보낸다
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, deleteDoc, collection, getDocs,
} from 'firebase/firestore';
import {
  getAuth, connectAuthEmulator, signInWithEmailAndPassword,
} from 'firebase/auth';

const URL = process.env.INSPECT_URL || 'http://localhost:4173/';
const OUT = 'tools/report';
mkdirSync(OUT, { recursive: true });

const problems = [];
const notes = [];
const ok = (msg) => console.log(`  ✔ ${msg}`);
const bad = (msg) => { console.log(`  ✘ ${msg}`); problems.push(msg); };

// ── Firestore를 직접 들여다보는 통로 (화면과 별개로 사실 확인용) ──
function client(name) {
  const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, name);
  const db = getFirestore(app);
  const auth = getAuth(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  return { db, auth };
}

function makePage(ctx, bag) {
  return async (as) => {
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') bag.errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => bag.errors.push('PAGEERROR ' + e.message.slice(0, 200)));
    page.on('dialog', async (d) => { bag.dialogs.push(d.message().slice(0, 100)); await d.accept().catch(() => {}); });
    await page.addInitScript(() => {
      window.__toasts = [];
      new MutationObserver((muts) => {
        for (const mu of muts) for (const n of mu.addedNodes) {
          if (n.nodeType === 1 && n.parentElement && n.parentElement.id === 'sp4-toast-container') {
            window.__toasts.push((n.textContent || '').trim());
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(as ? `${URL}?as=${as}` : URL, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
    await page.waitForTimeout(2500);
    return page;
  };
}

const takeToasts = (page) =>
  page.evaluate(() => { const t = (window.__toasts || []).slice(); window.__toasts = []; return t; }).catch(() => []);

const openMenu = async (page, label) => {
  await page.getByRole('button', { name: '⋮' }).first().click();
  await page.waitForTimeout(300);
  const item = page.getByRole('button', { name: new RegExp(label) }).first();
  if (await item.count() === 0) { await page.keyboard.press('Escape'); return false; }
  await item.click();
  await page.waitForTimeout(900);
  return true;
};

async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const bag = { errors: [], dialogs: [] };

  // 계정마다 저장소가 따로여야 하므로 브라우저 컨텍스트를 나눈다
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const newA = makePage(ctxA, bag);
  const newB = makePage(ctxB, bag);

  // ══ 1) 공유 그룹을 둘이서 ══════════════════════════════════════
  console.log('\n[1] 공유 그룹 — A가 만들고 B가 들어간다');
  const A = await newA();

  await openMenu(A, '공유 그룹 관리');
  await A.getByRole('button', { name: /새 그룹 만들기/ }).first().click();
  await A.waitForTimeout(300);
  const groupName = '6학년 공유방';
  await A.locator('input[type="text"]:visible').first().fill(groupName);
  await A.getByRole('button', { name: /만들기|생성/ }).last().click();
  await A.waitForTimeout(2500);

  const aBody = await A.locator('body').innerText();
  const code = (aBody.match(/초대 코드:?\s*([A-Z0-9]{6})/) || [])[1];
  if (!code) { bad('A가 그룹을 만들었는데 초대 코드를 못 읽었다'); }
  else ok(`A가 그룹을 만들고 초대 코드를 받았다: ${code}`);
  await A.screenshot({ path: `${OUT}/d-01-group-A.png` });
  await A.keyboard.press('Escape');
  await A.waitForTimeout(600);

  const B = await newB('2');
  if (code) {
    await openMenu(B, '공유 그룹 관리');
    const joinTab = B.getByRole('button', { name: /초대 코드로 참여/ }).first();
    if (await joinTab.count() === 0) bad('B 쪽에 초대 코드로 참여하는 자리가 없다');
    else {
      await joinTab.click();
      await B.waitForTimeout(400);
      await B.locator('input[type="text"]:visible').first().fill(code);
      await B.getByRole('button', { name: /참여/ }).last().click();
      await B.waitForTimeout(3000);
      await B.screenshot({ path: `${OUT}/d-02-group-B.png` });
      const bBody = await B.locator('body').innerText();
      if (bBody.includes(groupName)) ok('B가 초대 코드로 그룹에 들어갔다');
      else bad(`B가 초대 코드(${code})로 참여하지 못했다 — 알림: ${JSON.stringify(await takeToasts(B))}`);
      await B.keyboard.press('Escape');
      await B.waitForTimeout(600);
    }
  }

  // A가 그룹으로 전환해 일정을 하나 쓰고, B가 그것을 보는가
  const switchToGroup = async (page, who) => {
    const sel = page.locator('select').filter({ hasText: groupName }).first();
    if (await sel.count() === 0) { bad(`${who}: 그룹으로 전환하는 칸을 못 찾았다`); return false; }
    await sel.selectOption({ label: new RegExp(groupName) }).catch(async () => {
      const opts = await sel.locator('option').allTextContents();
      const idx = opts.findIndex((t) => t.includes(groupName));
      if (idx >= 0) await sel.selectOption({ index: idx });
    });
    await page.waitForTimeout(2500);
    return true;
  };

  const shared = '공유 점검용 일정 ' + Date.now().toString(36).slice(-4);
  if (await switchToGroup(A, 'A')) {
    await A.getByRole('button', { name: '+ 새 일정' }).click();
    await A.locator('form textarea, form input[type="text"]').first().fill(shared);
    // ⚠️ Enter를 누르지 말 것. 일정 칸은 textarea라 줄바꿈만 들어가고 저장이 안 된다.
    //    예전 하네스는 이걸로 '저장했다'고 믿고 'B에게 안 보인다'는 엉뚱한 결론을 냈다.
    await A.getByRole('button', { name: '저장', exact: true }).first().click();
    await A.waitForTimeout(3000);
    await A.screenshot({ path: `${OUT}/d-03-group-write-A.png` });

    if (await switchToGroup(B, 'B')) {
      await B.waitForTimeout(2500);
      await B.screenshot({ path: `${OUT}/d-04-group-read-B.png` });
      const seen = await B.getByText(shared).count();
      if (seen > 0) ok('A가 그룹에 쓴 일정을 B가 그대로 본다');
      else bad('A가 그룹에 쓴 일정이 B에게 보이지 않는다');
    }
  }

  // ══ 2) 규칙 구멍 — 남의 그룹을 아무나 읽고 쓸 수 있는가 ═════════
  console.log('\n[2] 규칙 — 그룹에 들어가지 않은 사람이 남의 그룹을 건드릴 수 있는가');
  const c2 = client('ruleprobe');
  await signInWithEmailAndPassword(c2.auth, 'teacher2@example.com', 'test1234');
  const groupsSnap = await getDocs(collection(c2.db, 'groups')).catch(() => null);
  if (!groupsSnap) {
    ok('그룹 목록 전체 조회가 막혀 있다');
  } else {
    notes.push(`로그인만 하면 그룹 ${groupsSnap.size}개를 목록으로 훑을 수 있다 (초대 코드까지 같이 읽힌다)`);
    console.log(`  · 그룹 목록 조회: 됨 (${groupsSnap.size}개) — 규칙이 열려 있다`);
    const codes = [];
    groupsSnap.forEach((d) => { if (d.data().inviteCode) codes.push(d.data().inviteCode); });
    if (codes.length) console.log(`  · 초대 코드도 같이 읽힌다: ${codes.slice(0, 3).join(', ')}`);
  }

  // ══ 3) 가져오기 왕복 ═══════════════════════════════════════════
  console.log('\n[3] 내보낸 것을 되넣으면 원래대로 돌아오는가');
  // 개인 공간으로 돌아온 뒤 진행
  await A.goto(URL, { waitUntil: 'domcontentloaded' });
  await A.getByRole('heading', { name: '일정' }).waitFor({ timeout: 30000 });
  await A.waitForTimeout(2500);

  const c1 = client('roundtrip');
  const cred = await signInWithEmailAndPassword(c1.auth, 'teacher@example.com', 'test1234');
  const uid = cred.user.uid;
  const today = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;

  const beforeSnap = await getDoc(doc(c1.db, 'users', uid, 'events', todayStr));
  const beforeList = beforeSnap.exists() ? (beforeSnap.data().eventList || []) : [];
  console.log(`  · 되넣기 전 오늘 일정 ${beforeList.length}건`);

  await openMenu(A, '내보내기 / 가져오기');
  await A.locator('button[title="JSON"]').first().click();
  await A.waitForTimeout(400);
  const dl = A.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await A.getByRole('button', { name: /내보내기$/ }).last().click();
  const file = await dl;
  await A.waitForTimeout(1500);

  if (!file) {
    bad('JSON 백업 파일을 받지 못해 되넣기를 확인할 수 없다');
  } else {
    const path = `${OUT}/backup.json`;
    await file.saveAs(path);
    const size = readFileSync(path).length;
    ok(`JSON 백업을 받았다 (${Math.round(size / 1024)}KB)`);

    // 되넣기 전에 오늘 일정을 일부러 망가뜨린다
    await setDoc(doc(c1.db, 'users', uid, 'events', todayStr), {
      eventList: [{ id: 'ev_broken', content: '되넣기 전에 일부러 망가뜨린 것', completed: false }],
      eventText: '되넣기 전에 일부러 망가뜨린 것',
      updatedAt: Date.now(),
    });
    console.log('  · 오늘 일정을 일부러 1건으로 바꿔 두었다');

    const chooser = A.waitForEvent('filechooser', { timeout: 20000 }).catch(() => null);
    await A.getByRole('button', { name: /가져오기$/ }).last().click();
    const fc = await chooser;
    if (!fc) {
      bad('가져오기를 눌렀는데 파일 고르는 창이 뜨지 않는다');
    } else {
      await fc.setFiles(path);
      await A.waitForTimeout(12000);
      const msg = await takeToasts(A);
      console.log(`  · 가져오기 알림: ${JSON.stringify(msg)}`);
      await A.screenshot({ path: `${OUT}/d-05-import.png` });

      const afterSnap = await getDoc(doc(c1.db, 'users', uid, 'events', todayStr));
      const afterList = afterSnap.exists() ? (afterSnap.data().eventList || []) : [];
      const restored = afterList.length === beforeList.length;
      const stillBroken = afterList.some((e) => e.id === 'ev_broken');
      console.log(`  · 되넣은 뒤 오늘 일정 ${afterList.length}건 (원래 ${beforeList.length}건)`);
      if (restored && !stillBroken) ok('되넣으니 원래대로 돌아왔다');
      else if (stillBroken) bad(`되넣었는데 망가뜨린 내용이 그대로 남아 있다 (${afterList.length}건)`);
      else bad(`되넣은 뒤 건수가 다르다 — 원래 ${beforeList.length}건, 지금 ${afterList.length}건`);
    }
  }
  await A.keyboard.press('Escape');
  await A.waitForTimeout(800);

  // ══ 4) 휴지통 복원 ═════════════════════════════════════════════
  console.log('\n[4] 지운 것을 휴지통에서 되살리면 제자리로 가는가');
  await A.reload({ waitUntil: 'domcontentloaded' });
  await A.getByRole('heading', { name: '일정' }).waitFor({ timeout: 30000 });
  await A.waitForTimeout(2500);

  const mark = '휴지통 점검용 ' + Date.now().toString(36).slice(-4);
  await A.getByRole('button', { name: '+ 새 일정' }).click();
  await A.locator('form textarea, form input[type="text"]').first().fill(mark);
  await A.getByRole('button', { name: '저장', exact: true }).first().click();
  await A.waitForTimeout(3000);

  const made = await A.getByText(mark).count();
  if (made === 0) bad('새 일정을 저장했는데 화면에 나타나지 않는다');

  // 그 일정 줄의 삭제 단추 (EventItemActions가 title="일정 삭제"를 달아 둔다).
  // ⚠️ filter({hasText}).last() 로 잡으면 글자만 든 가장 안쪽 div가 잡혀 단추가 없다.
  //    단추 쪽에서 거슬러 올라가 그 줄에 내가 만든 글이 있는지로 고른다.
  // ⚠️ 단추에서 위로 몇 단계 훑어 '글자가 들어 있으면 이것'이라고 하면 안 된다.
  //    몇 단계만 올라가도 일정 전체를 감싼 카드에 닿아, 목록의 첫 단추가 걸린다.
  //    실제로 그렇게 해서 엉뚱한 일정을 지웠다.
  //    삭제 단추가 '하나만' 들어 있는 가장 바깥 조상이 그 일정의 줄이다.
  const delIndex = await A.evaluate((text) => {
    const SEL = 'button[title="일정 삭제"]';
    const btns = [...document.querySelectorAll(SEL)];
    for (let i = 0; i < btns.length; i++) {
      let row = btns[i];
      while (row.parentElement && row.parentElement.querySelectorAll(SEL).length === 1) {
        row = row.parentElement;
      }
      if ((row.textContent || '').includes(text)) return i;
    }
    return -1;
  }, mark);

  let deleted = false;
  if (delIndex >= 0) {
    await A.locator('button[title="일정 삭제"]').nth(delIndex).click();
    deleted = true;
  }
  await A.waitForTimeout(3000);
  if (!deleted) {
    bad('만든 일정을 지우는 단추를 찾지 못해 휴지통을 확인할 수 없다');
  } else {
    await A.screenshot({ path: `${OUT}/d-06a-after-delete.png` });
    const gone = await A.getByText(mark).count();
    console.log(`  · 지운 뒤 화면에 남았나: ${gone > 0 ? '남아 있음' : '사라짐'}`);
    if (gone > 0) bad('일정을 지웠는데 화면에서 사라지지 않는다');
    await A.getByRole('button', { name: /휴지통/ }).first().click();
    await A.waitForTimeout(2000);
    await A.screenshot({ path: `${OUT}/d-06-trash.png` });
    // 휴지통 팝업 안에서만 찾는다. 화면 뒤쪽 목록까지 세면 지워지지 않았을 때도
    // '휴지통에 있다'고 잘못 읽고, 반대로 안쪽 조각만 짚으면 있는데도 못 찾는다.
    // '복원' 단추를 품은 상자가 곧 휴지통 목록이다.
    const inTrash = await A.evaluate((text) => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '복원');
      if (!btn) return 0;
      let box = btn;
      for (let i = 0; i < 8 && box.parentElement; i++) box = box.parentElement;
      return (box.textContent || '').includes(text) ? 1 : 0;
    }, mark);
    if (inTrash === 0) bad('지운 일정이 휴지통에 들어가 있지 않다');
    else {
      ok('지운 일정이 휴지통에 있다');
      // ⚠️ '복원'으로 찾으면 꺼져 있는 '일괄 복원'이 먼저 잡힌다. 정확히 맞춘다.
      await A.getByRole('button', { name: '복원', exact: true }).first().click();
      await A.waitForTimeout(3000);
      console.log(`  · 복원 알림: ${JSON.stringify(await takeToasts(A))}`);
      await A.keyboard.press('Escape');
      await A.waitForTimeout(2500);
      const back = await A.getByText(mark).count();
      if (back > 0) ok('복원하니 원래 날짜로 돌아왔다');
      else bad('복원했는데 원래 날짜에 보이지 않는다');
      await A.screenshot({ path: `${OUT}/d-07-restored.png` });
    }
  }

  // ══ 5) 날짜를 넘겨 가며 이월 ═══════════════════════════════════
  console.log('\n[5] 하루씩 흘려보내며 이월 — 기록 쪽 링크가 쌓이지 않는가');
  await ctxA.close();
  await ctxB.close();

  const day0 = new Date();
  const dayStr = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const d0 = dayStr(day0);
  const d1 = dayStr(new Date(day0.getTime() + 86400000));
  const d2 = dayStr(new Date(day0.getTime() + 2 * 86400000));

  // 오늘 자리에 이월 일정 하나 + 기록 하나를 심고 서로 연결한다
  const evId = 'ev_fwd_probe';
  const jrId = 'jr_fwd_probe';
  await setDoc(doc(c1.db, 'users', uid, 'events', d0), {
    eventList: [{
      id: evId, content: '이월 점검용 일정', completed: false, label: '이월', labelIds: ['ev_3'],
      forward: true,
      linkedItems: [{ targetType: 'journal', targetId: jrId, targetDate: d0, title: `[${d0}] 이월 점검용 기록`, targetFId: 'personal' }],
    }],
    eventText: '[이월] 이월 점검용 일정',
    updatedAt: Date.now(),
  });
  await setDoc(doc(c1.db, 'users', uid, 'journals', d0), {
    entries: [{
      id: jrId, content: '이월 점검용 기록', createdAt: Date.now(), label: '수업기록', labelIds: [],
      linkedItems: [{ targetType: 'event', targetId: evId, targetDate: d0, title: `[${d0}] 일정`, targetFId: 'personal' }],
    }],
    updatedAt: Date.now(),
  });
  for (const d of [d1, d2]) await deleteDoc(doc(c1.db, 'users', uid, 'events', d)).catch(() => {});

  const linksOnJournal = async () => {
    const s = await getDoc(doc(c1.db, 'users', uid, 'journals', d0));
    const e = (s.exists() ? s.data().entries || [] : []).find((x) => x.id === jrId);
    return (e?.linkedItems || []).filter((l) => l.targetType === 'event');
  };
  console.log(`  · 시작: 기록에 달린 일정 링크 ${(await linksOnJournal()).length}개`);

  // 시계를 하루씩 앞으로 돌려 가며 앱을 새로 연다
  for (const [label, target] of [['하루 뒤', d1], ['이틀 뒤', d2]]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(`{
      const fake = new Date('${target}T09:00:00').getTime();
      const shift = fake - Date.now();
      const RealDate = Date;
      const D = class extends RealDate {
        constructor(...a) { if (a.length === 0) super(RealDate.now() + shift); else super(...a); }
        static now() { return RealDate.now() + shift; }
      };
      Object.defineProperty(D, 'name', { value: 'Date' });
      window.Date = D;
    }`);
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'domcontentloaded' });
    await p.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
    await p.waitForTimeout(7000); // 이월이 돌 시간을 준다
    const seen = await p.locator('body').innerText();
    const links = await linksOnJournal();
    console.log(
      `  · ${label}(${target}): 화면 날짜에 '이월 점검용 일정' ${seen.includes('이월 점검용 일정') ? '있음' : '없음'}` +
      `, 기록에 달린 일정 링크 ${links.length}개 → ${links.map((l) => l.targetDate).join(', ') || '없음'}`
    );
    await ctx.close();
  }
  const finalLinks = await linksOnJournal();
  if (finalLinks.length <= 1) ok(`이월을 두 번 거쳐도 기록의 일정 링크는 ${finalLinks.length}개로 유지된다`);
  else bad(`이월할 때마다 기록에 링크가 쌓인다 — 지금 ${finalLinks.length}개 (${finalLinks.map((l) => l.targetDate).join(', ')})`);

  // ══ 6) 연결된 링크에서 '수정'을 누르면 제대로 된 편집기가 열리는가 ══
  console.log('');
  console.log('[6] 연결된 링크 → 수정 → 제대로 된 편집기');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => bag.errors.push('PAGEERROR ' + e.message.slice(0, 200)));
    await p.goto(URL, { waitUntil: 'domcontentloaded' });
    await p.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
    await p.waitForTimeout(3000);

    // 오늘 날짜에 서로 이어진 일정 하나와 기록 하나를 새로 심는다.
    // (5번에서 쓴 것은 이월로 다른 날짜로 옮겨 가 버렸다)
    // ⚠️ 일정 줄의 🔗는 '링크 추가' 팝업이다. 여기서 눌러야 하는 것은
    //    링크가 있을 때만 나오는 '📑 연결된 링크 (n)'이다. 처음에 이걸 헷갈렸다.
    const evId2 = 'ev_link_probe';
    const jrId2 = 'jr_link_probe';
    await setDoc(doc(c1.db, 'users', uid, 'events', d0), {
      eventList: [{
        id: evId2, content: '링크 점검용 일정', completed: false,
        linkedItems: [{ targetType: 'journal', targetId: jrId2, targetDate: d0, title: `[${d0}] 링크 점검용 기록`, targetFId: 'personal' }],
      }],
      eventText: '링크 점검용 일정',
      updatedAt: Date.now(),
    });
    await setDoc(doc(c1.db, 'users', uid, 'journals', d0), {
      entries: [{
        id: jrId2, content: '링크 점검용 기록', createdAt: Date.now(), label: '수업기록', labelIds: [],
        linkedItems: [{ targetType: 'event', targetId: evId2, targetDate: d0, title: `[${d0}] 일정`, targetFId: 'personal' }],
      }],
      updatedAt: Date.now(),
    });
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.getByRole('heading', { name: '일정' }).waitFor({ timeout: 30000 });
    await p.waitForTimeout(3000);

    // 목록에서는 '🔗 n'(title="링크된 항목 n개")이고, 수정 폼에서만 '📑 연결된 링크'다.
    const linkBtn = p.locator('button[title^="링크된 항목"]').first();
    if (await linkBtn.count() === 0) {
      bad('연결된 링크를 여는 단추를 찾지 못했다');
    } else {
      await linkBtn.click();
      await p.waitForTimeout(2000);
      await p.screenshot({ path: `${OUT}/d-08-linkviewer.png` });

      const editBtn = p.getByRole('button', { name: /수정/ }).first();
      if (await editBtn.count() === 0) bad('연결된 링크 팝업에 수정 단추가 없다');
      else {
        await editBtn.click();
        await p.waitForTimeout(2500);
        await p.screenshot({ path: `${OUT}/d-09-edit-opened.png` });

        const body = await p.locator('body').innerText();
        const hasDrawer = /기록 수정|메모 수정/.test(body);
        const canAttach = body.includes('파일 첨부');
        const canLink = body.includes('링크 추가');
        const hasLabels = body.includes('라벨');
        if (hasDrawer && canAttach && canLink && hasLabels) {
          ok('기록 링크의 수정을 누르니 배너가 열리고 첨부·링크·라벨을 쓸 수 있다');
        } else {
          bad(
            `수정을 눌렀는데 배너가 제대로 열리지 않았다 ` +
            `(배너 ${hasDrawer}, 파일첨부 ${canAttach}, 링크추가 ${canLink}, 라벨 ${hasLabels})`
          );
        }
      }
    }
    await ctx.close();
  }

  await browser.close();
  writeFileSync(`${OUT}/deep.json`, JSON.stringify({ problems, notes, bag }, null, 2), 'utf-8');

  console.log('\n──────── 고칠 것 ────────');
  if (problems.length === 0) console.log('없음');
  else problems.forEach((p) => console.log(' • ' + p));
  if (notes.length) { console.log('\n──────── 참고 ────────'); notes.forEach((n) => console.log(' - ' + n)); }
  if (bag.dialogs.length) {
    console.log('');
    console.log('──────── 브라우저 대화상자 ────────');
    [...new Set(bag.dialogs)].forEach((d) => console.log(' ? ' + d));
  }
  const errs = [...new Set(bag.errors)];
  if (errs.length) { console.log('\n──────── 콘솔 오류 ────────'); errs.slice(0, 10).forEach((e) => console.log(' ! ' + e)); }
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
