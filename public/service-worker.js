/* Minimal service worker for installability + offline app shell.
   IMPORTANT: only same-origin GET requests are handled. All cross-origin
   traffic (Supabase API/auth/storage, Google Fonts) is left untouched so data
   stays live and authentication is never served from cache. */
const CACHE = 'sales-tracker-v1';

self.addEventListener('install', () => {
  // Activate this worker as soon as it finishes installing.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  // Never touch cross-origin (Supabase, fonts, etc.).
  if (url.origin !== self.location.origin) return;

  // App navigations: network-first, fall back to cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match(req)) || (await cache.match('./index.html'))
          || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Static assets (JS/CSS/icons): cache-first, then network.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      return cached || Response.error();
    }
  })());
});
