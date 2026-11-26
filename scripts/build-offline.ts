/**
 * Post-build step: writes dist/offline-manifest.json, the list of every file the site needs to
 * work offline (URLs with base path, content hash, size). src/scripts/offline.ts downloads these
 * files into the service worker's cache. Run automatically by `npm run build`.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { base } from '../deploy.config.mjs';

const distDir = join(import.meta.dirname, '..', 'dist');
const EXCLUDE = new Set(['sw.js', 'offline-manifest.json']);
const basePrefix = base === '/' ? '' : base;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const files: { url: string; hash: string; size: number }[] = [];
for (const file of walk(distDir)) {
  const rel = relative(distDir, file).split(sep).join('/');
  if (EXCLUDE.has(rel) || rel.endsWith('.map')) continue;
  const content = readFileSync(file);
  // Pages are requested as directories (trailing slash), so cache them under that URL.
  const path = rel === 'index.html' ? '' : rel.replace(/(^|\/)index\.html$/, '$1');
  files.push({
    url: `${basePrefix}/${path}`,
    hash: createHash('sha256').update(content).digest('hex').slice(0, 16),
    size: content.length,
  });
}
files.sort((a, b) => a.url.localeCompare(b.url));

const version = createHash('sha256')
  .update(files.map((f) => `${f.url} ${f.hash}`).join('\n'))
  .digest('hex')
  .slice(0, 12);
const bytes = files.reduce((sum, f) => sum + f.size, 0);
writeFileSync(
  join(distDir, 'offline-manifest.json'),
  JSON.stringify({ version, builtAt: new Date().toISOString(), bytes, files }),
);
console.log(
  `Offline manifest: ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB, version ${version}.`,
);
