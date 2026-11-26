/** Off-canvas navigation below 900px: open/close, Escape, backdrop, focus handling. */
const side = document.getElementById('side');
const button = document.querySelector<HTMLButtonElement>('[data-menu-button]');
const backdrop = document.querySelector<HTMLElement>('[data-menu-backdrop]');
const main = document.getElementById('main');
const mobile = window.matchMedia('(max-width: 900px)');

function setOpen(open: boolean, restoreFocus = true): void {
  if (!side || !button || !backdrop) return;
  side.classList.toggle('open', open);
  button.setAttribute('aria-expanded', String(open));
  backdrop.hidden = !open;
  if (main) main.inert = open;
  if (open) {
    const target =
      side.querySelector<HTMLElement>('[aria-current="page"]') ?? side.querySelector('a');
    target?.focus();
  } else if (restoreFocus) {
    button.focus();
  }
}

button?.addEventListener('click', () => setOpen(!side?.classList.contains('open')));
backdrop?.addEventListener('click', () => setOpen(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && side?.classList.contains('open')) setOpen(false);
});
mobile.addEventListener('change', () => setOpen(false, false));

// Keep the current lesson visible in the sidebar without scrolling the page itself.
const current = side?.querySelector<HTMLElement>('[aria-current="page"]');
if (side && current) {
  side.scrollTop = current.offsetTop - side.clientHeight / 2;
}

export {};
