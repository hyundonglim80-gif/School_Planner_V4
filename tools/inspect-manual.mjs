// tools/inspect-manual.mjs
//
// 사용 설명서(src/lib/helpTopics.ts)에 적힌 대로 실제 앱이 움직이는지 눌러 본다.
// 항목마다 ✅/❌ 를 찍고, 실패하면 그 순간 화면을 OUT 폴더에 남긴다.
// 에뮬레이터 안에서만 돈다 (선생님 실제 자료는 건드리지 않는다).
//
//   VITE_USE_EMULATOR=1 npm run build && npx vite preview --port 4173
//   npm run emu / npm run seed (먼저)
//   SITE=http://localhost:4173/ OUT=<폴더> node tools/inspect-manual.mjs
//
// 여러 환경에서 돌려 보려면 (모두 생략 가능):
//   BROWSER=chrome|chromium|firefox|webkit   브라우저 (기본 chrome, webkit = 사파리 엔진)
//   PC_W=1400 PC_H=950                       PC 창 크기 (모니터 절반이면 PC_W=960)
//   ONLY=pc|mobile                           한쪽만 돌린다
//   에뮬레이터는 돌릴 때마다 새로 띄우고 seed 하는 것이 좋다 (점검이 자료를 고친다).
//
// 구글 드라이브·캘린더·시트를 부르는 기능(파일 첨부 업로드, 캘린더 보내기 등)은
// 에뮬레이터에 구글이 없어 끝까지 갈 수 없다. 그런 것은 '창이 뜨고 버튼이 있는지'까지만 본다.
import { chromium, firefox, webkit } from 'playwright';
import fs from 'node:fs';

const SITE = process.env.SITE || 'http://localhost:4173/';
const OUT = process.env.OUT || 'tools/report/manual';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let page;
let shotNo = 0;

async function check(name, fn) {
  try {
    const note = await fn();
    results.push({ ok: true, name, note });
    console.log(`✅ ${name}${note ? ` — ${note}` : ''}`);
  } catch (e) {
    const msg = String(e?.message || e).split('\n')[0].slice(0, 200);
    results.push({ ok: false, name, note: msg });
    console.log(`❌ ${name} — ${msg}`);
    try {
      await page.screenshot({ path: `${OUT}/fail-${String(++shotNo).padStart(2, '0')}.png` });
    } catch {}
    await closeAll();
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const wait = (ms) => page.waitForTimeout(ms);

async function closeAll() {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await wait(150);
  }
  // 옆에 붙은 일정·기록·메모 칸은 팝업이 아니라서 ESC(칸 밖)로는 닫히지 않는다
  await page.locator('aside[aria-label$="쓰기"]').getByTitle('닫기').click({ timeout: 500 }).catch(() => {});
  // 마우스를 빈 곳으로 옮긴다. 날짜 옆 📅 위에 남아 있으면 작은 달력이 열린 채 목록을 가린다.
  await page.mouse.move(2, 300).catch(() => {});
  await wait(200);
}
async function openMenu(label) {
  await page.getByTitle('더보기 메뉴').click();
  await wait(250);
  await page.getByRole('button', { name: new RegExp(label) }).first().click();
  await wait(900);
}
const heading = (name) => page.getByRole('heading', { name }).first();
/** 일정을 쓰는 오른쪽 칸 (넓은 화면에서는 화면 옆에 붙는다) */
const eventPanel = () => page.locator('aside[aria-label="일정 쓰기"]');
const EVENT_PH = '새로운 일정을 입력하세요...';
const scopeTitle = () => page.locator('header span.font-extrabold').first().innerText();
const dialogOpen = () => page.locator('[data-scroll-lock]').count();

async function goScope(label) {
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await wait(1800);
}
async function goToday() {
  await page.keyboard.press('Control+Space');
  await wait(1200);
}

const BROWSER = process.env.BROWSER || 'chrome';
const PC_W = Number(process.env.PC_W || 1400);
const PC_H = Number(process.env.PC_H || 950);
const ONLY = process.env.ONLY || '';
const browser =
  BROWSER === 'firefox'
    ? await firefox.launch({ headless: true })
    : BROWSER === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ ...(BROWSER === 'chrome' ? { channel: 'chrome' } : {}), headless: true });
console.log(`환경: ${BROWSER} · PC ${PC_W}x${PC_H}${ONLY ? ` · ${ONLY}만` : ''}`);

