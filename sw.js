// Offline-first service worker. The whole app is precached on install, so
// after the first visit SuperSplit never needs the network again.

const VERSION = 'supersplit-v15';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/core/db.js',
  './js/core/money.js',
  './js/core/split.js',
  './js/core/balances.js',
  './js/core/store.js',
  './js/core/avatar.js',
  './js/core/analytics.js',
  './js/core/receipt-ocr.js',
  './js/core/transfer.js',
  './js/export/doc.js',
  './js/export/text.js',
  './js/export/paint.js',
  './js/export/layout.js',
  './js/export/image.js',
  './js/export/pdf.js',
  './js/export/share.js',
  './js/ui/icons.js',
  './js/ui/shell.js',
  './js/ui/components.js',
  './js/ui/home.js',
  './js/ui/group.js',
  './js/ui/expense-editor.js',
  './js/ui/settlement.js',
  './js/ui/share-sheet.js',
  './js/ui/charts.js',
  './js/ui/import-sheet.js',
  './js/util/dom.js',
  './assets/favicon.svg',
  './assets/favicon-32.png',
  './assets/logo.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/maskable-512.png',
  './assets/apple-touch-icon.png',
  './assets/fonts/geist-variable.woff2',
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  './vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js',
  './vendor/tesseract/lang/eng.traineddata.gz',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // The app's own code is fetched fresh when there is a network, so a new
  // deploy takes effect on the next load rather than the one after it. With
  // no network it falls straight back to the cache, so offline is unchanged.
  const isAppCode =
    request.mode === 'navigate' ||
    /\.(?:html|js|css|webmanifest)$/.test(url.pathname) ||
    url.pathname === '/' ||
    url.pathname.endsWith('/');

  if (isAppCode && !url.pathname.includes('/vendor/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((c) => c.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('./index.html') || caches.match('./')),
        ),
    );
    return;
  }

  // Everything else (fonts, icons and vendored libraries) never changes
  // without a new filename, so it is served from the cache.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(VERSION).then((c) => c.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'));
    }),
  );
});
