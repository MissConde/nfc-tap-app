/**
 * sw.js — Dance Tracker Service Worker
 * Strategy: Cache-first for static assets, Network-only for API calls.
 */

// One thing to note for deployment: When you update sw.js in the future, 
// bump CACHE_VERSION from v1 to v2 etc. — that's how the old cache gets cleared on users' devices automatically.

const CACHE_VERSION = 'dance-tracker-v1';
const STATIC_ASSETS = [
  '/nfc-tap-app/index.html',
  '/nfc-tap-app/style.css',
  '/nfc-tap-app/app.js',
  '/nfc-tap-app/manifest.json',
  '/nfc-tap-app/assets/kwanza_icon_192.png',
  '/nfc-tap-app/assets/kwanza_banner.jpeg',
];

// ─── INSTALL ─────────────────────────────────────────────────────────────────
// Pre-cache all static assets immediately when SW is installed.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // Activate immediately without waiting for old tabs to close.
  self.skipWaiting();
});

// ─── ACTIVATE ────────────────────────────────────────────────────────────────
// Delete old cache versions from previous deploys.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Take control of all open clients immediately.
  self.clients.claim();
});

// ─── FETCH ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Network-only: Google Apps Script API — never cache live data.
  if (url.hostname === 'script.google.com') {
    event.respondWith(fetch(request));
    return;
  }

  // 2. Network-only: Non-GET requests (POST registrations, feedback etc.).
  if (request.method !== 'GET') {
    event.respondWith(fetch(request));
    return;
  }

  // 3. Navigation requests (NFC URL tap → browser tries to navigate to ?id=XXXX):
  //    Serve the cached index.html immediately — launch_handler will then
  //    redirect into the existing PWA window instead of opening a new tab.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('/nfc-tap-app/index.html').then(
        (cached) => cached || fetch(request)
      )
    );
    return;
  }

  // 4. Cache-first for all other static assets (CSS, JS, images).
  //    Serve from cache instantly, update cache in background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
        }
        return response;
      });
      // Return cached version immediately if available, else wait for network.
      return cached || networkFetch;
    })
  );
});