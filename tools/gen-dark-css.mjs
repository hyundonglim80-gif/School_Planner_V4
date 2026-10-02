// tools/gen-dark-css.mjs
//
// 다크 모드(ROADMAP 17)의 색표 src/dark.css 를 만든다. 색을 바꾸려면 이 파일을 고치고 다시 돌린다:
//   node tools/gen-dark-css.mjs
//
// 왜 이렇게 하나. 화면은 Tailwind 색 클래스(bg-white, text-slate-800 ...)를 수천 군데 쓴다. Tailwind v4의 색 클래스는
// 모두 CSS 변수(var(--color-slate-800))를 읽으므로, html.dark 일 때 그 변수의 값만 바꾸면 컴포넌트를 고치지 않고 화면 전체가
// 바뀐다. 쓰임새를 세어 보니(2026-10-02):
//   - 회색(slate)은 바탕(50·100·200)·테두리(200·300)·글자(400~900)로 쓰인다 → 통째로 뒤집는다.
//   - 다른 색은 옅은 바탕(50·100)·테두리(200·300)·진한 글자(600~900)로 쓰인다 → 옅은 것은 어두운 빛깔로, 진한 것은 밝게.
//     다만 단추 바탕(bg-600·700·800·900, 흰 글자를 얹는다)은 원래 색을 지킨다 - 아래 '단추 바탕' 규칙.
//   - white는 흰 바탕(bg-white 222곳)과 흰 글자(text-white 131곳)가 같은 변수다 → 변수는 어두운 바탕으로 바꾸고,
//     흰 글자·색 단추 위 반투명 흰색은 따로 흰색으로 되돌린다.
//   모두 @media screen 안이라 인쇄는 늘 밝은 모양이다.
import { readFileSync, writeFileSync } from 'node:fs';

const theme = readFileSync('node_modules/tailwindcss/theme.css', 'utf8');
const orig = {};
for (const m of theme.matchAll(/--color-([a-z]+)-(\d+):\s*([^;]+);/g)) {
  (orig[m[1]] ||= {})[m[2]] = m[3].trim();
}

const HUES = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];
const NEUTRALS = ['slate', 'gray', 'zinc', 'neutral', 'stone'];

// 어두운 바탕 (회색 사다리) - 숫자가 클수록 밝다
const SURFACE = 'oklch(23% 0.028 262)';
const BODY = 'oklch(18% 0.024 263)';
const NEUTRAL_DARK = {
  50: 'oklch(25.5% 0.029 261)',
  100: 'oklch(28.5% 0.031 260)',
  200: 'oklch(33% 0.033 259)',
  300: 'oklch(40% 0.035 258)',
  400: 'oklch(60% 0.034 257)',
  500: 'oklch(68% 0.03 257)',
  600: 'oklch(76% 0.025 257)',
  700: 'oklch(84% 0.019 257)',
  800: 'oklch(90% 0.013 257)',
  900: 'oklch(94% 0.009 257)',
  950: 'oklch(97% 0.005 257)',
};

const mix = (color, pct) => `color-mix(in oklab, ${color} ${pct}%, ${SURFACE})`;
/** 다른 색: 옅은 바탕은 어두운 빛깔, 진한 글자는 밝게 */
const hueDark = (o) => ({
  50: mix(o[900], 28),
  100: mix(o[900], 42),
  200: mix(o[800], 55),
  300: mix(o[700], 68),
  400: o[400],
  500: o[400],
  600: o[400],
  700: o[300],
  800: o[200],
  900: o[100],
  950: o[50],
});

const vars = [];
vars.push(`    --color-white: ${SURFACE};`);
vars.push(`    --color-bg-body: ${BODY};`);
vars.push(`    --color-bg-card: ${SURFACE};`);
vars.push(`    --color-bg-hover: ${NEUTRAL_DARK[100]};`);
vars.push(`    --color-border: ${NEUTRAL_DARK[300]};`);
for (const n of NEUTRALS) {
  if (!orig[n]) continue;
  for (const [s, v] of Object.entries(NEUTRAL_DARK)) vars.push(`    --color-${n}-${s}: ${v};`);
}
for (const h of HUES) {
  const o = orig[h];
  if (!o) continue;
  for (const [s, v] of Object.entries(hueDark(o))) vars.push(`    --color-${h}-${s}: ${v};`);
}

// 단추 바탕: 흰 글자를 얹는 진한 바탕은 원래 색 (밝게 뒤집으면 흰 글자가 안 보인다)
const keep = [];
for (const h of HUES) {
  const o = orig[h];
  if (!o) continue;
  for (const s of ['600', '700', '800', '900']) {
    keep.push(`  html.dark .bg-${h}-${s}, html.dark .hover\\:bg-${h}-${s}:hover { background-color: ${o[s]}; }`);
  }
}
// 회색 진한 바탕(말풍선·어두운 단추)은 바탕보다 한 단계 밝은 회색으로
for (const s of ['700', '800', '900']) {
  keep.push(`  html.dark .bg-slate-${s}, html.dark .hover\\:bg-slate-${s}:hover { background-color: ${NEUTRAL_DARK[300]}; }`);
}

const whites = [
  `  html.dark .text-white, html.dark .hover\\:text-white:hover, html.dark .group:hover .group-hover\\:text-white { color: #fff; }`,
  `  html.dark .text-white\\/60 { color: rgb(255 255 255 / 0.6); }`,
  `  html.dark .text-white\\/50 { color: rgb(255 255 255 / 0.5); }`,
  ...[15, 25, 30].map((a) => `  html.dark .bg-white\\/${a}, html.dark .hover\\:bg-white\\/${a}:hover { background-color: rgb(255 255 255 / ${a / 100}); }`),
];

const css = `/* src/dark.css - tools/gen-dark-css.mjs 가 만든다. 손으로 고치지 말고 그 스크립트를 고쳐 다시 돌린다. (ROADMAP 17) */
@media screen {
  html.dark {
    color-scheme: dark;
${vars.join('\n')}
  }
  html.dark body {
    background-color: var(--color-bg-body);
  }
${keep.join('\n')}
${whites.join('\n')}
}
`;
writeFileSync('src/dark.css', css);
console.log(`src/dark.css: 변수 ${vars.length}개, 단추 바탕 ${keep.length}줄`);
