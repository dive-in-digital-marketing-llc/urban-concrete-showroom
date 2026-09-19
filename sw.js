/* Urban Concrete Showroom — service worker.
   Job sites have bad signal. The shell and the seed photos are cached on
   install so the app opens and the map chrome renders offline; tiles are
   cached as they are seen, so a street he has already looked at still draws.
   Jobs themselves live in IndexedDB and never needed the network. */
const VERSION = 'ucs-v2';
const SHELL = `${VERSION}-shell`;
const TILES = `${VERSION}-tiles`;
const MEDIA = `${VERSION}-media`;

const SHELL_FILES = [
  '.', 'index.html', 'manifest.webmanifest', 'data/seed.json',
  'img/logo.webp', 'img/icon-180.png', 'img/icon-192.png', 'img/icon-512.png',
  // Leaflet's marker sprites are fetched by the library, not the page, so
  // they are not picked up by the network-first branch until something has
  // already drawn a default marker. Without them an offline first run gets
  // a map with no pins on it.
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png',
  'assets/app.css',
  'assets/taxonomy.js', 'assets/geo.js', 'assets/exif.js', 'assets/imaging.js',
  'assets/store.js', 'assets/intel.js', 'assets/search.js', 'assets/map.js',
  'assets/ui.js', 'assets/owner.js', 'assets/app.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css'
];

/* The sample photographs. A contractor who installs the app and then
   drives out of signal used to get a showroom with no pictures in it
   unless he happened to have scrolled past them first. They are precached
   into MEDIA rather than SHELL so the activate-time purge treats them the
   same as photos he adds himself. */
const SEED_MEDIA = 'data/seed.json';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(MEDIA)
      .then(async (cache) => {
        try {
          const res = await fetch(SEED_MEDIA, { cache: 'no-cache' });
          if (!res.ok) return;
          const book = await res.json();
          const urls = [...new Set((book.photos || []).map((p) => p.url).filter(Boolean))];
          await Promise.allSettled(urls.map((u) => cache.add(u)));
        } catch (err) { /* the app works without them; it just looks empty offline */ }
      })
      .then(() => caches.open(SHELL))
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
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        /* The index.html fallback is for NAVIGATIONS. Applied to every
           request it handed back an HTML document, with HTTP 200 and
           text/html, to whatever asked — including a <script src> that
           missed the cache, which fails as "Unexpected token '<'" and
           takes the whole app down. A 200 carrying the wrong body is
           worse than an honest failure. */
        if (request.mode === 'navigate') {
          return (await caches.match('index.html')) || Response.error();
        }
        return Response.error();
      })
  );
});

async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
