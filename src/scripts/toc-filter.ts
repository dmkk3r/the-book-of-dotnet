/** Filters the table of contents by title (client-side, case- and accent-insensitive). */
const root = document.querySelector<HTMLElement>('[data-toc-filter]');
const input = root?.querySelector('input');
const empty = document.querySelector<HTMLElement>('[data-toc-empty]');
const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

const chapters = [...document.querySelectorAll<HTMLElement>('[data-toc-chapter]')].map((el) => {
  const details = el.querySelector('details')!;
  return {
    el,
    details,
    wasOpen: details.open,
    title: normalize(el.querySelector('summary [data-toc-title]')?.textContent ?? ''),
    items: [...el.querySelectorAll<HTMLElement>('[data-toc-item]')].map((item) => ({
      item,
      title: normalize(item.querySelector('[data-toc-title]')?.textContent ?? ''),
    })),
  };
});

function apply(query: string): void {
  const q = normalize(query.trim());
  let matches = 0;
  for (const c of chapters) {
    if (!q) {
      c.el.hidden = false;
      c.details.open = c.wasOpen;
      c.items.forEach((i) => (i.item.hidden = false));
      continue;
    }
    const chapterHit = c.title.includes(q);
    let visible = 0;
    for (const i of c.items) {
      const hit = chapterHit || i.title.includes(q);
      i.item.hidden = !hit;
      if (hit) visible++;
    }
    c.el.hidden = visible === 0;
    c.details.open = visible > 0;
    matches += visible;
  }
  if (empty) empty.hidden = !q || matches > 0;
}

if (root && input) {
  root.hidden = false;
  input.addEventListener('input', () => apply(input.value));
}

export {};
