/**
 * Finds broken internal links in a static build. Used by scripts/check-links.ts after
 * `astro build`, and unit-tested in tests/link-check.test.ts.
 */

export interface LinkProblem {
  page: string;
  url: string;
  reason: string;
}

const ATTRIBUTE_PATTERN =
  /\s(?:href|src|component-url|renderer-url)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const SRCSET_PATTERN = /\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const EXTERNAL_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** All id attributes in an HTML document. */
export function extractIds(html: string): Set<string> {
  return new Set(
    [...html.matchAll(/\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[1] ?? m[2] ?? ''),
  );
}

/** Extracts all href/src/srcset URLs from an HTML document. */
export function extractUrls(html: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(ATTRIBUTE_PATTERN)) {
    urls.push(match[1] ?? match[2] ?? '');
  }
  for (const match of html.matchAll(SRCSET_PATTERN)) {
    const value = match[1] ?? match[2] ?? '';
    for (const candidate of value.split(',')) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) urls.push(url);
    }
  }
  return urls;
}

/**
 * Maps a URL path to the candidate files in dist that would serve it,
 * mirroring how GitHub Pages resolves directories.
 */
export function candidateFiles(pathname: string): string[] {
  const decoded = decodeURIComponent(pathname);
  if (decoded.endsWith('/')) return [`${decoded}index.html`];
  return [decoded, `${decoded}.html`, `${decoded}/index.html`];
}

/**
 * Checks every internal URL on a page.
 * @param pageUrl  Site-relative URL of the page, e.g. "/repo/kapitel/gc/".
 * @param base     Normalized base path, "/" or "/repo".
 * @param exists   Whether a path (relative to the dist root, starting with "/") exists.
 */
export function checkPage(
  html: string,
  pageUrl: string,
  base: string,
  exists: (distPath: string) => boolean,
  /** Ids defined in the target file (for #fragment checks); omit to skip fragment checks. */
  idsOf?: (distPath: string) => Set<string>,
): LinkProblem[] {
  const problems: LinkProblem[] = [];
  const basePrefix = base === '/' ? '/' : `${base}/`;

  for (const raw of extractUrls(html)) {
    const url = raw.trim();
    if (url === '' || EXTERNAL_PATTERN.test(url)) continue;

    const resolved = new URL(url, `http://localhost${pageUrl}`);
    const pathname = resolved.pathname;

    if (!pathname.startsWith(basePrefix) && pathname !== base) {
      problems.push({ page: pageUrl, url, reason: `does not start with base path "${base}"` });
      continue;
    }

    const distPath = '/' + pathname.slice(basePrefix.length).replace(/^\/+/, '');
    const normalized = pathname === base ? '/' : distPath;
    const target = candidateFiles(normalized).find(exists);
    if (!target) {
      problems.push({ page: pageUrl, url, reason: `target not found in dist (${normalized})` });
      continue;
    }
    const fragment = decodeURIComponent(resolved.hash.slice(1));
    if (fragment && idsOf && target.endsWith('.html') && !idsOf(target).has(fragment)) {
      problems.push({
        page: pageUrl,
        url,
        reason: `anchor #${fragment} not found in ${normalized}`,
      });
    }
  }
  return problems;
}
