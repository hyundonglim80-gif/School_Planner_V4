// tools/inspect-progress-csv.mjs
//
// 진도 관리의 예시 CSV (2026-10-04 사용자 요청)를 실제 크롬으로 본다 (teacher1, PC 1400px).
//   - '⬇️ 예시 CSV 받기' → 파일이 내려오고 머리줄·예시 차시가 들어 있다
//     (컨테이너 Chromium은 파일 이름을 'download'로 준다 - 이름은 사용자 PC에서 본다)
//   - '📂 CSV 불러오기'로 그 파일을 고르면 15차시가 칸에 들어온다 (저장하지 않는다 - 자료는 그대로)
//   - CP949로 저장한 CSV도 한글이 깨지지 않는다
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-progress-csv.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true })).newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
const dir = mkdtempSync(join(tmpdir(), 'progress-csv-'));

try {
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().waitFor({ timeout: 40000 });
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /진도 관리/ }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: '진도 관리' }).first();
  await dialog.waitFor({ timeout: 10000 });
  // 새 진도에서 (저장한 진도를 건드리지 않게)
  const add = dialog.getByRole('button', { name: /새 진도/ }).first();
  if (await add.isVisible().catch(() => false)) await add.click();

  const [dl] = await Promise.all([page.waitForEvent('download'), dialog.locator('[data-progress-sample]').click()]);
  const file = join(dir, 'sample.csv');
  await dl.saveAs(file);
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  check('[받기] 예시 CSV가 내려온다 (머리줄 단원,차시,내용,교과서,준비물)', text.startsWith('단원,차시,내용,교과서,준비물'), dl.suggestedFilename());
  check('[받기] 예시 데이터가 들어 있다', text.includes('잎의 생김새 관찰하기') && text.includes('2. 물의 상태 변화'));

  await dialog.locator('[data-progress-csv-input]').setInputFiles(file);
  await page.getByText('15차시를 불러왔습니다').first().waitFor({ timeout: 5000 });
  check('[불러오기] 15차시를 불러왔다는 안내', true);
  const values = await dialog.locator('input').evaluateAll((els) => els.map((e) => e.value));
  check('[불러오기] 칸에 예시 차시가 들어온다', values.includes('잎의 생김새 관찰하기') && values.includes('끓음 관찰하기'));

  // CP949(EUC-KR) 파일: '단원,차시,내용,준비물\n,1,국어,' 의 한글을 손으로 만든 바이트
  const cp949 = Buffer.from([
    0xb4, 0xdc, 0xbf, 0xf8, 0x2c, 0xc2, 0xf7, 0xbd, 0xc3, 0x2c, 0xb3, 0xbb, 0xbf, 0xeb, 0x2c, 0xc1, 0xd8, 0xba, 0xf1, 0xb9, 0xb0, 0x0a,
    0x2c, 0x31, 0x2c, 0xb1, 0xb9, 0xbe, 0xee, 0x2c, 0x0a,
  ]);
  const f2 = join(dir, 'cp949.csv');
  writeFileSync(f2, cp949);
  await dialog.locator('[data-progress-csv-input]').setInputFiles(f2);
  await page.getByText('1차시를 불러왔습니다').first().waitFor({ timeout: 5000 });
  const v2 = await dialog.locator('input').evaluateAll((els) => els.map((e) => e.value));
  check('[불러오기] CP949로 저장한 CSV도 한글 그대로', v2.includes('국어'), v2.filter(Boolean).slice(0, 4).join(' | '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
}

check('점검 동안 페이지 오류가 없다', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fails = results.filter((r) => !r).length;
console.log(`\n결과: ${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
