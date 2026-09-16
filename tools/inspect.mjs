// tools/inspect.mjs
//
// 에뮬레이터에 심어 둔 데이터로 V4를 실제 크롬에서 끝까지 눌러 보며,
// 화면마다 (1) 걸린 시간 (2) Firestore에 오간 횟수 (3) 조용히 난 오류를 잰다.
// 마지막에 좁은 화면(390px)으로 한 번 더 돌며 잘리는 곳을 찾는다.
//
//   node tools/inspect.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.INSPECT_URL || 'http://localhost:5173/';
const OUT = 'tools/report';
mkdirSync(OUT, { recursive: true });

const problems = [];
const rows = [];

async function installProbes(page) {
  await page.addInitScript(() => {
    // (1) 본 스레드를 50ms 넘게 붙잡는 작업(=화면이 멈추는 구간)
    window.__longtasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__longtasks.push(Math.round(e.duration));
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* 지원 안 하면 넘어간다 */ }

    // 내려받은 문서 수도 세 보려 했으나 접었다. Firestore의 WebChannel은
    // 한 연결(SID)을 롱폴링으로 잘게 나눠 protobuf에 가까운 형태로 실어 보내서,
    // fetch/XHR을 가로채도 'documentChange' 같은 이름으로는 세어지지 않는다.
    // HTTP 요청 수를 세는 것은 더 나쁘다 — 조각 수일 뿐 읽은 문서 수가 아니다.
    // 제대로 세려면 앱 쪽에서 SDK 호출을 감싸야 한다. 지금은 아래 네 가지만 본다.
  });
}

