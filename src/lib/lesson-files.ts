import type { Curriculum } from './curriculum';

export interface LessonFile {
  /** Path relative to src/content/lessons, e.g. "gc/generationen.mdx". */
  path: string;
  /** The `id` from the frontmatter. */
  id: string;
}

/**
 * Checks that every lesson file belongs to the curriculum and sits in the right place:
 * src/content/lessons/<chapterId>/<lessonId>.mdx with a matching frontmatter id.
 * Returns a list of human-readable problems (empty if everything is fine).
 */
export function checkLessonFiles(files: LessonFile[], c: Curriculum): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const lesson = c.lessons.find((l) => l.id === file.id);
    if (!lesson) {
      problems.push(`${file.path}: unknown lesson id "${file.id}" (not in curriculum.json)`);
      continue;
    }
    const expected = `${lesson.chapter.id}/${lesson.id}.mdx`;
    if (file.path !== expected) {
      problems.push(`${file.path}: lesson "${file.id}" must be located at ${expected}`);
    }
    const previous = seen.get(file.id);
    if (previous) problems.push(`${file.path}: id "${file.id}" already used by ${previous}`);
    seen.set(file.id, file.path);
  }
  return problems;
}
