/**
 * Hub Service Worker
 * ------------------
 * Offline strategy (PRD §3.1, AGENTS.md Phase 5):
 *   - Static app assets: cache-first (precached shell + runtime-cached bundles).
 *   - Navigations: network-first with an app-shell fallback so SPA routes such
 *     as `/share-target` and `?action=` shortcuts resolve to `index.html` even
 *     on static hosts that would otherwise return a 404.
 *   - GitHub API: network-first, never cached (sync data must stay fresh).
 *
 * Also implements the PWA push surface: `push` renders a notification,
 * `notificationclick` focuses/opens the app, and `message` supports the
 * page->SW `SKIP_WAITING` handshake for prompt updates.
 */

const CACHE_NAME = 'hub-static-v2';

/** App shell precached on install (relative to the SW scope). */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET requests are cacheable.
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Network-first for the GitHub API: never serve stale sync data.
  if (url.hostname === 'api.github.com') {
    event.respondWith(networkFirst(request));
    return;
  }

  // SPA navigations (including /share-target and ?action= shortcuts) must
  // always resolve to the app shell.
  if (request.mode === 'navigate') {
    event.respondWith(navigateShell(request));
    return;
  }

  // Cache-first for same-origin static assets.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
  }
});

/** Serve from cache, falling back to the network and caching the response. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    throw new Error('Resource unavailable offline.');
  }
}

/** Serve the cached app shell for any navigation, refreshing it when online. */
async function navigateShell(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    // A real HTML document (not a host 404 error page) wins and refreshes the
    // cached shell so future offline loads stay current.
    if (response.ok) {
      cache.put('./index.html', response.clone());
      return response;
    }
  } catch {
    // Offline: fall through to the cached shell.
  }

  const shell = (await cache.match('./index.html')) ?? (await cache.match('./'));
  if (shell) {
    return shell;
  }
  throw new Error('App shell unavailable offline.');
}

/** Try the network first, falling back to any cached copy. */
async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw new Error('Resource unavailable offline.');
  }
}

/* ------------------------------------------------------------------ */
/* Push notifications                                                  */
/* ------------------------------------------------------------------ */

self.addEventListener('push', (event) => {
  let payload = { title: 'Hub', body: 'You have a new update.', url: './' };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: payload.tag,
      data: { url: payload.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          if ('navigate' in client) {
            void client.navigate(target);
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(target);
      }
      return undefined;
    }),
  );
});

/* ------------------------------------------------------------------ */
/* Page <-> SW messaging                                               */
/* ------------------------------------------------------------------ */

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});
