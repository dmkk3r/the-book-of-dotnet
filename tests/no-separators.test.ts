import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// House style (CLAUDE.md): no dashes (– —) and no middle dots (·) as separators anywhere in the site.
const FORBIDDEN = /[–—·]/;
const root = join(import.meta.dirname, '..');

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(astro|tsx?|mdx|css|json)$/.test(entry)) yield full;
  }
}

describe('house style', () => {
  it('uses no dashes or middle dots in src', () => {
    const hits: string[] = [];
    for (const file of files(join(root, 'src'))) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (FORBIDDEN.test(line)) hits.push(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
