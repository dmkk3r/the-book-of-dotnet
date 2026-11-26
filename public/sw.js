/* Service worker of The Book of .NET: makes the site readable offline.
 *
 * - Hashed build assets (/_astro/) are immutable: served from the cache first.
 * - Everything else (pages, search index, icons): network first with a short timeout, falling
 *   back to the cache. Successful responses are stored, so visited pages work offline.
 * - The full download ("Für offline speichern") is done by src/scripts/offline.ts into the same
 *   cache, driven by offline-manifest.json, which the build writes (scripts/build-offline.ts).
 */
const CACHE = 'book-of-dotnet-offline';
const SCOPE = new URL(self.registration.scope).pathname;
const TIMEOUT_MS = 3500;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function store(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
}

async function cacheFirst(request) {
  // ignoreVary: script and font requests carry an Origin header, the stored responses vary on it.
  // ignoreSearch: Astro retries failed islands with ?astro-retry=…, the files are content-hashed.
  const cached = await caches.match(request, { ignoreVary: true, ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  await store(request, response);
  return response;
}

async function networkFirst(request, isPage) {
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    await store(request, response);
    return response;
  } catch (error) {
    // ignoreSearch: Pagefind requests its index with a cache-busting ?ts=… parameter.
    const cached = await caches.match(request, { ignoreVary: true, ignoreSearch: true });
    if (cached) return cached;
    if (isPage) return offlinePage();
    throw error;
  }
}

function offlinePage() {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline | The Book of .NET</title>
<style>body{font:16px/28px system-ui,sans-serif;max-width:40rem;margin:15vh auto;padding:0 16px;color:#161616}
@media (prefers-color-scheme:dark){body{background:#1f1f1f;color:#fff}a{color:#75b6e7}}a{color:#0065b3}</style>
</head><body><h1>Diese Seite ist offline nicht gespeichert</h1>
<p>Du bist gerade ohne Internet. Diese Seite wurde noch nicht heruntergeladen.</p>
<p>Unter <a href="${SCOPE}fortschritt/#offline">Fortschritt</a> kannst du beim nächsten Mal alle Lektionen
für offline speichern. Bis dahin: <a href="${SCOPE}">zur Startseite</a>.</p></body></html>`;
  return new Response(html, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  if (url.pathname.endsWith('/offline-manifest.json')) return; // always from the network
  if (url.pathname.startsWith(`${SCOPE}_astro/`)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request, request.mode === 'navigate'));
});
