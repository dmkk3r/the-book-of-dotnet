/**
 * Enhances the static pages with progress from localStorage:
 * done markers, per-chapter counters and bars, and the "continue" button.
 * Without JavaScript or storage, pages simply show zero progress.
 */
import { doneIds, onProgressChange } from '@/lib/progress';

interface LessonIndex {
  chapters: Record<string, string[]>;
  lessons: { id: string; title: string; href: string; ready: boolean }[];
}

function readIndex(): LessonIndex | undefined {
  const el = document.getElementById('lesson-index');
  try {
    return el?.textContent ? (JSON.parse(el.textContent) as LessonIndex) : undefined;
  } catch {
    return undefined;
  }
}

const index = readIndex();

function render(): void {
  if (!index) return;
  const done = doneIds();

  for (const el of document.querySelectorAll<HTMLElement>('[data-lesson]')) {
    const isDone = done.has(el.dataset.lesson ?? '');
    el.dataset.done = String(isDone);
    const label = el.querySelector('[data-done-label]');
    if (label) label.textContent = isDone ? ' (erledigt)' : '';
  }

  for (const scope of document.querySelectorAll<HTMLElement>('[data-progress-chapter]')) {
    const ids = index.chapters[scope.dataset.progressChapter ?? ''] ?? [];
    const count = ids.filter((id) => done.has(id)).length;
    for (const el of scope.querySelectorAll('[data-progress-count]'))
      el.textContent = String(count);
    for (const bar of scope.querySelectorAll<HTMLElement>('[data-progress-bar]')) {
      bar.style.width = ids.length ? `${(count / ids.length) * 100}%` : '0';
    }
  }

  const next =
    index.lessons.find((l) => l.ready && !done.has(l.id)) ??
    index.lessons.find((l) => !done.has(l.id));
  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-continue]')) {
    if (!next) continue;
    link.href = next.href;
    const label = link.querySelector('[data-continue-title]');
    if (label) label.textContent = next.title;
  }
}

render();
onProgressChange(render);
