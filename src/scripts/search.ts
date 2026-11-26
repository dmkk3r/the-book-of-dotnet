/**
 * Header search on top of Pagefind's JS API. The index (pagefind/) only exists after
 * `npm run build`; in `npm run dev` the panel explains that.
 */
interface PagefindResult {
  data: () => Promise<{ url: string; excerpt: string; meta: { title?: string } }>;
}
interface Pagefind {
  options: (o: { baseUrl: string }) => Promise<void>;
  init: () => Promise<void>;
  search: (q: string) => Promise<{ results: PagefindResult[] } | null>;
}

const root = document.querySelector<HTMLElement>('[data-search]');
const input = root?.querySelector<HTMLInputElement>('[data-search-input]');
const panel = root?.querySelector<HTMLElement>('[data-search-panel]');
const status = root?.querySelector<HTMLElement>('[data-search-status]');
const list = root?.querySelector<HTMLOListElement>('[data-search-list]');
const MAX_RESULTS = 8;

let pagefind: Promise<Pagefind | undefined> | undefined;
function loadPagefind(): Promise<Pagefind | undefined> {
  pagefind ??= (async () => {
    try {
      const url = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}pagefind/pagefind.js`;
      const module = (await import(/* @vite-ignore */ url)) as Pagefind;
      await module.options({ baseUrl: import.meta.env.BASE_URL.replace(/\/?$/, '/') });
      await module.init();
      return module;
    } catch {
      return undefined;
    }
  })();
  return pagefind;
}

function setOpen(open: boolean): void {
  if (!panel || !input) return;
  panel.hidden = !open;
}

let generation = 0;
async function run(query: string): Promise<void> {
  if (!status || !list) return;
  const current = ++generation;
  const q = query.trim();
  if (!q) {
    list.replaceChildren();
    setOpen(false);
    return;
  }
  setOpen(true);
  status.textContent = 'Suche läuft …';
  const pf = await loadPagefind();
  if (current !== generation) return;
  if (!pf) {
    status.textContent =
      'Die Suche ist erst nach „npm run build“ verfügbar (zum Beispiel mit „npm run preview“).';
    list.replaceChildren();
    return;
  }
  const search = await pf.search(q);
  if (current !== generation || !search) return;
  const data = await Promise.all(search.results.slice(0, MAX_RESULTS).map((r) => r.data()));
  if (current !== generation) return;
  status.textContent =
    search.results.length === 0
      ? `Keine Treffer für „${q}“.`
      : `${search.results.length} Treffer für „${q}“${search.results.length > MAX_RESULTS ? `, die ersten ${MAX_RESULTS}` : ''}.`;
  list.replaceChildren(
    ...data.map((d) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = d.url;
      const title = document.createElement('span');
      title.className = 'r-title';
      title.textContent = d.meta.title ?? d.url;
      const excerpt = document.createElement('span');
      excerpt.className = 'r-excerpt';
      // Pagefind escapes page text and only adds <mark> around hits.
      excerpt.innerHTML = d.excerpt;
      a.append(title, excerpt);
      li.append(a);
      return li;
    }),
  );
}

if (root && input && panel && list) {
  root.hidden = false;
  let timer: number | undefined;
  input.addEventListener('focus', () => void loadPagefind());
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(input.value), 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      list.querySelector('a')?.focus();
      e.preventDefault();
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      input.focus();
      return;
    }
    const links = [...list.querySelectorAll('a')];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    if (e.key === 'ArrowDown') links[Math.min(i + 1, links.length - 1)]?.focus();
    else if (e.key === 'ArrowUp') (i === 0 ? input : links[i - 1])?.focus();
    else return;
    e.preventDefault();
  });
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target as Node)) setOpen(false);
  });
  // Reopen previous results on click (not on focus, so Escape can return focus without reopening).
  input.addEventListener('click', () => {
    if (input.value.trim() && list.children.length) setOpen(true);
  });
}

export {};

// Magnifier button: opens the field, Escape or leaving an empty field closes it again.
const toggle = root?.querySelector<HTMLButtonElement>('[data-search-toggle]');
function setExpanded(open: boolean): void {
  if (!root || !toggle) return;
  root.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Suche schließen' : 'Suche öffnen');
  if (open) input?.focus();
}
toggle?.addEventListener('click', () => setExpanded(!root?.classList.contains('open')));
input?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && input.value === '') {
    setExpanded(false);
    toggle?.focus();
  }
});
root?.addEventListener('focusout', (e) => {
  const next = e.relatedTarget as Node | null;
  if (input && input.value === '' && !(next && root.contains(next))) setExpanded(false);
});
