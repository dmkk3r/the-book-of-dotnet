import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { curriculum } from '../src/lib/curriculum';
import { checkLessonFiles, type LessonFile } from '../src/lib/lesson-files';

const lessonsDir = join(import.meta.dirname, '..', 'src', 'content', 'lessons');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.mdx')) yield full;
  }
}

/** Reads the `id:` field from YAML frontmatter (enough for this check, no YAML parser needed). */
function frontmatterId(source: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? '';
  return /^id:\s*["']?([^"'\s]+)["']?\s*$/m.exec(frontmatter)?.[1] ?? '';
}

describe('lesson MDX files', () => {
  it('all belong to the curriculum and sit in their chapter folder', () => {
    const files: LessonFile[] = [...walk(lessonsDir)].map((file) => ({
      path: relative(lessonsDir, file).split(sep).join('/'),
      id: frontmatterId(readFileSync(file, 'utf8')),
    }));
    expect(checkLessonFiles(files, curriculum)).toEqual([]);
  });
});

describe('checkLessonFiles', () => {
  it('accepts a correctly placed lesson', () => {
    expect(
      checkLessonFiles([{ path: 'gc/generationen.mdx', id: 'generationen' }], curriculum),
    ).toEqual([]);
  });

  it('reports unknown ids', () => {
    const [problem] = checkLessonFiles(
      [{ path: 'gc/gibts-nicht.mdx', id: 'gibts-nicht' }],
      curriculum,
    );
    expect(problem).toMatch(/unknown lesson id "gibts-nicht"/);
  });

  it('reports lessons in the wrong chapter folder or with a mismatched file name', () => {
    expect(
      checkLessonFiles([{ path: 'jit/generationen.mdx', id: 'generationen' }], curriculum)[0],
    ).toMatch(/must be located at gc\/generationen.mdx/);
    expect(
      checkLessonFiles([{ path: 'gc/gens.mdx', id: 'generationen' }], curriculum),
    ).toHaveLength(1);
  });

  it('reports the same id used twice', () => {
    const problems = checkLessonFiles(
      [
        { path: 'gc/generationen.mdx', id: 'generationen' },
        { path: 'gc/generationen-2.mdx', id: 'generationen' },
      ],
      curriculum,
    );
    expect(problems.some((p) => p.includes('already used'))).toBe(true);
  });
});
