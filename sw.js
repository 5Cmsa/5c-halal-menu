// Makes the site installable and usable without a signal. Every request is
// tried on the network first, and the last good answer is kept, so offline
// the page opens with the most recent menus this device loaded.

const CACHE = 'menu-v3';
const WAIT_FOR_NETWORK_MS = 6000;

// Fetched when the app is installed, so the first offline launch works.
const SHELL = [
  './',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/classify.js',
  'js/dom.js',
  'js/hadith.js',
  'js/halls.js',
  'js/links.js',
  'js/sources.js',
  'js/stats.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'data/collins.json',
  'data/history.json',
  'data/hoch.json',
  'data/malott.json',
  'data/mcconnell.json',
  'data/pomona-hours.json',
];

// Pomona's feeds load as scripts from another site, so they are saved as
// opaque copies. A failure here must not stop the install.
const POMONA_FEEDS = ['https://api.pomona.edu/eatec/Frary.json', 'https://api.pomona.edu/eatec/Frank.json'];

// Other sites whose answers are worth keeping: menus, the hadith text, fonts.
const KEPT_HOSTS = new Set(['api.pomona.edu', '5cmenu-cache.jojodmo.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      await Promise.allSettled(POMONA_FEEDS.map(async (url) => cache.put(url, await fetch(url, { mode: 'no-cors' }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin && !KEPT_HOSTS.has(url.hostname)) return;
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = () => cache.match(request, { ignoreSearch: request.mode === 'navigate' });

  const network = fetch(request).then((response) => {
    // Opaque answers (cross-site scripts and styles) can't be inspected; keep them too.
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  });
  network.catch(() => {});

  try {
    const slow = new Promise((resolve) => setTimeout(resolve, WAIT_FOR_NETWORK_MS, null));
    const response = await Promise.race([network, slow]);
    if (response) return response;
  } catch {
    // Offline: fall through to the saved copy.
  }
  // Offline, or the network is too slow to wait for: use the saved copy, and
  // only if there is none keep waiting on the network.
  return (await saved()) ?? network;
}
