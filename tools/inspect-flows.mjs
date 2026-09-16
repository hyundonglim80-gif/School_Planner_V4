// tools/inspect-flows.mjs
//
// 첫 하네스(inspect.mjs)가 못 본 곳을 본다.
//   1) 팝업 스무 개 남짓의 생김새가 서로 어긋나지 않는가
//   2) 공유 그룹 만들기 / 참여 / 전환
//   3) 내보내기·가져오기 — CSV, JSON, 조사표 CSV, 구글 캘린더, 구글 시트
//
// 구글 캘린더·시트는 실제 구글 토큰이 있어야 끝까지 가므로 여기서는
// "토큰 없이 눌렀을 때 조용히 죽지 않고 제대로 알려 주는가"까지만 본다.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.INSPECT_URL || 'http://localhost:4173/';
const OUT = 'tools/report';
mkdirSync(OUT, { recursive: true });

const problems = [];
const notes = [];

function collect(page, bag) {
  page.on('console', (m) => {
    if (m.type() === 'error') bag.errors.push(m.text().slice(0, 240));
  });
  page.on('pageerror', (e) => bag.errors.push('PAGEERROR ' + e.message.slice(0, 240)));
  page.on('dialog', async (d) => {
    bag.dialogs.push(`${d.type()}: ${d.message().slice(0, 120)}`);
    await d.dismiss().catch(() => {});
  });
}

/**
 * 토스트는 2.5초 뒤 스스로 사라진다. 그래서 '지금 떠 있는 것'을 읽으면
 * 늦게 읽었을 때 아무것도 없는 것처럼 보인다 — 조용히 실패한 것과 구별이 안 된다.
 * 뜨는 순간 전부 기록해 두고 나중에 꺼내 본다.
 */
async function watchToasts(page) {
  await page.addInitScript(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const mu of muts) {
        for (const n of mu.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'sp4-toast-container') continue;
          const inContainer = n.parentElement && n.parentElement.id === 'sp4-toast-container';
          if (inContainer) window.__toasts.push((n.textContent || '').trim());
        }
      }
      // addInitScript는 문서가 만들어지기 전에 돈다. documentElement는 아직 없을
      // 수 있으므로 항상 존재하는 document를 본다.
    }).observe(document, { childList: true, subtree: true });
  });
}

async function takeToasts(page) {
  return page.evaluate(() => {
    const t = (window.__toasts || []).slice();
    window.__toasts = [];
    return t;
  }).catch(() => []);
}

/** 열려 있는 팝업의 생김새를 한 줄로 요약한다 */
async function fingerprint(page) {
  return page.evaluate(() => {
    // 가장 위에 있는 팝업 상자를 찾는다 (z-index가 가장 큰 fixed 껍데기 안의 카드)
    const shells = [...document.querySelectorAll('div.fixed.inset-0, div[style*="z-index"]')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 200 && r.height > 100;
      });
    if (shells.length === 0) return null;

    // ⚠️ 마지막 껍데기를 곧바로 집으면 안 된다. 배경 가림막도 fixed inset-0 이라
    //    같이 잡히는데 그 안에는 팝업 상자가 없다. 검색 팝업이 그 구조라
    //    '열리지 않았다'고 잘못 읽었다. 뒤에서부터 훑어 상자가 있는 것을 고른다.
    const cardIn = (shell) =>
      [...shell.querySelectorAll('div')]
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter(({ e, r }) => {
          const cs2 = getComputedStyle(e);
          return r.width > 200 && r.height > 100 && cs2.backgroundColor !== 'rgba(0, 0, 0, 0)'
            && parseFloat(cs2.borderTopLeftRadius) > 0;
        })
        .sort((x, y) => y.r.width * y.r.height - x.r.width * x.r.height)[0];

    let card = null;
    for (let i = shells.length - 1; i >= 0; i--) {
      card = cardIn(shells[i]);
      if (card) break;
    }
    if (!card) return null;

    const cs = getComputedStyle(card.e);
    const texts = (sel) => [...card.e.querySelectorAll(sel)].map((x) => (x.textContent || '').trim());
    const buttons = texts('button').filter(Boolean);

    return {
      width: Math.round(card.r.width),
      radius: cs.borderTopLeftRadius,
      heading: (card.e.querySelector('h1,h2,h3')?.textContent || '').trim().slice(0, 40),
      hasX: buttons.some((t) => t === '✕' || t === '×' || t === 'X'),
      hasClose: buttons.some((t) => t === '닫기'),
      hasCancel: buttons.some((t) => t === '취소'),
      buttonCount: buttons.length,
      lastButtons: buttons.slice(-3),
    };
  });
}

