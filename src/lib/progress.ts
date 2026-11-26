/**
 * Lesson progress, stored only in localStorage. Every access is guarded:
 * the app must work fully without storage (private mode, blocked cookies).
 */

export const PROGRESS_KEY = 'book-of-dotnet:progress:v1';
export const PROGRESS_EVENT = 'book-of-dotnet:progress';

export interface LessonProgress {
  done: boolean;
  /** ISO date (YYYY-MM-DD). */
  completedAt?: string;
}

export interface Progress {
  lessons: Record<string, LessonProgress>;
}

const empty = (): Progress => ({ lessons: {} });

/** Parses stored JSON defensively; anything unexpected yields empty progress. */
export function parseProgress(json: string | null): Progress {
  if (!json) return empty();
  try {
    const data: unknown = JSON.parse(json);
    if (typeof data !== 'object' || data === null) return empty();
    const lessons = (data as { lessons?: unknown }).lessons;
    if (typeof lessons !== 'object' || lessons === null) return empty();

    const result = empty();
    for (const [id, entry] of Object.entries(lessons)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { done, completedAt } = entry as { done?: unknown; completedAt?: unknown };
      if (typeof done !== 'boolean') continue;
      result.lessons[id] = typeof completedAt === 'string' ? { done, completedAt } : { done };
    }
    return result;
  } catch {
    return empty();
  }
}

export function loadProgress(): Progress {
  try {
    return parseProgress(localStorage.getItem(PROGRESS_KEY));
  } catch {
    return empty();
  }
}

function save(progress: Progress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Storage unavailable: progress lives only for this page view.
  }
  try {
    window.dispatchEvent(new CustomEvent(PROGRESS_EVENT));
  } catch {
    // Not in a browser (tests).
  }
}

export function doneIds(progress: Progress = loadProgress()): Set<string> {
  return new Set(
    Object.entries(progress.lessons)
      .filter(([, p]) => p.done)
      .map(([id]) => id),
  );
}

export function setDone(lessonId: string, done: boolean, today = new Date()): Progress {
  const progress = loadProgress();
  progress.lessons[lessonId] = done
    ? { done: true, completedAt: today.toISOString().slice(0, 10) }
    : { done: false };
  save(progress);
  return progress;
}

/** Calls `listener` whenever progress changes in this tab or another one. */
export function onProgressChange(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === PROGRESS_KEY) listener();
  };
  window.addEventListener(PROGRESS_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(PROGRESS_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

// ---- Export and import (Phase 5) ------------------------------------------

export const EXPORT_FORMAT = 'book-of-dotnet-progress';

export interface ProgressExport {
  format: typeof EXPORT_FORMAT;
  version: 1;
  exportedAt: string;
  lessons: Progress['lessons'];
}

/** Serializes progress for download (only completed lessons). */
export function serializeExport(progress: Progress, now = new Date()): string {
  const lessons = Object.fromEntries(Object.entries(progress.lessons).filter(([, p]) => p.done));
  const data: ProgressExport = {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: now.toISOString(),
    lessons,
  };
  return JSON.stringify(data, null, 2);
}

export type ImportResult =
  { ok: true; progress: Progress; unknown: string[] } | { ok: false; error: string };

/**
 * Reads an exported file. Accepts the export format and the raw storage format.
 * Lesson ids that are not in `knownIds` are dropped and reported.
 */
export function parseImport(text: string, knownIds: ReadonlySet<string>): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Die Datei ist kein gültiges JSON.' };
  }
  if (typeof data !== 'object' || data === null || !('lessons' in data)) {
    return { ok: false, error: 'Die Datei enthält keinen Lernfortschritt.' };
  }
  const format = (data as { format?: unknown }).format;
  if (format !== undefined && format !== EXPORT_FORMAT) {
    return { ok: false, error: 'Die Datei stammt nicht von dieser Lernplattform.' };
  }
  const version = (data as { version?: unknown }).version;
  if (version !== undefined && version !== 1) {
    return { ok: false, error: `Version ${String(version)} wird nicht unterstützt.` };
  }
  const parsed = parseProgress(JSON.stringify({ lessons: (data as { lessons: unknown }).lessons }));
  const unknown: string[] = [];
  const progress: Progress = { lessons: {} };
  for (const [id, entry] of Object.entries(parsed.lessons)) {
    if (knownIds.has(id)) progress.lessons[id] = entry;
    else unknown.push(id);
  }
  return { ok: true, progress, unknown };
}

/** Merges imported progress into existing progress: a lesson stays done if either says so. */
export function mergeProgress(current: Progress, incoming: Progress): Progress {
  const result: Progress = { lessons: { ...current.lessons } };
  for (const [id, entry] of Object.entries(incoming.lessons)) {
    const existing = result.lessons[id];
    if (!existing?.done || (entry.done && !existing.completedAt)) result.lessons[id] = entry;
  }
  return result;
}

/** Replaces the stored progress (used by import and reset). */
export function storeProgress(progress: Progress): void {
  save(progress);
}
