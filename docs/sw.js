// ═══════════════════════════════════════════════════════════════════════
//  FOOS — service worker
//
//  Why this exists: at the foosball table (Kevin's work) the phone joins the
//  Pi's own hotspot "FoosCam", which has NO internet. Without this, the app —
//  served from GitHub Pages — simply can't load there, so you can never reach
//  the Camera tile that points at the Pi (http://10.42.0.1). This caches the
//  whole app shell (and the Firebase SDK it imports) so the app opens with no
//  internet at all, lets you swipe to Extras → Camera, and comes back after
//  you've viewed the camera and hit Back.
//
//  Versioning: SHELL_VERSION moves in lockstep with the ?v= cache-buster in
//  index.html. Bump BOTH on every web deploy. Vendor (Firebase) URLs are
//  version-pinned and immutable, so that cache persists across deploys.
// ═══════════════════════════════════════════════════════════════════════

const SHELL_VERSION = 'v11';                       // ← keep in sync with ?v= in index.html
const SHELL_CACHE = `foos-shell-${SHELL_VERSION}`;
const VENDOR_CACHE = 'foos-vendor';                // Firebase SDK — immutable, survives deploys

// The local app shell. Query strings MUST match what index.html requests so
// cache lookups hit (styles.css?v=10, app.js?v=10).
const SHELL_ASSETS = [
  './',
  'index.html',
  `styles.css?v=${SHELL_VERSION.slice(1)}`,
  `app.js?v=${SHELL_VERSION.slice(1)}`,
  'manifest.webmanifest',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith('foos-shell-') && k !== SHELL_CACHE)
        .map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  );
});

// Cache-first: serve from cache, else fetch and stash. Used for immutable,
// versioned assets (local shell + the pinned Firebase SDK).
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Only cache real, complete responses. (Opaque cross-origin = status 0.)
  if (response && (response.ok || response.type === 'opaque')) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;              // never touch Firestore writes
  const url = new URL(request.url);

  // Firebase/Google backends (Auth, Firestore Listen channel, installations…):
  // never intercept — Firebase's own persistentLocalCache handles offline data.
  if (/(^|\.)googleapis\.com$|firebaseio\.com$|firebaseinstallations/.test(url.hostname)) {
    return;
  }

  // Top-level navigations: network-first so online users always get fresh HTML
  // (a new deploy), falling back to the cached shell when offline (FoosCam).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((r) => r || caches.match('index.html'))
          .then((r) => r || caches.match('./')),
      ),
    );
    return;
  }

  // Firebase SDK from gstatic (+ its internal chunks): cache-first, persistent.
  if (url.hostname === 'www.gstatic.com') {
    event.respondWith(cacheFirst(request, VENDOR_CACHE));
    return;
  }

  // Same-origin static assets (versioned, immutable): cache-first with network
  // fallback so a bumped ?v= self-heals even before the new SW takes over.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Anything else (e.g. the Pi at 10.42.0.1 is cross-origin and out of scope):
  // leave to the network.
});
