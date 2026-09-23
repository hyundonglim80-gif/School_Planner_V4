// tools/serve-both.mjs
//
// V3와 V4를 한 출처(같은 호스트)의 하위 경로에 올려 준다.
// 실제 배포가 그 모양이고, 그래야 두 앱이 localStorage를 공유한다.
// 포트를 나눠 띄우면 서로 다른 출처가 되어 공유가 안 되고, 그래서
// 예전 재현들이 전부 헛돌았다.
//
//   VITE_USE_EMULATOR=1 npm run build   (먼저)
//   node tools/serve-both.mjs
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const PORT = Number(process.env.PORT || 4190);
const ROOT = resolve('tools/.site');
const V3_SRC = resolve('../School_Planner_V3');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function buildSite() {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });

  if (!existsSync('dist')) {
    console.error('dist가 없다. 먼저: VITE_USE_EMULATOR=1 npm run build');
    process.exit(1);
  }
  cpSync('dist', join(ROOT, 'School_Planner_V4'), { recursive: true });
  cpSync(V3_SRC, join(ROOT, 'School_Planner_V3'), {
    recursive: true,
    filter: (src) => !src.includes(`${'.git'}`),
  });

  // V3 사본을 에뮬레이터에 붙인다 (원본은 건드리지 않는다)
  const p = join(ROOT, 'School_Planner_V3/js/api/firebaseInit.js');
  let s = readFileSync(p, 'utf-8');
  s = s.replace(
    'import { getAuth } from "firebase/auth";',
    'import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";'
  );
  s = s.replace(
    'import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";',
    'import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator } from "firebase/firestore";'
  );
  s += `
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234').catch((e) => console.warn(e));
`;
  writeFileSync(p, s, 'utf-8');
}

buildSite();

// ⚠️ 여기서 dist를 '한 번' 베낀다. 예전에는 그게 전부라, 서버를 띄워 둔 채
//    다시 빌드하면 새 빌드가 아니라 처음 베낀 것이 계속 나갔다. 고친 판과 안 고친
//    판을 견주는 점검이 통째로 헛돌았다(둘 다 같은 것을 재고 있었다).
//    요청마다 dist가 더 새것인지 보고, 새것이면 다시 베낀다.
let copiedAt = Date.now();
async function refreshIfRebuilt() {
  const info = await stat('dist/index.html').catch(() => null);
  if (info && info.mtimeMs > copiedAt) {
    console.log('dist가 새로 빌드되었다. 다시 베낀다.');
    buildSite();
    copiedAt = Date.now();
  }
}

createServer(async (req, res) => {
  try {
    await refreshIfRebuilt();
    let path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404).end('not found'); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(PORT, () => {
  console.log(`두 앱을 한 출처에 올렸다: http://localhost:${PORT}/School_Planner_V4/`);
  console.log(`                          http://localhost:${PORT}/School_Planner_V3/`);
});
