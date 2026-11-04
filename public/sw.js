/**
 * Hub Service Worker
 * ------------------
 * Offline strategy (PRD §3.1, AGENTS.md Phase 8):
 *   - The build injects a versioned precache manifest of every emitted asset
 *     (hashed JS/CSS, `index.html`, icons, manifest) so a fresh install works
 *     offline immediately — no "install then go offline" gap (G-48).
 *   - Static metadata (manifest, icons) uses stale-while-revalidate so it
 *     revalidates in the background without blocking.
 *   - Navigations use navigation preload + a validated app-shell fallback, so a
 *     captive-portal 200 is never cached as the shell.
 *   - GitHub API: network-first, never cached (sync data must stay fresh).
 *
 * Update flow (G-49): the worker never calls `skipWaiting()` on install. The
 * page detects a `waiting` worker, offers "Update available — Reload", and only
 * then posts `SKIP_WAITING`. This keeps a deploy from swapping the worker under
 * a running page.
 *
 * The cache-version and precache-manifest placeholders below are replaced at
 * build time by the `hub-precache` Vite plugin (see `vite.config.ts`).
 */

const CACHE_VERSION = '__CACHE_VERSION__';
const PRECACHE_MANIFEST = __PRECACHE_MANIFEST__;

const CACHE_NAME = `hub-static-${CACHE_VERSION}`;
const SHELL_URL = './index.html';

/** Static metadata that should revalidate in the background. */
const STATIC_METADATA = [
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_MANIFEST)));
  // Deliberately no `skipWaiting()` here: the page controls the update flow.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));

      // Navigation preload lets the browser start the navigation request in
      // parallel with worker startup, removing the SW boot cost from the path.
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          // Navigation preload is a progressive enhancement.
        }
      }

      await self.clients.claim();
    })(),
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
    event.respondWith(navigateShell(event));
    return;
  }

  // Same-origin static assets.
  if (url.origin === self.location.origin) {
    if (isStaticMetadata(url)) {
      event.respondWith(staleWhileRevalidate(request));
    } else {
      event.respondWith(cacheFirst(request));
    }
  }
});

/** True for the manifest and icon files that should revalidate in the background. */
function isStaticMetadata(url) {
  return STATIC_METADATA.some((entry) => url.pathname.endsWith(entry.replace('./', '/')));
}

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

/** Serve the cached copy immediately, refreshing it in the background. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    return cached;
  }
  const response = await network;
  if (response) {
    return response;
  }
  throw new Error('Resource unavailable offline.');
}

/** A real HTML document (not a host 404 or captive-portal page). */
function isValidShell(response) {
  if (!response || !response.ok) {
    return false;
  }
  const type = response.headers.get('content-type') || '';
  return type.includes('text/html');
}

/** Serve the app shell for any navigation, refreshing it when online. */
async function navigateShell(event) {
  const cache = await caches.open(CACHE_NAME);

  try {
    // Prefer the navigation-preload response when the browser provided one.
    const preload = await event.preloadResponse;
    const response = preload || (await fetch(event.request));
    if (isValidShell(response)) {
      cache.put(SHELL_URL, response.clone());
      return response;
    }
  } catch {
    // Offline: fall through to the cached shell.
  }

  const shell = (await cache.match(SHELL_URL)) || (await cache.match('./'));
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
