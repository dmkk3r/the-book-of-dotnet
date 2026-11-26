/**
 * Highlights the current section in the "In diesem Artikel" rail: the last heading that has
 * scrolled past the reading line below the sticky header.
 */
const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-rail-link]')];
const targets = links
  .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
  .filter((el): el is HTMLElement => el !== null);

function update(): void {
  const line = 120;
  let current = targets[0];
  for (const t of targets) {
    if (t.getBoundingClientRect().top <= line) current = t;
  }
  // At the very bottom, the last section is current even if its heading is low.
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
    current = targets[targets.length - 1];
  }
  for (const link of links) {
    if (current && link.hash.slice(1) === current.id) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

if (targets.length) {
  let scheduled = false;
  window.addEventListener(
    'scroll',
    () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        update();
      });
    },
    { passive: true },
  );
  update();
}

export {};
