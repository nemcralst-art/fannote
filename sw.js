/* ファンノート Service Worker
   役割：ファイルをキャッシュしてオフラインでも開けるようにする。
   ※ IndexedDB（登録した人のデータ）には一切さわりません。更新で消えません。 */

const VERSION = 'fannote-v1.8.1';

const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/sortable.min.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/favicon.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 自分のファイルだけ扱う

  // ネット優先（つながればいつも最新／つながらなければキャッシュ）
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