// ───────────────────────────── PC ─────────────────────────────
if (ONLY !== 'mobile') {
  const ctx = await browser.newContext({ viewport: { width: PC_W, height: PC_H } });
  page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => {
    // 웹킷은 새로 고칠 때 끊긴 Firestore 통신 요청을 페이지 오류로 올린다. 앱의 오류가 아니다.
    if (/Firestore\/(Write|Listen)\/channel/.test(e.message)) return;
    pageErrors.push(e.message);
  });
  page.on('dialog', (d) => d.accept().catch(() => {}));

  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await heading('수업').waitFor({ timeout: 40000 });
  await wait(2000);

  // ── 시작하기 ──
  await check('[화면 전환] Shift+1~5 로 하루·주간·월간·년간·메모', async () => {
    const seen = [];
    for (const [k, expect] of [['2', /주$/], ['3', /월$/], ['4', /학년도$/], ['1', /일 \(/]]) {
      await page.keyboard.press(`Shift+Digit${k}`);
      await wait(1200);
      const t = await scopeTitle();
      assert(expect.test(t), `Shift+${k} 뒤 제목이 '${t}'`);
      seen.push(t);
    }
    await page.keyboard.press('Shift+Digit5');
    await wait(1200);
    assert((await page.getByRole('button', { name: /새 메모/ }).count()) > 0, 'Shift+5 뒤 메모 화면이 아님');
    await page.keyboard.press('Shift+Digit1');
    await wait(1200);
    return seen.join(' / ');
  });

  await check('[화면 전환] Shift+←/→ 로 옆 화면, 끝에서 반대쪽', async () => {
    await page.keyboard.press('Shift+ArrowRight');
    await wait(1000);
    assert(/주$/.test(await scopeTitle()), '하루 → 다음이 주간이 아님');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await wait(1200);
    assert((await page.getByRole('button', { name: /새 메모/ }).count()) > 0, '하루에서 이전이 메모가 아님');
    await page.keyboard.press('Shift+Digit1');
    await wait(1000);
  });

  await check('[날짜 이동] Ctrl+←/→ 하루씩, Ctrl+Space 오늘, 날짜 글자 누르면 오늘', async () => {
    const today = await scopeTitle();
    await page.keyboard.press('Control+ArrowRight');
    await wait(900);
    const next = await scopeTitle();
    assert(next !== today, 'Ctrl+→ 가 날짜를 바꾸지 않음');
    await page.keyboard.press('Control+ArrowLeft');
    await page.keyboard.press('Control+ArrowLeft');
    await wait(900);
    await page.keyboard.press('Control+Space');
    await wait(900);
    assert((await scopeTitle()) === today, 'Ctrl+Space 뒤 오늘이 아님');
    await page.locator('header').getByRole('button', { name: '▶', exact: true }).click();
    await wait(700);
    await page.getByTitle(/오늘 날짜로 돌아가기/).click();
    await wait(900);
    assert((await scopeTitle()) === today, '날짜 글자 클릭 뒤 오늘이 아님');
    return `${today} → ${next}`;
  });

  await check('[날짜 이동] 📅 작은 달력에서 날짜를 눌러 이동', async () => {
    const before = await scopeTitle();
    await page.getByTitle(/달력에서 날짜 선택/).hover();
    await wait(500);
    await page.getByTitle('다음 달').click();
    await wait(300);
    // 다음 달 15일
    await page.locator('button', { hasText: /^15$/ }).last().click();
    await wait(1200);
    const after = await scopeTitle();
    assert(after !== before && after.includes('15일'), `이동 뒤 '${after}'`);
    await goToday();
    return after;
  });

  await check('[표시 토글] Shift+↑ 주말, Ctrl+↑ 일정, Alt+↑ 수업', async () => {
    const pressed = async (label) =>
      page.locator('header button[aria-pressed]', { hasText: new RegExp(`^${label}$`) }).first().getAttribute('aria-pressed');
    for (const [key, label] of [['Shift+ArrowUp', '주말'], ['Control+ArrowUp', '일정'], ['Alt+ArrowUp', '수업']]) {
      const a = await pressed(label);
      await page.keyboard.press(key);
      await wait(400);
      const b = await pressed(label);
      assert(a !== b, `${key} 가 ${label} 토글을 바꾸지 않음`);
      await page.keyboard.press(key.replace('Up', 'Down'));
      await wait(400);
      assert((await pressed(label)) === a, `${key.replace('Up', 'Down')} 로 되돌아오지 않음 (↓도 같이 동작)`);
    }
  });

  await check('[표시 토글] 일정·수업을 둘 다 끄면 하루 화면에 기록만 남는다', async () => {
    await page.keyboard.press('Control+ArrowUp');
    await page.keyboard.press('Alt+ArrowUp');
    await wait(600);
    const hasEv = await page.getByRole('heading', { name: '일정', exact: true }).count();
    const hasCls = await page.getByRole('heading', { name: '수업', exact: true }).count();
    const hasJ = await page.getByRole('heading', { name: '기록', exact: true }).count();
    await page.keyboard.press('Control+ArrowUp');
    await page.keyboard.press('Alt+ArrowUp');
    await wait(600);
    assert(hasEv === 0 && hasCls === 0 && hasJ === 1, `일정 ${hasEv} 수업 ${hasCls} 기록 ${hasJ}`);
  });

  await check('[하루 화면] 수업이 왼쪽, 일정이 오른쪽', async () => {
    const c = await page.getByRole('heading', { name: '수업', exact: true }).boundingBox();
    const e = await page.getByRole('heading', { name: '일정', exact: true }).boundingBox();
    assert(c.x < e.x, `수업 x=${c.x}, 일정 x=${e.x}`);
  });

  // ── 일정 ──
  const TXT = `점검용 일정 ${Date.now() % 100000}`;
  await check('[일정 추가] + 새 일정 → 오른쪽 칸, 맨 위 라벨이 미리 골라짐', async () => {
    await page.getByRole('button', { name: '+ 새 일정' }).click();
    await wait(500);
    assert((await eventPanel().count()) === 1, '오른쪽에 붙은 일정 칸이 아님');
    const preset = await eventPanel().locator('button[aria-pressed="true"]').allInnerTexts();
    assert(preset.length === 1, `미리 골라진 라벨 ${JSON.stringify(preset)}`);
    return `미리 고른 라벨: ${preset[0]}`;
  });

  await check('[일정 추가] Ctrl+S 저장 뒤 칸이 열린 채 비워지고, 목록에 생김', async () => {
    const box = eventPanel().getByPlaceholder(EVENT_PH);
    await box.fill(TXT);
    await box.press('Control+s');
    await wait(1500);
    assert((await box.inputValue()) === '', '저장 뒤 입력칸이 비지 않음');
    assert(await box.isVisible(), '저장 뒤 칸이 닫힘');
    assert((await page.getByText(TXT, { exact: true }).count()) === 1, '목록에 새 일정이 없음');
  });

  await check('[일정 추가] 칸이 본문을 가리지 않고, 왼쪽을 눌러도 닫히지 않음', async () => {
    const panelBox = await eventPanel().boundingBox();
    const mainBox = await page.locator('main').boundingBox();
    assert(mainBox.x + mainBox.width <= panelBox.x + 1, '본문이 칸 밑에 깔림');
    await page.getByRole('heading', { name: '기록', exact: true }).click();
    await wait(400);
    assert((await eventPanel().count()) === 1, '왼쪽을 눌렀더니 칸이 닫힘');
  });

  await check('[일정 추가] 칸 안에서 ESC 로 칸 닫기', async () => {
    await eventPanel().getByPlaceholder(EVENT_PH).press('Escape');
    await wait(400);
    assert((await eventPanel().count()) === 0, 'ESC 뒤에도 열려 있음');
  });

  await check('[일정 속성] 라벨을 고르면 그 라벨의 속성이 따라 켜짐 (이월 라벨 → 이월 체크)', async () => {
    await page.getByRole('button', { name: '+ 새 일정' }).click();
    await wait(400);
    const form = eventPanel();
    // 미리 골라진 라벨을 떼고 '이월'만 고른다
    for (const b of await form.locator('button[aria-pressed="true"]').all()) await b.click();
    await form.getByRole('button', { name: '이월', exact: true }).click();
    await wait(200);
    const fwd = await form.locator('label', { hasText: /^이월$/ }).locator('input').isChecked();
    await form.getByPlaceholder(EVENT_PH).press('Escape');
    assert(fwd, '이월 라벨을 골랐는데 이월 속성이 꺼져 있음');
  });

  await check('[기간 일정] 기간을 켜면 연속 기간 등록 창, 닫으면 기간이 다시 꺼짐', async () => {
    await page.getByRole('button', { name: '+ 새 일정' }).click();
    await wait(400);
    const form = eventPanel();
    await form.locator('label', { hasText: /^기간$/ }).locator('input').check();
    await wait(700);
    assert(await heading(/연속 기간 등록/).isVisible(), '기간 창이 뜨지 않음');
    assert((await page.getByText('주말(토/일)과 공휴일 제외하고 계산하기').count()) > 0, '주말·공휴일 제외 옵션 없음');
    await page.getByRole('button', { name: '닫기' }).last().click();
    await wait(500);
    const still = await form.locator('label', { hasText: /^기간$/ }).locator('input').isChecked();
    await form.getByPlaceholder(EVENT_PH).press('Escape');
    assert(!still, '창을 닫았는데 기간이 켜진 채');
  });

  await check('[일정 알림] ⏰ 알림 추가 → 1430 입력 → 표시', async () => {
    await page.getByRole('button', { name: '+ 새 일정' }).click();
    await wait(400);
    await eventPanel().getByRole('button', { name: /알림 추가/ }).click();
    await wait(500);
    await page.getByPlaceholder(/1430/).fill('1430');
    await page.getByRole('button', { name: '저장', exact: true }).last().click();
    await wait(500);
    const txt = await eventPanel().getByRole('button', { name: /⏰/ }).innerText();
    await eventPanel().getByPlaceholder(EVENT_PH).press('Escape');
    assert(/14:30/.test(txt), `알림 단추가 '${txt}'`);
    return txt.trim();
  });

  await check('[일정 완료] 라벨 칩을 누르면 취소선, 다시 누르면 풀림', async () => {
    const row = page.locator('[data-focus-key]', { hasText: TXT }).first();
    const chip = row.locator('span[title^="클릭하여 완료"]').first();
    await chip.click();
    await wait(1200);
    const done = await row.locator('span.line-through').count();
    await chip.click();
    await wait(1200);
    const undone = await row.locator('span.line-through').count();
    assert(done === 1 && undone === 0, `완료 ${done} / 되돌림 ${undone}`);
  });

  await check('[일정 수정] 누르면 오른쪽 칸에서 수정, Ctrl+S 저장', async () => {
    await page.getByText(TXT, { exact: true }).click();
    await wait(500);
    assert(await eventPanel().getByRole('heading', { name: '일정 수정' }).isVisible(), '일정 수정 칸이 안 뜸');
    const ta = eventPanel().locator('textarea').first();
    await ta.fill(TXT + ' 수정');
    await ta.press('Control+s');
    // 서버를 거쳐 목록에 들어올 때까지 기다린다 (1.5초로는 모자랄 때가 있었다)
    await page
      .locator('[data-focus-key^="event"]', { hasText: TXT + ' 수정' })
      .first()
      .waitFor({ timeout: 8000 })
      .catch(() => {});
    // 목록의 줄만 센다 (오른쪽 칸의 입력칸 글자까지 세면 2건이 된다)
    const seen = await page.locator('[data-focus-key^="event"]', { hasText: TXT + ' 수정' }).count();
    const rows = await page.locator('[data-focus-key^="event"]').allInnerTexts();
    assert(seen === 1, `수정한 내용 ${seen}건 보임 · 목록: ${rows.map((r) => r.replace(/\s+/g, ' ').slice(0, 30)).join(' | ')}`);
    await ta.press('Escape');
    await wait(300);
  });

  await check('[일정 순서] ▼ 로 아래와 자리를 바꿈', async () => {
    const list = async () =>
      page.$$eval('[data-focus-key^="event"]', (els) => els.map((e) => e.textContent.trim().slice(0, 30)));
    const before = await list();
    const idx = before.findIndex((t) => t.includes(TXT));
    if (idx === before.length - 1) {
      await page.locator('[data-focus-key]', { hasText: TXT }).locator('button', { hasText: '▲' }).click();
    } else {
      await page.locator('[data-focus-key]', { hasText: TXT }).locator('button', { hasText: '▼' }).click();
    }
    await wait(1500);
    const after = await list();
    assert(after.findIndex((t) => t.includes(TXT)) !== idx, '자리가 그대로');
  });

  await check('[일정 삭제] 칸의 삭제 → 지워지고 칸이 닫히고 휴지통 안내', async () => {
    await page.getByText(TXT + ' 수정', { exact: true }).click();
    await wait(500);
    await eventPanel().getByRole('button', { name: '삭제', exact: true }).click();
    await wait(1200);
    assert((await eventPanel().count()) === 0, '지운 뒤에도 칸이 열려 있음');
    assert((await page.getByText(TXT + ' 수정', { exact: true }).count()) === 0, '지워지지 않음');
    assert((await page.getByText(/휴지통에서 복원할 수 있습니다/).count()) > 0, '휴지통 안내가 없음');
  });

  await check('[휴지통] 지운 일정이 있고 복원하면 돌아옴', async () => {
    await page.getByRole('button', { name: /휴지통/ }).first().click();
    await wait(1500);
    const item = page.locator('div', { hasText: TXT + ' 수정' }).filter({ has: page.getByRole('button', { name: '복원', exact: true }) }).last();
    assert((await item.count()) > 0, '휴지통에 없음');
    assert((await page.getByText('전체 선택').count()) > 0, '전체 선택이 없음');
    await item.getByRole('button', { name: '복원', exact: true }).click();
    await wait(1500);
    await closeAll();
    await wait(800);
    assert((await page.getByText(TXT + ' 수정', { exact: true }).count()) === 1, '복원했는데 하루 화면에 없음');
  });

  // ── 수업 ──
  await check('[수업 칸] 교시를 누르면 수정, 준비물 적고 Ctrl+S', async () => {
    await page.locator('[data-focus-key^="period"]').first().click();
    await wait(500);
    const sup = page.getByPlaceholder('준비물');
    await sup.fill('점검 준비물');
    await sup.press('Control+s');
    await wait(1500);
    assert((await page.getByText('점검 준비물').count()) > 0, '준비물이 안 보임');
    assert((await page.getByText(/1교시 수업 내용을 저장했습니다/).count()) > 0, '저장 안내 없음');
  });

  await check('[수업 칸] ▼ 로 1교시와 2교시를 맞바꿈, ▲ 로 되돌림', async () => {
    const subj = async () =>
      page.$$eval('[data-focus-key^="period"]', (els) => els.slice(0, 2).map((e) => e.querySelector('span.font-bold.text-sm')?.textContent));
    const a = await subj();
    await page.locator('[data-focus-key^="period"]').first().locator('button', { hasText: '▼' }).click();
    await wait(1500);
    const b = await subj();
    await page.locator('[data-focus-key^="period"]').nth(1).locator('button', { hasText: '▲' }).click();
    await wait(1500);
    assert(a[0] === b[1] && a[1] === b[0], `${a} → ${b}`);
    return `${a.join(',')} → ${b.join(',')}`;
  });

  // ── 기록 ──
  const JTXT = `점검 기록 ${Date.now() % 100000}`;
  await check('[기록] + 추가 → 배너, 라벨 미리 선택, Ctrl+S 두 번 눌러도 하나만', async () => {
    const before = Number(await page.getByRole('heading', { name: '기록', exact: true }).locator('xpath=following-sibling::span[1]').innerText());
    await page.getByRole('button', { name: '+ 추가' }).click();
    await wait(600);
    assert(await heading('새 기록').isVisible(), '배너가 열리지 않음');
    const preset = await page.locator('button', { hasText: /^✓ / }).allInnerTexts();
    const ta = page.getByPlaceholder(/오늘 있었던 일을 기록해보세요/);
    await ta.fill(JTXT);
    await ta.press('Control+s');
    await wait(1500);
    assert(await heading('기록 수정').isVisible(), '저장 뒤 배너가 닫히거나 제목이 안 바뀜');
    await ta.fill(JTXT + ' 고침');
    await ta.press('Control+s');
    await wait(1500);
    await page.getByTitle('닫기').first().click();
    await wait(800);
    const after = Number(await page.getByRole('heading', { name: '기록', exact: true }).locator('xpath=following-sibling::span[1]').innerText());
    assert(after === before + 1, `기록 수 ${before} → ${after}`);
    return `미리 고른 라벨 ${preset.join(',') || '없음'}`;
  });

  await check('[캡처 붙여넣기] 내용칸에 그림을 붙이면 업로드를 시도 (에뮬레이터에는 드라이브가 없음)', async () => {
    await page.getByRole('button', { name: '+ 추가' }).click();
    await wait(600);
    const ta = page.getByPlaceholder(/오늘 있었던 일을 기록해보세요/);
    await ta.focus();
    const delivered = await page.evaluate(async () => {
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      const file = new File([png], 'image.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const el = document.activeElement;
      // 파이어폭스는 스크립트로 만든 붙여넣기 이벤트에 그림을 실어 보내지 않는다 (진짜 붙여넣기는 된다).
      // 그런 브라우저에서는 '확인할 수 없음'으로 적고 넘어간다.
      let items = -1;
      const peek = (e) => { items = e.clipboardData ? e.clipboardData.items.length : 0; };
      el.addEventListener('paste', peek, { capture: true, once: true });
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return items;
    });
    if (delivered === 0) {
      await page.getByTitle('닫기').first().click();
      return '이 브라우저는 스크립트로 만든 붙여넣기에 그림을 싣지 않아 확인할 수 없음 (건너뜀)';
    }
    await wait(2500);
    const uploading = await page.getByText(/붙여넣은 이미지 업로드 중|업로드에 실패|드라이브|권한|로그인/).count();
    await page.getByTitle('닫기').first().click();
    assert(uploading > 0, '붙여넣기에 아무 반응이 없음');
    return '붙여넣기 → 업로드 시도까지 확인 (실제 드라이브 업로드는 에뮬레이터 밖)';
  });

  await check('[기록] 라벨 버튼으로 거르기', async () => {
    const filters = page.locator('button.rounded-full', { hasText: /\S/ });
    const n = await filters.count();
    assert(n >= 2, '라벨 필터 버튼이 없음');
    await filters.nth(1).click();
    await wait(500);
    await page.getByRole('button', { name: '전체', exact: true }).first().click();
  });

  // ── 링크 ──
  await check('[링크] 일정 수정 → 🔗 링크 추가 → 기록 탭에서 골라 연결 저장 → 🔗 숫자 → 뷰어 → 해제', async () => {
    await page.getByText(TXT + ' 수정', { exact: true }).click();
    await wait(500);
    await eventPanel().getByRole('button', { name: /링크 추가/ }).click();
    await wait(1200);
    assert(await heading(/새 데이터 연결하기/).isVisible(), '연결 창이 안 뜸');
    await page.getByRole('button', { name: /📔 기록/ }).click();
    await wait(1500);
    const item = page.locator('[data-scroll-lock] div.cursor-pointer', { hasText: JTXT }).first();
    if (await item.count()) await item.click();
    else await page.locator('[data-scroll-lock] div.cursor-pointer').first().click();
    await wait(400);
    await page.getByRole('button', { name: '연결 저장' }).click();
    await wait(2000);
    assert((await page.getByRole('button', { name: /연결된 링크 \(1\)/ }).count()) > 0, '수정 칸에 연결된 링크 (1) 이 없음');
    await closeAll();
    await wait(600);
    const badge = page.locator('[data-focus-key]', { hasText: TXT }).getByRole('button', { name: /🔗 1/ });
    assert((await badge.count()) === 1, '🔗 1 표시가 없음');
    await badge.click();
    await wait(1500);
    assert(await heading(/연결된 데이터 확인/).isVisible(), '뷰어가 안 뜸');
    for (const b of ['✏️ 수정', '📌 이동', '🗑️ 삭제']) assert((await page.getByRole('button', { name: b }).count()) > 0, `${b} 버튼 없음`);
    await page.getByRole('button', { name: '🗑️ 삭제' }).first().click();
    await wait(1500);
    await closeAll();
    await wait(600);
    assert((await page.locator('[data-focus-key]', { hasText: TXT }).getByRole('button', { name: /🔗/ }).count()) === 0, '해제 뒤에도 🔗 가 남음');
  });

  // ── 다중 선택 ──
  await check('[다중 선택] 켜고 안 끝난 일정 두 개 골라 완료 → 모드가 저절로 끝남', async () => {
    const open = page.locator('[data-focus-key^="event"]').filter({ hasNot: page.locator('span.line-through') });
    const keys = [];
    for (let i = 0; i < 2; i++) keys.push(await open.nth(i).getAttribute('data-focus-key'));
    await openMenu('다중 선택 모드 켜기');
    for (const k of keys) await page.locator(`[data-focus-key="${k}"]`).click();
    await wait(300);
    assert((await page.getByText('선택됨').count()) > 0, '선택 막대가 없음');
    await page.getByTitle('선택 일정 일괄 완료 처리').click();
    await wait(1800);
    assert((await page.getByText('선택됨').count()) === 0, '완료 뒤에도 선택 막대가 남음');
    for (const k of keys) {
      assert((await page.locator(`[data-focus-key="${k}"] span.line-through`).count()) > 0, '고른 일정이 완료로 바뀌지 않음');
      // 되돌려 둔다 (라벨 칩)
      await page.locator(`[data-focus-key="${k}"] span[title^="클릭하여 완료"]`).first().click().catch(() => {});
      await wait(800);
    }
  });

  // ── 주간 ──
  await check('[주간] 모든 요일의 교시 줄 수가 같고 일정 머리글이 나란함', async () => {
    await page.keyboard.press('Shift+Digit2');
    await wait(2500);
    const r = await page.evaluate(() =>
      [...document.querySelectorAll('div')].filter((c) => c.className.includes('min-h-[250px]')).map((c) => {
        const h = [...c.querySelectorAll('div')].find((d) => d.className.includes('font-extrabold') && d.textContent.trim().startsWith('일정'));
        return Math.round(h.getBoundingClientRect().top - c.getBoundingClientRect().top);
      })
    );
    assert(new Set(r).size === 1, `요일별 위치 ${r}`);
    return `${r.length}개 요일 모두 ${r[0]}px`;
  });

  await check('[주간] 빈 교시를 누르면 N교시 수정 팝업', async () => {
    const empty = page.locator('div[title*="비어 있음"]').first();
    assert((await empty.count()) > 0, '빈 교시 칸이 없음 (주말이 꺼져 있으면 없을 수 있음)');
    await empty.click();
    await wait(1200);
    assert(await heading(/교시 수정/).isVisible(), '수정 팝업이 안 뜸');
    await closeAll();
  });

  await check('[주간] 일정을 누르면 오른쪽 일정 수정 칸', async () => {
    await page.locator('[title="클릭하여 상세 보기"]').first().click();
    await wait(1200);
    assert(await eventPanel().getByRole('heading', { name: '일정 수정' }).isVisible(), '일정 수정 칸이 안 뜸');
    await closeAll();
  });

  await check('[주간 +] + → 오른쪽 새 일정 칸 → Ctrl+S (칸은 비워진 채 남음)', async () => {
    const Q = `주간추가 ${Date.now() % 10000}`;
    await page.getByTitle('일정 빠른 추가').first().click();
    await wait(800);
    const box = eventPanel().getByPlaceholder(EVENT_PH);
    await box.fill(Q);
    await box.press('Control+s');
    await wait(1800);
    const stillOpen = (await box.isVisible()) && (await box.inputValue()) === '';
    await closeAll();
    assert((await page.getByText(Q).count()) > 0, '주간 칸에 안 보임');
    assert(stillOpen, '저장 뒤 칸이 비워진 채 남아 있지 않음');
  });

  await check('[기록 표식] 📝 숫자를 누르면 기록만 펼쳐 보는 창', async () => {
    const b = page.getByTitle(/^기록 \d+건 보기$/).first();
    if ((await b.count()) === 0) {
      await page.keyboard.press('Shift+Digit3');
      await wait(2500);
    }
    await page.getByTitle(/^기록 \d+건 보기$/).first().click();
    await wait(1500);
    assert((await dialogOpen()) > 0, '창이 안 뜸');
    await closeAll();
  });

  await check('[날짜 칸] 주간·월간에서 날짜 칸을 누르면 하루 화면', async () => {
    await page.keyboard.press('Shift+Digit3');
    await wait(2500);
    await page.locator('[data-today="true"]').first().click({ position: { x: 5, y: 5 } });
    await wait(1500);
    assert(/일 \(/.test(await scopeTitle()), `제목 '${await scopeTitle()}'`);
  });

  // ── 월간·년간 ──
  await check('[월간] 달력 속성이 꺼진 라벨(이월·기간·반복)의 일정은 안 보임', async () => {
    await page.keyboard.press('Shift+Digit3');
    await wait(2500);
    const chips = await page.$$eval('[title="클릭하여 상세 보기"] span[title^="클릭하여 완료"]', (els) => els.map((e) => e.textContent.trim()));
    const bad = chips.filter((c) => ['이월', '기간', '반복'].includes(c));
    assert(bad.length === 0, `보이면 안 되는 라벨 ${bad.length}건`);
    return `월간 라벨 칩: ${[...new Set(chips)].join(', ')}`;
  });

  await check('[년간] 1학기/2학기 칩이 달을 거름', async () => {
    await page.keyboard.press('Shift+Digit4');
    await wait(3500);
    const months = async () => page.getByText(/^\d+월$/).count();
    const all = await months();
    await page.getByRole('button', { name: '1학기', exact: true }).click();
    await wait(1500);
    const s1 = await months();
    await page.getByRole('button', { name: '전체', exact: true }).click();
    await wait(800);
    assert(all > s1 && s1 > 0, `전체 ${all}달, 1학기 ${s1}달`);
    return `전체 ${all}달 / 1학기 ${s1}달`;
  });

  // ── 메모 ──
  await check('[메모] + 새 메모 → Ctrl+S → 즐겨찾기 → 완료', async () => {
    await page.keyboard.press('Shift+Digit5');
    await wait(2000);
    // 처음에는 즐겨찾기로 열린다. 새 메모가 보이도록 전체로 바꾼다.
    await page.getByRole('button', { name: /전체 메모/ }).click();
    await wait(500);
    const M = `점검 메모 ${Date.now() % 10000}`;
    await page.getByRole('button', { name: /새 메모/ }).click();
    await wait(600);
    const ta = page.getByPlaceholder(/자유롭게 생각을 기록해보세요/);
    await ta.fill(M);
    await ta.press('Control+s');
    await wait(1500);
    await page.getByTitle('닫기').first().click();
    await wait(1200);
    const card = page.locator('[data-focus-key]', { hasText: M }).first();
    assert((await card.count()) === 1, '카드가 없음');
    await card.getByTitle('즐겨찾기').click();
    await wait(1200);
    await page.getByRole('button', { name: /즐겨찾기/ }).first().click();
    await wait(800);
    assert((await page.locator('[data-focus-key]', { hasText: M }).count()) === 1, '⭐ 필터에 없음');
    await page.getByRole('button', { name: /전체 메모/ }).click();
    await wait(600);
    const doneCount = async () => Number((await page.getByText(/^완료 \(\d+\)/).innerText()).match(/\d+/)[0]);
    const before = await doneCount();
    await page.locator('[data-focus-key]', { hasText: M }).locator('input[type=checkbox]').click();
    await wait(1800);
    assert((await doneCount()) === before + 1, `완료 수 ${before} → ${await doneCount()}`);
  });

  await check('[Keep 가져오기] 내보내기/가져오기에서 Keep 창으로 넘어가는 안내가 있음', async () => {
    await openMenu('내보내기 / 가져오기');
    assert(await heading(/내보내기 \/ 가져오기 통합 관리/).isVisible(), '백업 창이 안 뜸');
    for (const t of ['캘린더', '구글 시트', 'CSV', 'JSON']) assert((await page.getByTitle(t).count()) > 0, `${t} 대상이 없음`);
    await closeAll();
  });

  // ── 검색 ──
  await check('[검색] Ctrl+F → 검색어 Enter → 자세히 → 이동하면 그 날짜 하루 화면', async () => {
    await page.keyboard.press('Shift+Digit1');
    await wait(1200);
    await page.keyboard.press('Control+f');
    await wait(1000);
    const box = page.getByPlaceholder(/검색어 입력 후 엔터/);
    await box.fill('협의회');
    await box.press('Enter');
    await wait(3500);
    const first = page.locator('[data-scroll-lock] div.cursor-pointer', { hasText: /일정 \(\d{4}-/ }).first();
    assert((await first.count()) > 0, '결과가 없음');
    await first.click();
    await wait(800);
    const go = page.getByRole('button', { name: /하루 화면으로 이동/ }).first();
    const label = await go.innerText();
    await go.click();
    await wait(2500);
    const d = label.match(/(\d{4})-(\d{2})-(\d{2})/);
    const t = await scopeTitle();
    assert(d && t.includes(`${Number(d[2])}월 ${Number(d[3])}일`), `'${label}' 인데 제목 '${t}'`);
    await goToday();
    return t;
  });

  // ── 메뉴 도구 ──
  await check('[통합 라벨 관리] 세 탭', async () => {
    await openMenu('통합 라벨 관리');
    for (const t of [/일정 라벨/, /기록\(일지\) 라벨/, /메모 라벨/]) assert((await page.getByRole('button', { name: t }).count()) > 0, `${t} 탭 없음`);
    assert((await page.getByRole('button', { name: /삭제된 라벨 복구/ }).count()) > 0, '복구 버튼 없음');
    await closeAll();
  });

  await check('[D-Day] 추가 → ★ 상단 표시 → 삭제', async () => {
    await page.getByTitle(/학사 D-Day 관리/).click();
    await wait(800);
    await page.getByPlaceholder(/일정명/).fill('점검디데이');
    const d = new Date(Date.now() + 10 * 864e5);
    await page.locator('[data-scroll-lock] input[type=date]').first().fill(d.toISOString().slice(0, 10));
    await page.locator('[data-scroll-lock] button[type=submit]').first().click();
    await wait(1500);
    const row = page.locator('[data-scroll-lock] button', { hasText: '점검디데이' }).first();
    assert((await row.count()) > 0, '추가한 D-Day가 목록에 없음');
    const isStar = (await row.innerText()).includes('★');
    if (!isStar) {
      await row.click();
      await wait(1200);
    }
    await closeAll();
    const top = await page.getByTitle(/학사 D-Day 관리/).innerText();
    assert(/D-10/.test(top), `상단 표시 '${top.replace(/\s+/g, ' ')}'`);
    return top.replace(/\s+/g, ' ');
  });

  await check('[다른 날 D-Day] 하루 화면에서 다른 날을 보면 날짜 옆에 그날 기준 D-Day', async () => {
    await page.keyboard.press('Control+ArrowRight');
    await wait(1200);
    const has = await page.locator('header span', { hasText: /^D-9$/ }).count();
    await goToday();
    assert(has > 0, '그날 기준 D-9 표시가 없음');
  });

  await check('[명렬표] 관리·검색·암기 탭, 새 학급 → 학생 추가 → 초성 검색', async () => {
    await openMenu('학급 정보');
    for (const t of ['관리', '검색', '암기']) assert((await page.getByRole('button', { name: t, exact: true }).count()) > 0, `${t} 탭 없음`);
    await page.getByTitle(/학급을 더하거나 지우고/).click();
    await wait(400);
    await page.getByRole('button', { name: /새 학급 추가/ }).click();
    await wait(600);
    await page.getByPlaceholder('인원').fill('2');
    await page.getByRole('button', { name: /학생 추가/ }).click();
    await wait(500);
    const nameInputs = page.locator('[data-scroll-lock] table input[type=text]:not([placeholder])');
    const count = await nameInputs.count();
    if (count >= 2) {
      await nameInputs.nth(0).fill('김지우');
      await nameInputs.nth(1).fill('박하늘');
    }
    await page.getByRole('button', { name: /클라우드 저장/ }).click();
    await wait(2500);
    // 저장 뒤에도 새 학급에 머물러야 한다 (예전에는 1반으로 튀었다)
    const firstName = await nameInputs.first().inputValue().catch(() => '');
    assert(firstName === '김지우', `저장 뒤 첫 학생이 '${firstName}' (다른 학급으로 튐)`);
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await wait(600);
    await page.getByPlaceholder(/ㄱㅈㅇ/).fill('ㄱㅈㅇ');
    await wait(800);
    const hit = await page.locator('[data-scroll-lock]').getByText('김지우').count();
    await closeAll();
    assert(hit > 0, `초성 검색 결과 없음 (이름칸 ${count}개)`);
  });

  await check('[조사표] 수업 📊 → + 새 조사표 → 생성 → 표 → 저장 → 📊1 표시', async () => {
    await page.locator('[data-focus-key^="period"]').first().hover();
    await page.locator('[data-focus-key^="period"]').first().getByTitle(/조사표/).click();
    await wait(1500);
    const createBtn = page.getByRole('button', { name: '+ 새 조사표' });
    if (await createBtn.count()) await createBtn.click();
    await wait(600);
    await page.getByPlaceholder(/1단원 평가/).fill('점검 조사표');
    await page.getByRole('button', { name: '생성', exact: true }).click();
    await wait(2000);
    assert((await page.getByText('전체 일괄 적용').count()) > 0, '입력 표가 안 뜸');
    await page.keyboard.press('Control+s');
    await wait(1500);
    await closeAll();
    await wait(1000);
    const badge = await page.locator('[data-focus-key^="period"]').first().getByTitle(/조사표 \d+건/).count();
    assert(badge > 0, '교시 옆 📊 숫자가 없음');
  });

  await check('[공유 그룹] 그룹 만들기 → 6자리 코드 → 📂 공간 선택이 생김', async () => {
    await openMenu('공유 그룹 관리');
    await page.getByRole('button', { name: /새 그룹 만들기/ }).click();
    await page.getByPlaceholder(/교과협의회/).fill('점검 그룹');
    await page.getByRole('button', { name: '그룹 만들기', exact: true }).last().click();
    await wait(2500);
    const code = await page.locator('[data-scroll-lock]').getByText(/^[A-Z0-9]{6}$/).first().innerText().catch(() => '');
    await closeAll();
    await wait(800);
    const sel = await page.locator('header select').count();
    assert(code && sel > 0, `코드 '${code}', 공간 선택 ${sel}`);
    return `초대 코드 ${code}`;
  });

  await check('[시간표] 표에서 화살표·Enter 로 칸 이동', async () => {
    await openMenu('시간표 적용');
    const cells = page.locator('[data-scroll-lock] table input');
    await cells.first().click();
    const a = await page.evaluate(() => document.activeElement?.getBoundingClientRect().top);
    await page.keyboard.press('Enter');
    const b = await page.evaluate(() => document.activeElement?.getBoundingClientRect().top);
    for (const t of ['1학기 기간 채우기', '2학기 기간 채우기', '이번 주 기간 채우기']) assert((await page.getByRole('button', { name: t }).count()) > 0, `${t} 없음`);
    await closeAll();
    assert(b > a, 'Enter 로 아래 칸으로 가지 않음');
  });

  await check('[캘린더 보내기] 창, 병합/교체, 보낼 대상', async () => {
    await page.getByRole('button', { name: /캘린더/ }).first().click();
    await wait(1000);
    for (const t of ['병합', '교체', '지금 화면 기간으로']) assert((await page.getByText(t).count()) > 0, `${t} 없음`);
    await closeAll();
  });

  await check('[반복 일정 등록] 주기 4가지', async () => {
    await openMenu('반복 일정 등록');
    for (const t of ['매주', '격주', '매월(첫째 주)', '매월(특정 일)']) assert((await page.getByText(t, { exact: true }).count()) > 0, `${t} 없음`);
    await closeAll();
  });

  await check('[미완료 일정 가져오기] 창과 이월 기간 안내', async () => {
    await openMenu('미완료 일정 가져오기');
    assert((await page.getByText(/지난 \d+일간의 미완료 일정/).count()) > 0, '기간 안내 없음');
    await closeAll();
  });

  await check('[환경설정] 글자 크기가 누르는 즉시 바뀜', async () => {
    await openMenu('환경설정');
    const size = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    const a = await size();
    await page.getByRole('button', { name: '매우 크게' }).click();
    await wait(300);
    const b = await size();
    await page.getByRole('button', { name: '보통' }).click();
    await wait(300);
    await closeAll();
    assert(a !== b, `글자 크기 ${a} → ${b}`);
    return `${a} → ${b}`;
  });

  await check('[팝업] ESC 로 모든 팝업 닫기', async () => {
    await openMenu('통합 라벨 관리');
    await page.keyboard.press('Escape');
    await wait(500);
    assert((await dialogOpen()) === 0, 'ESC 뒤에도 팝업이 남음');
  });

  // ── 학급 운영: 알림장 · 출석부 · 누가기록 ──
  /** 기록 칸에서 그 글로 시작하는 카드를 찾아(접혀 있으면 펼쳐) 글을 읽는다 */
  const journalText = async (head) => {
    const cards = page.locator('[data-focus-key^="journal"]', { hasText: head });
    // 저장은 서버 트랜잭션 두 번을 거친다. 카드가 나타날 때까지 기다린다.
    await cards.first().waitFor({ timeout: 8000 }).catch(() => {});
    const count = await cards.count();
    if (!count) return { count, text: '' };
    const toggle = cards.first().getByTitle('펼치기');
    if (await toggle.count()) {
      await toggle.first().click();
      await wait(300);
    }
    return { count, text: await cards.first().innerText() };
  };
  await check('[알림장] 수업 옆 📢 → 다음 수업일 불러오기 → 저장 → 그날 기록에 알림장 항목', async () => {
    await page.keyboard.press('Shift+Digit1');
    await goToday();
    await page.getByRole('button', { name: '📢 알림장' }).click();
    await wait(1500);
    const box = page.getByLabel('알림장 내용');
    await box.fill('점검 알림장 첫 줄');
    await page.getByRole('button', { name: /다음 수업일 불러오기/ }).click();
    await wait(2500);
    const lines = (await box.inputValue()).split('\n').filter(Boolean).length;
    await box.press('Control+s');
    await wait(2500);
    await closeAll();
    await wait(1500);
    const entry = await journalText('1. 점검 알림장 첫 줄');
    assert(entry.count === 1 && entry.text.includes('점검 알림장 첫 줄'), `기록 칸의 알림장 항목 ${entry.count}개`);
    return `알림장 ${lines}줄 (불러온 줄 포함)`;
  });

  await check('[알림장] 다시 고쳐 저장해도 기록 항목은 하나만 (고쳐 씀)', async () => {
    await page.getByRole('button', { name: '📢 알림장' }).click();
    await wait(1500);
    const box = page.getByLabel('알림장 내용');
    await box.fill((await box.inputValue()) + '\n둘째 줄 추가');
    await box.press('Control+s');
    await wait(2500);
    await closeAll();
    await wait(1500);
    const e = await journalText('1. 점검 알림장 첫 줄');
    assert(e.count === 1 && e.text.includes('둘째 줄 추가'), `항목 ${e.count}개, 둘째 줄 ${e.text.includes('둘째 줄 추가')}`);
  });

  await check('[알림장] ⋮ 알림장 모아 보기에 날짜별로 나옴', async () => {
    await openMenu('알림장 모아 보기');
    await wait(1500);
    assert((await page.getByText('점검 알림장 첫 줄').count()) > 0, '모아 보기에 없음');
    await closeAll();
  });

  let attendName = '';
  await check('[출석부] 수업 옆 📋 → 결석(질병)+사유, 지각(미인정) 2교시 → 저장 → 기록에 출결 항목', async () => {
    await page.getByRole('button', { name: '📋 출석부' }).click();
    await wait(2000);
    // 지난 점검에서 남은 출결을 먼저 비운다
    const clearAll = page.getByRole('button', { name: '모두 출석' });
    if (await clearAll.isEnabled()) await clearAll.click();
    const rows = page.locator('[data-attendance-num]');
    assert((await rows.count()) >= 2, `학생 줄 ${await rows.count()}개 (명렬표 필요)`);
    const r0 = rows.nth(0);
    attendName = (await r0.locator('span.font-bold').first().innerText()).replace(/^\d+/, '').trim();
    await r0.getByRole('button', { name: '결석', exact: true }).click();
    await r0.getByRole('button', { name: /사유 적기/ }).click();
    await page.getByLabel(/번 사유$/).fill('감기');
    const r1 = rows.nth(1);
    await r1.getByRole('button', { name: '지각', exact: true }).click();
    await r1.getByRole('button', { name: '미인정', exact: true }).click();
    await r1.getByRole('button', { name: '2', exact: true }).click();
    await page.keyboard.press('Control+s');
    await wait(3000);
    await closeAll();
    await wait(1500);
    const e = await journalText('[출결]');
    assert(e.count === 1, '기록 칸에 출결 항목이 없음');
    const t = e.text;
    assert(/결석\(질병\) - 감기/.test(t) && /지각\(미인정\) 2교시/.test(t), `항목 글: ${t.replace(/\s+/g, ' ').slice(0, 120)}`);
    return `${attendName} 결석(질병) - 감기`;
  });

  await check('[출석부] 누계 탭: 결석 질병 1, 누르면 날짜별 내역', async () => {
    await page.getByRole('button', { name: '📋 출석부' }).click();
    await wait(1500);
    await page.getByRole('button', { name: /누계/ }).click();
    await wait(2500);
    const row = page.locator('tbody tr', { hasText: attendName }).first();
    const cells = await row.locator('td').allInnerTexts();
    assert(cells[1] === '1', `결석 질병 칸 '${cells[1]}'`);
    await row.click();
    await wait(400);
    assert((await page.getByText(/결석\(질병\) - 감기/).count()) > 0, '날짜별 내역이 안 펼쳐짐');
    await closeAll();
    return `결석-질병 ${cells[1]}`;
  });

  await check('[출석부] 출석으로 되돌려 저장하면 기록 칸의 출결 항목도 바뀜', async () => {
    await page.getByRole('button', { name: '📋 출석부' }).click();
    await wait(2000);
    await page.locator('[data-attendance-num]').nth(1).getByRole('button', { name: '출석', exact: true }).click();
    await page.keyboard.press('Control+s');
    await wait(3000);
    await closeAll();
    await wait(1500);
    const { text: t } = await journalText('[출결]');
    assert(!/지각/.test(t), '지각이 남아 있음');
  });

  await check('[누가기록] 기록에 학생 태그 넣기 → ⋮ 학생 누가기록에 기록과 출결이 모임 → 누르면 그 날로', async () => {
    await page.getByRole('button', { name: '+ 추가' }).click();
    await wait(600);
    const ta = page.getByPlaceholder(/오늘 있었던 일을 기록해보세요/);
    await ta.fill('발표를 적극적으로 함');
    await page.getByRole('button', { name: /학생 태그 넣기/ }).click();
    await wait(1500);
    await page.locator('button[title^="#"]', { hasText: attendName }).first().click();
    const v = await ta.inputValue();
    const tag = (v.match(/#\d{8}/) || [])[0];
    assert(tag, `태그가 안 붙음: '${v}'`);
    await ta.press('Control+s');
    await wait(1500);
    await page.getByTitle('닫기').first().click();
    await wait(1000);
    await openMenu('학생 누가기록');
    await wait(1500);
    await page.getByLabel('학생 번호로 찾기').fill(tag);
    await page.getByRole('button', { name: '찾기', exact: true }).click();
    await wait(3000);
    const body = await page.locator('[data-scroll-lock]').innerText();
    assert(body.includes('발표를 적극적으로 함'), '태그 붙은 기록이 없음');
    assert(/결석\(질병\) - 감기/.test(body), '출결이 없음');
    assert(/결석 1/.test(body), '합계 줄이 없음');
    await page.locator('[data-scroll-lock] button', { hasText: '발표를 적극적으로 함' }).first().click();
    await wait(2000);
    assert((await dialogOpen()) === 0, '누가기록 창이 닫히지 않음');
    return tag;
  });

  // ── 알림장·출석부: 오른쪽 칸, 기록과 함께 바뀜 ──
  const noticePanel = () => page.locator('aside[aria-label="알림장 쓰기"]');
  const attendPanel = () => page.locator('aside[aria-label="출석부 쓰기"]');
  const journalPanelBox = () => page.locator('aside[aria-label="기록 쓰기"]').getByPlaceholder(/오늘 있었던 일을 기록해보세요/);
  /** 기록 칸의 그 카드를 눌러 오른쪽 기록 칸을 연다 */
  const openJournalCard = async (head) => {
    await page.keyboard.press('Shift+Digit1');
    await goToday();
    const card = page.locator('[data-focus-key^="journal"]', { hasText: head }).first();
    await card.waitFor({ timeout: 8000 });
    await card.click({ position: { x: 60, y: 40 } });
    await wait(800);
  };

  await check('[알림장·출석부] 오른쪽 칸으로 열리고 본문을 가리지 않음 (출석부는 더 넓게)', async () => {
    await page.keyboard.press('Shift+Digit1');
    await goToday();
    const main = async () => (await page.locator('main').boundingBox());
    await page.getByRole('button', { name: '📢 알림장' }).click();
    await wait(1200);
    const n = await noticePanel().boundingBox();
    const m1 = await main();
    await closeAll();
    await page.getByRole('button', { name: '📋 출석부' }).click();
    await wait(1500);
    const a = await attendPanel().boundingBox();
    const m2 = await main();
    await closeAll();
    assert(n && a, `알림장 칸 ${!!n}, 출석부 칸 ${!!a}`);
    assert(m1.x + m1.width <= n.x + 1 && m2.x + m2.width <= a.x + 1, '본문이 칸 밑에 깔림');
    assert(a.width >= n.width, `출석부 칸(${a.width}px)이 알림장 칸(${n.width}px)보다 좁음`);
    return `알림장 ${Math.round(n.width)}px · 출석부 ${Math.round(a.width)}px`;
  });

  await check('[알림장] 기록 칸에서 알림장 항목을 고치면 알림장도 바뀜', async () => {
    await openJournalCard('1. 점검 알림장 첫 줄');
    const box = journalPanelBox();
    const v = await box.inputValue();
    await box.fill(v.replace('둘째 줄 추가', '둘째 줄 기록에서 고침'));
    await box.press('Control+s');
    await wait(3000);
    await closeAll();
    await page.getByRole('button', { name: '📢 알림장' }).click();
    await wait(1800);
    const notice = await noticePanel().getByLabel('알림장 내용').inputValue();
    await closeAll();
    assert(/둘째 줄 기록에서 고침/.test(notice), `알림장 글: ${notice.replace(/\n/g, ' / ')}`);
  });

  await check('[알림장] 기록 칸에서 알림장 항목을 지우면 알림장도 비워지고, 휴지통에서 되살리면 돌아옴', async () => {
    await page.keyboard.press('Shift+Digit1');
    await goToday();
    const card = page.locator('[data-focus-key^="journal"]', { hasText: '점검 알림장 첫 줄' }).first();
    await card.hover();
    await card.getByTitle('기록 삭제').click();
    await wait(3000);
    await page.getByRole('button', { name: '📢 알림장' }).click();
    await wait(1800);
    const emptied = await noticePanel().getByLabel('알림장 내용').inputValue();
    await closeAll();
    await page.getByRole('button', { name: /휴지통/ }).first().click();
    await wait(1500);
    const item = page.locator('div', { hasText: '점검 알림장 첫 줄' }).filter({ has: page.getByRole('button', { name: '복원', exact: true }) }).last();
    await item.getByRole('button', { name: '복원', exact: true }).click();
    await wait(3000);
    await closeAll();
    await page.getByRole('button', { name: '📢 알림장' }).click();
    await wait(1800);
    const back = await noticePanel().getByLabel('알림장 내용').inputValue();
    await closeAll();
    assert(emptied.trim() === '', `지운 뒤에도 알림장 글이 남음: ${emptied.replace(/\n/g, ' / ')}`);
    assert(/점검 알림장 첫 줄/.test(back), '되살린 뒤 알림장이 돌아오지 않음');
  });

  await check('[출석부] 기록 칸에서 출결 항목을 고치면 출석부도 바뀜', async () => {
    await openJournalCard('[출결]');
    const box = journalPanelBox();
    const v = await box.inputValue();
    assert(/결석\(질병\) - 감기/.test(v), `출결 항목 글: ${v.replace(/\n/g, ' / ')}`);
    await box.fill(v.replace('결석(질병) - 감기', '결석(기타) - 가족 여행'));
    await box.press('Control+s');
    await wait(3500);
    await closeAll();
    await page.getByRole('button', { name: '📋 출석부' }).click();
    await wait(2000);
    const row = attendPanel().locator('[data-attendance-num]', { hasText: attendName }).first();
    const other = await row.getByRole('button', { name: '기타', exact: true }).getAttribute('aria-pressed');
    const note = await row.getByRole('button', { name: /가족 여행/ }).count();
    await closeAll();
    assert(other === 'true' && note > 0, `사유 '기타' ${other}, 설명 ${note}`);
  });

  await check('[출석부] 출결 모양이 아닌 줄을 넣으면 출석부는 그대로 두고 안내', async () => {
    await openJournalCard('[출결]');
    const box = journalPanelBox();
    const v = await box.inputValue();
    await box.fill(v + '\n오늘 학부모 통화함');
    await box.press('Control+s');
    await wait(3000);
    const warned = await page.getByText(/출결 줄을 읽지 못해 출석부는 그대로/).count();
    // 되돌린다
    await box.fill(v);
    await box.press('Control+s');
    await wait(2500);
    await closeAll();
    assert(warned > 0, '안내가 뜨지 않음');
  });

  await check('[출석부] 기록 칸에서 출결 항목을 지우면 그날 모두 출석', async () => {
    await page.keyboard.press('Shift+Digit1');
    await goToday();
    const card = page.locator('[data-focus-key^="journal"]', { hasText: '[출결]' }).first();
    await card.hover();
    await card.getByTitle('기록 삭제').click();
    await wait(3500);
    await page.getByRole('button', { name: '📋 출석부' }).click();
    await wait(2000);
    const marked = await attendPanel().locator('[data-attendance-num] button[aria-pressed="true"]').count();
    await closeAll();
    assert(marked === 0, `아직 표시된 출결 ${marked}개`);
  });

  // ── 메모 차례·거르개 ──
  await check('[메모] ▲▼ 로 차례를 바꾸고, 다시 열어도 그 차례', async () => {
    await page.keyboard.press('Shift+Digit5');
    await wait(2000);
    await page.getByRole('button', { name: /전체 메모/ }).click();
    await wait(800);
    const keys = async () => page.$$eval('section [data-focus-key^="memo"]', (els) => els.map((e) => e.getAttribute('data-focus-key')));
    const cards = await page.locator('section [data-focus-key^="memo"]').all();
    let idx = -1;
    for (let i = 0; i < cards.length - 1; i++) {
      if (await cards[i].getByRole('button', { name: '뒤로' }).isEnabled()) { idx = i; break; }
    }
    assert(idx >= 0, '▼ 를 누를 수 있는 메모가 없음');
    const before = await keys();
    await cards[idx].getByRole('button', { name: '뒤로' }).click();
    await wait(1800);
    const after = await keys();
    assert(after[idx] === before[idx + 1] && after[idx + 1] === before[idx], '자리가 바뀌지 않음');
    await page.keyboard.press('Shift+Digit1');
    await wait(1200);
    await page.keyboard.press('Shift+Digit5');
    await wait(2000);
    await page.getByRole('button', { name: /전체 메모/ }).click();
    await wait(800);
    const again = await keys();
    assert(again[idx] === before[idx + 1], '다시 열었더니 원래 차례');
  });

  await check('[메모] 거르개 차례: 즐겨찾기 → 라벨 → 전체 메모, 고른 거르개를 기억', async () => {
    const nav = page.getByRole('navigation', { name: '메모 라벨 거르개' });
    const names = (await nav.locator('button[aria-pressed]').allInnerTexts()).map((t) => t.replace(/✓|\d+/g, '').trim());
    assert(names[0].includes('즐겨찾기') && names[names.length - 1].includes('전체 메모'), `차례 ${names.join(', ')}`);
    await nav.locator('button[aria-pressed]').nth(1).click();
    await wait(500);
    await page.keyboard.press('Shift+Digit1');
    await wait(1200);
    await page.keyboard.press('Shift+Digit5');
    await wait(1800);
    const pressed = await nav.locator('button[aria-pressed="true"]').innerText();
    assert(pressed.includes(names[1]), `다시 열었을 때 '${pressed}'`);
    await page.keyboard.press('Shift+Digit1');
    await wait(1200);
    return names.join(' → ');
  });
  // ── 바깥을 누르거나 다른 항목을 열면 저장 ──
  await check('[자동 저장] 일정 칸: 고친 채 다른 일정을 누르면 먼저 저장', async () => {
    await page.keyboard.press('Shift+Digit1');
    await goToday();
    const rows = page.locator('[data-focus-key^="event"]');
    assert((await rows.count()) >= 2, '일정이 두 개 이상 있어야 함');
    const row = rows.last();
    const orig = (await row.innerText()).trim();
    await row.click();
    await wait(400);
    const ta = eventPanel().locator('textarea').first();
    const base = await ta.inputValue();
    await ta.fill(base + ' 넘어가며저장');
    await rows.first().click();
    await wait(1800);
    const ok = (await page.getByText(base + ' 넘어가며저장', { exact: true }).count()) === 1;
    // 되돌려 둔다
    await page.getByText(base + ' 넘어가며저장', { exact: true }).click().catch(() => {});
    await wait(300);
    await eventPanel().locator('textarea').first().fill(base).catch(() => {});
    await eventPanel().locator('textarea').first().press('Control+s').catch(() => {});
    await wait(1200);
    await closeAll();
    assert(ok, `'${orig}' 수정이 저장되지 않음`);
  });

  await check('[자동 저장] 일정 칸: ESC 는 저장하지 않음', async () => {
    const row = page.locator('[data-focus-key^="event"]').last();
    await row.click();
    await wait(400);
    const ta = eventPanel().locator('textarea').first();
    const base = await ta.inputValue();
    await ta.fill(base + ' 버림');
    await ta.press('Escape');
    await wait(1200);
    assert((await page.getByText(base + ' 버림', { exact: true }).count()) === 0, 'ESC 인데 저장됨');
  });

  await check('[자동 저장] 수업 칸: 준비물 고치고 바깥을 누르면 저장', async () => {
    const cell = page.locator('[data-focus-key^="period"]').nth(2);
    await cell.click();
    await wait(400);
    await page.getByPlaceholder('준비물').fill('바깥저장 준비물');
    await page.getByRole('heading', { name: '기록', exact: true }).click();
    await wait(1800);
    assert((await page.getByText('바깥저장 준비물').count()) > 0, '저장되지 않음');
  });

  // 넓은 화면(768px 이상)에서 기록·메모 칸은 화면 옆에 붙는다. 팝업이 아니라서
  // 바깥을 눌러도, 다른 화면으로 옮겨도 닫히지 않는다 (적던 것이 남는다).
  const entryPanel = () => page.locator('aside[aria-label$="쓰기"]');
  await check('[옆 칸] 기록 추가: 화면 옆에 붙고, 왼쪽 화면을 눌러도 닫히지 않음', async () => {
    const J2 = `옆칸 기록 ${Date.now() % 10000}`;
    await page.getByRole('button', { name: '+ 추가' }).click();
    await wait(600);
    assert((await entryPanel().count()) === 1, '옆에 붙은 칸이 아님');
    const panelBox = await entryPanel().boundingBox();
    const mainBox = await page.locator('main').boundingBox();
    assert(mainBox.x + mainBox.width <= panelBox.x + 1, '본문이 칸 밑에 깔림');
    await page.getByPlaceholder(/오늘 있었던 일을 기록해보세요/).fill(J2);
    await page.getByRole('heading', { name: '수업', exact: true }).click();
    await wait(500);
    assert((await entryPanel().count()) === 1, '왼쪽을 눌렀더니 닫힘');
    await page.getByPlaceholder(/오늘 있었던 일을 기록해보세요/).press('Control+s');
    await wait(2000);
    assert((await page.locator('[data-focus-key^="journal"]', { hasText: J2 }).count()) === 1, '저장되지 않음');
  });

  await check('[옆 칸] 다른 화면으로 옮겨도 칸과 글이 남고, 돌아와 저장하면 원래 날짜에 들어감', async () => {
    const ta = page.getByPlaceholder(/오늘 있었던 일을 기록해보세요/);
    const J3 = (await ta.inputValue()) + ' 이어씀';
    await ta.fill(J3);
    // (글을 쓰는 중에는 Shift+2 가 글자로 들어가므로 탭을 눌러 옮긴다)
    await page.locator('header').getByRole('button', { name: '주간', exact: true }).click();
    await wait(1500);
    await page.locator('header').getByRole('button', { name: '▶', exact: true }).click();
    await wait(1200);
    assert((await ta.inputValue()) === J3, '화면을 옮기자 글이 사라짐');
    await ta.press('Control+s');
    await wait(2000);
    await page.locator('header').getByRole('button', { name: '하루', exact: true }).click();
    await page.getByTitle(/오늘 날짜로 돌아가기/).click();
    await wait(1500);
    assert((await page.locator('[data-focus-key^="journal"]', { hasText: J3 }).count()) === 1, '원래 날짜에 저장되지 않음');
    await page.locator('aside').getByRole('button', { name: '닫기' }).click();
    await wait(600);
    assert((await entryPanel().count()) === 0, '닫기로 닫히지 않음');
  });

  await check('[옆 칸] 메모를 고치다 다른 메모를 누르면 고친 것을 저장하고 넘어감', async () => {
    await page.keyboard.press('Shift+Digit5');
    await wait(2000);
    await page.getByRole('button', { name: /전체 메모/ }).click();
    await wait(600);
    const cards = page.locator('section [data-focus-key^="memo"]');
    await cards.nth(0).click();
    await wait(800);
    const ta = page.getByPlaceholder(/자유롭게 생각을 기록해보세요/);
    const M = `옆칸 메모 ${Date.now() % 10000}`;
    await ta.fill(M);
    await cards.nth(1).click();
    await wait(2000);
    const now = await ta.inputValue();
    assert(now !== M, '다른 메모로 넘어가지 않음');
    assert((await page.locator('section [data-focus-key^="memo"]', { hasText: M }).count()) === 1, '앞 메모가 저장되지 않음');
    await page.locator('aside').getByRole('button', { name: '닫기' }).click();
    await wait(500);
    await page.keyboard.press('Shift+Digit1');
    await wait(1200);
  });

  await check('[옆 칸] 주간 일정 칸: 연 채 다른 주로 옮겨도 칸이 남고, 연 날짜에 저장', async () => {
    await page.keyboard.press('Shift+Digit2');
    await wait(2500);
    await page.locator('[title="클릭하여 상세 보기"]').first().click();
    await wait(1200);
    const sub = await eventPanel().locator('p.text-primary').innerText();
    const ta = eventPanel().locator('textarea').first();
    const base = await ta.inputValue();
    await ta.fill(base + ' 옆칸저장');
    // 입력칸 밖에서 눌러야 날짜 이동 단축키가 먹는다
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+ArrowRight');
    await wait(1500);
    assert((await eventPanel().count()) === 1, '다른 주로 옮겼더니 칸이 닫힘');
    await ta.press('Control+s');
    await wait(1500);
    await page.keyboard.press('Control+ArrowLeft');
    await wait(1500);
    const ok = (await page.getByText(base + ' 옆칸저장').count()) > 0;
    await closeAll();
    await page.keyboard.press('Shift+Digit1');
    await wait(1200);
    assert(ok, `열 때의 날짜(${sub})에 저장되지 않음`);
  });

  // ── 화면 보기 ──
  await check('[주간] 넓은 화면이면 다음 주 한 줄, 좁으면 이번 주만', async () => {
    await page.keyboard.press('Shift+Digit2');
    await wait(2500);
    const next = await page.locator('section[aria-label="다음 주"]').count();
    const main = await page.locator('main').boundingBox();
    const wide = main.width - 40 >= 1200;
    await page.keyboard.press('Shift+Digit1');
    await wait(1200);
    assert(next === (wide ? 1 : 0), `본문 ${Math.round(main.width)}px 인데 다음 주 ${next}줄`);
    return wide ? '다음 주까지 보임' : '이번 주만 보임';
  });

  /** 달력 화면의 일정을 눌러 오른쪽 칸이 열리는지 (라벨 칩을 피해 오른쪽 끝을 누른다) */
  const openCalendarEvent = async (scopeKey) => {
    await page.keyboard.press(`Shift+Digit${scopeKey}`);
    await wait(3000);
    const ev = page.locator('[title="클릭하여 상세 보기"]').first();
    assert((await ev.count()) > 0, '누를 일정이 없음');
    const box = await ev.boundingBox();
    await ev.click({ position: { x: box.width - 3, y: box.height / 2 } });
    await wait(1200);
    const ok = await eventPanel().getByRole('heading', { name: '일정 수정' }).isVisible().catch(() => false);
    await closeAll();
    assert(ok, '오른쪽 일정 수정 칸이 안 뜸');
  };
  await check('[월간] 일정을 누르면 오른쪽 일정 수정 칸', async () => openCalendarEvent(3));
  await check('[년간] 일정을 누르면 오른쪽 일정 수정 칸', async () => openCalendarEvent(4));

  // ── 일정: 기간 · 반복 · 묶인 일정 지우기 ──
  /** 오늘 하루 화면의 일정 줄 */
  const eventRow = (text) => page.locator('[data-focus-key^="event"]', { hasText: text }).first();
  /** 묶인 일정을 '연결된 일정 전체 삭제'로 지운다 */
  const deleteWholeGroup = async (text) => {
    const row = eventRow(text);
    await row.hover();
    await row.getByTitle('일정 삭제').click();
    await wait(800);
    assert(await heading(/연결된 일정 삭제/).isVisible(), '지울 범위를 묻지 않음');
    await page.getByRole('button', { name: /연결된 일정 전체 삭제/ }).click();
    await wait(2500);
  };

  await check('[기간 일정] 3일 등록 → 날마다 (1/3) → 🗑 는 범위를 묻고 전체 삭제', async () => {
    await page.keyboard.press('Shift+Digit1');
    await goToday();
    const P = `점검기간 ${Date.now() % 10000}`;
    await page.getByRole('button', { name: '+ 새 일정' }).click();
    await wait(500);
    await eventPanel().getByPlaceholder(EVENT_PH).fill(P);
    await eventPanel().locator('label', { hasText: /^기간$/ }).locator('input').check();
    await wait(800);
    assert(await heading(/연속 기간 등록/).isVisible(), '기간 창이 안 뜸');
    const weekdayOnly = page.getByRole('checkbox', { name: /주말\(토\/일\)과 공휴일 제외/ });
    if ((await weekdayOnly.count()) && (await weekdayOnly.isChecked())) await weekdayOnly.uncheck();
    const start = await page.getByLabel('시작일').inputValue();
    const end = new Date(new Date(start + 'T00:00:00').getTime() + 2 * 864e5);
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    await page.getByLabel('종료일').fill(endStr);
    await wait(300);
    await page.getByRole('button', { name: /등록 \(3일\)/ }).click();
    await wait(3000);
    await closeAll();
    await wait(1200);
    const has = await eventRow(`${P} (1/3)`).count();
    assert(has === 1, `오늘에 '${P} (1/3)' 이 없음`);
    await deleteWholeGroup(`${P} (1/3)`);
    assert((await eventRow(P).count()) === 0, '전체 삭제 뒤에도 남음');
  });

  await check('[반복 일정] 매주 → 📅 미리보기 → 반복 일정 생성 → 오늘에 생기고, 묶음으로 지워짐', async () => {
    const R = `점검반복 ${Date.now() % 10000}`;
    await openMenu('반복 일정 등록');
    await page.getByPlaceholder(/학년 협의회/).fill(R);
    await page.getByRole('button', { name: '매주', exact: true }).click();
    const today = ['일', '월', '화', '수', '목', '금', '토'][new Date().getDay()];
    const dayBtn = page.locator('[data-scroll-lock] button.rounded-full', { hasText: new RegExp(`^${today}$`) });
    if (!(await dayBtn.getAttribute('class')).includes('bg-primary')) await dayBtn.click();
    const dates = page.locator('[data-scroll-lock] input[type=date]');
    const end = new Date(Date.now() + 21 * 864e5);
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    await dates.nth(1).fill(endStr);
    await page.getByRole('button', { name: /미리보기/ }).click();
    await wait(400);
    const preview = await page.getByRole('button', { name: /미리보기/ }).innerText();
    const n = Number((preview.match(/(\d+)개 날짜/) || [])[1] || 0);
    assert(n >= 3, `미리보기 '${preview}'`);
    await page.getByRole('button', { name: /반복 일정 생성 \(\d+개\)/ }).click();
    await wait(3500);
    await closeAll();
    await wait(1500);
    assert((await eventRow(R).count()) === 1, '오늘 일정에 반복 일정이 없음');
    await deleteWholeGroup(R);
    return `${n}개 날짜`;
  });

  // ── 찾기 · 정리 ──
  await check('[라벨 이름 바꾸기] 통합 라벨 관리에서 바꾸면 이미 붙은 일정 칩도 바뀜', async () => {
    const L = `점검라벨일정 ${Date.now() % 10000}`;
    await page.getByRole('button', { name: '+ 새 일정' }).click();
    await wait(500);
    const preset = (await eventPanel().locator('button[aria-pressed="true"]').allInnerTexts())[0];
    const box = eventPanel().getByPlaceholder(EVENT_PH);
    await box.fill(L);
    await box.press('Control+s');
    await wait(1500);
    await box.press('Escape');
    await openMenu('통합 라벨 관리');
    const nameBox = page.locator('[data-scroll-lock] input[type=text]:not([placeholder])').first();
    const before = await nameBox.inputValue();
    assert(before === preset, `맨 위 라벨 '${before}' ≠ 미리 골라진 '${preset}'`);
    const renamed = `${before}바뀜`;
    await nameBox.fill(renamed);
    await page.getByRole('button', { name: /클라우드 저장/ }).click();
    await wait(4000);
    await closeAll();
    await wait(1500);
    const chip = await eventRow(L).innerText();
    // 되돌린다
    await openMenu('통합 라벨 관리');
    await page.locator('[data-scroll-lock] input[type=text]:not([placeholder])').first().fill(before);
    await page.getByRole('button', { name: /클라우드 저장/ }).click();
    await wait(4000);
    await closeAll();
    assert(chip.includes(renamed), `일정 줄 '${chip.replace(/\s+/g, ' ')}' 에 '${renamed}' 가 없음`);
    return `${before} → ${renamed} → ${before}`;
  });

  await check('[휴지통] 전체 선택 · 일괄 복원 · 일괄 삭제', async () => {
    await page.getByRole('button', { name: /휴지통/ }).first().click();
    await wait(1500);
    for (const t of [/전체 선택/, /일괄 복원/, /일괄 삭제/]) assert((await page.getByText(t).count()) > 0, `${t} 없음`);
    await closeAll();
  });

  // ── 공유 · 연동 · 백업 ──
  await check('[백업] JSON 을 고르고 내보내기 → 백업 파일이 내려받아짐', async () => {
    await openMenu('내보내기 / 가져오기');
    await page.getByTitle('JSON').first().click();
    await wait(400);
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByTitle('내보내기', { exact: true }).click(),
    ]);
    const name = dl.suggestedFilename();
    await closeAll();
    assert(/\.json$/i.test(name), `받은 파일 '${name}'`);
    return name;
  });

  // ── 설정 · 단축키 ──
  await check('[환경설정] 시작 화면을 주간으로 저장하면 새로 열 때 주간부터', async () => {
    await openMenu('환경설정');
    await page.locator('[data-scroll-lock]').getByRole('button', { name: '주간', exact: true }).click();
    await page.getByRole('button', { name: '저장', exact: true }).last().click();
    await wait(1500);
    await closeAll();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await heading('일정').waitFor({ timeout: 40000 }).catch(() => {});
    await wait(3000);
    const t = await scopeTitle();
    // 되돌린다
    await openMenu('환경설정');
    await page.locator('[data-scroll-lock]').getByRole('button', { name: '마지막에 보던 화면', exact: true }).click();
    await page.getByRole('button', { name: '저장', exact: true }).last().click();
    await wait(1200);
    await closeAll();
    await page.keyboard.press('Shift+Digit1');
    await wait(1200);
    assert(/주$/.test(t), `새로 연 뒤 제목 '${t}'`);
    return t;
  });

  // 단축키 창은 환경설정 창 위에 뜬다. 두 창 모두 '저장'이 있으니 단축키 창의 것을 누른다.
  const shortcutDialogSave = () =>
    page
      .locator('div.rounded-2xl', { has: page.getByRole('heading', { name: /단축키$/ }) })
      .last()
      .getByRole('button', { name: '저장', exact: true })
      .last()
      .click();
  await check('[단축키 바꾸기] 출석부에 Alt+A → 눌러서 열림 → ⋮ 메뉴와 설명서에도 Alt + A → 기본값으로', async () => {
    await openMenu('환경설정');
    await page.getByRole('button', { name: /단축키 설정/ }).click();
    await wait(800);
    const keyBox = page.getByLabel('출석부 키');
    await keyBox.click();
    await keyBox.press('Alt+KeyA');
    await wait(200);
    await shortcutDialogSave();
    await wait(1000);
    await closeAll();
    await page.keyboard.press('Alt+KeyA');
    await wait(1500);
    const opened = await heading(/출석부/).isVisible().catch(() => false);
    await closeAll();
    await page.getByTitle('더보기 메뉴').click();
    await wait(300);
    const menuText = await page.getByRole('button', { name: /출석부/ }).first().innerText();
    await page.getByRole('button', { name: /사용 설명서/ }).first().click();
    await wait(1500);
    await page.locator('[data-help-category="classroom"]').click();
    await page.locator('[data-help-topic="attendance"]').click();
    await wait(300);
    const helpHasKey = (await page.locator('[data-scroll-lock] kbd', { hasText: 'Alt + A' }).count()) > 0;
    await closeAll();
    // 되돌린다
    await openMenu('환경설정');
    await page.getByRole('button', { name: /단축키 설정/ }).click();
    await wait(800);
    await page.getByRole('button', { name: '기본값으로' }).click();
    await shortcutDialogSave();
    await wait(1000);
    await closeAll();
    assert(opened, 'Alt+A 로 출석부가 열리지 않음');
    assert(/Alt \+ A/.test(menuText), `⋮ 메뉴 항목 '${menuText.replace(/\s+/g, ' ')}'`);
    assert(helpHasKey, '설명서의 출석부 항목에 Alt + A 가 없음');
  });

  // ── 사용 설명서 ──
  await check('[설명서] ⋮ 메뉴 이름이 "사용 설명서", 첫 화면은 기능별 분류 카드만', async () => {
    await page.getByTitle('더보기 메뉴').click();
    await wait(300);
    const item = page.getByRole('button', { name: /사용 설명서/ }).first();
    const label = (await item.innerText()).replace(/\s+/g, ' ').trim();
    assert(!/단축키/.test(label), `메뉴 이름 '${label}'`);
    await item.click();
    await wait(1500);
    const cards = await page.locator('[data-help-category]').count();
    const topics = await page.locator('[data-help-topic]').count();
    await closeAll();
    assert(cards >= 10 && topics === 0, `분류 카드 ${cards}개, 첫 화면의 세부 기능 ${topics}개`);
    return `메뉴 '${label}', 분류 ${cards}개`;
  });

  await check('[설명서] 모든 분류 → 모든 세부 기능을 열어 세부 설명과 사용 예 확인', async () => {
    await openMenu('사용 설명서');
    const catIds = await page.locator('[data-help-category]').evaluateAll((els) => els.map((e) => e.dataset.helpCategory));
    let opened = 0;
    const lacking = [];
    for (const cid of catIds) {
      await page.locator(`[data-help-category="${cid}"]`).click();
      await wait(80);
      const topicIds = await page.locator('[data-help-topic]').evaluateAll((els) => els.map((e) => e.dataset.helpTopic));
      assert(topicIds.length > 0, `${cid} 분류가 비었음`);
      for (const tid of topicIds) {
        await page.locator(`[data-help-topic="${tid}"]`).click();
        await wait(60);
        const detail = await page.locator('section[aria-labelledby="help-detail-heading"] > :not(h4)').count();
        const steps = await page.locator('section[aria-labelledby="help-example-heading"] li').count();
        if (!detail || !steps) lacking.push(tid);
        opened++;
        await page.getByRole('navigation', { name: '설명서 위치' }).getByRole('button').first().click();
        await wait(60);
      }
      await page.getByRole('button', { name: '← 기능별 분류' }).click();
      await wait(60);
    }
    await closeAll();
    assert(lacking.length === 0, `세부 설명이나 사용 예가 빈 기능: ${lacking.join(', ')}`);
    return `분류 ${catIds.length}개 · 기능 ${opened}개`;
  });

  await check('[오류] 점검 동안 페이지 오류 없음', async () => {
    assert(pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  });
  await ctx.close();
}

// ───────────────────────────── 휴대폰 ─────────────────────────────
if (ONLY !== 'pc') {
  // 파이어폭스는 isMobile 을 받지 않는다 (폭과 터치만 흉내 낸다)
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    ...(BROWSER === 'firefox' ? {} : { isMobile: true }),
  });
  page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await heading('수업').waitFor({ timeout: 40000 });
  await wait(2000);

  await check('[휴대폰] 아래 탭바로 화면 전환', async () => {
    const bar = page.locator('nav').last();
    await bar.getByText('주간').click();
    await wait(1500);
    assert(/주$/.test(await scopeTitle()), `제목 '${await scopeTitle()}'`);
    await bar.getByText('하루').click();
    await wait(1200);
  });

  await check('[휴대폰] ⋮ 메뉴에 캘린더·휴지통·표시·로그아웃', async () => {
    await page.getByTitle('더보기 메뉴').click();
    await wait(400);
    for (const t of [/구글 캘린더로 보내기/, /휴지통/, /로그아웃/]) assert((await page.getByRole('button', { name: t }).count()) > 0, `${t} 없음`);
    await page.keyboard.press('Escape');
  });

  await check('[휴대폰] 새 일정 칸은 화면을 덮고, 저장 → 닫기로 목록에 생김', async () => {
    const Q = `폰일정 ${Date.now() % 10000}`;
    await page.getByRole('button', { name: '+ 새 일정' }).click();
    await wait(800);
    assert((await eventPanel().count()) === 0, '좁은 화면인데 옆에 붙는 칸으로 열림');
    const box = page.getByPlaceholder(EVENT_PH);
    const b = await box.boundingBox();
    assert(b && b.width > 250, '입력칸이 안 보임');
    await box.fill(Q);
    await page.getByRole('button', { name: '저장', exact: true }).last().click();
    await wait(1800);
    await page.getByRole('button', { name: '닫기', exact: true }).last().click();
    await wait(800);
    assert((await page.getByText(Q, { exact: true }).count()) === 1, '목록에 새 일정이 없음');
  });

  await check('[휴대폰] 사용 설명서: 분류 → 기능 → 세부 설명·사용 예', async () => {
    await page.getByTitle('더보기 메뉴').click();
    await wait(400);
    await page.getByRole('button', { name: /사용 설명서/ }).first().click();
    await wait(1500);
    await page.locator('[data-help-category="events"]').click();
    await page.locator('[data-help-topic="event-add"]').click();
    await wait(300);
    const ex = await page.locator('section[aria-labelledby="help-example-heading"] li').count();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.goBack();
    await wait(800);
    assert(ex > 0, '사용 예가 없음');
    assert(!overflow, '가로로 넘침');
  });

  await check('[휴대폰] 뒤로가기는 앱을 나가지 않고 팝업만 닫음', async () => {
    await page.locator('header').getByTitle(/통합 검색/).click();
    await wait(1000);
    assert((await dialogOpen()) > 0, '검색 창이 안 뜸');
    await page.goBack();
    await wait(1000);
    assert(page.url().startsWith(SITE.replace(/\/$/, '')), '앱을 나감');
    assert((await dialogOpen()) === 0, '팝업이 닫히지 않음');
  });
  await ctx.close();
}

await browser.close();
const fails = results.filter((r) => !r.ok);
console.log(`\n결과: ${results.length - fails.length}/${results.length} 통과`);
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ env: { BROWSER, PC_W, PC_H, ONLY }, results }, null, 2));
process.exit(0);
