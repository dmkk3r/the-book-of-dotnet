/** "Kopieren" buttons on code blocks (hidden without JavaScript). */
import { iconSvg } from '@/lib/icons';

// Markdown code blocks get the same button in their header (drawn by CSS, see Block.astro).
for (const pre of document.querySelectorAll<HTMLPreElement>('.block-body > pre.astro-code')) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy';
  button.dataset.copy = '';
  button.hidden = true;
  button.innerHTML = `${iconSvg('copy')}<span data-copy-label>Kopieren</span>`;
  pre.prepend(button);
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  button.hidden = false;
  const label = button.querySelector('[data-copy-label]');
  button.addEventListener('click', async () => {
    const code =
      (button.closest('.codeblock') ?? button.closest('pre'))?.querySelector('code')?.textContent ??
      '';
    try {
      await navigator.clipboard.writeText(code);
      if (label) label.textContent = 'Kopiert';
    } catch {
      if (label) label.textContent = 'Kopieren nicht möglich';
    }
    window.setTimeout(() => {
      if (label) label.textContent = 'Kopieren';
    }, 2000);
  });
}

export {};
