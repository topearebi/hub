/**
 * Hub Service Worker
 * ------------------
 * Offline strategy (PRD §3.1, AGENTS.md Phase 5):
 *   - Static app assets: cache-first (precached shell + runtime-cached bundles).
 *   - GitHub API: network-first, never cached (sync data must stay fresh).
 *
 * The app shell is precached on install so Hub boots in airplane mode after the
 * first visit. Hashed Vite bundles are cached on first fetch at runtime.
 */

const CACHE_NAME = 'hub-static-v1';

/** App shell precached on install (relative to the SW scope). */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
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
    // Offline navigation: fall back to the cached app shell.
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) {
        return shell;
      }
    }
    throw new Error('Resource unavailable offline.');
  }
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
