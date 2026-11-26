import { getCollection, type CollectionEntry } from 'astro:content';
import { curriculum } from './curriculum';
import { checkLessonFiles } from './lesson-files';
import { buildProblems } from './lesson-status';

export type LessonEntry = CollectionEntry<'lessons'>;

export interface LessonInfo {
  entry: LessonEntry;
  /** Raw MDX and steps file (for TODO checks). */
  texts: string[];
}

// Raw sources, keyed like "/src/content/lessons/gc/generationen.mdx".
const rawFiles = import.meta.glob<string>('/src/content/lessons/**/*.{mdx,steps.ts}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

let cache: Map<string, LessonInfo> | undefined;

/**
 * All lessons with content, keyed by lesson id. Fails the build if a file has an unknown id,
 * sits in the wrong folder, or is marked verified while it still has TODO(verify).
 */
export async function getLessons(): Promise<Map<string, LessonInfo>> {
  if (cache) return cache;
  const entries = await getCollection('lessons');
  const files = entries.map((e) => ({
    path: (e.filePath ?? e.id).replace(/^.*src\/content\/lessons\//, ''),
    id: e.data.id,
  }));
  const problems = checkLessonFiles(files, curriculum);

  const result = new Map<string, LessonInfo>();
  for (const [i, entry] of entries.entries()) {
    const base = `/src/content/lessons/${files[i]!.path.replace(/\.mdx$/, '')}`;
    // The MDX first, then every step script of the lesson (<id>.steps.ts, <id>-<name>.steps.ts).
    const stepTexts = Object.entries(rawFiles)
      .filter(
        ([key]) =>
          key.endsWith('.steps.ts') && (key.startsWith(`${base}.`) || key.startsWith(`${base}-`)),
      )
      .map(([, text]) => text);
    const texts = [rawFiles[`${base}.mdx`], ...stepTexts].filter(
      (t): t is string => t !== undefined,
    );
    problems.push(...buildProblems({ ...entry.data, texts }));
    result.set(entry.data.id, { entry, texts });
  }

  if (problems.length > 0) {
    throw new Error(`Invalid lessons:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  cache = result;
  return cache;
}

/** Ids of lessons that have content (shown as "ready" in navigation). */
export async function getReadyIds(): Promise<Set<string>> {
  return new Set((await getLessons()).keys());
}
