// sw.js for School Planner V4
const CACHE_NAME = 'sp4-offline-cache-v1';

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
