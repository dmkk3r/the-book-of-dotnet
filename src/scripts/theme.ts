/** Theme toggle: System → Hell → Dunkel. Stored in localStorage, applied early in <head>. */
import { iconSvg, type IconName } from '@/lib/icons';

type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'book-of-dotnet:theme';
const ORDER: ThemeChoice[] = ['system', 'light', 'dark'];
const LABELS: Record<ThemeChoice, string> = { system: 'System', light: 'Hell', dark: 'Dunkel' };
const ICONS: Record<ThemeChoice, IconName> = {
  system: 'theme-system',
  light: 'theme-light',
  dark: 'theme-dark',
};

function read(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Without storage the choice lasts for this page only.
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) {
    const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]!;
    const label = button.querySelector('[data-theme-label]');
    const icon = button.querySelector('.theme-icon');
    if (label) label.textContent = `Design: ${LABELS[choice]}`;
    if (icon) icon.innerHTML = iconSvg(ICONS[choice]);
    button.title = `Wechseln zu: ${LABELS[next]}`;
  }
}

let current = read();
apply(current);
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) {
  button.hidden = false;
  button.addEventListener('click', () => {
    current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
    apply(current);
  });
}

export {};
