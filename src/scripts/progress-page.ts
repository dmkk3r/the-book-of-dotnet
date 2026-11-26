/** Fortschritt page: summary, export as JSON file, import with merge, reset. */
import {
  loadProgress,
  mergeProgress,
  onProgressChange,
  parseImport,
  serializeExport,
  storeProgress,
} from '@/lib/progress';

interface LessonIndex {
  lessons: { id: string; title: string; href: string }[];
}

const root = document.querySelector<HTMLElement>('[data-progress-page]');
const index = JSON.parse(
  document.getElementById('lesson-index')?.textContent ?? '{"lessons":[]}',
) as LessonIndex;
const known = new Set(index.lessons.map((l) => l.id));
const summary = document.querySelector('[data-progress-summary]');
const list = document.querySelector('[data-progress-list]');
const message = document.querySelector<HTMLElement>('[data-progress-message]');
const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'UTC' });

function say(text: string, kind: 'ok' | 'error'): void {
  if (!message) return;
  message.textContent = text;
  message.dataset.kind = kind;
}

function render(): void {
  const progress = loadProgress();
  const done = index.lessons.filter((l) => progress.lessons[l.id]?.done);
  if (summary)
    summary.textContent = `${done.length} von ${index.lessons.length} Lektionen erledigt.`;
  if (!list) return;
  list.replaceChildren(
    ...done.map((lesson) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = lesson.href;
      a.textContent = lesson.title;
      li.append(a);
      const at = progress.lessons[lesson.id]?.completedAt;
      if (at) li.append(` (erledigt am ${dateFormat.format(new Date(at))})`);
      return li;
    }),
  );
}

if (root) {
  root.hidden = false;
  render();
  onProgressChange(render);

  root.querySelector('[data-export]')?.addEventListener('click', () => {
    const json = serializeExport(loadProgress());
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `book-of-dotnet-fortschritt-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    say('Exportdatei erstellt.', 'ok');
  });

  const input = root.querySelector<HTMLInputElement>('[data-import]');
  input?.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const result = parseImport(await file.text(), known);
    if (!result.ok) {
      say(`Import fehlgeschlagen: ${result.error}`, 'error');
      return;
    }
    const before = Object.values(loadProgress().lessons).filter((p) => p.done).length;
    const merged = mergeProgress(loadProgress(), result.progress);
    storeProgress(merged);
    const after = Object.values(merged.lessons).filter((p) => p.done).length;
    const skipped = result.unknown.length
      ? ` ${result.unknown.length} unbekannte Lektion(en) übersprungen.`
      : '';
    say(
      `Import abgeschlossen: ${after - before} Lektion(en) neu als erledigt übernommen.${skipped}`,
      'ok',
    );
  });

  root.querySelector('[data-reset]')?.addEventListener('click', () => {
    if (!window.confirm('Den gesamten Fortschritt in diesem Browser löschen?')) return;
    storeProgress({ lessons: {} });
    say('Fortschritt zurückgesetzt.', 'ok');
  });
}

export {};
