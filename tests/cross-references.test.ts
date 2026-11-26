import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { curriculum } from '../src/lib/curriculum';
import { blockTitles } from '../src/lib/slug';

const lessonsDir = join(import.meta.dirname, '..', 'src', 'content', 'lessons');

function* mdxFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* mdxFiles(full);
    else if (entry.endsWith('.mdx')) yield full;
  }
}

const files = [...mdxFiles(lessonsDir)];
const known = new Set<string>([
  ...curriculum.lessons.map((l) => l.title),
  ...curriculum.chapters.map((c) => c.title),
  ...files.flatMap((f) => blockTitles(readFileSync(f, 'utf8'))),
]);

/** Sentences that point to other lessons; every „…“ in them must be a real title. */
const REFERS = /Lektion|Mehr dazu|siehe/i;

describe('cross references between lessons', () => {
  it('only use existing lesson, chapter or section titles', () => {
    const problems: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
        .replace(/^---[\s\S]*?---/, '') // frontmatter
        .replace(/```[\s\S]*?```/g, '') // code fences
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, ''); // MDX comments
      for (const sentence of text.split(/(?<=[.!?:])\s+/)) {
        if (!REFERS.test(sentence)) continue;
        for (const match of sentence.matchAll(/„([^“]+)“/g)) {
          const title = match[1]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
          if (!known.has(title)) problems.push(`${relative(lessonsDir, file)}: „${title}“`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
