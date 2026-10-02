// tools/gen-icons.mjs
// public/favicon.svg로 앱 아이콘 PNG를 만든다 (안드로이드가 '앱'으로 설치하려면 PNG 아이콘이 있어야 안전하다 -
// SVG만 있으면 홈 화면 바로가기로만 깔려 공유 목록(Web Share Target)에 나오지 않을 수 있다).
//   node tools/gen-icons.mjs   → public/icon-192.png · icon-512.png · icon-maskable-512.png
// favicon.svg를 바꾸면 다시 돌린다.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/favicon.svg', 'utf-8');
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await browser.newPage();

const shot = async (size, file, maskable = false) => {
  await page.setViewportSize({ width: size, height: size });
  // maskable: 바탕을 끝까지 채우고 그림은 가운데 80% 안에 (안드로이드가 원·물방울 모양으로 잘라도 남게)
  const inner = maskable ? Math.round(size * 0.8) : size;
  await page.setContent(
    `<html><body style="margin:0;background:${maskable ? '#2563EB' : 'transparent'};display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">
      <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`
  );
  await page.screenshot({ path: `public/${file}`, omitBackground: !maskable });
  console.log(`public/${file}`);
};

await shot(192, 'icon-192.png');
await shot(512, 'icon-512.png');
await shot(512, 'icon-maskable-512.png', true);
await browser.close();
