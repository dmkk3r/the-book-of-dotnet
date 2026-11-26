/**
 * Post-build check: every internal link and asset in dist/ must carry the base path
 * and point to an existing file. Run automatically by `npm run build`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { base } from '../deploy.config.mjs';
import { checkPage, extractIds } from '../src/lib/link-check.ts';
import { expectedPaths } from '../src/lib/curriculum.ts';

const distDir = join(import.meta.dirname, '..', 'dist');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

if (!existsSync(distDir)) {
  console.error('dist/ not found. Run `astro build` first.');
  process.exit(1);
}

const exists = (distPath: string) => {
  const full = join(distDir, distPath);
  return existsSync(full) && statSync(full).isFile();
};

const idCache = new Map<string, Set<string>>();
const idsOf = (distPath: string) => {
  let ids = idCache.get(distPath);
  if (!ids) {
    ids = extractIds(readFileSync(join(distDir, distPath), 'utf8'));
    idCache.set(distPath, ids);
  }
  return ids;
};

const basePrefix = base === '/' ? '' : base;
let pages = 0;
const problems = [];

for (const file of walk(distDir)) {
  if (!file.endsWith('.html')) continue;
  pages++;
  const rel = relative(distDir, file).split(sep).join('/');
  const pageUrl = `${basePrefix}/${rel.replace(/index\.html$/, '')}`;
  problems.push(...checkPage(readFileSync(file, 'utf8'), pageUrl, base, exists, idsOf));
}

// Every page the curriculum defines must exist.
for (const path of expectedPaths()) {
  const file = join(distDir, path, 'index.html');
  if (!existsSync(file)) {
    problems.push({ page: '(curriculum)', url: `${basePrefix}/${path}`, reason: 'page missing' });
  }
}

if (problems.length > 0) {
  console.error(`Link check failed: ${problems.length} broken link(s) in ${pages} page(s).`);
  for (const p of problems) console.error(`  ${p.page}  ->  ${p.url}  (${p.reason})`);
  process.exit(1);
}
console.log(`Link check passed: ${pages} page(s), base "${base}".`);