async function openFromMenu(page, label) {
  await page.getByRole('button', { name: '⋮' }).first().click();
  await page.waitForTimeout(350);
  const item = page.getByRole('button', { name: new RegExp(label) }).first();
  if (await item.count() === 0) {
    await page.keyboard.press('Escape');
    return false;
  }
  await item.click();
  await page.waitForTimeout(900);
  return true;
}

async function closeAll(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const bag = { errors: [], dialogs: [], popups: [] };
  collect(page, bag);
  await watchToasts(page);

  // 구글 캘린더/시트는 권한 창(팝업)을 새로 띄운다. 에뮬레이터에서는 그 창이
  // 뜬 채로 남아 흐름이 멈춘다. 뜬 것을 기록하고 바로 닫아 계속 진행한다.
  ctx.on('page', async (p) => {
    bag.popups.push(p.url().slice(0, 100));
    await p.close().catch(() => {});
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);

  // ── 1) 팝업 생김새 훑기 ────────────────────────────────────────
  console.log('\n[팝업 생김새]');
  const shapes = [];

  const headerPopups = [
    ['D-Day', () => page.getByRole('button', { name: /D-Day/ }).first().click()],
    ['휴지통', () => page.getByRole('button', { name: /휴지통/ }).first().click()],
    ['검색', () => page.getByRole('button', { name: /검색/ }).first().click()],
    ['구글 캘린더로 보내기', () => page.getByRole('button', { name: /캘린더/ }).first().click()],
  ];
  for (const [name, open] of headerPopups) {
    await open();
    await page.waitForTimeout(900);
    const fp = await fingerprint(page);
    if (fp) shapes.push({ name, ...fp });
    else problems.push(`'${name}' 팝업이 열리지 않았거나 생김새를 읽지 못했다`);
    await page.screenshot({ path: `${OUT}/p-${name.replace(/[^가-힣A-Za-z]/g, '')}.png` });
    await closeAll(page);
  }

  const menuPopups = [
    '통합 라벨 관리', '반복 일정 등록', '미완료 일정 가져오기',
    '학급 정보', '공유 그룹 관리', '시간표 적용',
    '내보내기 / 가져오기', '환경설정', '사용 설명서',
  ];
  for (const label of menuPopups) {
    const ok = await openFromMenu(page, label);
    if (!ok) { problems.push(`⋮ 메뉴에서 '${label}'를 찾지 못했다`); continue; }
    const fp = await fingerprint(page);
    if (fp) shapes.push({ name: label, ...fp });
    else problems.push(`'${label}' 팝업이 열리지 않았거나 생김새를 읽지 못했다`);
    await page.screenshot({ path: `${OUT}/p-${label.replace(/[^가-힣A-Za-z]/g, '')}.png` });
    await closeAll(page);
  }

  for (const s of shapes) {
    console.log(
      `  ${s.name.padEnd(16)} 폭 ${String(s.width).padStart(4)}px  모서리 ${s.radius.padStart(5)}  ` +
      `✕ ${s.hasX ? 'O' : '-'}  닫기 ${s.hasClose ? 'O' : '-'}  제목 "${s.heading}"`
    );
  }

  // 어긋나는 것 추리기
  const radii = [...new Set(shapes.map((s) => s.radius))];
  if (radii.length > 1) {
    notes.push(`팝업 모서리 반경이 ${radii.length}가지다: ${radii.join(', ')}`);
    for (const r of radii) {
      const who = shapes.filter((s) => s.radius === r).map((s) => s.name);
      notes.push(`  ${r} — ${who.join(', ')}`);
    }
  }
  const noX = shapes.filter((s) => !s.hasX);
  if (noX.length) problems.push(`✕ 닫기 단추가 없는 팝업: ${noX.map((s) => s.name).join(', ')}`);
  const noClose = shapes.filter((s) => !s.hasClose);
  if (noClose.length) notes.push(`바닥에 '닫기' 단추가 없는 팝업: ${noClose.map((s) => s.name).join(', ')}`);
  const cancel = shapes.filter((s) => s.hasCancel);
  if (cancel.length) problems.push(`'취소' 문구를 쓰는 팝업(규칙은 '닫기'): ${cancel.map((s) => s.name).join(', ')}`);
  const noHeading = shapes.filter((s) => !s.heading);
  if (noHeading.length) problems.push(`제목이 없는 팝업: ${noHeading.map((s) => s.name).join(', ')}`);

  // ── 2) 공유 그룹 ───────────────────────────────────────────────
  console.log('\n[공유 그룹]');
  await openFromMenu(page, '공유 그룹 관리');
  await page.screenshot({ path: `${OUT}/g-01-group.png` });

  const makeTab = page.getByRole('button', { name: /새 그룹 만들기/ }).first();
  if (await makeTab.count() === 0) {
    problems.push('공유 그룹 — 새 그룹 만들기 자리를 찾지 못했다');
  } else {
    await makeTab.click();
    await page.waitForTimeout(400);
    const nameBox = page.locator('input[type="text"]:visible').first();
    await nameBox.fill('점검용 학년 공유방');
    const submit = page.getByRole('button', { name: /만들기|생성/ }).last();
    await submit.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/g-02-created.png` });

    const body = await page.locator('body').innerText();
    const hasCode = /초대 코드/.test(body);
    const madeIt = body.includes('점검용 학년 공유방');
    console.log(`  그룹 생성: ${madeIt ? '됨' : '안 됨'}, 초대 코드 표시: ${hasCode ? '됨' : '안 됨'}`);
    if (!madeIt) problems.push('공유 그룹 — 만들었는데 목록에 나타나지 않는다');
    if (madeIt && !hasCode) problems.push('공유 그룹 — 만들었는데 초대 코드가 보이지 않는다 (남을 부를 수 없다)');

    const code = (body.match(/초대 코드:?\s*([A-Za-z0-9-]{4,})/) || [])[1];
    if (code) console.log(`  초대 코드: ${code}`);
    notes.push(`공유 그룹 만들기까지 확인함${code ? ` (초대 코드 ${code})` : ''}. 다른 계정으로 참여하는 것은 확인하지 못함`);
  }
  await closeAll(page);

  // 그룹으로 전환되는지 (상단에 그룹 고르는 자리가 있는가)
  const groupSwitch = await page.getByText('점검용 학년 공유방').count();
  console.log(`  화면에서 그룹으로 전환하는 자리: ${groupSwitch > 0 ? '있음' : '못 찾음'}`);
  if (groupSwitch === 0) {
    problems.push('공유 그룹 — 만든 그룹으로 전환하는 자리를 화면에서 찾지 못했다');
  }

  // ── 3) 내보내기 / 가져오기 ─────────────────────────────────────
  console.log('\n[내보내기 / 가져오기]');
  await openFromMenu(page, '내보내기 / 가져오기');
  await page.screenshot({ path: `${OUT}/b-01-backup.png` });

  // 대상 단추는 접근 이름이 '📅 캘린더'처럼 그림까지 붙어 있어서 문구만으로는 안 잡힌다.
  // title 속성이 정확히 한 단어라 그것으로 고른다.
  const pickTarget = async (label) => {
    const b = page.locator(`button[title="${label}"]`).first();
    if (await b.count() === 0) return false;
    await b.click();
    await page.waitForTimeout(400);
    return true;
  };
  const pickScope = async (label) => {
    const b = page.getByRole('button', { name: new RegExp(label) }).first();
    if (await b.count() === 0) return false;
    await b.click();
    await page.waitForTimeout(300);
    return true;
  };
  const runExport = async (name) => {
    const before = bag.errors.length;
    const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await page.getByRole('button', { name: /내보내기$/ }).last().click();
    const file = await dl;
    await page.waitForTimeout(1800);
    const msg = await takeToasts(page);
    const newErrors = bag.errors.slice(before);
    console.log(
      `  ${name.padEnd(14)} 파일 ${file ? '받음: ' + (await file.suggestedFilename()) : '없음'}` +
      `  알림 ${JSON.stringify(msg)}  오류 ${newErrors.length}`
    );
    return { file, msg, newErrors };
  };

  // CSV
  if (await pickTarget('CSV')) {
    await pickScope('해당 월');
    const r = await runExport('CSV 내보내기');
    if (!r.file) problems.push('내보내기 — CSV를 골랐는데 파일이 내려오지 않는다');
    if (r.newErrors.length) problems.push(`내보내기 — CSV에서 콘솔 오류: ${r.newErrors[0]}`);
  } else problems.push('내보내기 — CSV 고르는 자리를 찾지 못했다');

  // JSON
  if (await pickTarget('JSON')) {
    await pickScope('해당 월');
    const r = await runExport('JSON 내보내기');
    if (!r.file) problems.push('내보내기 — JSON을 골랐는데 파일이 내려오지 않는다');
  }

  // 조사표 CSV
  if (await pickTarget('조사표')) {
    const r = await runExport('조사표 CSV');
    if (!r.file && !r.msg.length) {
      problems.push('내보내기 — 조사표를 골랐는데 파일도 안 내려오고 알림도 없다 (조용히 실패)');
    }
  }

  // 구글 캘린더 / 시트: 토큰이 없을 때 제대로 알려 주는가
  for (const target of ['캘린더', '구글 시트']) {
    try {
      if (!(await pickTarget(target))) { problems.push(`내보내기 — '${target}' 고르는 자리를 찾지 못했다`); continue; }
      await pickScope('해당 월');
      const before = bag.errors.length;
      const popupsBefore = bag.popups.length;
      await page.getByRole('button', { name: /내보내기$/ }).last().click({ timeout: 10000 });
      await page.waitForTimeout(6000);
      const msg = await takeToasts(page);
      const newErrors = bag.errors.slice(before);
      const askedPermission = bag.popups.length > popupsBefore;
      console.log(
        `  ${target.padEnd(14)} 알림 ${JSON.stringify(msg)}  권한창 ${askedPermission ? '뜸' : '안 뜸'}  오류 ${newErrors.length}`
      );
      if (msg.length === 0 && !askedPermission) {
        problems.push(
          `내보내기 — '${target}'를 눌렀는데 알림도 권한창도 없다 (됐는지 안 됐는지 알 수 없다)`
        );
      }
      notes.push(
        `'${target}'는 실제 구글 토큰이 있어야 끝까지 간다. 여기서는 ` +
        `${askedPermission ? '권한 창을 띄우는 것까지' : '안내 문구까지'} 확인함`
      );
    } catch (e) {
      problems.push(`내보내기 — '${target}'에서 멈췄다: ${String(e.message).slice(0, 90)}`);
      await page.keyboard.press('Escape').catch(() => {});
      await openFromMenu(page, '내보내기 / 가져오기');
    }
  }
  await page.screenshot({ path: `${OUT}/b-02-backup-after.png` });
  await closeAll(page);

  await ctx.close();
  await browser.close();

  writeFileSync(`${OUT}/flows.json`, JSON.stringify({ shapes, problems, notes, bag }, null, 2), 'utf-8');

  console.log('\n──────── 고칠 것 ────────');
  if (problems.length === 0) console.log('없음');
  else problems.forEach((p) => console.log(' • ' + p));
  console.log('\n──────── 참고 ────────');
  notes.forEach((n) => console.log(' - ' + n));
  if (bag.errors.length) {
    console.log('\n──────── 콘솔 오류 ────────');
    [...new Set(bag.errors)].forEach((e) => console.log(' ! ' + e));
  }
  if (bag.dialogs.length) {
    console.log('\n──────── 브라우저 대화상자 ────────');
    [...new Set(bag.dialogs)].forEach((e) => console.log(' ? ' + e));
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