function makeCollector(page) {
  const state = { fs: 0, failed: [], errors: [], warns: [] };
  page.on('request', (r) => {
    if (r.url().includes('127.0.0.1:8080')) state.fs++;
  });
  page.on('requestfailed', (r) => {
    // 크롬이 페이지를 떠날 때 끊는 롱폴링은 오류가 아니다
    if (r.failure()?.errorText?.includes('ERR_ABORTED')) return;
    state.failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 120)}`);
  });
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') state.errors.push(t.slice(0, 300));
    else if (m.type() === 'warning') state.warns.push(t.slice(0, 300));
  });
  page.on('pageerror', (e) => state.errors.push('PAGEERROR ' + e.message.slice(0, 300)));
  return state;
}

async function step(page, s, name, action, opts = {}) {
  const settle = opts.settle ?? 1500;
  const shot = opts.shot ?? null;
  const e0 = s.errors.length, w0 = s.warns.length, f0 = s.failed.length;
  await page.evaluate(() => { window.__longtasks = []; }).catch(() => {});
  const t0 = Date.now();
  await action();
  // 누른 것이 실제로 화면에 그려질 때까지 기다린다.
  // (클릭 반환 시각만 재면 React가 그리는 시간이 통째로 빠진다)
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  ).catch(() => {});
  const ms = Date.now() - t0;
  await page.waitForTimeout(settle);
  const blocked = await page.evaluate(() => (window.__longtasks || []).slice()).catch(() => []);

  const row = {
    name,
    ms,
    blockedMs: blocked.reduce((a, b) => a + b, 0),
    worstBlockMs: blocked.length ? Math.max(...blocked) : 0,
    errors: s.errors.slice(e0),
    warns: s.warns.slice(w0),
    failed: s.failed.slice(f0),
  };
  rows.push(row);
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: false });

  const flags = [];
  if (row.ms > 1000) flags.push(`느림 ${row.ms}ms`);
  if (row.worstBlockMs > 200) flags.push(`화면 멈춤 ${row.worstBlockMs}ms`);
  if (row.errors.length) flags.push(`오류 ${row.errors.length}건`);
  if (row.failed.length) flags.push(`요청 실패 ${row.failed.length}건`);
  if (flags.length) problems.push(`${name} — ${flags.join(', ')}`);

  console.log(
    `  ${String(row.ms).padStart(5)}ms  멈춤 ${String(row.worstBlockMs).padStart(4)}ms  ` +
    `오류 ${row.errors.length}  실패요청 ${row.failed.length}  ${name}`
  );
  return row;
}

/** 가로로 삐져나온 요소를 찾는다 (좁은 화면에서 잘리는 곳) */
async function findOverflow(page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > w + 2 || r.left < -2) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' && r.width <= w + 2) continue;
        // 가로로 밀어 보는 영역(칩 줄, 표 등) 안에 있는 것은 삐져나온 게 아니다.
        let scrollable = false;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX;
          if (ox === 'auto' || ox === 'scroll') { scrollable = true; break; }
        }
        if (scrollable) continue;
        bad.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 70),
          text: (el.textContent || '').trim().slice(0, 40),
          left: Math.round(r.left),
          right: Math.round(r.right),
        });
      }
    }
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      clientWidth: w,
      worst: bad.sort((a, b) => b.right - a.right).slice(0, 6),
    };
  });
}

/**
 * 서로 겹쳐 있는 '누를 수 있는 것'을 찾는다.
 * 넘침 검사로는 못 잡는다. 겹친 쪽은 폭 안에 얌전히 들어와 있기 때문이다.
 * 위에 덮인 단추를 누르면 엉뚱한 것이 눌린다.
 */
async function findOverlaps(page) {
  return page.evaluate(() => {
    // 고정(fixed)된 막대 밑으로 내용이 스크롤되어 지나가는 것은 겹침이 아니라
    // 원래 그런 것이다. 그래서 '같은 고정 영역 안에서 서로 겹친 것'만 본다.
    const fixedRoot = (el) => {
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).position === 'fixed') return a;
      }
      return null;
    };

    const els = [...document.querySelectorAll('button, a, input, select')]
      .map((el) => ({ el, r: el.getBoundingClientRect(), fx: fixedRoot(el) }))
      .filter(({ el, r }) => {
        if (r.width < 8 || r.height < 8) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.1;
      });

    const hits = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i], bb = els[j];
        // 서로 감싸는 관계(단추 안의 단추 등)는 겹침이 아니다
        if (a.el.contains(bb.el) || bb.el.contains(a.el)) continue;
        if (a.fx !== bb.fx) continue; // 하나만 고정 막대 안 -> 그냥 밑으로 지나가는 것
        const ox = Math.min(a.r.right, bb.r.right) - Math.max(a.r.left, bb.r.left);
        const oy = Math.min(a.r.bottom, bb.r.bottom) - Math.max(a.r.top, bb.r.top);
        if (ox > 4 && oy > 4) {
          hits.push({
            a: (a.el.textContent || a.el.tagName).trim().slice(0, 16),
            b: (bb.el.textContent || bb.el.tagName).trim().slice(0, 16),
            x: Math.round(ox),
            y: Math.round(oy),
          });
        }
      }
    }
    return hits.sort((p, q) => q.x * q.y - p.x * p.y).slice(0, 5);
  });
}

async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  // ── 1) 넓은 화면: 속도와 조용한 실패 ───────────────────────────
  console.log('\n[넓은 화면 1440x900]');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await installProbes(page);
  const s = makeCollector(page);

  // ⚠️ 시간을 재는 동작 안에 고정 대기(waitForTimeout)를 넣지 말 것.
  //    그 대기가 그대로 '걸린 시간'으로 잡혀 숫자가 부풀어 오른다.
  //    대신 '화면에 실제로 나타났는가'로 기다린다.
  await step(page, s, '첫 로드 → 일정이 화면에 나올 때까지', async () => {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 30000 });
  }, { settle: 3000, shot: '01-day' });

  await step(page, s, '다음 날로 1번 이동', async () => {
    await page.getByRole('button', { name: '▶' }).first().click();
  }, { settle: 1200 });

  await step(page, s, '다음 날로 또 1번 이동', async () => {
    await page.getByRole('button', { name: '▶' }).first().click();
  }, { settle: 1200 });

  const screens = [['주간', '02-week'], ['월간', '03-month'], ['년간', '04-year'], ['메모', '05-memo']];
  for (const pair of screens) {
    const label = pair[0], shot = pair[1];
    await step(page, s, `${label} 화면 열기`, async () => {
      await page.getByRole('button', { name: label, exact: true }).click();
    }, { settle: 2500, shot });
  }

  await step(page, s, '하루 화면으로 돌아오기', async () => {
    await page.getByRole('button', { name: '하루', exact: true }).click();
  }, { settle: 1500 });

  await step(page, s, '검색 팝업 열기', async () => {
    await page.getByRole('button', { name: /검색/ }).first().click();
    await page.getByRole('button', { name: '데이터 찾기' }).waitFor({ timeout: 10000 });
  }, { settle: 800 });

  await step(page, s, '검색 — 1학기 전체 (검색어 없이)', async () => {
    await page.getByRole('combobox').first().selectOption('sem1');
    await page.getByRole('button', { name: '데이터 찾기' }).click();
    await page.getByText(/총 .*건의 데이터를 찾았습니다/).waitFor({ timeout: 60000 });
  }, { settle: 1200, shot: '06-search' });

  const found = await page.getByText(/총 .*건의 데이터를 찾았습니다/).innerText().catch(() => '');
  console.log(`         ↳ ${found.trim()}`);

  await step(page, s, '검색 결과 더 보기 5번', async () => {
    for (let i = 0; i < 5; i++) {
      const more = page.getByRole('button', { name: /더 보기/ });
      if (await more.count() === 0) break;
      await more.click();
    }
  }, { settle: 800 });

  await step(page, s, '검색 닫기', async () => {
    await page.keyboard.press('Escape');
  }, { settle: 600 });

  await step(page, s, '새 일정 추가', async () => {
    await page.getByRole('button', { name: '+ 새 일정' }).click();
    const box = page.locator('form textarea, form input[type="text"]').first();
    await box.fill('점검용 일정 — 지워도 됩니다');
    await page.keyboard.press('Enter');
  }, { settle: 2000, shot: '07-add-event' });

  await browser.close();

  // ── 2) 좁은 화면: 잘리는 곳 ────────────────────────────────────
  console.log('\n[좁은 화면 390x844]');
  const b2 = await chromium.launch({ channel: 'chrome', headless: true });
  const m = await b2.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await installProbes(m);
  const s2 = makeCollector(m);
  await step(m, s2, '모바일 첫 로드 → 일정이 나올 때까지', async () => {
    await m.goto(URL, { waitUntil: 'domcontentloaded' });
    await m.getByRole('heading', { name: '일정' }).waitFor({ timeout: 30000 });
  }, { settle: 3000 });

  const overflowReport = [];
  // ⚠️ 모바일 하단 탭은 단추 이름이 '📅 월간'처럼 그림까지 붙어 있어서
  //    이름이 정확히 '월간'인 단추를 찾으면 하나도 안 잡힌다. 예전에는 여기서
  //    조용히 건너뛰고 같은 화면을 다섯 번 찍어 놓고 '이상 없음'이라고 했다.
  //    이제 못 찾거나 화면이 안 바뀌면 그것 자체를 문제로 적는다.
  const mobileScreens = [
    ['하루', 'm-01-day'], ['주간', 'm-02-week'], ['월간', 'm-03-month'],
    ['년간', 'm-04-year'], ['메모', 'm-05-memo'],
  ];
  for (const pair of mobileScreens) {
    const label = pair[0], shot = pair[1];
    const tab = m.locator('nav button').filter({ hasText: label }).first();
    if (await tab.count() === 0) {
      problems.push(`모바일 ${label} 탭을 찾지 못했다 (점검 못 함)`);
      continue;
    }
    await tab.click();
    await m.waitForTimeout(2200);

    // 정말 그 화면으로 바뀌었는지 확인한다 (누른 탭에 강조가 들어갔는가)
    const active = await tab.evaluate((el) => el.className.includes('text-primary'));
    if (!active) {
      problems.push(`모바일 ${label} 탭을 눌렀는데 화면이 바뀌지 않았다`);
    }

    await m.screenshot({ path: `${OUT}/${shot}.png`, fullPage: false });
    const o = await findOverflow(m);
    const ov = await findOverlaps(m);
    overflowReport.push(Object.assign({ screen: label, switched: active, overlaps: ov }, o));
    for (const h of ov) {
      problems.push(
        `모바일 ${label} 화면 — '${h.a}'와 '${h.b}'가 ${h.x}x${h.y}px 겹침 ` +
        '(위에 덮인 쪽을 누르면 엉뚱한 것이 눌린다)'
      );
    }
    const over = o.docScrollWidth - o.clientWidth;
    console.log(
      `  ${label}: ${active ? '' : '[화면 안 바뀜] '}가로 넘침 ${over > 2 ? over + 'px' : '없음'}` +
      `, 삐져나온 요소 ${o.worst.length}개`
    );
    if (over > 2) problems.push(`모바일 ${label} 화면 — 가로로 ${over}px 넘침`);
    if (o.worst.length) {
      problems.push(
        `모바일 ${label} 화면 — 삐져나온 요소 ${o.worst.length}개 ` +
        `(예: <${o.worst[0].tag}> "${o.worst[0].text}" 오른쪽 끝 ${o.worst[0].right}px)`
      );
    }
  }

  const searchBtn = m.locator('nav button, header button, button').filter({ hasText: '🔍' }).first();
  if (await searchBtn.count() > 0) {
    await searchBtn.click();
    await m.waitForTimeout(1500);
    await m.screenshot({ path: `${OUT}/m-06-search.png` });
    const o = await findOverflow(m);
    overflowReport.push(Object.assign({ screen: '검색 팝업' }, o));
    const over = o.docScrollWidth - o.clientWidth;
    console.log(`  검색 팝업: 가로 넘침 ${over > 2 ? over + 'px' : '없음'}, 삐져나온 요소 ${o.worst.length}개`);
    if (over > 2) problems.push(`모바일 검색 팝업 — 가로로 ${over}px 넘침`);
    if (o.worst.length) problems.push(`모바일 검색 팝업 — 삐져나온 요소 ${o.worst.length}개`);
  } else {
    problems.push('모바일 검색 단추를 찾지 못했다 (점검 못 함)');
  }

  await b2.close();

  writeFileSync(
    `${OUT}/report.json`,
    JSON.stringify({ rows, overflow: overflowReport, problems }, null, 2),
    'utf-8'
  );

  console.log('\n──────── 걸린 곳 ────────');
  if (problems.length === 0) console.log('눈에 띄는 것 없음');
  else problems.forEach((p) => console.log(' • ' + p));

  const allErrors = [...new Set(rows.flatMap((r) => r.errors))];
  const allWarns = [...new Set(rows.flatMap((r) => r.warns))];
  const allFailed = [...new Set(rows.flatMap((r) => r.failed))];
  if (allErrors.length) { console.log('\n──────── 콘솔 오류 ────────'); allErrors.forEach((e) => console.log(' ! ' + e)); }
  if (allFailed.length) { console.log('\n──────── 실패한 요청 ────────'); allFailed.forEach((e) => console.log(' ! ' + e)); }
  if (allWarns.length) { console.log('\n──────── 경고 ────────'); allWarns.slice(0, 15).forEach((e) => console.log(' ~ ' + e)); }
  console.log(`\n스크린샷과 상세 기록: ${OUT}/`);
}

run().catch((e) => { console.error(e); process.exit(1); });
