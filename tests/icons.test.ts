import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICONS, iconSvg } from '../src/lib/icons';

// Unicode symbols that were used as icons before the site switched to one icon set.
const ICON_CHARS = /[☰◐◑◍⧉✓✔✕✖✗⟲⟳↻▶⏵⏸❚⚠★☀☾ⓘ↗]/u;
const DIRS = ['src/components', 'src/layouts', 'src/pages', 'src/scripts', 'src/styles'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(astro|tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe('icons', () => {
  it('uses icons from src/lib/icons.ts instead of Unicode symbols', () => {
    const offenders = DIRS.flatMap(files).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line, i) => ({ line: line.trim(), at: `${path}:${i + 1}` }))
        // comments may mention symbols
        .filter(({ line }) => !/^(\/\/|\*|\/\*)/.test(line) && ICON_CHARS.test(line))
        .map(({ at, line }) => `${at}: ${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it('renders every icon as an accessible-hidden SVG that takes the text colour', () => {
    for (const name of Object.keys(ICONS) as (keyof typeof ICONS)[]) {
      const svg = iconSvg(name);
      expect(svg).toMatch(/^<svg class="icon" fill="currentColor" aria-hidden="true"/);
      expect(svg).toContain('viewBox=');
    }
  });
});
