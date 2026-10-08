// sw.js for School Planner V4
const CACHE_NAME = 'sp4-offline-cache-v1';
// 다른 앱에서 공유받은 것을 앱이 꺼낼 때까지 두는 곳 (src/lib/shareTarget.ts와 같은 이름·열쇠)
const SHARE_CACHE = 'sp4share-inbox';
const shareKey = (id, part) => `${self.location.origin}/__sp4share/${id}/${part}`;

// 공유받기 (Web Share Target - manifest.json의 share_target). 글과 파일을 캐시에 넣고
// 앱을 '?share=<id>'로 연다. 앱이 로그인한 뒤 꺼내 새 메모 칸에 채운다.
async function receiveShare(request) {
  const scope = self.registration.scope;
  try {
    const form = await request.formData();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const cache = await caches.open(SHARE_CACHE);
    const str = v => (typeof v === 'string' ? v : '');
    const files = [];
    const list = form.getAll('files');
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (!f || typeof f === 'string' || !f.size) continue;
      const key = shareKey(id, `file${i}`);
      await cache.put(key, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
      files.push({ key, name: f.name || `공유 파일 ${i + 1}`, type: f.type || '' });
    }
    const meta = { title: str(form.get('title')), text: str(form.get('text')), url: str(form.get('url')), files, at: Date.now() };
    await cache.put(shareKey(id, 'meta'), new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
    return Response.redirect(`${scope}index.html?share=${id}`, 303);
  } catch (err) {
    console.log('[SP4] 공유받기 실패:', err);
    return Response.redirect(`${scope}index.html?share=error`, 303);
  }
}

// 일정 알림 서버 푸시 (2026-10-08, functions/index.js의 sendDueAlarms가 FCM으로 보낸다).
// FCM 웹 푸시는 { data: {...}, from, ... } 모양으로 온다 - data.type === 'event-alarm'만 다룬다.
// 앱 화면을 보고 있는 창이 있으면 그 창에 넘겨 알림 창·소리로 울리고(src/hooks/useEventAlarms - 같은 일정은 한 번만),
// 없으면(앱을 닫았거나 다른 앱을 보는 중) 휴대폰·PC 알림을 띄운다. 알림 tag는 앱이 띄우는 알림과 같다(겹치면 하나로).
self.addEventListener('push', event => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = {};
  }
  const d = (msg && msg.data) || msg || {};
  if (d.type !== 'event-alarm') return;
  event.waitUntil(
    (async () => {
      const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const visible = wins.filter(c => c.visibilityState === 'visible' && c.url.startsWith(self.registration.scope));
      if (visible.length > 0) {
        visible.forEach(c => c.postMessage({ type: 'sp4-event-alarm', alarm: d }));
        return;
      }
      await self.registration.showNotification('⏰ 일정 알림', {
        body: d.content || '예정된 일정이 있습니다.',
        tag: `sp4-alarm-${d.id}`,
        renotify: true,
        requireInteraction: true,
        vibrate: [400, 200, 400, 200, 400],
        icon: `${self.registration.scope}icon-192.png`,
        badge: `${self.registration.scope}icon-192.png`,
        data: { url: `${self.registration.scope}index.html` },
      });
    })()
  );
});

// 알림을 누르면 열려 있는 앱 창으로, 없으면 새로 연다
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    (async () => {
      const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const mine = wins.find(c => c.url.startsWith(self.registration.scope));
      if (mine) return mine.focus();
      return clients.openWindow(url);
    })()
  );
});

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // 네비게이션 프리로드를 끈다.
      //
      // 브라우저가 이것을 켜 두면 문서 요청을 미리 한 번 보내 두고, 서비스
      // 워커가 event.preloadResponse로 그것을 받아 쓰기를 기대한다. 우리는
      // 안 쓰므로 콘솔에 경고가 쌓인다.
      //   The service worker navigation preload request was cancelled
      //   before 'preloadResponse' settled.
      //
      // 받아 쓰는 쪽으로 고칠 수도 있지만 그러면 안 된다. 아래 navigate
      // 갈래는 일부러 cache: 'reload'로 브라우저 HTTP 캐시까지 건너뛴다.
      // 그러지 않으면 오래된 index.html이 재사용되어 새로 배포한 앱 대신
      // 예전 앱이 뜨는 일이 있었다(화면은 멀쩡해 보여서 알아채기 어렵다).
      // 프리로드 응답은 그 우회를 거치지 않으므로, 쓰는 순간 그 문제가
      // 되돌아온다. 미리 받아 두는 이득보다 잃는 것이 크다.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.disable().catch(() => {});
      }

      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName.startsWith('sp4-') && cacheName !== CACHE_NAME) {
            console.log('[SP4] 구버전 캐시 삭제:', cacheName);
            return caches.delete(cacheName);
          }
          return undefined;
        })
      );

      await clients.claim();
    })()
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;

  if (!url.startsWith('http')) return;

  if (event.request.method === 'POST' && new URL(url).pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(event.request));
    return;
  }

  // Firebase 및 외부 API는 서비스 워커 캐시 제외
  if (url.includes('firestore') || url.includes('googleapis') || url.includes('googleusercontent') || url.includes('identitytoolkit')) {
    return;
  }

  // HTML 문서는 Network First 전략으로 항상 최신 버전 확인
  if (event.request.mode === 'navigate') {
    event.respondWith(
      // cache: 'reload' 로 브라우저의 HTTP 캐시까지 건너뛴다.
      // 이게 없으면 오래된 index.html이 재사용되어, 새로 배포한 앱 대신
      // 예전 앱이 계속 뜰 수 있다. 화면은 멀쩡해 보이므로 알아채기 어렵다.
      fetch(event.request, { cache: 'reload' }).then(response => {
        const clonedResponse = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clonedResponse);
        });
        return response;
      }).catch(() => {
        return caches.match(event.request).then(cachedResponse => {
          return cachedResponse || new Response('오프라인 상태입니다.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
    );
    return;
  }

  // 나머지 정적 리소스는 Cache First
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const clonedResponse = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clonedResponse);
        });
        return response;
      }).catch(() => {
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
