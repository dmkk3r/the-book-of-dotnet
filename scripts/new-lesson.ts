/**
 * Creates a new lesson from the template:
 *   npm run new:lesson -- <chapterId> <lessonId>
 * The lesson must already exist in src/data/curriculum.json.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { curriculum, lessonPath } from '../src/lib/curriculum.ts';
import { lessonFiles, resolveLesson } from '../src/lib/lesson-template.ts';

const root = join(import.meta.dirname, '..');
const [chapterId, lessonId] = process.argv.slice(2);

try {
  const lesson = resolveLesson(curriculum, chapterId, lessonId);
  const files = lessonFiles(lesson, new Date());
  for (const path of [files.mdxPath, files.stepsPath]) {
    if (existsSync(join(root, path)))
      throw new Error(`${path} already exists. Nothing was written.`);
  }
  mkdirSync(dirname(join(root, files.mdxPath)), { recursive: true });
  writeFileSync(join(root, files.mdxPath), files.mdx);
  writeFileSync(join(root, files.stepsPath), files.steps);

  console.log(`Created lesson "${lesson.title}" (status: draft)
  ${files.mdxPath}
  ${files.stepsPath}

Open in dev server: /${lessonPath(lesson.chapter.id, lesson.id)}
Next: fill in the TODOs, add sources, run npm run check && npm run test.`);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
