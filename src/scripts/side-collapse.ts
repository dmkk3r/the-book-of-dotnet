/** Collapse button of the table of contents (desktop only, remembered in localStorage). */
const KEY = 'book-of-dotnet:side-collapsed';
const button = document.querySelector<HTMLButtonElement>('[data-side-collapse]');

function apply(collapsed: boolean): void {
  document.documentElement.classList.toggle('side-collapsed', collapsed);
  if (!button) return;
  const label = collapsed ? 'Inhaltsverzeichnis ausklappen' : 'Inhaltsverzeichnis einklappen';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.setAttribute('aria-expanded', String(!collapsed));
}

if (button) {
  button.hidden = false;
  apply(document.documentElement.classList.contains('side-collapsed'));
  button.addEventListener('click', () => {
    const collapsed = !document.documentElement.classList.contains('side-collapsed');
    apply(collapsed);
    try {
      localStorage.setItem(KEY, collapsed ? '1' : '0');
    } catch {
      // Storage blocked: the setting lasts for this page only.
    }
  });
}

export {};
