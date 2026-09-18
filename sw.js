/* Urban Concrete Showroom — service worker.
   Job sites have bad signal. The shell and the seed photos are cached on
   install so the app opens and the map chrome renders offline; tiles are
   cached as they are seen, so a street he has already looked at still draws.
   Jobs themselves live in IndexedDB and never needed the network. */
const VERSION = 'ucs-v1';
const SHELL = `${VERSION}-shell`;
const TILES = `${VERSION}-tiles`;
const MEDIA = `${VERSION}-media`;

const SHELL_FILES = [
  '.', 'index.html', 'assets/app.css', 'assets/app.js', 'assets/vocab.js',
  'manifest.webmanifest', 'data/seed.json', 'img/logo.webp',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      // addAll rejects the whole batch if one file 404s; add individually so a
      // single missing asset cannot leave the app with no cache at all.
      .then((c) => Promise.allSettled(SHELL_FILES.map((f) => c.add(f))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Never cache a geocode lookup — a stale address is worse than no address.
  if (url.hostname.includes('nominatim')) return;

  // Map tiles: cache-first, capped so a long drive does not fill the device.
  if (url.hostname.includes('basemaps.cartocdn.com')) {
    e.respondWith(caches.open(TILES).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      try {
        const res = await fetch(request);
        if (res.ok) {
          cache.put(request, res.clone());
          trim(TILES, 900);
        }
        return res;
      } catch (err) {
        return new Response('', { status: 504 });
      }
    }));
    return;
  }

  // Photos: cache-first, they never change once written.
  if (/\.(webp|jpg|jpeg|png|avif)$/i.test(url.pathname)) {
    e.respondWith(caches.open(MEDIA).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      try {
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      } catch (err) {
        return hit || new Response('', { status: 504 });
      }
    }));
    return;
  }

  // Everything else: network-first so a deploy is picked up, cache as backup.
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('index.html')))
  );
});

async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
