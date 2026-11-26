/**
 * "Für offline speichern" on the progress page: downloads every file listed in
 * offline-manifest.json into the service worker's cache (see public/sw.js). Files whose hash is
 * unchanged are skipped, so an update only fetches what changed; files no longer listed are
 * removed. Works without the service worker being active yet, the cache is shared.
 */
const CACHE = 'book-of-dotnet-offline';
const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const STATE_URL = `${base}__offline-state.json`; // never requested from the network
const PARALLEL = 6;

interface ManifestFile {
  url: string;
  hash: string;
  size: number;
}
interface Manifest {
  version: string;
  builtAt: string;
  bytes: number;
  files: ManifestFile[];
}
interface State {
  version: string;
  savedAt: string;
  hashes: Record<string, string>;
}

const root = document.querySelector<HTMLElement>('[data-offline]');
const status = root?.querySelector<HTMLElement>('[data-offline-status]');
const saveButton = root?.querySelector<HTMLButtonElement>('[data-offline-save]');
const removeButton = root?.querySelector<HTMLButtonElement>('[data-offline-remove]');
const bar = root?.querySelector<HTMLProgressElement>('[data-offline-progress]');

const files = (n: number) => (n === 1 ? '1 Datei' : `${n} Dateien`);
const mb = (bytes: number) =>
  `${(bytes / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
const date = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

async function readState(): Promise<State | undefined> {
  try {
    const cache = await caches.open(CACHE);
    const response = await cache.match(STATE_URL);
    return response ? ((await response.json()) as State) : undefined;
  } catch {
    return undefined;
  }
}

async function loadManifest(): Promise<Manifest | undefined> {
  try {
    const response = await fetch(`${base}offline-manifest.json`, { cache: 'no-store' });
    return response.ok ? ((await response.json()) as Manifest) : undefined;
  } catch {
    return undefined; // offline
  }
}

function setStatus(text: string): void {
  if (status) status.textContent = text;
}

async function refresh(): Promise<void> {
  if (!root || !saveButton || !removeButton) return;
  const [state, manifest] = await Promise.all([readState(), loadManifest()]);
  removeButton.hidden = !state;
  saveButton.disabled = !manifest;
  if (!state && !manifest) {
    setStatus('Du bist offline, und es ist noch nichts gespeichert.');
  } else if (!state) {
    setStatus(`Noch nicht gespeichert. Der Download umfasst etwa ${mb(manifest!.bytes)}.`);
    saveButton.textContent = 'Für offline speichern';
  } else if (!manifest) {
    setStatus(
      `Offline verfügbar, gespeichert am ${date(state.savedAt)}. Ob es Neues gibt, zeigt sich, sobald du wieder online bist.`,
    );
  } else if (manifest.version === state.version) {
    setStatus(`Offline verfügbar und aktuell, gespeichert am ${date(state.savedAt)}.`);
    saveButton.textContent = 'Erneut prüfen und speichern';
  } else {
    const changed = manifest.files.filter((f) => state.hashes[f.url] !== f.hash);
    const size = changed.reduce((sum, f) => sum + f.size, 0);
    setStatus(`Es gibt neue oder geänderte Inhalte (${files(changed.length)}, etwa ${mb(size)}).`);
    saveButton.textContent = 'Aktualisieren';
  }
}

async function save(): Promise<void> {
  if (!saveButton || !bar) return;
  const manifest = await loadManifest();
  if (!manifest) {
    setStatus('Speichern geht nur mit Internetverbindung.');
    return;
  }
  saveButton.disabled = true;
  try {
    // Ask the browser not to evict the data under storage pressure (granted or not, it is harmless).
    await navigator.storage?.persist?.();
  } catch {
    // ignore
  }
  const cache = await caches.open(CACHE);
  const old = (await readState())?.hashes ?? {};
  const todo = manifest.files.filter((f) => old[f.url] !== f.hash);
  const hashes: Record<string, string> = {};
  for (const f of manifest.files) if (old[f.url] === f.hash) hashes[f.url] = f.hash;

  let done = 0;
  let failed = 0;
  bar.hidden = false;
  bar.max = Math.max(1, todo.length);
  bar.value = 0;
  const queue = [...todo];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      try {
        const response = await fetch(f.url, { cache: 'reload' });
        if (!response.ok) throw new Error(String(response.status));
        await cache.put(f.url, response);
        hashes[f.url] = f.hash;
      } catch {
        failed++;
      }
      done++;
      bar.value = done;
      setStatus(`Speichere … ${done} von ${todo.length} Dateien`);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  // Remove files that are no longer part of the site (old build assets).
  const wanted = new Set(manifest.files.map((f) => new URL(f.url, location.href).href));
  wanted.add(new URL(STATE_URL, location.href).href);
  for (const request of await cache.keys()) {
    if (!wanted.has(request.url)) await cache.delete(request);
  }

  const complete = failed === 0;
  const state: State = {
    // An incomplete download keeps an outdated version, so the page offers to continue.
    version: complete ? manifest.version : 'incomplete',
    savedAt: new Date().toISOString(),
    hashes,
  };
  await cache.put(
    STATE_URL,
    new Response(JSON.stringify(state), { headers: { 'Content-Type': 'application/json' } }),
  );
  bar.hidden = true;
  saveButton.disabled = false;
  await refresh();
  if (!complete)
    setStatus(
      `${files(failed)} konnten nicht geladen werden. Versuch es noch einmal, bereits Gespeichertes bleibt erhalten.`,
    );
}

async function remove(): Promise<void> {
  await caches.delete(CACHE);
  await refresh();
  setStatus('Die Offline-Daten wurden gelöscht.');
}

if (root && 'caches' in window && 'serviceWorker' in navigator) {
  root.hidden = false;
  saveButton?.addEventListener('click', () => void save());
  removeButton?.addEventListener('click', () => void remove());
  window.addEventListener('online', () => void refresh());
  window.addEventListener('offline', () => void refresh());
  void refresh();
} else if (root) {
  root.hidden = false;
  root.querySelector<HTMLElement>('[data-offline-actions]')?.setAttribute('hidden', '');
  setStatus('Dieser Browser unterstützt das Speichern für offline nicht.');
}

export {};
